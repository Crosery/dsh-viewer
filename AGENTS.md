# @crosery/dsh-viewer

一个 dsh 插件：给模型一个 `display_file` 工具，把 6 类 36 种扩展名渲染进 Web GUI 的对话流。**Host 半边在 `src/`，浏览器半边在 `src/client/`**，两个半边共享 `src/contract.ts`。

## 三条会被默认直觉坑到的约束

写任何代码前先读。它们不挑改动类型，每次都可能触发。

**两个半边分开编译。** `npm run typecheck` 跑两个 tsconfig 不是洁癖：两边都在增强同一个 `@deepseek-ai/cordis` 的 `Context`，而 `sessions` 在 Host 侧是 `SessionStore`、在浏览器侧是 `ISessions`。一个同时看见两份增强的 program 会静默解析到错的那个（`skipLibCheck` 把冲突盖掉了），症状是 `ctx.sessions.binding` 报不存在。新增源文件时确认它落进了正确的那份 `include`。

**客户端 bundle 有纯度门。** `src/client/**` 只允许三种 import：`react`、`react/jsx-runtime`、`react-dom`（只用 `createPortal`）这三个外部模块，相对路径的本仓库文件，以及**仅类型**导入（`import type`）。其余值导入要么被整个内联进 bundle，要么变成模块表答不出的 `require`——后者在浏览器里激活插件时才抛错，本地跑测试永远看不到。`react-dom` 在 0.1.1 与 0.1.7 的 shell 模块表里都是内置项（React 18.3.1），灯箱靠 `createPortal` 挂到 `body` 才不会被带 transform 的滚动容器裁掉；除 `createPortal` 外不要从它取别的东西。自查：

```sh
npm run build && grep -o 'require("[^"]*")' lib/client.js | sort -u
```

只应出现 `react`、`react/jsx-runtime` 和 `react-dom`。CI 也断言这一条。

**`inject` 里只写每个目标组合都保证存在的服务。** 未激活的条目是**硬启动失败**（`dsh: 1 entry did not activate`），不是优雅跳过——把 `webServer` 写进 `inject` 会让这个插件无法与 `dsh-headless` 组合，而不只是在那里失效。可选服务走 `ctx.inject([...], scoped => …)` 嵌套作用域，或 `ctx.get('...')` 读。

## 文档路由

| 任务 | 文档（中 · 英） |
| --- | --- |
| 改代码、加一种格式、加一个设置、动卡片渲染 | [docs/development.zh.md](docs/development.zh.md) · [en](docs/development.md) |
| 写提交信息、开 PR、CI 红了 | [docs/pull-requests.zh.md](docs/pull-requests.zh.md) · [en](docs/pull-requests.md) |
| 发版、打 tag、发 npm、提插件市场 | [docs/releasing.zh.md](docs/releasing.zh.md) · [en](docs/releasing.md) |
| 上游 harness 变了、改 peer 范围、收到 `upstream-drift` issue | [docs/harness-compatibility.zh.md](docs/harness-compatibility.zh.md) · [en](docs/harness-compatibility.md) |

## 环境

- Node `^22.19 || >=24`。harness 在奇数主版本上直接启动失败。
- LibreOffice 只有 `document` 类需要（`docx`/`xlsx`/`pptx` 等），而且 0.1.6-alpha.2 起 harness 自带的 `officeToPdf` 服务会先接手 `doc`/`docx`/`xls`/`xlsx`/`ppt`/`pptx`。两者都没有时其余五类照常工作，文档卡片会说明缺什么。
- **核 API 对着类型声明**：devDependencies 钉在 0.1.7-rc.2（`node_modules/@deepseek-ai/dsh-*/lib/types`），最低线 0.1.1-rc.2 用 `node scripts/sweep-trains.mjs --versions 0.1.1-rc.2` 在临时副本里复核；全部已发布版本同一个脚本不带参数跑。源码必须同时在两条线上编译：只用结构类型和特性探测，不静态值导入任何一条线上缺失的符号。类型声明与实测优先于任何文档，本文件包含在内。
