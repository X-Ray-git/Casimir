# 浏览器级聚焦：实现与验证

目标：新分屏打开 ChatGPT 后直接在输入框打字，无需点击页面。

完整背景、失败方案与讨论见[2026-09-17 排查记录](2026-09-17-split-view-investigation.md)。
文件名保留早期原型名称以维持链接；本页描述的是当前已启用实现。

2026-09-17：用户重新加载后反馈聚焦已生效。其 Chrome 后台日志依次记录
`composer focus offered`（enabled: true）、`composer focus requested`、
`composer focus`（focused: true）、`composer focus detached` 和 `PDF transferred`。
该轮来源为 `https://arxiv.org/pdf/2609.18011`，目标标签页为 `846335589`。
这是用户实测反馈与后台日志确认；修复后的原生键盘位置未由 agent 再次独立验证。

用户已同意权限变更，`manifest.json` 已增加 `debugger` 权限。
重新加载扩展后生效。首轮实测仍进入地址栏；随后发现 arXiv 任务缺少
`sourceTabId`，导致分屏核对失败，已补齐。测试现通过真实分屏事件生成任务，
不再手工构造此字段；该回归测试修复前失败、修复后通过。
补齐字段后第二轮原生键盘测试仍进入地址栏，附件正常。用户随后确认已加载
`debugger` 权限，完整后台日志显示 PDF 传递完成但未进入聚焦步骤。
准备逻辑现改为同时等待上传控件和可见输入框，附件确认后保留端口直到准备步骤结束；
页面首次变为可见不会取消请求，切到不可见仍会取消。已补充延迟挂载、可见性变化和
等待超时测试，并记录准备阶段日志；上述成功反馈发生在这些修正之后。
此权限不能作为 Chrome 的可选权限；不能通过一个普通设置开关避免授权。

## 具体行为

1. 只有领取到当前标签页附件任务的 ChatGPT 页面能请求聚焦。
2. 最多等待 20 秒，直到上传控件与可见输入框都就绪；发生页面点击、按键或
   切到不可见后取消请求。附件上传完成不会提前关闭尚在准备的通信端口。
3. 后台核对目标为活动 ChatGPT 标签页，Chrome 窗口在前台，且源标签页
   仍在同一分屏。每个任务端口至多执行一次。
4. 短暂连接该标签页的调试接口，再检查配对、页面可见性和用户交互状态。
5. 通过 `Page.bringToFront` 让 Chrome 聚焦网页，通过固定脚本聚焦
   `#prompt-textarea`，只返回聚焦是否成功的布尔值。
6. 成功或失败均尝试断开自己建立的连接；不自动重试、不插入文字、不发送消息。
   聚焦失败不阻断附件传递。

## 权限代价与实测限制

- `debugger` 权限本身具备读取、修改网页等广泛能力；代码使用范围仅限上述目标，
  但权限授权本身不等同于仅允许聚焦。
- Chrome 可能显示调试提示；提示的显示和消失时间由浏览器控制。
- 若其他调试器占用目标而连接失败，会跳过；不会断开其他调试器。
- 不关闭或隐藏 Chrome 的权限提示与调试提示。
- 自动化测试验证了配对限制、无权限时跳过、重复请求、切走后的取消和失败清理，
  不能代替真实 Chrome 的焦点测试。

## 验收

用户重新加载后，在独立测试分屏中观察页面加载完成，再输入测试文字
（不发送），确认文字进入 ChatGPT 而非地址栏。随后清除测试文字、关闭测试页。
同时确认没有白色中转页、PDF 附件正常、调试连接已断开。

参考：[Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)、
[不可选权限列表](https://developer.chrome.com/docs/extensions/reference/api/permissions)、
[Page.bringToFront 实现](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/protocol/page_handler.cc)。
