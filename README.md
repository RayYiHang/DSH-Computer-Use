# DSH Computer Use

让 DeepSeek Harness（DSH）Agent 读取和操作 macOS 原生应用。支持应用清单、辅助功能树、窗口截图、点击、滚动、键盘输入和快捷键。Agent 继续使用 DSH 当前会话选定的模型。

## 安装

适用于 Apple Silicon Mac。已验证 DSH **0.2.2-rc.5** 和 macOS **27**。

在 DSH 中打开 **插件 → 添加插件**，粘贴下面的 Release 插件包地址，点击安装并启用。

```text
https://github.com/RayYiHang/DSH-Computer-Use/releases/download/v1.1.0/dsh-chatgpt-computer-use-1.1.0.tgz
```

也可以从 [GitHub Releases](https://github.com/RayYiHang/DSH-Computer-Use/releases/latest) 下载同一个 `.tgz`，将文件的绝对路径填入 DSH。旧版通过 `link:` 安装的同名插件可在 DSH 中卸载后再安装 Release 版。

首次调用时，插件会准备原版 Computer Use 驱动。本机已有受支持的 ChatGPT 应用时，会复用其中的驱动。否则插件从 [OpenAI 官方下载源](https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg) 下载磁盘映像，校验签名，并将驱动保存到 `~/Library/Caches/DSH-Computer-Use/`。冷启动首次下载约 870 MB，后续调用复用缓存。目标 Mac 无需安装或登录 ChatGPT 或 Codex，也无需额外的 OpenAI API 密钥。Release 包提供 DSH 插件，运行时由目标 Mac 从官方来源取得。

系统弹窗出现时，为签名的 **Codex Computer Use** helper 授予需要的「辅助功能」和「屏幕与系统音频录制」权限。插件专注于原生 macOS 应用，也可将浏览器当作桌面应用交互。

## 使用

在 DSH 中发送：

> 用 DSH Computer Use 打开计算器，读取当前显示值。

- **完全权限** 自动通过 DSH 插件的应用访问确认。
- **工作区内修改 / 仅可查看** 由 DSH 显示逐应用确认。
- macOS 权限和原驱动的应用策略对所有模式生效。

`chatgpt_computer_use` 通过本地 MCP 调用原版驱动。JavaScript 状态在同一个会话回合的工具调用间保留，`chatgpt_computer_use_reset` 可清除该状态。

如果 DSH 安装在其他目录，可以在宿主环境设置 `DSH_COMPUTER_USE_RUNTIME` 为 DSH 应用内的 `Contents/Resources/app/dsh` 路径。停用或卸载插件可在 DSH 的「插件」页面完成。

## 构建插件包

克隆本仓库后运行 `npm pack`。输出的 `.tgz` 是可交给 DSH 插件管理器的安装包。

本项目是第三方 DSH 插件。OpenAI 驱动保留其原有签名及适用条款。
