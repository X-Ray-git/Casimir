# Casimir 维护入口

本文档是后续维护者和 agent 的短入口。详细事实与操作说明位于
[`docs/`](docs/README.md)。

接手时按以下顺序阅读：

1. [文档知识地图](docs/README.md)。
2. [当前状态](docs/status/current.md)。
3. [架构概览](docs/architecture/overview.md)。
4. 当前任务对应的开发或故障排查页面。

当前约束：

- 仓库根目录就是 Chrome 的“加载已解压的扩展程序”目录，`manifest.json` 不移入构建目录。
- Casimir 使用 Manifest V3 和原生 JavaScript，不为已有功能引入运行时依赖或前端框架。
- 自动化必须绑定准确的标签页 ID，不得覆盖已有网页，也不得自动发送 ChatGPT 消息。
- 不调用未公开的 ChatGPT 后端接口；优先使用稳定 URL、可访问性属性和原生文件输入。
- 改动后运行 `npm run check`；修改发布内容时同步更新 Manifest、`package.json` 与变更日志。
- 除非用户明确要求，否则不要创建 tag、GitHub Release 或发布到 Chrome Web Store。
