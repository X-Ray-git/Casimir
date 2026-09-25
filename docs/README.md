# Casimir 维护知识库

这里保存仍对开发、排障和发布有用的当前事实。项目规模较小，因此只按实际职责拆分，
不复制 Flutter 客户端的平台目录。

## 推荐阅读顺序

1. [当前状态](status/current.md)
2. [架构概览](architecture/overview.md)
3. [本地开发](operations/development.md)
4. [故障排查](operations/troubleshooting.md)

## 专题与修改背景

- [2026-09-25 ChatGPT 布局适配](operations/2026-09-25-chatgpt-layout.md)：两份快照、DOM 变更和验证边界。

- [浏览器级聚焦：实现与验证](operations/browser-focus-prototype.md)：当前行为、权限边界与验收。
- [2026-09-17 分屏附件与焦点排查记录](operations/2026-09-17-split-view-investigation.md)：
  初始故障、证据链、失败方案、Chrome 更新假设、授权讨论、测试遗漏及最终验证。

## 维护规则

- 用户可见行为、权限或兼容性发生变化时，同步更新 README、架构文档和当前状态。
- 未发布变化写入根目录的 `CHANGELOG.md`。
- 新增 Manifest 权限时，必须在 README 和架构文档中解释用途与边界。
- 保持根目录可直接被 Chrome 加载；`dist/` 只保存可分发压缩包，不作为开发入口。
