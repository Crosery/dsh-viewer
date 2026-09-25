# 开发

> [English](development.md) · **中文** · [文档索引](README.zh.md)

三条常驻约束在 [AGENTS.md](../AGENTS.md)；这里是改代码时的配方与不变量。

## 两个半边的职责边界

| | Host（`src/`） | 浏览器（`src/client/`） |
| --- | --- | --- |
| 拿得到 | `ctx.fs` `ctx.tools` `ctx.attachments` `ctx.webServer` `ctx.llm` `ctx.officeToPdf`（后四个可选）、`node:` 内建 | `ctx.slots` `ctx.locale`、DOM；可选的 `ctx.sessions`、`ctx.uiConversation`、`ctx.configForms`，以及 owner 给的 `loadImage`/`openFile` |
| 负责 | 解析路径、签名 URL、转换文档、提交附件、决定 `inContext` | 把一个已经settled的工具块渲染成卡片 |
| 禁止 | import 任何 UI 或传输类型 | 值导入 react、react/jsx-runtime、react-dom（只用 createPortal）以外的任何外部包（[纯度门](../AGENTS.md)） |

`src/contract.ts` 是两边唯一共享的模块，因此它**不引 `@deepseek-ai/schemastery`，也不引任何 `node:` 内建**——引了就会被内联进客户端 bundle 或直接把它打崩。Host 的 schema 建在它之上，放 `src/settings.ts`。

## 加一种新格式

1. 在 `src/contract.ts` 的 `MEDIA_TABLE` 加一行：扩展名 → `{ kind, mediaType }`。**只加浏览器真能播的格式**——这张表里的一条是一句承诺：卡片会渲染出东西。浏览器放不了的编码属于 `file` 兜底。
2. 需要新的渲染方式才加 `ViewerKind`；能复用现有元素就复用（`svg` 和 `png` 同属 `image`，因为都进 `<img>`）。
3. 新 kind 才需要动：`src/client/ViewerCard.tsx` 的 `KIND_TITLE`、`KindIcon` 的 path、`Viewer` 的 `switch`，以及 `src/client/locales.ts` 两份词典（键集不一致会让 locale 服务失败）。
4. 二进制不透明的格式（读它的字节当文本毫无意义）加进 `OPAQUE_KINDS`，`read` 打上去才会被纠正。`html` 刻意不在其中：读 HTML 源码是正当的文本读取。
5. `tests/contract.test.ts` 补断言。README 两份的格式表和数字**同时**改——市场评审会拿描述里的数字对着代码核。

## 加一个设置

字段名常量与接口在 `src/contract.ts`，schema 在 `src/settings.ts`，两边都要加。然后想清楚它是**注册期事实**还是**运行期读数**：

- 注册期（比如 `tool`）：改变模型看到的 schema 列表，必须在 `onChange` 里**重新注册**。关掉它意味着工具从列表里消失，而不是留在那里拒绝调用。
- 运行期（比如 `feedModel`）：监听器每次执行时读 thunk 即可，不需要重挂。

`src/index.ts` 的 `reconcile()` 是前者的样板：幂等，且在没有 settings provider 的组合里也要被调用一次，否则 entry-config 的状态建立不起来。

## 卡片的三条数据来源

`src/client/card-model.ts` 按顺序尝试，每一条都有存在的理由，删任何一条都会让某个真实场景变成空白表头：

1. **`block.meta`** — `display_file` 的 `presentationMeta`。顶层调用的正常路径，重放安全。
2. **结果信封** — 注册表**只为顶层调用投影 `presentationMeta`**（`exec.parent === undefined`）。模型在 `run_code` 里调 `tools.display_file` 时元数据根本不存在，只能从模型可见信封里的 `<media>` `<bytes>` `<asset>` 恢复。这是卡片解析**自己写的**结构化信封，恢复值仍走与重放完全相同的校验。
3. **content 里的 image block** — 出厂 `read_image` 不写任何元数据，它的图只在内容块里。

任何一条都可能拿到本 build 没写过的形状（旧日志、被截断的窗口、更新版本写的字段），所以全部防御性收窄，**失败返回 `undefined` 让卡片降级，不抛错**——抛错的条目会被移出插槽，整场对话的查看器卡片一起消失。

## 与 harness 自带视图共处

- **每个插槽注册都互相隔离**（`src/client/registration.ts` 的 `contribute`）。插槽已声明时，`slots.inject` 回调里抛出的错误会重新抛进 `apply`，cordis 随即卸载整个客户端半边——v0.1.1 在 0.1.7 上就是被 `read_image` 冲突连带撤掉了 `display_file` 卡片。
- **`read_image` 以优先级 1 注册。** 插槽核心拒绝同一 key 在已占用优先级上的第二个条目，并渲染优先级最低的那个；所以 harness 自带的 `read_image` 视图（0.1.3 起）胜出，本卡片只在没有它的版本上补位。`tests/client-registration.test.ts` 用当前安装版本的真实 `SlotCore` 验证这一点。
- **轮次尾部**（`src/client/turn-tail.ts`、`ViewerTail.tsx`）是走出「已完成轮次折叠」的官方途径：一个 Conversation Definition 把该轮的 `display_file` 结果发布成 Turn 数据，再由 `conversation.chat.turnTail` 列表条目渲染。只在这两个接口都以这种形态存在的版本（0.1.6 起）才接入；工具行本来就可见时它什么都不渲染。
- **桌面版按能力识别**（`src/client/host.ts`：`dsh-app:` 协议或 `__DSH_HOST_PATHS__`），绝不看 user agent。桌面窗口会静默拒绝指向应用 URL 的新标签，所以那里「新标签打开」换成 owner 的 `openFile`（侧边栏预览）；视频/音频改从 `__DSH_TRANSPORT__.streamBaseUrl` 加载（`mediaSourceFor`），因为经 `dsh-app:` 转发第一次加载的媒体不能拖动。PDF 内嵌框在桌面窗口里与浏览器里一样能显示（已在 0.1.7-rc.2 实测）。

## 两个反直觉的渲染事实

**PDF 的 iframe 不能加 `sandbox`。** 不带 `allow-same-origin` 的 sandbox 给 frame 一个不透明 origin，Chrome 内置 PDF 阅读器拒绝在那里运行，显示「此页面已被 Chrome 屏蔽」。PDF 本来也不需要它：以 `application/pdf` + `nosniff` 下发时浏览器交给自己隔离的阅读器。本地 HTML 正相反——那是 agent 可能刚写出来的任意脚本——保留 sandbox，并由 Host 随响应下发的 CSP 兜底。

**`read` 打到二进制媒体上不是错误。** 出厂 `dsh-fs-local` 采样文件头，遇 NUL 直接抛 `FS_NOT_TEXT`，所以那条红色失败行**装不装本插件都有**。`tools/pre-execute` 拒绝会自己造一个 `isError`；`tools/post-execute` 也救不了——替换 value 在失败结果上被明确拒绝，替换 content 又保留 `isError`。纠正因此放在 `tools/execute` around-dispatch 且**不调 `next()`**：注定失败的读取一次 I/O 都不发生，自造的成功结果经 `normalizeDispatchResult` 重跑该工具自己的 `render` 和 `presentationMeta`，把持久化的 read 元数据一并换掉。

## 测试

`npm test` 跑 `tests/*.test.ts`。新增行为的判据不是「有没有测」，而是**这个测试能不能证伪真实故障**：

- **纯函数**（分类、收窄、信封解析）直接测，覆盖畸形输入——它们在重放旧日志时会真的收到。
- **HTTP 行为挂真服务器测。** Range 的正确性无法靠单测解析器证明，必须看响应到底带了哪些字节和头（`tests/asset-route.test.ts` 用 `node:http` 发真请求）。
- **外部工具链测真产物。** `tests/convert.test.ts` 用 LibreOffice 自己造 DOCX 再转回来，断言产物头四字节是 `%PDF-`；机器上没装 LibreOffice 时跳过，并单独断言「没装时的报错指明了装法」。
- **改了 UI 渲染**，跑一遍真实会话截图确认，别只看单测——`sandbox` 那个 bug 所有单测都是绿的，只有截图里能看见「已被 Chrome 屏蔽」。
