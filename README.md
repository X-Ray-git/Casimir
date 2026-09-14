# Casimir

<p align="center">
  <img src="assets/readme-icon.png" width="256" alt="Casimir 图标">
</p>

Casimir 是一个面向个人工作流的 Chrome 扩展，连接论文阅读与 ChatGPT 操作。
项目使用 Manifest V3 和原生 JavaScript，仓库根目录可以直接作为已解压扩展加载。

## 当前功能

- **arXiv PDF 首次访问**：首次打开 arXiv 摘要页或匹配的 DAIR.AI 论文页时跳转到
  对应 PDF；从任意来源打开过该 PDF 后不再自动跳转。
- **论文分屏**：在支持的论文页面旁创建 Chrome 原生分屏后，将新空白窗格打开为 ChatGPT。
- **论文附件传递**：把匹配的 arXiv、alphaXiv、Nature、ACL Anthology 或 OpenReview
  论文内容传给准确的 ChatGPT 标签页；alphaXiv 博客及 Nature 的 PDF 不适合直接
  获取时，使用当前页面的 MHTML 快照。
- **X Article 传递**：将 X 的长文章页面直接保存为 MHTML，并传给配对的 ChatGPT
  标签页，不解析正文或追踪文章中的外部链接。
- **ChatGPT 快捷键**：提供常用导航快捷键与本地自定义提示词。
- **限流提醒处理**：自动确认并关闭 ChatGPT 的“对话记录访问受限”提醒，不影响
  其他弹窗。

## 环境要求

- Google Chrome 140 或更高版本
- macOS（当前原生分屏的主要验证平台）
- Node.js 20 或更高版本（仅开发和测试需要）

## 安装

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库根目录，也就是直接包含 `manifest.json` 的 `Casimir` 目录。
5. 确认扩展卡片显示 **Casimir 0.5.0**。

修改代码后，需要在扩展管理页重新加载 Casimir，并刷新已经打开的 arXiv、DAIR.AI、
alphaXiv、Nature、ACL Anthology、OpenReview、X Article 与 ChatGPT 标签页，使新的
内容脚本生效。

## ChatGPT 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Command/Ctrl + O` | 新建对话 |
| `Command/Ctrl + I` | 聚焦提示词输入框 |
| `Command/Ctrl + L` | 切换侧栏 |
| `Command/Ctrl + Shift + N` | 切换临时对话 |
| `Command/Ctrl + Shift + ,` | 打开自定义快捷键设置 |

自定义快捷键可以插入可复用提示词、选择是否先新建对话，并用 `{{clipboard}}`
替换为当前剪贴板文本。所有设置只保存在 Chrome 扩展本地存储中。

## 验证论文分屏

1. 打开受支持的来源：arXiv PDF、alphaXiv 的 `/abs/` 或 `/pdf/` 页面、带有正文
   PDF 下载入口的 Nature 文章页、ACL Anthology 论文页、OpenReview forum 页面，
   或者 `x.com/<账号>/article/<数字 ID>`。
2. 保持论文标签页处于活动状态。
3. 按 `Command + Option + N` 创建 Chrome 原生分屏。
4. 确认新空白窗格打开 `https://chatgpt.com/`。
5. 等待 Casimir 状态提示，并确认 PDF、alphaXiv 博客的 MHTML 回退或 X Article
   MHTML 出现在 ChatGPT 附件区域。
6. 确认原始论文窗格及 URL 未改变，Casimir 没有填写提示词或发送消息。

Casimir 只在内存中获取、捕获并传递附件，不写入下载目录。Casimir 当前的自动传输
上限为 100 MB（并非 ChatGPT 的文件上限）；目标 ChatGPT 页面在两分钟内未
领取任务时，任务会过期。

以下情况不会触发导航：

- 普通网页与新空白窗格组成分屏。
- 不受支持的论文页与新空白窗格组成分屏。
- 现有网页与受支持的论文页组成分屏。
- 在分屏以外创建普通新标签页。

## 开发

项目没有第三方运行时依赖。首次检出后运行：

```bash
npm ci
npm run check
```

生成可分发压缩包：

```bash
npm run package
```

产物位于 `dist/casimir-<version>.zip`。开发时仍建议直接加载仓库根目录。

## 权限与安全边界

- `tabs`：读取标签页和 `splitViewId`，识别刚创建的分屏空白窗格，并只导航匹配窗格。
- `pageCapture`：将已匹配的 X Article 或依赖当前页面访问状态的 Nature 文章保存为
  内存中的 MHTML 快照，并为无法获取 PDF 的 alphaXiv 博客及 Nature 公开文章提供回退。
- `storage`：保存跨 arXiv 与 DAIR.AI 共享的 PDF 访问记录、自定义快捷键和短生命周期的
  PDF 交接任务。
- `https://arxiv.org/*`：运行首次访问脚本、记录已经打开的 PDF，并由后台获取匹配的
  公开 PDF。
- `https://academy.dair.ai/papers/*`：仅在论文详情页读取与页面 URL 中论文 ID 一致的
  arXiv PDF 链接，并执行首次访问跳转。
- `https://www.alphaxiv.org/*`：读取论文页提供的正文 PDF 元数据及博客内容类型，并在
  必要时捕获页面。
- `https://cdn.openai.com/*`：获取当前支持的 alphaXiv 博客明确链接的公开原始论文 PDF。
- `https://www.nature.com/*`：读取文章正文下载入口；公开 PDF 优先直接获取，依赖当前
  页面访问状态的文章则只捕获当前标签页已经渲染的内容。
- `https://aclanthology.org/*`：读取并获取与当前论文 ID 完全匹配的公开正文 PDF；
  checklist 与其他附件不会被选中。
- `https://openreview.net/*`：读取并获取与当前 forum ID 完全匹配的投稿 PDF；请求只向
  OpenReview 自身沿用浏览器已有的站点会话，以通过其访问校验。
- `https://x.com/*`：确认 X Article 正文已经渲染，并在用户创建分屏后捕获准确的
  Article 标签页；普通推文不会触发。
- `https://chatgpt.com/*`：运行快捷键、PDF 文件输入及对话记录限流提醒处理脚本。

Casimir 不读取 ChatGPT 对话内容，不调用未公开的 ChatGPT 后端接口，也不会填写提示词
或自动发送消息。附件只会交给与源论文标签页配对的准确 ChatGPT 标签页；Nature
支持不读取或复用登录凭据，也不尝试绕过订阅或机构访问限制。MHTML 会包含捕获时
alphaXiv、Nature 或 X 页面中已经渲染的内容与资源，因此发送前仍可在 ChatGPT
附件区域移除。

OpenReview 的 PDF 端点可能要求站点挑战校验。Casimir 不读取 Cookie 值，只在用户从
匹配的 forum 页面明确触发工作流时，让浏览器把已有 OpenReview 会话附加到同站 PDF
请求；该会话不会发送给其他来源或 ChatGPT。

## 工程结构

```text
Casimir/
├── manifest.json
├── assets/
│   ├── icon.svg
│   └── icons/
├── src/
│   ├── background/
│   └── content/
├── tests/
├── scripts/
├── docs/
│   ├── architecture/
│   ├── operations/
│   └── status/
├── .github/workflows/
├── CHANGELOG.md
└── package.json
```

## 文档

- [维护知识库](docs/README.md)
- [架构概览](docs/architecture/overview.md)
- [开发与验证](docs/operations/development.md)
- [故障排查](docs/operations/troubleshooting.md)
- [当前状态](docs/status/current.md)
- [变更记录](CHANGELOG.md)

## 许可证

Casimir 采用 [MIT License](LICENSE) 开源许可证。
