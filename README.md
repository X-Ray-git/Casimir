# Casimir

<p align="center">
  <img src="assets/readme-icon.png" width="256" alt="Casimir 图标">
</p>

Casimir 是一个面向个人工作流的 Chrome 扩展，聚焦 arXiv 阅读与 ChatGPT 操作。
项目使用 Manifest V3 和原生 JavaScript，仓库根目录可以直接作为已解压扩展加载。

## 当前功能

- **arXiv 首次访问**：首次打开某篇论文的摘要页时跳转到对应 PDF。
- **arXiv 分屏**：在 arXiv PDF 旁创建 Chrome 原生分屏后，将新空白窗格打开为 ChatGPT。
- **PDF 附件传递**：把匹配的公开 arXiv PDF 传给准确的 ChatGPT 标签页文件输入。
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

修改代码后，需要在扩展管理页重新加载 Casimir，并刷新已经打开的 arXiv 与
ChatGPT 标签页，使新的内容脚本生效。

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

## 验证 arXiv 分屏

1. 打开一个 arXiv PDF，例如 `https://arxiv.org/pdf/1706.03762`。
2. 保持 PDF 标签页处于活动状态。
3. 按 `Command + Option + N` 创建 Chrome 原生分屏。
4. 确认新空白窗格打开 `https://chatgpt.com/`。
5. 等待 Casimir 状态提示，并确认 PDF 出现在 ChatGPT 附件区域。
6. 确认原始 PDF 窗格及 URL 未改变，Casimir 没有填写提示词或发送消息。

Casimir 只在内存中获取并传递 PDF，不写入下载目录。Casimir 当前的自动传输
上限为 100 MB（并非 ChatGPT 的文件上限）；目标 ChatGPT 页面在两分钟内未
领取任务时，任务会过期。

以下情况不会触发导航：

- 普通网页与新空白窗格组成分屏。
- arXiv 摘要页与新空白窗格组成分屏。
- 现有网页与 arXiv PDF 组成分屏。
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
- `storage`：保存访问记录、自定义快捷键和短生命周期的 PDF 交接任务。
- `https://arxiv.org/*`：运行首次访问脚本，并由后台获取匹配的公开 PDF。
- `https://chatgpt.com/*`：运行快捷键、PDF 文件输入及对话记录限流提醒处理脚本。

Casimir 不读取 ChatGPT 对话内容，不调用未公开的 ChatGPT 后端接口，也不会填写提示词
或自动发送消息。PDF 只会交给与源 arXiv 标签页配对的准确 ChatGPT 标签页。

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
