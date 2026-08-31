# @crosery/dsh-viewer

一个 dsh 插件：给模型一个 `display_file` 工具，把 6 类 36 种扩展名渲染进 Web GUI 的对话流。**Host 半边在 `src/`，浏览器半边在 `src/client/`**，两个半边共享 `src/contract.ts`。

## 三条会被默认直觉坑到的约束

写任何代码前先读。它们不挑改动类型，每次都可能触发。

**两个半边分开编译。** `npm run typecheck` 跑两个 tsconfig 不是洁癖：两边都在增强同一个 `@deepseek-ai/cordis` 的 `Context`，而 `sessions` 在 Host 侧是 `SessionStore`、在浏览器侧是 `ISessions`。一个同时看见两份增强的 program 会静默解析到错的那个（`skipLibCheck` 把冲突盖掉了），症状是 `ctx.sessions.binding` 报不存在。新增源文件时确认它落进了正确的那份 `include`。

**客户端 bundle 有纯度门。** `src/client/**` 只允许三种 import：`react` 与 `react/jsx-runtime`、相对路径的本仓库文件、以及**仅类型**导入（`import type`）。其余值导入要么被整个内联进 bundle，要么变成模块表答不出的 `require`——后者在浏览器里激活插件时才抛错，本地跑测试永远看不到。自查：

```sh
npm run build && grep -o 'require("[^"]*")' lib/client.js | sort -u
```

只应出现 `react` 和 `react/jsx-runtime`。CI 也断言这一条。

**`inject` 里只写每个目标组合都保证存在的服务。** 未激活的条目是**硬启动失败**（`dsh: 1 entry did not activate`），不是优雅跳过——把 `webServer` 写进 `inject` 会让这个插件无法与 `dsh-headless` 组合，而不只是在那里失效。可选服务走 `ctx.inject([...], scoped => …)` 嵌套作用域，或 `ctx.get('...')` 读。

## 文档路由

| 任务 | 文档 |
| --- | --- |
| 改代码、加一种格式、加一个设置、动卡片渲染 | [docs/development.md](docs/development.md) |
| 写提交信息、开 PR、CI 红了 | [docs/pull-requests.md](docs/pull-requests.md) |
| 发版、打 tag、发 npm、提插件市场 | [docs/releasing.md](docs/releasing.md) |
| 上游 harness 变了、改 peer 范围、收到 `upstream-drift` issue | [docs/harness-compatibility.md](docs/harness-compatibility.md) |

## 环境

- Node `^22.19 || >=24`。harness 在奇数主版本上直接启动失败。
- LibreOffice 只有 `document` 类需要（`docx`/`xlsx`/`pptx` 等）。没装时其余五类照常工作，文档卡片会说明缺什么。
- **核 API 对着本机已安装的类型声明**：`~/.bun/install/global/node_modules/@deepseek-ai/dsh-*/lib/types/*.d.ts`。类型声明与实测优先于任何文档，本文件包含在内。
