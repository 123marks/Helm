import { listProviders } from '../../services/providers'
import type { SmsRental, SmsServiceOption } from '@shared/types'
import { smsActivateDriver, smsBowerDriver } from './handlerApi'
import { smspoolDriver } from './smspool'
import { genericSmsDriver } from './generic'
import { getRental, insertRental, listRentals as listStored, updateRental } from './repo'
import type { SmsDriver } from './types'

const DRIVERS: Record<string, SmsDriver> = {
  sms_activate: smsActivateDriver,
  smsbower: smsBowerDriver,
  smspool: smspoolDriver,
  generic_sms: genericSmsDriver
}

export function resolveDefaultSms(): {
  providerId: string
  driver: SmsDriver
  config: Record<string, string | number | boolean>
} | null {
  const items = listProviders('sms')
  const chosen = items.find((p) => p.isDefault && p.enabled) ?? items.find((p) => p.enabled)
  if (!chosen) return null
  const driver = DRIVERS[chosen.driver]
  if (!driver) return null
  return { providerId: chosen.id, driver, config: chosen.config }
}

function resolvedOrThrow(): NonNullable<ReturnType<typeof resolveDefaultSms>> {
  const r = resolveDefaultSms()
  if (!r) throw new Error('未配置可用的默认接码服务，请到「服务中心」添加并设为默认')
  return r
}

export async function rentNumber(opts: {
  service: string
  country?: string
  accountId?: string
  taskId?: string
  signal?: AbortSignal
}): Promise<SmsRental> {
  const r = resolvedOrThrow()
  const rental = await r.driver.rent({ config: r.config, signal: opts.signal }, opts.service, opts.country)
  return insertRental({
    providerId: r.providerId,
    rental,
    accountId: opts.accountId,
    taskId: opts.taskId
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * A polling error we must NOT keep retrying on: the rental is gone, the key is
 * bad, or the number was cancelled/banned. Everything else (network blips,
 * timeouts, 5xx, rate limits, non-JSON) is transient — a paid number is already
 * rented, so we keep waiting instead of throwing it away.
 */
function isFatalSmsError(message: string): boolean {
  return /API Key 无效|不属于当前 Key|记录不存在|已取消该号码|被平台封禁|BAD_KEY|NO_ACTIVATION|STATUS_CANCEL|BANNED/i.test(
    message
  )
}

export async function waitForSmsCode(
  rentalId: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  const row = getRental(rentalId)
  if (!row) throw new Error('接码记录不存在')
  const r = resolvedOrThrow()
  const timeout = opts?.timeoutMs ?? 180000
  const start = Date.now()
  let received = false
  let lastTransient = ''
  try {
    while (Date.now() - start < timeout) {
      if (opts?.signal?.aborted) throw new Error('已取消')
      let code: string | null = null
      try {
        code = await r.driver.fetchCode({ config: r.config, signal: opts?.signal }, row.remoteId)
      } catch (err) {
        const msg = (err as Error).message || ''
        // A fatal condition means the number is unusable — stop and release it.
        if (isFatalSmsError(msg)) throw err
        // Otherwise the number is still ours; note the blip and keep polling.
        lastTransient = msg
      }
      if (code) {
        received = true
        updateRental(rentalId, { status: 'code_received', code })
        await r.driver.finish({ config: r.config }, row.remoteId).catch(() => undefined)
        updateRental(rentalId, { status: 'finished' })
        return code
      }
      await sleep(5000)
    }
    throw new Error(
      lastTransient
        ? `等待短信验证码超时（${Math.round(timeout / 1000)}s）；最近一次接口异常：${lastTransient}`
        : `等待短信验证码超时（${Math.round(timeout / 1000)}s）`
    )
  } catch (e) {
    if (!received) await cancelRental(rentalId).catch(() => undefined)
    throw e
  }
}

export async function cancelRental(rentalId: string): Promise<void> {
  const row = getRental(rentalId)
  if (!row) return
  const r = resolveDefaultSms()
  if (r) await r.driver.cancel({ config: r.config }, row.remoteId).catch(() => undefined)
  updateRental(rentalId, { status: 'canceled' })
}

export async function finishRental(rentalId: string): Promise<void> {
  const row = getRental(rentalId)
  if (!row) return
  const r = resolveDefaultSms()
  if (r) await r.driver.finish({ config: r.config }, row.remoteId).catch(() => undefined)
  updateRental(rentalId, { status: 'finished' })
}

export function listRentals(): SmsRental[] {
  return listStored()
}

export async function listSmsServices(country?: string): Promise<SmsServiceOption[]> {
  const r = resolveDefaultSms()
  if (!r?.driver.services) return []
  return r.driver.services({ config: r.config }, country)
}

export async function testSmsDriver(
  driver: string,
  config: Record<string, string | number | boolean>
): Promise<{ ok: boolean; message: string }> {
  const d = DRIVERS[driver]
  if (!d) return { ok: false, message: '未知接码驱动' }
  const bal = await d.balance({ config })
  if (bal.amount <= 0) return { ok: false, message: `余额为 0（${bal.currency}），请先充值` }
  return { ok: true, message: `余额：${bal.amount} ${bal.currency}` }
}
