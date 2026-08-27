// Provider catalog shared by main + renderer. A "provider" is an external
// service used during account automation/registration:
//   - mailbox : receive email verification codes / links
//   - captcha : solve Turnstile / reCAPTCHA / hCaptcha
//   - sms     : rent a phone number and receive SMS codes
//   - proxy   : route browser / HTTP traffic
//
// Each driver declares a `fields` template so the settings UI can render a
// dynamic form. Keep this file free of Node/DOM imports.

export type ProviderType = 'mailbox' | 'captcha' | 'sms' | 'proxy'

export type ProviderFieldType = 'text' | 'password' | 'textarea' | 'number' | 'boolean'

export interface ProviderField {
  key: string
  label: string
  type: ProviderFieldType
  required?: boolean
  placeholder?: string
  help?: string
  secret?: boolean // stored encrypted, masked in UI
  defaultValue?: string | number | boolean
}

export interface ProviderDriver {
  type: ProviderType
  driver: string
  label: string
  description: string
  /** true when the driver needs no configuration (e.g. free temp-mail, manual solve). */
  noConfig?: boolean
  fields: ProviderField[]
  /** mailbox drivers that can create an inbox + poll for codes support a "test" action. */
  testable?: boolean
  /** Declared in the catalog but not yet wired in the main process. */
  unimplemented?: boolean
}

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  mailbox: '邮箱服务',
  captcha: '验证码服务',
  sms: '接码服务',
  proxy: '代理资源'
}

export const PROVIDER_DRIVERS: ProviderDriver[] = [
  // ── Mailbox ──────────────────────────────────────────────
  {
    type: 'mailbox',
    driver: 'tempmail_lol',
    label: 'TempMail.lol（免费临时邮箱）',
    description: '免注册生成临时邮箱，批量注册会自动收验证码/链接并填回，形成闭环。',
    testable: true,
    fields: [
      {
        key: 'apiBase',
        label: 'API 地址（可选）',
        type: 'text',
        placeholder: 'https://api.tempmail.lol/v2',
        help: '留空使用默认公共 API。'
      }
    ]
  },
  {
    type: 'mailbox',
    driver: 'testmail',
    label: 'testmail.app',
    description: '需 API Key 与命名空间，地址形如 {namespace}.{tag}@inbox.testmail.app。',
    testable: true,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true },
      { key: 'namespace', label: 'Namespace', type: 'text', required: true },
      { key: 'tagPrefix', label: 'Tag 前缀（可选）', type: 'text' }
    ]
  },
  {
    type: 'mailbox',
    driver: 'imap',
    label: 'IMAP 邮箱（推荐）',
    description: '自己的 Gmail / Outlook / 域名邮箱。IMAP 收验证码，注册时自动派生 plus 地址。',
    testable: true,
    fields: [
      { key: 'host', label: 'IMAP 服务器', type: 'text', required: true, placeholder: 'imap.gmail.com' },
      { key: 'port', label: 'IMAP 端口', type: 'number', required: true, defaultValue: 993 },
      { key: 'secure', label: '使用 TLS', type: 'boolean', defaultValue: true },
      { key: 'user', label: '登录邮箱', type: 'text', required: true },
      {
        key: 'pass',
        label: '密码 / 应用专用密码',
        type: 'password',
        required: true,
        secret: true,
        help: 'Gmail 需在账号安全设置生成「应用专用密码」，不能用登录密码。'
      },
      {
        key: 'baseAddress',
        label: '派生地址基址（可选）',
        type: 'text',
        placeholder: 'me@gmail.com',
        help: '留空则用登录邮箱。注册时会派生 me+xxxx@gmail.com。'
      },
      { key: 'plusAddressing', label: '启用 plus-address 派生', type: 'boolean', defaultValue: true },
      { key: 'mailbox', label: '收信文件夹', type: 'text', defaultValue: 'INBOX' },
      { key: 'smtpHost', label: 'SMTP 服务器（可选）', type: 'text', placeholder: 'smtp.gmail.com' },
      { key: 'smtpPort', label: 'SMTP 端口（可选）', type: 'number', defaultValue: 465 }
    ]
  },
  {
    type: 'mailbox',
    driver: 'icloud_imap',
    label: 'Apple iCloud 邮箱（IMAP）',
    description: '用自己的 iCloud / Apple ID 收验证码。需在 appleid.apple.com 生成 App 专用密码；会派生 user+xxxx@icloud.com。',
    testable: true,
    fields: [
      {
        key: 'user',
        label: 'iCloud 邮箱',
        type: 'text',
        required: true,
        placeholder: 'name@icloud.com'
      },
      {
        key: 'pass',
        label: 'App 专用密码',
        type: 'password',
        required: true,
        secret: true,
        help: '不是登录密码。在 appleid.apple.com → 登录和安全 → App 专用密码 生成。'
      },
      {
        key: 'baseAddress',
        label: '派生基址（可选）',
        type: 'text',
        placeholder: 'name@icloud.com',
        help: '留空则用登录邮箱。注册时派生 name+xxxx@icloud.com。'
      },
      { key: 'plusAddressing', label: '启用 plus-address 派生', type: 'boolean', defaultValue: true }
    ]
  },
  {
    type: 'mailbox',
    driver: 'icloud_hme',
    label: 'iCloud Hide My Email（本地 icloud-hme）',
    description:
      '对接 xiaozhou26/icloud-hme：每次注册创建独立 @icloud.com 隐藏别名并读信。先在本机启动该服务并登录 Apple 账号。',
    testable: true,
    fields: [
      {
        key: 'apiUrl',
        label: '服务地址',
        type: 'text',
        required: true,
        defaultValue: 'http://127.0.0.1:8081',
        placeholder: 'http://127.0.0.1:8081'
      },
      {
        key: 'adminPassword',
        label: '管理员密码',
        type: 'password',
        required: true,
        secret: true,
        help: 'icloud-hme 启动时的 ICLOUD_HME_ADMIN_PASSWORD。'
      },
      {
        key: 'accountId',
        label: '账号 ID（可选）',
        type: 'text',
        placeholder: 'acc_1',
        help: '留空则自动选用第一个已激活的 iCloud 账号。'
      }
    ]
  },
  {
    type: 'mailbox',
    driver: 'icloud_mail',
    label: 'iCloud Mail API（商业接码）',
    description:
      '兼容 reg-factory 的 iCloud 接码接口：GET /api/user/email 申请地址，GET /api/user/mail 取信。',
    testable: true,
    fields: [
      {
        key: 'apiBase',
        label: 'API 地址',
        type: 'text',
        required: true,
        placeholder: 'https://mail.no-replyca.xyz',
        defaultValue: 'https://mail.no-replyca.xyz'
      },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true },
      {
        key: 'mailType',
        label: '类型',
        type: 'text',
        defaultValue: 'icloud',
        help: 'icloud=普通子邮箱；icloud-code=按服务取码。'
      },
      {
        key: 'service',
        label: '服务代号（icloud-code 时）',
        type: 'text',
        defaultValue: 'github',
        placeholder: 'github'
      }
    ]
  },
  {
    type: 'mailbox',
    driver: 'cfworker',
    label: 'Cloudflare Worker 自建邮箱',
    description: '用自己的域名接信：POST /api/inbox 创建，GET /api/inbox/{address}/messages 收验证码。',
    testable: true,
    fields: [
      { key: 'apiUrl', label: 'API 地址', type: 'text', required: true, placeholder: 'https://mail.example.com' },
      { key: 'adminToken', label: '管理 Token', type: 'password', secret: true },
      { key: 'domain', label: '邮箱域名', type: 'text', placeholder: 'example.com' }
    ]
  },
  {
    type: 'mailbox',
    driver: 'generic_http',
    label: '通用 HTTP 邮箱',
    description: '用 URL 模板对接任意临时邮箱 API，支持 {email}/{token} 占位符。',
    testable: true,
    fields: [
      { key: 'createUrl', label: '创建邮箱 URL', type: 'text', required: true },
      { key: 'createMethod', label: '创建请求方法', type: 'text', defaultValue: 'POST' },
      { key: 'emailPath', label: '邮箱地址的 JSON 路径', type: 'text', required: true, placeholder: 'data.address' },
      { key: 'tokenPath', label: '令牌的 JSON 路径', type: 'text', placeholder: 'data.token' },
      {
        key: 'listUrl',
        label: '拉取邮件 URL',
        type: 'text',
        required: true,
        placeholder: 'https://api.example.com/inbox?token={token}'
      },
      { key: 'listPath', label: '邮件数组的 JSON 路径', type: 'text', defaultValue: 'emails' },
      { key: 'token', label: '固定 Bearer Token（可选）', type: 'password', secret: true }
    ]
  },
  {
    type: 'mailbox',
    driver: 'mail_pickup',
    label: '取件链接邮箱（iCloud 商业号）',
    description:
      '粘贴已买好的邮箱+取件页，注册时弹出一个地址并轮询收码。支持 mail.xxx/messages 与 flysms pickup。',
    testable: true,
    fields: [
      {
        key: 'stock',
        label: '库存（每行一个）',
        type: 'textarea',
        required: true,
        secret: true,
        placeholder:
          'name@icloud.com----https://mail.example.com/messages/ID/name@icloud.com\nname@icloud.com---tok_xxx---https://flysms.example/icloud/pickup#email=name@icloud.com&key=tok_xxx',
        help: '每行：邮箱----取件URL，或 邮箱---token---取件URL。批量注册每成功申请一个就从库存扣一行。'
      }
    ]
  },
  {
    type: 'mailbox',
    driver: 'outlook_graph',
    label: 'Outlook Graph / OAuth2（gr/o2 双令牌）',
    description:
      '微软长效号：Graph 读信，失败则走 OAuth2 IMAP。库存格式 email----密码----clientId----refreshToken。',
    testable: true,
    fields: [
      {
        key: 'stock',
        label: '库存（每行一个双令牌号）',
        type: 'textarea',
        secret: true,
        placeholder:
          'name@outlook.com----password----xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx----M.C519_BAY.0.U.-…',
        help: 'gr/o2 双令牌：邮箱----密码----Azure client_id----refresh_token。有库存时每次注册消耗一行；无库存则用下方单个账号并派生 plus 地址。'
      },
      { key: 'email', label: '单个账号邮箱（无库存时）', type: 'text', placeholder: 'name@outlook.com' },
      { key: 'password', label: '密码（可选，IMAP 备用）', type: 'password', secret: true },
      {
        key: 'clientId',
        label: 'Azure 应用 client_id',
        type: 'text',
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
      },
      { key: 'refreshToken', label: 'OAuth2 / Graph refresh token', type: 'password', secret: true },
      {
        key: 'plusAddressing',
        label: '无库存时启用 plus-address 派生',
        type: 'boolean',
        defaultValue: true
      }
    ]
  },
  // ── Captcha ──────────────────────────────────────────────
  {
    type: 'captcha',
    driver: 'twocaptcha',
    label: '2Captcha',
    description: '主流打码平台，支持 Turnstile / reCAPTCHA / hCaptcha。',
    testable: true,
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true }]
  },
  {
    type: 'captcha',
    driver: 'yescaptcha',
    label: 'YesCaptcha',
    description: '打码平台，2Captcha 兼容协议。',
    testable: true,
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true }]
  },
  {
    type: 'captcha',
    driver: 'captcha_run',
    label: 'captcha.run（PerimeterX）',
    description:
      '纯协议 PerimeterX 打码（PxCaptcha2）。Outlook 协议注册专用，需配合住宅代理；「测试」查钱包余额。',
    testable: true,
    fields: [
      { key: 'apiKey', label: 'API Key（Bearer）', type: 'password', required: true, secret: true },
      {
        key: 'apiBase',
        label: 'API 地址',
        type: 'text',
        defaultValue: 'https://apicn.captcha.run',
        placeholder: 'https://apicn.captcha.run',
        help: '国内 apicn.captcha.run；海外可用 https://api.captcha.run。'
      }
    ]
  },
  {
    type: 'captcha',
    driver: 'ezcaptcha',
    label: 'EzCaptcha（PerimeterX 备选）',
    description: 'PerimeterX / PxInvisible 打码，作为 captcha.run 的兜底。',
    testable: true,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true },
      { key: 'apiBase', label: 'API 地址', type: 'text', defaultValue: 'https://api.ez-captcha.com' }
    ]
  },
  {
    type: 'captcha',
    driver: 'capsolver',
    label: 'CapSolver（PerimeterX / 文本 OCR 备选）',
    description: 'AntiPerimeterX 与文本图形验证码 OCR，作为兜底。',
    testable: true,
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true }]
  },
  {
    type: 'captcha',
    driver: 'manual',
    label: '手动打码',
    description: '弹出浏览器让你手动完成验证，无需 API Key。',
    noConfig: true,
    fields: []
  },
  // ── SMS ──────────────────────────────────────────────────
  {
    type: 'sms',
    driver: 'sms_activate',
    label: 'SMS-Activate 兼容协议',
    description:
      'handler_api.php 协议。官方已于 2025-12 关停，请填写兼容平台地址（HeroSMS / VirtualSMS / SMSBower 等）。',
    testable: true,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true },
      { key: 'country', label: '默认国家代码', type: 'text', placeholder: '0=俄罗斯 6=印尼 187=美国' },
      {
        key: 'apiBase',
        label: 'API 地址',
        type: 'text',
        required: true,
        placeholder: 'https://smsbower.online/stubs/handler_api.php',
        help: '官方已关停。可用：https://smsbower.online/stubs/handler_api.php、https://api.eveses.com/stubs/handler_api.php、https://virtualsms.io/stubs/handler_api.php'
      },
      { key: 'maxPrice', label: '单号最高价（可选）', type: 'number' }
    ]
  },
  {
    type: 'sms',
    driver: 'smsbower',
    label: 'SMSBower',
    description: '接码平台，使用与 SMS-Activate 兼容的 handler_api 协议。',
    testable: true,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true },
      { key: 'country', label: '默认国家代码', type: 'text' },
      {
        key: 'apiBase',
        label: 'API 地址（可选）',
        type: 'text',
        placeholder: 'https://smsbower.online/stubs/handler_api.php'
      }
    ]
  },
  {
    type: 'sms',
    driver: 'smspool',
    label: 'SMSPool',
    description: '接码平台，独立 JSON API。',
    testable: true,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true },
      { key: 'country', label: '默认国家（ISO 或数字 ID）', type: 'text', placeholder: 'US' },
      { key: 'apiBase', label: 'API 地址（可选）', type: 'text', placeholder: 'https://api.smspool.net' }
    ]
  },
  {
    type: 'sms',
    driver: 'generic_sms',
    label: '通用接码适配器',
    description: '用 URL 模板对接任意接码平台，支持 {apiKey}/{service}/{country}/{id} 占位符。',
    testable: true,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true },
      {
        key: 'rentUrl',
        label: '租号请求 URL',
        type: 'text',
        required: true,
        placeholder: 'https://api.example.com/rent?key={apiKey}&service={service}&country={country}'
      },
      { key: 'rentIdPath', label: '租用 ID 的 JSON 路径', type: 'text', required: true, placeholder: 'data.id' },
      { key: 'rentPhonePath', label: '号码的 JSON 路径', type: 'text', required: true, placeholder: 'data.phone' },
      {
        key: 'codeUrl',
        label: '查码请求 URL',
        type: 'text',
        required: true,
        placeholder: 'https://api.example.com/sms?key={apiKey}&id={id}'
      },
      { key: 'codePath', label: '验证码的 JSON 路径', type: 'text', placeholder: 'data.code' },
      { key: 'codeRegex', label: '验证码提取正则（可选）', type: 'text', placeholder: '(\\d{6})' },
      { key: 'cancelUrl', label: '取消/释放 URL（可选）', type: 'text' },
      { key: 'finishUrl', label: '完成确认 URL（可选）', type: 'text' },
      { key: 'balanceUrl', label: '余额查询 URL（可选）', type: 'text' },
      { key: 'balancePath', label: '余额的 JSON 路径', type: 'text', placeholder: 'balance' }
    ]
  },
  // ── Proxy ────────────────────────────────────────────────
  {
    type: 'proxy',
    driver: 'static',
    label: '静态代理',
    description: '单个固定代理地址。',
    testable: true,
    fields: [
      {
        key: 'url',
        label: '代理地址',
        type: 'text',
        required: true,
        placeholder: 'http://user:pass@host:port 或 socks5://host:port',
        help: '推荐 HTTP(S) 代理。注意：Chromium 不支持带账号密码的 SOCKS5（无鉴权的 SOCKS5 可用）。'
      }
    ]
  },
  {
    type: 'proxy',
    driver: 'rotating_gateway',
    label: '动态代理网关',
    description: '每次请求经网关自动轮换出口 IP。',
    testable: true,
    fields: [{ key: 'url', label: '网关地址', type: 'text', required: true }]
  },
  {
    type: 'proxy',
    driver: 'api_extract',
    label: 'API 提取代理',
    description: '调用提取 API 动态获取代理列表。',
    fields: [{ key: 'fetchUrl', label: '提取 API 地址', type: 'text', required: true }]
  }
]

export function driversFor(type: ProviderType): ProviderDriver[] {
  return PROVIDER_DRIVERS.filter((d) => d.type === type)
}

export function getDriver(type: ProviderType, driver: string): ProviderDriver | undefined {
  return PROVIDER_DRIVERS.find((d) => d.type === type && d.driver === driver)
}
