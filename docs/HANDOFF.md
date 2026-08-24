# 开发者 / 交接文档 (HANDOFF)

> 目标读者：接手本项目的开发者。读完本文你应能：跑起来、看懂结构、扩展平台自动化、定位常见问题。
> 配套阅读：`docs/ARCHITECTURE.md`（设计蓝图）、`docs/SECURITY.md`（安全模型）。

---

## 1. 环境要求

- Node.js ≥ 20（开发用；打包运行时用 Electron 内置 Node）
- npm ≥ 9
- 本机安装 **Google Chrome**（自动化通过 Playwright 驱动它）
- Windows / macOS / Linux 均可开发；当前以 **Windows 优先**验证
- **无需 C++ 工具链**：数据库采用 `sql.js`(SQLite/WASM)，纯 JS，`npm install` 不含任何原生编译步骤

## 2. 安装与运行

```bash
npm install
npm run dev            # 启动开发模式（Vite HMR + Electron）
```

其他脚本：

```bash
npm run typecheck      # 主进程 + 渲染层 TS 类型检查
npm run build          # 构建到 out/
npm run dist           # 构建并用 electron-builder 打安装包
```

> 数据库为 sql.js(WASM)，无需重建原生模块；`sql-wasm.wasm` 位于 `node_modules/sql.js/dist/`，主进程运行时自动定位加载。

## 3. 目录速览

```
src/
  shared/        主/渲染共享的类型 (types.ts) 与 IPC 通道名 (ipc.ts)
  main/          Electron 主进程（Node）
    index.ts     入口：初始化 paths/crypto/db，注册 IPC，创建窗口
    paths.ts     userData 下的目录解析（profiles/screenshots/logs/db/key）
    db/          sql.js 适配器、版本化迁移、仓储(accounts/tasks)
    services/    crypto(加解密) / totp / logger / settings
    automation/  chrome 探测 / browser 启动 / engine 队列 / flows 平台流程
    ipc/         按域拆分的 ipcMain.handle 注册
  preload/       contextBridge 暴露 window.api
  renderer/      React + Vite 前端
    src/components/ui   shadcn 基础组件
    src/components      业务组件
    src/pages           页面
    src/store           zustand 状态
    src/lib             api 封装 / 工具 / 平台元数据 / 二维码解码
```

## 4. 端到端数据流（以「批量改密码」为例）

1. 渲染层 `Accounts` 页选中多个同平台账号，打开 `RunAutomationDialog`。
2. 对话框调用 `window.api.automation.enqueue({ accountIds, type:'change_password', params })`。
3. preload 经 IPC 转发到主进程 `ipc/automation.ipc.ts` → `engine.enqueue()`。
4. `engine` 为每个账号建 `automation_tasks` 记录并入队，按 `settings.maxConcurrency` 并发调度。
5. 每个任务：`browser.openContext(profileDir)` 启动该账号专属 Chrome → 取得 `flows/registry` 中对应 `Flow` → 执行 `flow.run(ctx)`。
6. `ctx.step()` 逐步留痕；失败自动截图到 `userData/screenshots/`。
7. 任务状态/进度实时 `updateTask()` 并经 IPC 事件 `automation:task-updated` 推送 UI。
8. 成功且 flow 返回 `data.accountPatch` 时，`engine` 调 `updateAccount()` 把新密码写回加密库。
9. 全过程 `logger` 落 `logs` 表 + 文件 + 事件 `logs:new` 推送「日志」页。

## 5. 如何新增一个平台操作（扩展点）

以给 **GitHub 增加「修改恢复邮箱」** 为例：

1. 在 `src/main/automation/flows/github.ts` 增加一个 `Flow`：

```ts
const changeRecovery: Flow = {
  platform: 'github',
  action: 'change_recovery',            // 复用已有 TaskType；如需新类型见第 6 点
  title: 'GitHub 修改恢复邮箱',
  description: '……',
  params: [
    { key: 'recoveryEmail', label: '新恢复邮箱', type: 'text', required: true }
  ],
  async run(ctx) {
    await ensureGithubLogin(ctx)
    await ctx.step('打开邮箱设置', async () => { /* ... */ })
    // ...
    return { ok: true, message: '完成', data: { accountPatch: { recoveryEmail: '...' } } }
  }
}
export const githubFlows: Flow[] = [checkLogin, changePassword, changeRecovery]
```

2. 无需改 UI：`RunAutomationDialog` 会通过 `automation:actions` 动态拉取该平台的操作和参数表单。
3. 若引入了新的 `TaskType`，在 `src/shared/types.ts` 的 `TaskType` 联合类型里补充，并在 `renderer/pages/Automation.tsx` 的 `TASK_LABELS` 里加中文名。

**新增整个平台**：在 `flows/` 加 `<platform>.ts` 导出 `Flow[]`，在 `flows/registry.ts` 的 `ALL` 里合并；在 `shared/types.ts` 的 `Platform` 联合类型与 `renderer/lib/platforms.ts` 的 `PLATFORMS` 里登记（决定图标/颜色/名称）。

## 6. Flow 编写约定

- 用 `ctx.step('中文步骤名', async () => {...})` 包裹每个关键步骤：自动记录开始/成功/失败并在失败时截图。
- 选择器优先语义定位：`page.getByRole` / `getByLabel` / 文本正则；必要时用 `firstVisible(page, [多个候选选择器])` 兜底，降低平台改版脆性。
- 需要 2FA 时用 `ctx.totp()` 取当前验证码。
- 需要写回账号库时，`return { ok:true, message, data:{ accountPatch: { ...Partial<AccountInput> } } }`。
- 尊重取消：长循环里调用 `ctx.throwIfCanceled()`。
- 登录类操作先 `ensureXxxLogin(ctx)` 复用登录子流程。

## 7. IPC 契约参考

通道常量集中在 `src/shared/ipc.ts`，类型即 `src/shared/types.ts` 的 `Api` 接口。渲染层统一通过 `window.api.<域>.<方法>()` 调用（见 `renderer/lib/api.ts`）。事件订阅（返回取消函数）：`api.automation.onTaskUpdated(cb)`、`api.logs.onNew(cb)`。

## 8. 常见问题排查

- **数据库/WASM**：sql.js 为 WebAssembly，无需重建；若打包后报找不到 `sql-wasm.wasm`，在 electron-builder 配置里用 `asarUnpack` 包含 `**/node_modules/sql.js/dist/*`。
- **未检测到 Chrome**：设置页手动填 Chrome 路径；或用 CDP 模式连接已开启 `--remote-debugging-port=9222` 的 Chrome。
- **Google/X 登录失败**：多为验证码/设备验证/风控。关闭「无头模式」，在弹出的浏览器里手动完成一次登录（会写入该账号 profile），之后再跑自动化即可复用登录态。
- **自动化点不到元素**：平台改版导致选择器失效。到对应 `flows/<platform>.ts` 更新选择器；失败截图在 `userData/screenshots/`，日志在「日志」页按 taskId 过滤。
- **userData 位置**：Windows 为 `%APPDATA%/Helm`（旧版 `%APPDATA%/ai-account-manager` 会在首次启动时自动迁移）。数据库、日志、profiles、master.key 均在此。

## 9. 代码规范

- 全量 TypeScript，`strict` 打开。
- 主进程不向渲染层泄露明文主密钥；解密仅在主进程按需进行。
- 敏感字段一律走 `services/crypto.ts` 加解密，不直接明文入库。
- 组件用 shadcn 风格（Radix + Tailwind + cva）；新组件放 `components/ui`。

## 10. 待办 / 后续路线（TODO）

- [ ] Google 2FA 启用/轮换（当前 `manage_2fa` 仅读取状态）
- [ ] GitHub / X 更多操作 flows
- [ ] 渲染层 CSP 收紧（生产构建）
- [ ] 打包配置（NSIS/DMG）与自动更新
- [ ] i18n（当前中文为主，`AppSettings.language` 已预留）
- [ ] flow 冒烟测试与选择器健康检查
