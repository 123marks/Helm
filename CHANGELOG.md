# Changelog

## 0.4.0

- **新增 Outlook 邮箱池**：导入现成微软号 combo（`email----password----clientId----refreshToken`，可选 + 恢复邮箱两段，兼容四段/六段），在「服务中心 · 邮箱」里统一管理——状态/用量统计、批量保活（刷新 refresh_token，`invalid_grant` 自动标死号）、导出四段/六段、一键「取号建账」直接把现成号建进微软账号库（秒级、无浏览器、无需打码）
- 邮箱池面板重做：顶部健康构成条（有效/待检/使用中/待重试/死号按比例着色 + 图例）、分区操作、可折叠、表格视觉层次收紧，与全局设计一致
- **Outlook 池打通批量注册**：批量注册新增「Outlook 池现成号」收信来源——用池里的微软邮箱给 ChatGPT 等平台收验证码，把「微软邮箱」和「GPT 注册」两个项目的价值串成一条闭环
- **可选后台保活**：设置里可开「Outlook 池令牌保活」间隔，后台只刷新到期的号，限速执行
- 接码稳健性：`waitForSmsCode` 不再因一次临时网络抖动就退掉已付费的号码，改为继续轮询、仅在致命错误（号码被取消/Key 失效/记录不存在/封号）或超时才结束
- Outlook OAuth2 IMAP 兜底读信新增扫「垃圾邮件」文件夹——新号验证邮件常落 Junk，避免收不到码

## 0.3.0

- **项目更名 Helm**：应用名、安装包、快捷方式、GitHub 仓库同步改名；首次启动自动把旧数据目录（`AI Account Manager` / `ai-account-manager`）的数据库、`master.key`、`Local State`、浏览器配置迁移过来，旧目录保留为备份，并修正账号里存的绝对 profile 路径
- **新增「额度总览」页**：Hero 汇总卡（月订阅成本 / 平均用量 / 告警数 / 最近重置倒计时 / 查询失败数）+ 四个可点筛选的状态块、平台聚合条、需要关注清单、全账号用量表（按用量 / 重置 / 查询时间 / 月成本 / 套餐 / 平台排序，可按状态筛选），支持整页或单账号刷新
- **额度历史与使用趋势**：每次成功查询都写一条快照（同账号 5 分钟内合并，保留 120 天），总览页画出 24h / 7d / 30d / 90d 的用量趋势，总体与各平台分线、图例可点击隐藏、悬停看具体数值
- **月订阅成本**：按档位公开价目累加，卡片与表格都能看到每个号、每个平台一个月值多少钱
- **授权后额度自动出数**：主进程在账号创建或换 Token 后立即后台拉一次额度并推给界面，不必再手点刷新；另有可配置的后台轮询（默认 30 分钟，只刷过期的账号）
- **会员档位重做**：新增各平台官方档位目录（Cursor Hobby/Pro/Pro+/Ultra/Teams Standard·Premium/Enterprise、ChatGPT Free/Go/Plus/Pro/Business/Enterprise、Claude Free/Pro/Max 5×/Max 20×/Team·Premium/Enterprise、Kiro Free/Pro/Pro+/Pro Max/Power、Windsurf、SuperGrok Lite/SuperGrok/Plus/Heavy、Google AI Plus/Pro/Ultra 5×·20×），卡片显示档位名、公开价格与该档到底买到什么
- **Antigravity 正名**：不再叫「反重力」；区分 Antigravity IDE 与 Antigravity 2.0，套餐按 Google AI 订阅体系显示；额度新增「按模型额度」折叠区（每个模型的 5h / Weekly 剩余）
- Cursor 额度贴近官方 Usage 面板：Total Usage / Auto + Composer / API Usage 直接带 `$x / $y` 绝对值，按需使用未开启时显式显示「已禁用」，无上限时显示为不限量而非天文数字
- 布局统一：卡片头部与面板等高、同一网格内卡片等高、徽章尺寸与间距一致；仪表盘与额度总览共用同一套 KPI 卡；仪表盘新增额度告警入口
- Antigravity 的 Google OAuth 客户端凭据移出源码，改为构建时从环境注入（见 `.env.example`），仓库不再携带不属于本项目的凭据
- 关闭添加账号弹窗不再在主进程打出 `oauth:wait` 错误日志：用户主动取消视为正常结束
- 添加账号默认走官方授权：Google / GitHub / Apple / 微软 / X 等 SSO，不必先填账密；Cursor / OpenAI / Kiro / Windsurf 仍走专用 OAuth
- 新增 Grok（xAI）：官方登录、xai- Key / Cookie JSON、订阅额度
- Cursor 额度对齐官方 Usage：Total / Auto + Composer / API，按需用量仅在开启且有消耗时显示；不再误标「基础/高级 0/0」
- 各平台套餐名按公开价目显示（Ultra $200/mo、ChatGPT Plus、SuperGrok 等）；卡片边框随档位变化
- 额度条可点复制、刷新有转圈和 toast；详情里 Token / 自定义字段可完整显示、显示/复制
- Kiro 试用/奖励额度不再加进订阅额度
- 详情字段与凭据去掉常驻复制图标：悬停高亮，点击即复制，密钥仅在悬停时出现显示开关
- 卡片底栏收成统一工具条（去掉与状态点重复的复制钥匙）；详情抽屉底栏改为等宽四列操作格
- 会员徽章统一用 FREE；额度卡片按档位描边高光，进度条改为渐变
- 额度查询改为先打官方 HTTP：已有会话不再每次读写 Chrome 配置；全量刷新主号优先、同域名限速、429 退避
- Grok 图标改为官方 G 形标；额度同时读 rate-limits / user / session，支持 xai- Key 与 Cookie
- 新增反重力（Antigravity）：官方 Google OAuth、Token/JSON 导入、Claude / Gemini 5h·Weekly + AI 积分（对齐 Cockpit）
- 额度说明可开关（设置 / 账号页工具栏）；默认显示套餐内用量等介绍
- Grok 图标改为 grok.com 官方黑洞 G；反重力改为官方彩虹 A（IDE 黑底版）
- 卡片播放键改为「应用到本地」：把会话写入 Cursor / Kiro / Windsurf / Codex / Claude Code / Grok / 反重力 的本机 IDE 或 CLI
- GitHub / Google 等无额度卡片改为身份信息面板，和额度卡同高、同质感
- 官方授权后补邮箱和登录方式（Google / GitHub / 邮箱等），卡片标题不再显示「Cursor cursor」
- 识别本机 IDE / CLI 当前登录：卡片标「当前使用」，未知会话自动入库，切换成功有明确提示
- 本机同步只读小 JSON，不再打开 Cursor `state.vscdb` / 扫进程 / 联网补邮箱，避免主进程卡死
- 开发态窗口图标回退到品牌图，不再落到 Electron 默认原子标

## 0.2.9

- 添加账号三个页签内容分开：OAuth 只做官方授权；Token / JSON 只粘贴会话或导入 .json 文件；手动填写才是完整表单
- Token / JSON 支持选择本地 .json 文件，单账号对象或数组都能导入
- Cursor / OpenAI / Kiro / Windsurf 新增官方 OAuth：生成授权链接、浏览器打开、轮询或本地回调，成功后自动建号（对齐 Cockpit Tools）
- Cursor 使用 loginDeepControl + api2.cursor.sh/auth/poll；OpenAI 走 Codex PKCE（localhost:1455）；Kiro 走 app.kiro.dev/signin；Windsurf 走 windsurf/signin
- Cursor 图标改为官方 brand kit 2.5D 立方体；Kiro 改为官方紫色幽灵

## 0.2.8

- OpenAI / Claude / Cursor / Windsurf 换成官方 Simple Icons 路径；Google 不再套白底大方块；新增 Kiro 平台
- 账号卡片排版收紧；额度显示百分比
- OpenAI / Claude / Cursor / Windsurf / Kiro：粘贴官方 Token 或 JSON，写入独立 Chrome；官方网页登录后刷新额度会抓会话
- 额度接口按各平台公开实现对接（Cursor usage-summary、Claude organizations/usage、Kiro OIDC + getUsageLimits、Windsurf GetUserStatus）
- 已生成邮箱默认可折叠；区分临时库存和账号库真实邮箱；批量注册默认用真实邮箱

## 0.2.7

- 统一平台 Logo：卡片、下拉、安全中心同一套固定方块图标，OpenAI / Claude / Cursor / Windsurf 补上品牌标
- Cursor / ChatGPT 额度：用该账号已登录的 Chrome 会话查询官方接口，卡片显示套餐和用量；未登录会提示先打开浏览器
- 更新弹窗改成 Cockpit 风格：发现新版本时可立即更新、跳过此版本或取消
- 安全中心「重新体检 / 检测」补上反馈：检测直接提交登录检查并跳转自动化页
- 新建账号自动写入独立 UA / 语言 / 时区；批量注册提示用住宅代理降低人机

## 0.2.6

- Google / YouTube 注册按真实多步向导填表：姓名、生日性别、自建 @gmail.com 或已有邮箱、密码+确认密码
- 确认页分开显示登录邮箱和收信邮箱；预览字段原样写入对应步骤，写不进去会停
- GitHub 注册回读校验邮箱/用户名/密码，预览用户名按 GitHub 规则生成

## 0.2.5

- 批量注册改为先预览再确认：核对平台、收信邮箱、用户名、密码
- 明确「目标平台 ≠ 邮箱后缀」；卡片同时显示平台名和真实域名
- 已生成邮箱可搜索、批量删除/打标签、读信，空闲邮箱可直接用于注册
- 注册收信来源：新生成 / 已有临时邮箱 / 账号库里的 Gmail·iCloud·Outlook

## 0.2.4

- 服务中心记录测试/注册生成的临时邮箱，可复制、读信、删除
- 邮箱注册平台与添加账号对齐：Google / GitHub / Microsoft / Apple / X / YouTube / Discord / OpenAI / Claude / Cursor / Windsurf

## 0.2.3

- 接入 electron-updater：GitHub 打 tag 发版后，安装版会自动检查并提示更新
- 添加/编辑账号可按 Gmail / iCloud / Outlook 填写不同收信凭证
- 邮箱注册平台扩展到 Discord / OpenAI / X / Claude；临时邮箱入库显示完整地址
- 转动彩虹边框仅用于执行中账号，金色边框表示主号；批量删除/标主号更明显

## 0.2.2

- 账号卡片渐变描边
- 新增/导入支持 `----` / `---` / `|` / `邮箱:密码` 快捷粘贴
- 读信：服务中心与账号详情可预览最近邮件并复制验证码
- 账号可一键「用作收信」，供批量注册收验证码

## 0.2.1

- 服务中心「添加」菜单可滚动，小窗口也能选完全部驱动
- 取件链接邮箱：粘贴 iCloud 商业号 `邮箱----URL` / `邮箱---token---URL`，注册时扣库存并收码
- Outlook Graph / OAuth2 双令牌号：`邮箱----密码----clientId----refreshToken`，Graph 读信失败则走 IMAP
- 批量注册同时支持验证码和验证链接，免费临时邮箱 / IMAP / 自建域名 / 取件号 / Outlook 都能闭环
- GitHub README 增加交流群与产品截图

## 0.2.0

账号管理从「能看」做到「能跑」：接码、真实邮箱、Google 维护、OAuth 注册、苹果邮箱 + GitHub 注册全部接入运行时。

- 列表脱敏、全局小眼睛、状态灯可点
- SMS-Activate 兼容 / SMSBower / SMSPool / 通用接码
- IMAP/SMTP、cfworker、generic HTTP 邮箱
- iCloud IMAP、icloud-hme Hide My Email、商业 iCloud Mail API
- Google：改手机、启用/轮换 2FA、拉取备用码、完整维护队列
- OAuth 注册：OpenAI / Cursor / Windsurf / Discord
- GitHub 邮箱注册：单页表单只点 Create account，处理 Arkose，收 launch code
