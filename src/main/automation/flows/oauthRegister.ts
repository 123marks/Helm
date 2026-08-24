import type { Page } from 'playwright-core'
import type { Flow, FlowResult } from '../types'
import type { Platform } from '@shared/types'
import { firstVisible } from './util'
import { getAccount } from '../../db/repositories/accounts'
import { reauthenticate } from './google/common'

export interface OAuthRegisterSpec {
  platform: Platform
  title: string
  description: string
  signupUrl: string
  providers: Array<'google' | 'github'>
  oauthButtonSelectors: Record<'google' | 'github', string[]>
  successUrlIncludes?: string
}

function makeOAuthRegisterFlow(spec: OAuthRegisterSpec): Flow {
  return {
    platform: spec.platform,
    action: 'register_oauth',
    title: spec.title,
    description: spec.description,
    params: [
      {
        key: 'oauthProvider',
        label: '授权方式',
        type: 'select',
        required: true,
        options: spec.providers.map((p) => ({
          value: p,
          label: p === 'google' ? 'Google' : 'GitHub'
        }))
      },
      { key: 'sourceAccountId', label: '授权源账号 ID', type: 'text', required: true }
    ],
    async run(ctx): Promise<FlowResult> {
      const provider = (String(ctx.params.oauthProvider || spec.providers[0]) as 'google' | 'github')
      const sourceId = String(ctx.params.sourceAccountId || '')
      const source = sourceId ? getAccount(sourceId) : null
      if (!source) throw new Error('未指定授权源账号。请先在账号库中准备一个已登录的 Google/GitHub 账号')

      await ctx.step('打开注册页', async () => {
        await ctx.page.goto(spec.signupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await ctx.page.waitForTimeout(1500)
      })
      ctx.setProgress(25)

      const popupPromise = ctx.context.waitForEvent('page', { timeout: 12000 }).catch(() => null)

      await ctx.step(`点击 ${provider} 授权`, async () => {
        const sels = spec.oauthButtonSelectors[provider] ?? []
        const el = await firstVisible(ctx.page, sels, 8000)
        if (el) {
          await el.click()
        } else {
          const name =
            provider === 'google'
              ? /continue with google|sign (up|in) with google|使用 Google/i
              : /continue with github|sign (up|in) with github|使用 GitHub/i
          const btn = ctx.page.getByRole('button', { name }).first()
          if (!(await btn.isVisible().catch(() => false))) {
            throw new Error(`未找到「使用 ${provider} 继续」按钮`)
          }
          await btn.click()
        }
        await ctx.page.waitForTimeout(1500)
      })
      ctx.setProgress(50)

      const popup = await popupPromise
      const auth: Page = popup ?? ctx.page

      await ctx.step('处理授权页', async () => {
        await auth.waitForLoadState('domcontentloaded').catch(() => undefined)
        await auth.waitForTimeout(1200)
        const authUrl = auth.url()
        if (/accounts\.google\.com\/.*(signin|identifier)|github\.com\/login/i.test(authUrl)) {
          throw new Error(
            '源账号未登录。请先对该 Google/GitHub 账号运行「登录检测」，完成登录后再重试 OAuth 注册'
          )
        }
        await reauthenticate({ ...ctx, page: auth })

        const email = (source.email || source.username).toLowerCase()
        const chooser = auth.locator(`[data-identifier="${email}"], [data-email="${email}"]`).first()
        if (await chooser.isVisible().catch(() => false)) await chooser.click()
        else {
          const byText = auth.getByText(source.email || source.username, { exact: false }).first()
          if (await byText.isVisible().catch(() => false)) await byText.click().catch(() => undefined)
        }
        await auth.waitForTimeout(1500)

        if (provider === 'github') await auth.waitForTimeout(3500)
        const allow = auth
          .getByRole('button', { name: /continue|allow|authorize|同意|继续|允许/i })
          .first()
        if (await allow.isVisible().catch(() => false)) await allow.click().catch(() => undefined)
        await auth.waitForTimeout(2000)
      })
      ctx.setProgress(80)

      if (spec.successUrlIncludes) {
        await ctx.page
          .waitForURL((u) => u.href.includes(spec.successUrlIncludes!), { timeout: 45000 })
          .catch(() => undefined)
      }

      const url = ctx.page.url()
      const body = (await ctx.page.textContent('body').catch(() => '')) ?? ''
      if (/already (have|exists)|account exists|已存在|already registered/i.test(body)) {
        return { ok: true, message: '目标平台已存在该账号（按已注册处理）' }
      }
      if (spec.successUrlIncludes && !url.includes(spec.successUrlIncludes) && !ctx.headless) {
        ctx.log('warn', '未检测到成功 URL，请在浏览器中确认结果')
      }

      return {
        ok: true,
        message: `已通过 ${provider} 完成 ${spec.platform} 注册`,
        data: {
          accountPatch: {
            email: source.email,
            oauthProvider: provider,
            oauthSourceAccountId: source.id,
            status: 'active',
            notes: `OAuth 注册于 ${new Date().toLocaleString()} · 源账号 ${source.label}`
          }
        }
      }
    }
  }
}

const SPECS: OAuthRegisterSpec[] = [
  {
    platform: 'openai',
    title: 'OpenAI 注册（OAuth）',
    description: '用已有 Google 账号在 OpenAI 完成注册。',
    signupUrl: 'https://auth.openai.com/create-account',
    providers: ['google'],
    oauthButtonSelectors: {
      google: ['button:has-text("Continue with Google")', '[data-provider="google"]'],
      github: []
    },
    successUrlIncludes: 'chatgpt.com'
  },
  {
    platform: 'cursor',
    title: 'Cursor 注册（OAuth）',
    description: '用已有 Google / GitHub 账号注册 Cursor。',
    signupUrl: 'https://authenticator.cursor.sh/sign-up',
    providers: ['google', 'github'],
    oauthButtonSelectors: {
      google: ['button:has-text("Google")', '[data-provider="google"]'],
      github: ['button:has-text("GitHub")', '[data-provider="github"]']
    },
    successUrlIncludes: 'cursor.com'
  },
  {
    platform: 'windsurf',
    title: 'Windsurf 注册（OAuth）',
    description: '用已有 Google / GitHub 账号注册 Windsurf。',
    signupUrl: 'https://windsurf.com/account/register',
    providers: ['google', 'github'],
    oauthButtonSelectors: {
      google: ['button:has-text("Google")'],
      github: ['button:has-text("GitHub")']
    },
    successUrlIncludes: 'windsurf.com'
  },
  {
    platform: 'discord',
    title: 'Discord 注册（OAuth）',
    description: '用已有 Google 账号注册 Discord。',
    signupUrl: 'https://discord.com/register',
    providers: ['google'],
    oauthButtonSelectors: {
      google: ['button:has-text("Google")', '[data-provider="google"]'],
      github: []
    },
    successUrlIncludes: 'discord.com/channels'
  },
  {
    platform: 'kiro',
    title: 'Kiro 注册（OAuth）',
    description: '用已有 Google / GitHub 账号在官方页授权登录 Kiro。',
    signupUrl: 'https://app.kiro.dev',
    providers: ['google', 'github'],
    oauthButtonSelectors: {
      google: ['button:has-text("Google")'],
      github: ['button:has-text("GitHub")']
    },
    successUrlIncludes: 'kiro.dev'
  },
  {
    platform: 'grok',
    title: 'Grok 注册（OAuth）',
    description: '用已有 Google / X 账号在 xAI 官方页授权登录 Grok。',
    signupUrl: 'https://accounts.x.ai/sign-in',
    providers: ['google'],
    oauthButtonSelectors: {
      google: ['button:has-text("Google")'],
      github: []
    },
    successUrlIncludes: 'x.ai'
  },
  {
    platform: 'antigravity',
    title: 'Antigravity 注册（OAuth）',
    description: '用已有 Google 账号在 Antigravity 官方页授权登录。',
    signupUrl: 'https://antigravity.google',
    providers: ['google'],
    oauthButtonSelectors: {
      google: ['button:has-text("Google")', 'button:has-text("使用 Google")'],
      github: []
    },
    successUrlIncludes: 'antigravity.google'
  }
]

export const oauthRegisterFlows: Flow[] = SPECS.map(makeOAuthRegisterFlow)

export function oauthRegisterablePlatforms(): Platform[] {
  return SPECS.map((s) => s.platform)
}
