# 架构设计文档 (ARCHITECTURE)

> Helm —— 面向 Google / GitHub / X(Twitter) / YouTube 等平台的多账号安全管理与浏览器自动化工具。
>
> 本文档是**设计蓝图 + 实现规范**。任何改动应先更新本文档，再改代码，保持文档与代码一致（single source of truth）。

---

## 1. 目标与非目标

### 1.1 目标 (Goals)

- **多账号管理**：集中管理 Google / GitHub / X / YouTube 等平台账号的用户名、密码、2FA、恢复信息（恢复邮箱/手机、备用码）、Refresh Token 及自定义字段。
- **凭据安全存储**：所有敏感字段（密码、TOTP 密钥、备用码、Token）**加密落库**，密钥由操作系统钥匙串（Electron `safeStorage`）托底。
- **实时 2FA (TOTP) 管理器**：像 Authenticator 一样按 30s 周期实时刷新验证码，支持 `otpauth://` URI 与二维码导入。
- **浏览器自动化**：用 **Playwright 驱动本地已安装的 Google Chrome**，以真实登录态完成"改密码 / 改恢复信息 / 管理 2FA"等操作。
- **并发执行**：任务队列 + 上下文池，可对多账号并行执行同类操作，实时展示每个账号的进度。
- **可观测性**：全链路结构化日志（落库 + 文件 + 实时推送到 UI），关键步骤留痕、失败自动截图。
- **好看且好用**：现代化桌面 UI（Tailwind + shadcn/ui），交互清晰，信息密度合理。
- **开源可交接**：清晰的目录结构、类型化边界、完善的开发者文档，便于社区协作。

### 1.2 非目标 (Non-Goals)

- 不做"绕过验证码/风控"的黑产能力。自动化以**用户本人拥有、且已在本地 Chrome 登录**的账号为前提。
- 不承诺对抗各平台的反自动化机制；平台改版或风控升级可能导致某条 flow 失效，需社区维护。
- 不做云端同步/多端；数据默认仅存本地。

---

## 2. 技术栈与选型理由

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | **Electron** | 核心是 Playwright，而 Playwright 的一等公民是 Node.js。Electron 主进程即 Node，可直接跑 Playwright，无需像 Tauri 那样额外挂 Node 侧车，全程单一语言 TypeScript。 |
| 构建 | **electron-vite + Vite** | 主/预加载/渲染三端分离配置，HMR 快，TS 原生。 |
| 前端 | **React 19 + TypeScript** | 生态成熟，与参考项目 cockpit-tools 一致。 |
| UI | **Tailwind CSS + shadcn/ui + lucide-react** | 现代、精致、可深度定制；组件源码进仓库，无黑盒。 |
| 状态管理 | **zustand** | 轻量，主进程事件驱动 UI 更新友好。 |
| 数据库 | **sql.js (SQLite/WASM)** | 纯 JS/WebAssembly，无需任何原生编译，跨机器零构建负担；全内存运行并持久化到单文件。用一层 `Db` 适配器封装出与 better-sqlite3 一致的同步 API。 |
| 加密 | **Node crypto (AES-256-GCM) + Electron safeStorage** | 主密钥由 OS 钥匙串封存，字段级 AES-GCM 加密。 |
| 2FA | **otpauth** | 生成/校验 TOTP，解析 `otpauth://` URI。 |
| 二维码 | **jsqr** | 从截图/图片导入 TOTP 二维码。 |
| 自动化 | **playwright** | 驱动本地 Chrome（`channel:'chrome'`）或附加到运行中的 Chrome（`connectOverCDP`）。 |
| 日志 | **自研 logger + electron 文件轮转** | 落库 + 文件 + IPC 实时推送。 |

> 备选方案（未采用）：Tauri + Node 侧车（对齐 cockpit-tools，但为跑 Playwright 需额外进程与两种语言，复杂度高）；Tauri + Rust 原生自动化（chromiumoxide，放弃 Playwright，成熟度与可维护性差）。

---

## 3. 进程模型 (Process Model)

Electron 三类进程，安全边界清晰：

```
┌─────────────────────────────────────────────────────────────┐
│ Main Process (Node.js)                                        │
│  - DB (sql.js / WASM) / 迁移                                   │
│  - Crypto (safeStorage 解封主密钥 + AES-256-GCM 字段加解密)     │
│  - TOTP 服务                                                   │
│  - Automation Engine (队列 + 并发 + Chrome 上下文池 + flows)    │
│  - Logger (落库 + 文件 + 事件推送)                              │
│  - IPC handlers (ipcMain.handle)                              │
└───────────────▲───────────────────────────┬──────────────────┘
                │ contextBridge (类型化 API)  │ ipcRenderer events
┌───────────────┴───────────────────────────▼──────────────────┐
│ Preload (contextIsolation=on, nodeIntegration=off)            │
│  - 通过 contextBridge 暴露 window.api（白名单通道）             │
└───────────────▲───────────────────────────────────────────────┘
                │ window.api
┌───────────────┴───────────────────────────────────────────────┐
│ Renderer (React + Vite + Tailwind + shadcn/ui)                │
│  - 只做 UI，不直接碰 Node/DB/文件系统                           │
└───────────────────────────────────────────────────────────────┘
```

安全约束：`contextIsolation: true`、`nodeIntegration: false`、`sandbox`（预加载最小化）、渲染层禁止直接 `require`。所有能力经 preload 白名单通道暴露。

---

## 4. 目录结构 (Directory Layout)

```
Helm/
├─ docs/
│  ├─ ARCHITECTURE.md          # 本文件：架构与实现规范
│  ├─ HANDOFF.md               # 交接/开发者文档（如何跑、如何扩展）
│  └─ SECURITY.md              # 安全模型 + 责任使用说明
├─ electron.vite.config.ts     # 三端构建配置
├─ package.json
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
├─ tailwind.config.js / postcss.config.js / components.json
├─ resources/                  # 图标等打包资源
├─ src/
│  ├─ shared/                  # 主进程与渲染层共享的类型/常量
│  │  ├─ types.ts              # Account / Task / LogEntry / Platform ...
│  │  └─ ipc.ts                # IPC 通道名常量
│  ├─ main/                    # 主进程 (Node)
│  │  ├─ index.ts              # 应用入口、窗口、初始化
│  │  ├─ db/
│  │  │  ├─ index.ts           # sql.js 适配器(Db 门面) + 异步初始化 + 持久化
│  │  │  ├─ migrations.ts      # 版本化建表语句
│  │  │  └─ repositories/      # accounts / tasks 仓储
│  │  ├─ services/
│  │  │  ├─ crypto.ts          # safeStorage 主密钥 + AES-256-GCM
│  │  │  ├─ totp.ts            # TOTP 生成/导入
│  │  │  ├─ logger.ts          # 结构化日志
│  │  │  └─ settings.ts        # 应用设置
│  │  ├─ automation/
│  │  │  ├─ engine.ts          # 任务队列 + 并发调度
│  │  │  ├─ browser.ts         # 启动/连接本地 Chrome、上下文管理
│  │  │  ├─ chrome.ts          # 探测本地 Chrome 安装路径
│  │  │  ├─ types.ts           # Flow/StepContext/Result 定义
│  │  │  └─ flows/
│  │  │     ├─ registry.ts     # 平台→操作→flow 注册表
│  │  │     ├─ google/         # 登录/改密码/改恢复信息/2FA
│  │  │     ├─ github/
│  │  │     └─ x/
│  │  └─ ipc/                  # ipcMain.handle 分模块注册
│  │     ├─ index.ts
│  │     ├─ accounts.ipc.ts
│  │     ├─ totp.ipc.ts
│  │     ├─ automation.ipc.ts
│  │     ├─ logs.ipc.ts
│  │     └─ settings.ipc.ts
│  ├─ preload/
│  │  └─ index.ts              # contextBridge 暴露 window.api
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx / App.tsx
│        ├─ index.css          # Tailwind + 设计令牌(CSS 变量)
│        ├─ lib/utils.ts       # cn()
│        ├─ lib/api.ts         # 对 window.api 的类型化封装
│        ├─ components/ui/     # shadcn 组件（button/card/table/dialog...）
│        ├─ components/        # 业务组件（TotpBadge/StatusPill/Sidebar...）
│        ├─ pages/             # Dashboard/Accounts/Automation/Logs/Settings
│        └─ store/             # zustand stores
└─ README.md
```

---

## 5. 数据模型 (Data Model)

SQLite，版本化迁移。敏感字段以 `enc:` 前缀标记的密文字符串存储（见第 6 节）。

### 5.1 表：`accounts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | uuid |
| `platform` | TEXT | `google` / `github` / `x` / `youtube` / `custom` |
| `label` | TEXT | 备注名，用于列表展示 |
| `username` | TEXT | 登录名/邮箱（非敏感，明文便于搜索） |
| `email` | TEXT | 主邮箱 |
| `password_enc` | TEXT | 密码密文 |
| `totp_secret_enc` | TEXT | TOTP 密钥密文（Base32） |
| `recovery_email` | TEXT | 恢复邮箱 |
| `recovery_phone` | TEXT | 恢复手机 |
| `backup_codes_enc` | TEXT | 备用验证码密文（JSON 数组） |
| `refresh_token_enc` | TEXT | Refresh Token 密文 |
| `custom_fields` | TEXT | 自定义键值对（JSON，非敏感） |
| `group_name` | TEXT | 分组 |
| `tags` | TEXT | 标签（JSON 数组） |
| `status` | TEXT | `active` / `disabled` / `error` |
| `profile_dir` | TEXT | 该账号专属 Chrome 用户数据目录 |
| `notes` | TEXT | 备注 |
| `last_used_at` | INTEGER | 最近使用时间戳 |
| `created_at` / `updated_at` | INTEGER | 时间戳 |

### 5.2 表：`automation_tasks`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | uuid |
| `account_id` | TEXT FK | 关联账号 |
| `type` | TEXT | `change_password` / `change_recovery` / `manage_2fa` / `check_login` / ... |
| `status` | TEXT | `queued` / `running` / `success` / `failed` / `canceled` |
| `params` | TEXT | 入参 JSON |
| `result` | TEXT | 结果 JSON（含产物，如新密码回填） |
| `error` | TEXT | 失败原因 |
| `progress` | INTEGER | 0-100 |
| `created_at` / `started_at` / `finished_at` | INTEGER | 时间戳 |

### 5.3 表：`logs`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `ts` | INTEGER | 时间戳(ms) |
| `level` | TEXT | `debug` / `info` / `warn` / `error` |
| `category` | TEXT | `app` / `db` / `automation` / `crypto` / `ipc` |
| `account_id` | TEXT NULL | 关联账号 |
| `task_id` | TEXT NULL | 关联任务 |
| `message` | TEXT | 文本 |
| `meta` | TEXT NULL | 结构化附加信息 JSON |

### 5.4 表：`settings`

键值对（`key` PK, `value` TEXT）。存储并发上限、Chrome 路径覆盖、无头模式开关、语言等。

---

## 6. 安全模型 (Security Model)

**主密钥 (Master Key) 生命周期**
1. 首次启动生成 32 字节随机主密钥 `MK`。
2. 用 Electron `safeStorage.encryptString(MK)` 封存（OS 钥匙串托底：Windows DPAPI / macOS Keychain / Linux libsecret），密文写入 `userData/master.key`。
3. 启动时读取并 `safeStorage.decryptString` 解封得到 `MK`，仅驻留内存。
4. 若 `safeStorage` 不可用（部分 Linux 无 keyring）：降级为**用户主密码**派生密钥（scrypt），启动时要求输入。

**字段加密**
- 算法：`AES-256-GCM`。每条密文格式：`enc:v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`。
- `iv` 每次随机 12 字节；`authTag` 保证完整性。
- 仅密码/TOTP 密钥/备用码/Refresh Token 加密；用户名/邮箱明文以便搜索。

**其他**
- 渲染层永远拿不到明文主密钥；解密只在主进程按需进行，明文经 IPC 单次返回后不缓存。
- 日志与截图默认脱敏（不落明文密码）。
- 详见 `docs/SECURITY.md`（含责任使用说明）。

---

## 7. 自动化引擎 (Automation Engine)

### 7.1 浏览器接入策略

- **首选**：`chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: false })` —— 使用系统安装的 Chrome，每个账号一个独立持久化 profile：登录态隔离、可多开、支持并发。
- **可选**：`chromium.connectOverCDP(endpoint)` —— 附加到用户手动以 `--remote-debugging-port` 启动的 Chrome（复用其真实 profile）。

### 7.2 Flow 抽象

每个平台操作是一个可插拔 flow：

```ts
type Flow<P = any, R = any> = {
  platform: Platform;
  action: string;            // e.g. 'change_password'
  run(ctx: StepContext, params: P): Promise<R>;
};

type StepContext = {
  page: Page;
  account: Account;          // 已解密的敏感字段按需提供
  log: (level, msg, meta?) => void;
  step: <T>(name: string, fn: () => Promise<T>) => Promise<T>; // 步骤留痕 + 失败截图
  totp: () => string;        // 取当前 TOTP
  signal: AbortSignal;       // 支持取消
};
```

Flow 通过 `flows/registry.ts` 注册：`registry[platform][action] = flow`。新增平台/操作只需加文件并注册，UI 自动读取可用操作。

### 7.3 并发与队列

- `engine.enqueue(task)` 入队；调度器按 `settings.maxConcurrency` 并行取任务。
- 每个任务独立 `BrowserContext`；失败重试策略可配置。
- 任务状态与 `progress` 实时写库并经 IPC 事件推送 UI。
- 支持 `cancel(taskId)`（AbortSignal + 关闭 context）。

### 7.4 稳健性

- 每一步 `step()` 包裹：记录开始/结束、超时控制、失败自动截图（存 `userData/screenshots/`）。
- 选择器优先用**语义定位**（role/label/text），减少平台改版脆性。
- 关键操作前置校验（如确认已登录目标账号）与后置校验（确认修改生效）。

---

## 8. TOTP 2FA 管理器

- 存储 Base32 密钥（加密）。UI 每秒轮询主进程 `totp:getCode(accountId)`，返回 `{ code, remainingSeconds, period }`，进度环实时刷新。
- 导入方式：手输密钥、粘贴 `otpauth://totp/...` URI、上传/截图二维码（jsqr 解析）。
- 自动化 flow 内需要 2FA 时，`ctx.totp()` 直接取当前码填入。

---

## 9. 日志与可观测性

- `logger.log(level, category, message, meta)` → 同时：落 `logs` 表、写轮转文件（`userData/logs/app-YYYYMMDD.log`）、经 IPC `logs:new` 事件推送 UI。
- UI「日志」页支持按级别/分类/账号/任务过滤与实时滚动。
- 自动化任务详情页聚合该任务的步骤日志 + 截图。

---

## 10. IPC 契约 (IPC Surface)

通道名集中在 `src/shared/ipc.ts`，全部类型化。示例（完整见实现）：

| 通道 | 方向 | 说明 |
|---|---|---|
| `accounts:list` `accounts:get` `accounts:create` `accounts:update` `accounts:delete` | invoke | 账号 CRUD |
| `accounts:reveal` | invoke | 按需解密返回某账号敏感字段（单次） |
| `accounts:import` `accounts:export` | invoke | 批量导入/导出 |
| `totp:get` | invoke | 取当前验证码 |
| `automation:actions` | invoke | 列出某平台可用操作 |
| `automation:enqueue` `automation:cancel` `automation:tasks` | invoke | 任务管理 |
| `automation:task-updated` | event | 任务状态推送 |
| `logs:query` | invoke | 查询日志 |
| `logs:new` | event | 实时日志推送 |
| `settings:get` `settings:set` | invoke | 设置读写 |
| `system:detect-chrome` `system:open-path` | invoke | 环境探测/打开目录 |

---

## 11. 可扩展性 (Extensibility)

**新增一个平台操作**（例如给 GitHub 加"改密码"）：
1. 在 `src/main/automation/flows/github/changePassword.ts` 实现 `Flow`。
2. 在 `registry.ts` 注册。
3. 在 `shared/types.ts` 若有新 `action` 常量则补充。
4. UI 无需改动，操作列表由 `automation:actions` 动态提供。

**新增一个敏感字段**：在 `accounts` 表迁移中加 `_enc` 列 → 仓储读写走 crypto → UI 表单加字段。

---

## 12. 已知风险与约束

- **平台反自动化**：Google/GitHub/X 有风控、验证码、设备信任判定。以本地真实登录态操作可显著降低被拦概率，但**不保证 100% 成功**；flow 需持续维护。
- **纯协议方式不可靠**：直接构造 HTTP 请求改密/改恢复信息基本会被风控拦截，仅作个别可行接口的补充，不作为主力。
- **数据库**：使用 `sql.js`(WASM)，全内存运行、写操作防抖持久化到单文件（关闭时强制落盘）；无需原生编译。极端崩溃可能丢失最后 <400ms 未落盘的写入，启动时 `reconcileOrphanTasks` 会清理中断任务。打包时需将 `sql-wasm.wasm` 一并包含（`asarUnpack`）。
- **合规**：仅用于管理**自有/授权**账号；不得用于未授权访问。见 `SECURITY.md`。

---

## 13. 路线图 (Roadmap)

- M1（骨架）：工程搭建、数据层+加密、账号 CRUD、TOTP 管理器、日志、UI 框架。
- M2（旗舰自动化）：Google 登录校验 / 改密码 / 改恢复信息 / 2FA，并发队列，任务详情与截图。
- M3（扩展）：GitHub / X / YouTube flows；导入导出；批量操作模板。
- M4（打磨）：打包（NSIS/DMG）、自动更新、i18n、单测与 flow 冒烟。
