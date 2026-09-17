# 2026-09-17 分屏附件与输入框焦点排查记录

## 结论与阅读入口

本次解决两个独立问题：并发标签页事件导致附件任务丢失，以及新建 ChatGPT 分屏后
键盘焦点留在 Chrome 地址栏。最终保留直接导航，附件交接按目标标签页互斥处理，
输入框就绪后通过短暂 `chrome.debugger` 连接恢复页面与输入框焦点。

用户最后反馈“好像起效果了”，对应后台日志确认 `focused: true`、调试连接断开和
PDF 传递成功。不能将这一轮成功扩大为所有 Chrome 版本均已验证。

- 当前实现及权限边界：[浏览器级聚焦](browser-focus-prototype.md)。
- 日常诊断入口：[故障排查](troubleshooting.md)。
- 当前能力与限制：[当前状态](../status/current.md)。

本文记录可核对的现象、讨论过的方案、选择理由及验证限制，不替代源码，也不把
未证实的猜测写成根因。提交保留 0.5.0 版本号，变化继续归入 `Unreleased`；本次是
源码检查点，不是版本发布。原始对话不作为后续维护的必要依赖。

## 初始现象：ChatGPT 打开，但没有附件

用户确认 Casimir 0.5.0 已启用，扩展卡片没有错误按钮，`Cmd+Shift+,` 设置快捷键有效。
ChatGPT 能打开，但没有附件，也没有“正在获取 PDF”“正在准备”或“添加失败”提示。
页面 DevTools 的 Sources → Content scripts 显示 `chatgpt-pdf-upload.js` 已注入。
这些事实说明不能简单归因为整个扩展未加载，也不能仅凭脚本存在就认定上传流程已启动。

后台关键证据（来源 arXiv `2609.17523`）：

```text
[splitView detected]
[matched paper]  // 同一目标出现多次
[update to ChatGPT]
[update failed] Error: Navigation rejected.  // 重复导航失败
[skip] target is already ChatGPT
```

查询 `chrome.storage.session` 的 `pendingPdfUpload:` 键没有待处理任务；日志也缺少
`PDF transferred`。这不是 PDF 下载错误的充分证据，问题发生在任务交接之前。

### 并发根因与修复

`onCreated`、`onActivated`、`onUpdated` 可重叠调用 `evaluateCandidate()`。
原实现检查 `processed` 后先 `await` 标签页/来源查询，随后才设置标记；多个调用
因此能同时通过检查。一次导航成功，其他导航被 Chrome 拒绝，失败分支又清除了
成功调用刚保存的共享任务。于是页面打开了，但内容脚本无任务可领，也没有状态提示。

现在在第一个 `await` 之前设置 `candidate.evaluating`，持有到导航及失败清理结束，
通过 `finally` 释放；实际处理由 `evaluateLockedCandidate()` 完成。
成功的候选仍由 `processed` 去重，失败会允许后续标签页事件重试。
互斥按目标标签页执行，不阻止其他独立分屏。

回归测试用挂起的标签页查询制造事件重叠，检查只发生一次导航、任务仍可领取且
PDF 数据可传递；另测导航拒绝后的重试。修复后真实分屏中已观察到附件。

## 第二个问题：需要手动点击 ChatGPT 输入框

用户真正要求的体验是：从论文页新建原生分屏，右侧打开 ChatGPT 并附上论文，
随后直接打字，无需再点击输入框。附件恢复后，地址栏焦点问题仍存在，必须单独解决。

环境记录：macOS，排查时本机 Chrome 为 `153.0.8010.47`，扩展保持 0.5.0。
用户移除开发版，另行克隆并加载 GitHub 旧代码后，问题仍复现；随后已重新加载回
当前 `/Users/x.rw/dev/Casimir`。这削弱了“本轮附件修复单独导致焦点退化”的假设，
但没有完成新旧 Chrome 的对照，不能确认是某次 Chrome 更新，也不能排除站点变化。

### 尝试过的路径及结果

| 方案或判断 | 证据与结果 | 最终处理 |
| --- | --- | --- |
| 页面 `window.focus()`、输入框 `.focus()`，等待页面就绪后重试 | 用户重新加载并重试后无改善；页面中的活动元素不等于浏览器实际接收键盘的控件 | 撤除作为自动恢复方案的页面重试逻辑 |
| 扩展中转页再跳 ChatGPT | 仍聚焦地址栏，且用户观察到以前没有的白色页面闪烁 | 删除 `src/pages/open-chatgpt.html/js` 及相关引用，恢复直接 `tabs.update` |
| 只将标签页设为 active | 已经活动的标签页不保证网页取得焦点，原生分屏又有自己的焦点逻辑 | 不作为修复依据 |
| `F6` | agent 的一次实际尝试没有解决该场景 | 不推荐为已验证的替代方案 |
| 更换回 GitHub 旧代码 | 用户报告同一 Chrome 中仍复现 | 记录为环境相关证据，不宣称确定的 Chrome 回归 |
| 浏览器级 `Page.bringToFront`，再聚焦输入框 | Chromium 实现中包含激活 WebContents 和调用 Focus 的路径，能越过单纯页面元素聚焦的局限 | 用户同意权限后实施，并经后续修正取得成功反馈 |

源码研究支持普通扩展导航可能保留地址栏焦点，而 `Page.bringToFront` 有浏览器级
聚焦路径；它只是选择实验方向的依据，不能替代在该用户环境中验证。
研究时阅读的代码包括 Chromium `tabs_api.cc` 与 `page_handler.cc`，见文末来源。

## debugger 权限讨论与授权

在启用前向用户解释：`debugger` 权限可以广泛读取、修改页面，授权本身并不是仅允许
聚焦；Chrome 可能显示调试提示。用户明确回复“好的，就这样做”后才加入 Manifest。
此前原型通过 `getManifest().permissions` 检查，缺少权限时不会启动。
Chrome 不支持把此权限声明为可选权限，普通设置开关不能消除授权代价。

实现仅处理持有匹配附件任务的新 ChatGPT 标签页，检查目标活动状态、窗口前台状态、
源目标同窗口同分屏及两分钟任务时限；连接后再次检查。准备期间页面交互或变为隐藏
会取消；浏览器步骤也检查页面可见性、用户激活和输入框状态。每个端口只请求一次。
成功、失败或连接后的提前退出，都在 `finally` 中尝试断开自己的调试连接。
其他调试器占用目标导致连接失败时跳过，不断开其他调试器。

不读取对话内容，不写入提示词，不发送消息，不隐藏调试提示，不修改 Chrome 安全开关。
这些是当前代码边界，不应误写为 `debugger` 权限本身的能力限制。

## 原型为何未立即生效，以及测试的教训

### 1. arXiv 任务缺少来源标签页 ID

首轮启用权限后仍失败。检查发现，arXiv 的 `resolvePdfSource()` 只返回来源 URL，
未返回 `sourceTabId`；旧 PDF 下载流程不需要该字段，因此一直没有暴露。
新的分屏核对需要用它调用 `chrome.tabs.get()`，会在聚焦前报错退出。

最初浏览器聚焦测试手工构造了含来源 ID 的任务，掩盖了真实生产路径缺字段的问题。
现在 arXiv 解析返回来源 ID，测试也从 `onCreated` 事件生成真实任务后再领取及请求
聚焦。新断言在修复前失败（`undefined !== 1`），修复后通过。

### 2. 输入框尚未挂载与端口提前关闭

补齐来源 ID 后，agent 再次使用原生键盘直接输入 `casimir-focus-test`，仍进入地址栏；
附件正常。两轮 agent 测试均没有点击输入框或发送消息，不能用 DOM 层显示输入框
focused 的结果覆盖这项失败证据。

用户查询 `chrome.runtime.getManifest().permissions`，确认实际包含：
`debugger`、`pageCapture`、`storage`、`tabs`。随后捕获的一次完整分屏日志有
`matched paper`、`update to ChatGPT` 和 `PDF transferred`，却没有聚焦步骤日志。
这将范围缩小到内容脚本准备阶段，不能继续归咎于权限没有加载。

旧准备逻辑只等待上传控件，随后只检查一次 `#prompt-textarea`。如果编辑器晚于
上传控件挂载就静默放弃；同时，附件确认成功后直接断开端口，可能截断尚未完成的
准备工作。任意可见性变化都取消的逻辑还会将首次变为可见当成用户切走。

最终修正：

- 最多 200 次、每次约 100 ms，同时检查上传控件及 composer 内可见的输入框。
- 用 `focusPreparation` 跟踪准备过程，附件完成后等待它结束才关闭端口。
- 只在变为隐藏时因可见性取消，首次变为可见不取消；按键、点击仍取消。
- 后台记录 offered、requested、preparation skipped 及浏览器步骤的成功/失败/断开。

这些时序缺口在代码及回归场景中已确认。旧流程没有逐阶段诊断，无法事后严格区分
用户此前每一次失败具体命中了哪一条，不能声称每个失败都由同一时序造成。

## 诊断沟通与真实验证

用户最初不确定日志位置。`[casimir:paper-split-view]` 来自扩展 Service Worker 的
Console；`[casimir:chatgpt-attachment-upload]` 来自 ChatGPT 页面 Console。
Sources 中看见内容脚本仅说明已注入。只有启动和激活日志，或仅打开论文摘要页的日志，
并不是一次完整分屏测试；应先打开后台检查器，再从 PDF 页按 `Cmd+Option+N` 创建分屏。

重新加载指 Casimir 卡片的圆形箭头，不是管理页顶部“更新”。测试新分屏可以新建论文页，
无需反复刷新用户的所有论文页。查权限时应清空 Console 筛选框，否则查询结果可能被隐藏。
20 秒是准备等待上限及诊断等待时间，不是正常使用时每次必须等待的固定延迟。

agent 曾直接操作独立测试标签页；工具后来自动拒绝访问扩展管理页/测试 ChatGPT 页，
其中后者给出的理由是可能触及其他私密会话。没有改用底层 CDP、系统脚本或其他界面
绕过拒绝，而由用户执行重新加载、触发分屏和提供后台日志。调试自动化自身也可能
占用目标页调试连接，复测时避免在 Casimir 聚焦期间接管目标 ChatGPT 页。

最终用户提供的成功证据（2026-09-17，arXiv `2609.18011`）：

```text
[matched paper] sourceTabId: 846335449, targetTabId: 846335589
[update to ChatGPT] targetTabId: 846335589
[composer focus offered] targetTabId: 846335589, enabled: true
[composer focus requested] targetTabId: 846335589
[composer focus] targetTabId: 846335589, focused: true
[composer focus detached] targetTabId: 846335589
[PDF transferred] targetTabId: 846335589, totalBytes: 366166
```

附件与聚焦并行，因此不要求 PDF transferred 必须出现在聚焦之前。
`focused: true` 验证页面的 `document.hasFocus()` 与活动元素；`detached` 是断开 API
成功的日志，不是对调试横幅消失时刻的测量。最终成功是用户反馈与日志支持，修复后的
原生键盘输入位置没有由 agent 再次独立验证，也没有单独测量白屏闪烁或所有其他来源。

## 同批提交中的 Nature 修正

工作区在焦点排查前已有 Nature 相关未提交修改，本次保留并随源码检查点提交：
正常 `articles/<id>.pdf` 路径也先尝试公开 PDF，而非仅依据文件名直接转 MHTML。
Nature 后台请求保持 `credentials: "omit"`，使用同站
`?error=cookies_not_supported` 回跳参数避免进入身份服务；获取失败或非 PDF 时，
回退到准确源标签页的已渲染 MHTML。此处不读取登录凭据或绕过访问限制。

测试包括旧开放文章普通 PDF 路径成功，以及返回 HTML 时回退 MHTML；来源解析测试名称
同步调整。此修正与 ChatGPT 原生焦点问题没有已证实的因果联系，也不将其模拟测试
说成本轮新完成的 Nature 浏览器实测。

## 交接约束、测试与后续复现

最终 `npm run check` 与 `npm run package` 均通过：68 项 Node 测试，另有 Manifest
及 JavaScript 语法检查。打包产物为忽略提交的 `dist/casimir-0.5.0.zip`。
新增/加强的覆盖包括事件重叠与失败重试、真实任务来源 ID、精确配对和活动状态、
重复请求、连接失败与清理、输入框延迟挂载、隐藏/显示转换以及等待超时后的端口关闭。
调试协议在 Node 测试中由 stub 模拟；测试通过不等于原生焦点必然成功。

后续遇到回归时先依次判断 offered → requested/skip → focused/failed → detached，
保留原生键盘输入位置的观察。不要恢复已撤除的中转页，不要用反复 `.focus()` 掩盖
地址栏焦点，也不要为使测试通过而绕过任务绑定或用户切走检查。
Chrome 更新归因仍需明确版本对照；保持将现象、假设、代码缺陷和最终验收证据分别记录。

本次授权是本地提交，不自动推送、创建 tag、GitHub Release 或发布商店包。
后续发布可按[开发与版本流程](development.md)统一变更三个 JSON 版本及 README。

## 研究依据

- [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome permissions API 与不可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chromium tabs_api.cc（排查时阅读的固定修订）](https://chromium.googlesource.com/chromium/src/+/4848e47a0e2bcfd75994cc21b8b31ea457a1395c/chrome/browser/extensions/api/tabs/tabs_api.cc)
- [Chromium PageHandler / BringToFront](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/protocol/page_handler.cc)

`main` 链接内容会变化，研究依据不代表已定位到用户安装版本的回归提交。
