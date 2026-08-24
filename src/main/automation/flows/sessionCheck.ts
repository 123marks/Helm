import type { Flow, FlowResult } from '../types'
import type { Platform } from '@shared/types'
import { firstVisible } from './util'

const HOME: Record<string, { url: string; signedIn: RegExp }> = {
  microsoft: { url: 'https://account.microsoft.com/', signedIn: /account\.microsoft|outlook\.live|onedrive/i },
  apple: { url: 'https://account.apple.com/', signedIn: /account\.apple|appleid/i },
  discord: { url: 'https://discord.com/channels/@me', signedIn: /channels\/@me|discord\.com\/app/i },
  openai: { url: 'https://chatgpt.com/', signedIn: /chatgpt\.com\/(#|c\/|\?)/i },
  anthropic: { url: 'https://claude.ai/', signedIn: /claude\.ai\/(new|chat|project)/i },
  cursor: { url: 'https://cursor.com/settings', signedIn: /cursor\.com\/(settings|dashboard|agents)/i },
  windsurf: { url: 'https://windsurf.com/', signedIn: /windsurf/i },
  kiro: { url: 'https://app.kiro.dev', signedIn: /kiro\.dev|app\.kiro/i },
  grok: { url: 'https://grok.com/', signedIn: /grok\.com\/($|\?|#|c\/)/i },
  antigravity: { url: 'https://antigravity.google', signedIn: /antigravity\.google/i }
}

function makeCheck(platform: Platform): Flow {
  const spec = HOME[platform]
  return {
    platform,
    action: 'check_login',
    title: `${platform} 登录检测`,
    description: '打开该平台并检查独立 Chrome 配置里是否已有登录态。没有则尝试用账号密码登录。',
    params: [],
    async run(ctx): Promise<FlowResult> {
      if (!spec) throw new Error('该平台没有登录检测地址')
      await ctx.step('打开站点', async () => {
        await ctx.page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await ctx.page.waitForTimeout(2000)
      })
      ctx.setProgress(40)
      const url = ctx.page.url()
      if (spec.signedIn.test(url)) {
        return { ok: true, message: '已是登录态' }
      }
      const emailEl = await firstVisible(
        ctx.page,
        ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[autocomplete="username"]'],
        4000
      )
      if (emailEl && ctx.account.email) {
        await ctx.step('填写登录信息', async () => {
          await emailEl.fill(ctx.account.email)
          const next = ctx.page.getByRole('button', { name: /continue|next|sign in|登录|下一步/i }).first()
          if (await next.isVisible().catch(() => false)) await next.click()
          await ctx.page.waitForTimeout(1200)
          if (ctx.secrets.password) {
            const pw = await firstVisible(ctx.page, ['input[type="password"]', 'input[name="password"]'], 8000)
            if (pw) {
              await pw.fill(ctx.secrets.password)
              const submit = ctx.page.getByRole('button', { name: /continue|sign in|log in|登录/i }).first()
              if (await submit.isVisible().catch(() => false)) await submit.click()
            }
          }
          await ctx.page.waitForTimeout(2500)
        })
      }
      const after = ctx.page.url()
      const ok = spec.signedIn.test(after) || !/login|signin|sign-in|auth/i.test(after)
      return {
        ok,
        message: ok ? '登录检测完成' : '未确认登录态，请关闭无头后在弹出的浏览器里手动登录'
      }
    }
  }
}

export const sessionCheckFlows: Flow[] = (
  ['microsoft', 'apple', 'discord', 'openai', 'anthropic', 'cursor', 'windsurf', 'kiro', 'grok', 'antigravity'] as Platform[]
).map(makeCheck)
