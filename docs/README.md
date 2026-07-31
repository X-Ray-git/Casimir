# Casimir 维护知识库

这里保存仍对开发、排障和发布有用的当前事实。项目规模较小，因此只按实际职责拆分，
不复制 Flutter 客户端的平台目录。

## 推荐阅读顺序

1. [当前状态](status/current.md)
2. [架构概览](architecture/overview.md)
3. [本地开发](operations/development.md)
4. [故障排查](operations/troubleshooting.md)

## 维护规则

- 用户可见行为、权限或兼容性发生变化时，同步更新 README、架构文档和当前状态。
- 未发布变化写入根目录的 `CHANGELOG.md`。
- 新增 Manifest 权限时，必须在 README 和架构文档中解释用途与边界。
- 保持根目录可直接被 Chrome 加载；`dist/` 只保存可分发压缩包，不作为开发入口。
