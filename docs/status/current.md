# 当前状态

## 产品定位

Casimir 是一个个人使用的 Chrome Manifest V3 扩展，为论文阅读与 ChatGPT 提供明确触发、
范围受限的工作流增强。

项目以 MIT License 开源。

## 已实现

- 首次访问 arXiv 摘要页或匹配的 DAIR.AI 论文页时跳转到对应 PDF；从任意来源打开过
  同一 arXiv PDF 后不再跳转，版本号共享同一条访问记录。
- 在受支持的论文页面旁创建 Chrome 原生分屏后，将空白侧栏导航到 ChatGPT。
- 同一分屏目标标签页的后台处理互斥执行，防止重叠事件重复导航并误删附件任务。
- 新分屏的 ChatGPT 输入框就绪后，通过短暂调试连接恢复输入框焦点；已取得额外
  `debugger` 权限授权。2026-09-17 用户反馈生效，日志确认聚焦、断开和 PDF 传递成功。
- 将匹配的 arXiv、alphaXiv、Nature、ACL Anthology 或 OpenReview 论文内容传给准确的
  ChatGPT 标签页；alphaXiv 博客及 Nature 的 PDF 不适合后台直接获取时捕获并传递
  MHTML 页面快照。
- 将已完整渲染的 X Article 直接捕获为 MHTML 并传给准确的 ChatGPT 标签页，普通推文
  不触发。
- 提供 ChatGPT 新建对话、聚焦输入框、切换侧栏、临时对话及自定义提示词快捷键。
- 自动确认并关闭 ChatGPT 的对话记录访问限流提醒。
- 使用 Node 内置测试覆盖核心正向流程、事件顺序与防御性边界。
- 通过 GitHub Actions 验证 Manifest、JavaScript 语法、测试及打包流程。

## 兼容性与限制

- 最低 Chrome 版本为 140，分屏流程当前以 macOS 为主要验证平台。
- PDF 与 MHTML 的内存传输上限为 100 MB，待处理任务两分钟后过期。
- alphaXiv 博客的外部 PDF 读取维持显式可信主机列表；未知外部主机不会扩大为全站权限，
  而会使用 MHTML 回退。
- Nature 正文 PDF 均先通过同站无 Cookie 回跳参数尝试无凭据获取；无法得到有效 PDF
  时只捕获准确源标签页中已经渲染的内容，不读取登录凭据、不访问身份服务，也不绕过
  访问控制。
- ACL Anthology 与 OpenReview 仅接受和当前论文页面标识完全匹配的公开 PDF，不会选择
  checklist、附件或其他投稿的 PDF。
- OpenReview PDF 请求仅向 OpenReview 自身沿用浏览器现有站点会话以通过访问校验；
  扩展不读取 Cookie 值，其他来源仍使用无凭据请求。
- ChatGPT 文件上传与快捷键依赖其当前 DOM 契约，站点更新后可能需要适配。
- 当前只支持开发者模式加载，尚未配置 Chrome Web Store 发布流程。

## 焦点修复验证

- 保留直接导航，已撤除曾导致白屏闪烁的中转页。
- 补齐 arXiv 任务的来源标签页 ID，并修正输入框延迟挂载和端口提前关闭的时序缺口。
  68 项测试通过；用户新建分屏后的反馈与后台日志确认本轮聚焦成功。
- 实测来源为 arXiv `2609.18011`；修复后原生键盘位置未由 agent 再次独立验证，
  不据此推断所有 Chrome 版本都已覆盖。实现、权限边界及排障记录见
  [浏览器级聚焦](../operations/browser-focus-prototype.md)。
- 附件任务竞态、失败的焦点方案、Chrome 更新归因边界与全部诊断过程见
  [2026-09-17 排查记录](../operations/2026-09-17-split-view-investigation.md)。

## 后续增强

- 如果 ChatGPT 未来暴露无需额外请求的稳定信号，考虑被动显示对话记录限流是否
  已解除；不通过主动轮询侧栏或未公开接口判断状态。

## 验证基线

```bash
npm run check
npm run package
```

打包产物位于 `dist/casimir-<version>.zip`。
