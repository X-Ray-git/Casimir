# 当前状态

## 产品定位

Casimir 是一个个人使用的 Chrome Manifest V3 扩展，为 arXiv 与 ChatGPT 提供明确触发、
范围受限的工作流增强。

项目以 MIT License 开源。

## 已实现

- 首次访问 arXiv 摘要页时跳转到对应 PDF，并按论文 ID 记录访问状态。
- 在 arXiv PDF 旁创建 Chrome 原生分屏后，将空白侧栏导航到 ChatGPT。
- 将匹配的公开 arXiv PDF 传给准确的 ChatGPT 标签页文件输入。
- 提供 ChatGPT 新建对话、聚焦输入框、切换侧栏、临时对话及自定义提示词快捷键。
- 自动确认并关闭 ChatGPT 的对话记录访问限流提醒。
- 使用 Node 内置测试覆盖核心正向流程、事件顺序与防御性边界。
- 通过 GitHub Actions 验证 Manifest、JavaScript 语法、测试及打包流程。

## 兼容性与限制

- 最低 Chrome 版本为 140，分屏流程当前以 macOS 为主要验证平台。
- PDF 内存传输上限为 100 MB，待处理任务两分钟后过期。
- ChatGPT 文件上传与快捷键依赖其当前 DOM 契约，站点更新后可能需要适配。
- 当前只支持开发者模式加载，尚未配置 Chrome Web Store 发布流程。

## 后续增强

- 如果 ChatGPT 未来暴露无需额外请求的稳定信号，考虑被动显示对话记录限流是否
  已解除；不通过主动轮询侧栏或未公开接口判断状态。

## 验证基线

```bash
npm run check
npm run package
```

打包产物位于 `dist/casimir-<version>.zip`。
