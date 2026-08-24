# 打包与发布指南

本项目使用 **electron-builder** 打包，一次配置产出 Windows / macOS / Linux 共 8 种分发格式。

## 产物矩阵

| 平台 | 架构 | 格式 | 文件名 | 说明 |
|---|---|---|---|---|
| Windows | x64 | NSIS 安装包 | `AI-Account-Manager-<ver>-win-x64-setup.exe` | 可选安装目录、创建快捷方式，推荐 |
| Windows | arm64 | NSIS 安装包 | `AI-Account-Manager-<ver>-win-arm64-setup.exe` | Surface / 骁龙 Windows 设备，单独构建 |
| Windows | x64 | 便携版 | `AI-Account-Manager-<ver>-win-x64-portable.exe` | 免安装，单文件运行 |
| Windows | x64 | 压缩包 | `AI-Account-Manager-<ver>-win-x64.zip` | 解压即用，便于绿色分发 |
| macOS | x64 / arm64 | DMG | `AI-Account-Manager-<ver>-mac-<arch>.dmg` | Intel / Apple Silicon 分开下载 |
| macOS | x64 / arm64 | ZIP | `AI-Account-Manager-<ver>-mac-<arch>.zip` | 自动更新与手动安装用 |
| Linux | x64 | AppImage | `AI-Account-Manager-<ver>-linux-x86_64.AppImage` | 免安装，`chmod +x` 后直接运行 |
| Linux | x64 | deb / tar.gz | `AI-Account-Manager-<ver>-linux-amd64.deb`、`...-linux-x64.tar.gz` | Debian/Ubuntu 系与通用压缩包 |

> deb 与 AppImage 沿用各自生态的架构命名（`amd64` / `x86_64`），与 `artifactName` 里的 `${arch}` 不一致属正常现象。

> 注意 1：electron-builder **不能跨平台交叉编译 macOS**。本地只能打当前系统的包，三平台完整产物请走下面的 GitHub Actions 流程。
>
> 注意 2：Windows 的 x64 与 arm64 安装包必须**分两次调用** electron-builder。若把两个架构写进同一个 nsis target，会额外产出一个把两份运行时塞在一起的 ~180 MB 合并安装包。

## 本地打包

```bash
npm install
npm run dist:win        # Windows x64：安装版 + 便携版 + zip
npm run dist:win:arm64  # Windows arm64 安装版（单独一次调用）
npm run dist:mac      # 仅 macOS（需在 macOS 上执行）
npm run dist:linux    # 仅 Linux
npm run dist:dir      # 只解包不打包，用于快速验证（release/win-unpacked）
```

产物输出在 `release/`。

### 国内网络加速

首次打包需要下载 Electron 二进制（约 115 MB）。直连 GitHub 经常失败或下载到损坏的 zip，建议先设置镜像：

PowerShell:

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist:win
```

bash / zsh:

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist:linux
```

若报 `zip: not a valid zip file`，说明缓存里是坏包，删除后重试：

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron\Cache"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache"
```

## 一键发布三平台（GitHub Actions）

工作流：[`.github/workflows/release.yml`](../.github/workflows/release.yml)

```bash
npm version patch          # 或 minor / major，会自动改 package.json 并打 tag
git push origin main --tags
```

推送 `v*` 标签后，Actions 会在 `windows-latest` / `macos-latest` / `ubuntu-latest` 三个 runner 上并行构建，并把全部安装包以及 `latest.yml` / `latest-mac.yml` / `latest-linux.yml` 上传到对应的 GitHub Release。已安装的 **setup / dmg / AppImage** 会在启动时检查这些文件并提示更新（便携版需手动换包）。

手动触发（`workflow_dispatch`）时只构建、不发版，产物以 Artifacts 形式保留 14 天，适合验证打包是否正常。

发布无需额外配置密钥，使用内置的 `GITHUB_TOKEN`。

## 代码签名

当前安装包**未做代码签名**。这是个人/开源桌面软件的常态，不影响功能，只影响首次安装时的系统提示。下面分「用户侧绕过」和「开发者侧根治」说明。

### 用户侧：现在就能用

**Windows 10/11**

1. 双击 `.exe` 出现 SmartScreen「Windows 已保护你的电脑」
2. 点 **更多信息**
3. 点 **仍要运行**
4. 便携版（`.portable.exe`）同样操作；zip 解压后运行主程序也一样

安装后 SmartScreen 通常不再弹（同一文件路径下）。

**macOS**

1. 首次打开：右键（或 Control+点击）应用 → **打开** → 确认
2. 或终端清除隔离属性后正常双击：

```bash
xattr -cr "/Applications/Helm.app"
```

**Linux**：AppImage 首次 `chmod +x` 后直接运行；deb 用 `sudo dpkg -i` 安装即可，无额外签名要求。

### 开发者侧：彻底消除警告（需付费证书）

| 平台 | 需要什么 | 大致费用 | 效果 |
|---|---|---|---|
| Windows | OV 或 EV 代码签名证书（`.pfx`） | OV ~$200/年，EV ~$400+/年 | SmartScreen 不再拦；EV 可立即建立信誉 |
| macOS | Apple Developer + Developer ID Application 证书 + 公证 | $99/年 | 双击直接打开，无「来自未知开发者」 |

证书就绪后，在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 用途 |
|---|---|
| `CSC_LINK` | base64 编码的 `.p12` / `.pfx` 证书文件 |
| `CSC_KEY_PASSWORD` | 证书导出密码 |
| `APPLE_ID` | macOS 公证用 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | [appleid.apple.com](https://appleid.apple.com) 生成的 App 专用密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

然后在 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 的 Package 步骤里**删除** `CSC_IDENTITY_AUTO_DISCOVERY: false` 这一行，重新打 `v*` 标签发布即可自动签名 + macOS 公证。

本地 Windows 签名示例（有 `.pfx` 时）：

```powershell
$env:CSC_LINK="C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD="your-password"
npm run dist:win
```

### 为什么不默认签名

- 代码签名证书需要实名购买与年度续费，无法为开源仓库内置
- 未签名包功能与已签名包完全一致，仅首次运行多一步确认
- GitHub Actions 已预留 Secret 接入点，你买到证书后 5 分钟可配好

## 打包体积与依赖

- `playwright-core`、`sql.js`、`imapflow`、`nodemailer`、`mailparser` 通过 `asarUnpack` 解包到 `resources/app.asar.unpacked/`，否则 wasm / IMAP 会在 asar 内失败。
- 安装包约 100 MB，安装后约 320 MB（Electron 运行时占大头）。
- 应用**不内置 Chromium**，自动化功能依赖用户本机已安装的 Google Chrome。

## 更换图标

1. 将新 logo 放到 `build/logo-source.png`（或任意路径）。
2. 执行 `npm run make:logo`（或 `node scripts/process-logo.mjs <路径>`）生成 `build/icon.png`（1024×1024，紫色圆角底）。
3. 重新打包：`npm run dist:win`。electron-builder 会自动生成 Windows `.ico` 与 macOS `.icns`。
