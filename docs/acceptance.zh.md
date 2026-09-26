# 验收记录

> [English](acceptance.md) · **中文** · [文档索引](README.zh.md)

在哪些 harness 版本上做过端到端验证、怎么验证的。下面每个数字都来自真实运行的 host，不是对着代码推出来的。末尾的 v0.1.1 各节保留为那次发版的记录。

## 0.3.0：0.1.0-rc.8 之前的版本，实测

0.2.0 的范围从 `0.1.0-rc.8` 起算，理由是 `dsh-client-ui-renderer` 在那里才首次发布。从来没人在更早的版本上跑过本插件。下面这些跑过了，在真实浏览器里，`src/` 和 `lib/` 没有任何改动（`lib/` 与 v0.2.0 逐字节一致，先装的是 0.2.0 的压缩包；最后一行用 0.3.0 自己的压缩包重做了一遍）。

每个 host 都是一次性的 `DSH_HOME`：harness 按发布时的样子安装（`npm install --before` 下一次发布），插件用 `dsh plugin --profile web add` 安装。一个模拟的 OpenAI 兼容模型服务（0.1.7 桌面版实测用的那个的副本）通过 profile 的 `cordis.patch.yml` 配置（`llm-pi-ai` provider、`agent-default-model`）；收到 `SHOW:display_file:png` 或 `:pdf` 时，它对一张合成的 480×300 PNG 或一页 PDF 调用 `display_file`。目录选择器固定为页内浏览器，工作区预置为测试文件所在目录，所以不会弹出原生对话框。

![0.0.1-rc.5：图片卡片](acceptance/early-001rc5-image-card.png)

![0.1.0-rc.6：内嵌的 PDF 卡片](acceptance/early-010rc6-pdf-card.png)

| Harness | 界面 | 图片卡片 | 灯箱 | PDF | 刷新之后 | 控制台 |
| --- | --- | --- | --- | --- | --- | --- |
| `0.0.1-rc.5`，v0.2.0 压缩包 | 正常加载，没有启动审计页 | `480×300 · 6.1 KB`，已进入模型上下文 | `role=dialog`、`aria-modal`，焦点在关闭按钮上，Escape 关闭 | 内嵌 frame，不带 `sandbox`；签名资源回答 `200 application/pdf` | 两张卡片都从会话日志重建 | 没有错误或警告 |
| `0.1.0-rc.2`，v0.2.0 压缩包 | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |
| `0.1.0-rc.6`，v0.2.0 压缩包 | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |
| `0.0.1-rc.5`，0.3.0 压缩包 | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |

这些版本缺什么、为什么不要紧，见 [harness-compatibility.zh.md](harness-compatibility.zh.md#010-rc8-之前的版本)。

## 0.3.0：每一个已发布版本

`node scripts/sweep-trains.mjs`，2026-09-26 在最终的代码树上运行（Node 26.7.0、npm 11），覆盖全部 27 个已发布版本。某版本从未发布的 harness 包保留本仓库钉住的版本（`0.1.0-rc.8` 之前是 `dsh-client-ui-renderer@0.1.7-rc.2`），有 `dsh-client-runtime` 的版本把它钉到该版本。

| 版本 | 结果 |
| --- | --- |
| `0.0.1-rc.5`、`0.1.0-rc.8`、`0.1.1-rc.2`、`0.1.2-rc.1`、`0.1.3-alpha.2`、`0.1.5-rc.3`、`0.1.6-alpha.2`、`0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2` | 通过：host tsc、client tsc 和 174/174 测试（`0.0.1-rc.5` 上 `dsh-client-ui-renderer` 保留在 `0.1.7-rc.2`） |
| `0.1.0-rc.2`、`0.1.0-rc.3`、`0.1.0-rc.6`、`0.1.0-rc.7`、`0.1.1-rc.1`、`0.1.2-alpha.2` – `alpha.5`、`0.1.5-alpha.1`、`0.1.5-alpha.2`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.6-alpha.1`、`0.1.7-alpha.1` | 通过，174/174；经由该版本自己的 `@deepseek-ai/dsh` 安装，因为它的脱字符 peer 让 npm 的 peer 图以 `ERESOLVE` 中止（0.1.0 各构建的 renderer 保留在钉住的版本） |
| `0.0.1-rc.1`、`0.0.1-rc.2` | 上游发布不完整：单独安装该版本的 `@deepseek-ai/dsh` 得到 `npm error 404 Not Found - GET https://registry.npmjs.org/@deepseek-ai%2fdsh-agent-tool-mode`。类型和测试没跑：`dsh-client-ui-renderer` 和 `dsh-home-paths` 在那里也没发布 |

每个 harness peer 在两种规则下都接纳全部 27 个版本。退出码是 0。

## 0.3.0：启动冒烟，在无头 Chrome 里运行

严格模式（不带豁免），Node 26.7.0、pnpm 11.7.0，通过 playwright-core 驱动无头 Google Chrome 153，每一行装的都是同一个打包好的 `dsh-viewer-0.3.0.tgz`。每个 harness 都以「该版本自己的 `@deepseek-ai/dsh` 发布一秒之后」为 `--before` 安装（只因它自己晚发布的包才往后挪），装好的依赖树里没有任何更晚版本的包。每一行的每个阶段都通过：harness、pnpm、install、boot、host-activation、client-graph、client-load、client-exports 和 `client-boot`——应用在 Chrome 里挂载完成、本插件的模块已加载，页面上没有任何关于本插件的问题。

| Harness | 启动条目 | 模块表 |
| --- | --- | --- |
| `0.0.1-rc.5`、`0.1.0-rc.2`、`rc.3`、`rc.6`、`rc.7` | 39（`dsh-client-web` 外壳；报告依赖图里没有 renderer） | 10 项 |
| `0.1.0-rc.8`、`0.1.1-rc.1`、`0.1.1-rc.2`（最低线） | 43；legacy peer 模式 + 补装 20、21、21 个 peer | 7 项 |
| `0.1.2-alpha.2` – `alpha.5`、`0.1.2-rc.1`、`0.1.3-alpha.2` | 47、47、47、47、47、49 | 8 项 |
| `0.1.5-alpha.1` – `rc.3`、`0.1.6-alpha.1`、`0.1.6-alpha.2` | 0.1.5 各 54，0.1.6 为 57 和 59 | 9 项 |
| `0.1.7-alpha.1`、`alpha.2`、`rc.1`、`rc.2`（npm） | 63、63、63、65 | 9 项 |
| `0.1.7-rc.2`，桌面版 | 65——`/tmp/dsh-desktop-017/dsh`（应用的 `app.asar/dsh`），用已安装应用的可执行文件加 `ELECTRON_RUN_AS_NODE=1` 运行（Node 24.18.1） | 9 项 |

完整运行中 `0.1.5-alpha.1` 失败过一次，报 `Target page, context or browser has been closed`——机器负载高时 Chrome 自己退出了——重跑两次都通过；现在浏览器阶段遇到 Chrome 退出会换一个新 profile 重试一次。反向对照——同一个包，分别让客户端在 `apply` 里抛错、在应用挂载后抛错、或者 slot 注册被拒——在 `0.0.1-rc.5`、`0.1.1-rc.2` 和 `0.1.7-rc.2` 上都让 `client-boot` 失败。

这个分支上更早的一次运行以「下一个版本的发布时刻」为界安装，脱字符范围因而拿到了下一个版本的包：`0.1.0-rc.7` 起来的是 rc.8 的 43 条目、7 项外壳，本记录曾把它当成 rc.7 自己的。按发布时的样子安装，`0.1.0-rc.7` 跑的是和 `rc.6` 一样的旧外壳。

同样这些版本按今天的依赖图安装（`--graph today`：`0.0.1-rc.5`、`0.1.0-rc.2`、`rc.3`、`rc.6`、`rc.7`），会解析到 cordis 4.0.4、cordis-plugin-hmr 1.0.19 和 cordis-plugin-loader 1.0.5，0.1.0 各版本还会拿到 `0.1.0-rc.8` 的子包。每一次冒烟都在 `boot` 失败，而冒烟自带的对照——同一个 harness、不装插件的 home——也以同样方式失败：`dsh: user patch-layer watching requires the Cordis HMR service`。这张依赖图谁都启动不了。

## 0.2.0：每一个已发布版本

`node scripts/sweep-trains.mjs` 把临时副本的每个 `@deepseek-ai/dsh-*` devDependency 改指到同一个版本，安装后跑两份类型检查和整套测试。它对每一个已发布版本都这样做一遍。本插件编译依赖的每个 harness 包都在某版本上发布了、且三项检查全部通过时，该版本才算**已支持**。

| 版本 | 结果 |
| --- | --- |
| `0.1.0-rc.8`、`0.1.1-rc.2`、`0.1.2-rc.1`、`0.1.3-alpha.2`、`0.1.5-rc.3`、`0.1.6-alpha.2`、`0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2` | 已支持：host tsc、client tsc、全部测试通过 |
| `0.1.1-rc.1`、`0.1.2-alpha.2` – `alpha.5`、`0.1.5-alpha.1`、`0.1.5-alpha.2`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.6-alpha.1`、`0.1.7-alpha.1` | 已支持：同上，经由该版本自己的 `@deepseek-ai/dsh` 安装，因为它的脱字符 peer 会让 npm 的 peer 图以 `ERESOLVE` 中止 |
| `0.1.0-rc.2`、`0.1.0-rc.3`、`0.1.0-rc.6`、`0.1.0-rc.7` | 过早：`dsh-client-ui-renderer` 到 `0.1.0-rc.8` 才首次发布；peer 范围拒绝它们 |
| `0.0.1-rc.1`、`0.0.1-rc.2`、`0.0.1-rc.5` | 过早：`dsh-client-ui-renderer`（rc.1/rc.2 上还有 `dsh-home-paths`）尚未发布；peer 范围拒绝它们 |

2026-09-26 最后一次扫描中，每个已支持的版本都跑了全部 165 个测试，结果 165/165，退出码 0。

上一份 v0.1.1 记录依据 npm 的 peer 图，把 `0.1.2-alpha.5`、`0.1.5-alpha.1`、`0.1.5-alpha.2` 和 `0.1.5-rc.1` 判为「发布不完整」。harness 从来不跑那张图：`@deepseek-ai/dsh` 把它组合的每个包都钉成精确版本。按 harness 安装自己的方式安装，这四个版本全部通过。

## 0.2.0：启动冒烟

`scripts/smoke-boot.mjs` 打包当前检出，用 `dsh plugin --profile web add` 把 tarball 装进一个用完即删的 `DSH_HOME`，不带任何豁免。然后启动 `dsh --profile web`，检查启动审计，通过带 token 的 URL 读取 `__DSH_BOOT__`，并用 shell 自己的模块表执行服务端下发的客户端 bundle。

| Harness | 安装方式 | 结果 |
| --- | --- | --- |
| `0.1.7-rc.2`，桌面版 | 已安装应用的 `Contents/Resources/app.asar/dsh`，由它的 Electron 二进制以 `ELECTRON_RUN_AS_NODE=1` 运行（Node 24.18.1），用它自带的 pnpm 11.7.0 | 8 个子阶段全部通过；65 个启动条目；模块表 9 项 |
| `0.1.7-rc.2`，npm | 在 Node 24.21.0 上 `npm install` 到一个临时目录；它是最新版本，所以今天的依赖图就是它发布时的依赖图；pnpm 11.7.0 | 8 个子阶段全部通过；65 个启动条目；模块表 9 项 |
| `0.1.1-rc.2`，npm | 在 Node 24.21.0 上 `npm install --before 2026-08-30T14:10:52.613Z`（按发布时的样子）；pnpm 11.7.0 | 8 个子阶段全部通过；43 个启动条目；模块表 7 项（没有 `dsh-client-store`，也没有 dockkit） |
| `0.1.0-rc.8`、`0.1.2-rc.1`、`0.1.3-alpha.2`、`0.1.5-rc.3`、`0.1.6-alpha.2`、`0.1.7-alpha.2`——其余每个元组的最新版本，以及 npm 的 `latest` 与 `alpha` | 在 Node 24.21.0 上 `npm install --before <该版本的发布窗口>`；pnpm 11.7.0 | 每个版本 8 个子阶段全部通过；启动条目依次 43、47、49、54、59、63 个；模块表 7 项（0.1.0）、8 项（0.1.2、0.1.3）和 9 项 |
| `0.1.7-rc.2`，桌面版，**已发布的 v0.1.1 tarball** | 同上 | **安装被拒**：`dsh: installation rejected: Plugin @crosery/dsh-viewer@0.1.1 is incompatible with dsh 0.1.7-rc.2: peerDependencies …`。这正是冒烟要抓的回归 |

对 v0.1.1 的清单跑 `node scripts/harness-target.mjs desktop --admits` 以同样方式失败：10 个 harness peer 在两种规则下都拒绝 `0.1.7-rc.2`。

今天全新执行 `npm i @deepseek-ai/dsh@0.1.1-rc.2`，cordis 一族会解析到 2026-09-22 的发布（cordis 4.0.4、cordis-plugin-hmr 1.0.19、cordis-plugin-loader 1.0.5），而这样装出来的 harness 不装任何插件也启动不了：`dsh: user patch-layer watching requires the Cordis HMR service`。改为按它的发布窗口解析（cordis 4.0.2、hmr 1.0.17、loader 1.0.3，与维护者日常使用的安装一致）就能启动。所以冒烟对每个版本都用 `npm install --before <下一个版本的发布时间>` 安装；该版本自己的某个包发布得比这还晚时就把时刻往后挪：`0.1.5-rc.3` 的 `dsh-client-ui-sidebar-documentpreview` 比它晚了大约七个小时，也晚于 `0.1.7-alpha.1`，在那之前 `0.1.5-rc.3` 根本装不上。`0.1.0-rc.8` 用 `window.__DSH_BOOT__` 而不是 `globalThis["__DSH_BOOT__"]` 下发启动图；冒烟两种都认。

在 npm 11 下，`0.1.1-rc.2` 的 peer 解析在合理时间内算不完；GitHub 上的 floor 格在这里花了 653 秒。冒烟现在只给普通安装 120 秒，之后改用 legacy peer 模式安装，再把每个没满足的 peer 按声明的范围补装。2026-09-26 按这种方式重跑（Node 24.21.0、npm 11），最低线 8 个阶段全部通过：普通安装在 120 秒处被截断，在同一个 `--before 2026-08-30T14:10:52.613Z` 下补装了 21 个 peer，43 个启动条目，7 项的模块表，总计 2 分 52 秒。同一天 `0.1.7-rc.2` 通过 `--tarball` 安装一个单独打出的 tarball，8 个阶段全部通过，`scripts/release-notes.mjs` 也接受了冒烟为它记下的 sha256：这就是发版门禁走的路径。

## 0.2.0 在 0.1.7-rc.2 上的实测

两个 host 都是隔离的：有自己的 `DSH_HOME`，用一个按要求调用 `display_file` 的模拟模型服务，插件从打包的 tarball 安装，profile 的 `compatibility.json` 设为 `{}`（不带豁免）。启动日志里没有 `skipping profile bundle`，也没有 `did not activate`。浏览器控制台没有任何错误或警告，特别是没有 `read_image` 的 slot 冲突。

### Web

![回合折叠后，轮次尾部里的 PNG、PDF、MP4 与 DOCX 卡片](acceptance/web-017-turn-tail.png)

| 项目 | 值 |
| --- | --- |
| 已完成的回合 | 工具行折叠；PNG、PDF、MP4、DOCX 卡片出现在回复下方的轮次尾部 |
| `verbose` 视图 | 显示内联卡片，没有尾部；切回标准视图，尾部回来 |
| 刷新之后 | 尾部从会话日志重建 |
| DOCX | 由 harness 自带转换器转换：PDF 的生成者是 `LibreOfficeDev 26.8.0.3`，即内置套件，而不是本机的 LibreOffice 26.2.2.2 |
| 视频 | `currentTime` 到达 8–9 秒，`seekable` 为 `[0, 12]`，Range 请求返回 `206` 并带 `Content-Range` |
| 灯箱 | 以 portal 挂到 `body`，带 `aria-label`；焦点移到关闭按钮，Tab 不会离开，Esc 关闭且不会传到页面自己的监听器，焦点回到缩略图 |
| 系统提示词 | `display_file` 段紧跟在 read 指引之后，带 `present` 子句 |
| 对 PDF 的 `read` | 被重定向到 `display_file` |

### 桌面版

桌面版的第二个隔离实例（自己的用户数据目录、`DSH_HOME` 和端口），与维护者正在运行的那个并存，后者没有被碰过。

![桌面窗口里的内联 PDF，以及它打开的侧边栏预览](acceptance/desktop-017-pdf-sidebar.png)

| 项目 | 值 |
| --- | --- |
| PDF | 内联渲染（`navigator.pdfViewerEnabled` 为 `true`）；**在侧边栏预览**打开 harness 的 PDF.js 预览 |
| 新标签链接 | 窗口对 `target=_blank` 不打开任何窗口，所以卡片改为提供侧边栏预览 |
| 视频，修复前 | 经过会丢掉 `Content-Length` 的 `dsh-app:` 转发，第一次加载无法拖动 |
| 视频，修复后 | 从 Host 的回环地址加载，到达 `t = 9`，`seekable` 为 `[0, 12]` |
| DOCX | 内联渲染，带侧边栏按钮 |

## v0.1.1 在 0.1.1 → 0.1.5 上

### 真实 host 上的卡片

两个 host 都是真的 `dsh --profile web` 进程，各有自己的 `$DSH_HOME`，插件走 git 通道安装，会话里的资源 URL 全部用该 home 自己的 HMAC 密钥铸造。

#### 0.1.1-rc.2

![图片、视频、音频、文档卡片](acceptance/pinned-cards.png)

#### 0.1.5-rc.2 —— 就是 issue #3 立案时那条序列

![视频、音频、文档卡片](acceptance/next-cards.png)

修复前这个 host 根本起不来：入口加载就报 `does not provide an export named 'installSettingsSection'`。

### 实测数据

| 项目 | 值 |
| --- | --- |
| 图片卡片像素 | 从源 PNG 渲染出 `1200x750` |
| 卡片 ↔ 源图相关性 | `0.9958`（截图区域对比源文件；1.0 为完全一致） |
| 视频 | `960x540`、`6s`、`mediaError: null` |
| 拖动进度条 | `currentTime 3.5s → 4.24s`、`buffered 0.00-6.00`——从播放器里走的 Range 路径 |
| 音频 | `4.05s`，同一条签名路由 |
| Range 响应 | `HTTP 206` |
| 篡改签名 | `HTTP 404` |
| `settings/describe` | 列出 `crosery-viewer`，含四个字段与默认值 |
| `settings/update` | `{tool: false}` → 读回 `user.tool: false`、`revision 1`；恢复后 `revision 2` |

## 这份记录不声称的部分

- **Windows。** 桌面版也发布 `win-x64`，CI 会检查它的更新源与 macOS 的一致，但没有任何东西在 Windows 上跑过。Linux 上的证据来自 CI。
- **CI 里的桌面 GUI。** `desktop-bytes` 任务不开窗口地启动应用自带的运行时。Electron 渲染进程、preload 桥接和原生拖放由上面的人工实测覆盖，且只在 macOS 上。
- **0.2.0 在 0.1.1-rc.2 上的浏览器实测。** 那里的证据是类型检查、测试、逐字节一致的构建和启动冒烟；上面的实测卡片来自 v0.1.1。
- **0.1.0-rc.8 之前的版本上，图片和 PDF 以外的实测。** 视频、音频、Office 与 HTML 卡片、turn tail 和 settings 接口在那里只经过测试套件和启动冒烟，`0.1.0-rc.3` 与 `rc.7` 也只经过这两项，没有实测。
- **`0.0.1-rc.1` 与 `0.0.1-rc.2` 跑起来。** 它们的 harness 谁都装不上，所以对它们只有 peer 接纳这一项。
- **早期版本今天的安装依赖图能启动。** 它把 cordis 一族解析到 2026-09-22 的发布，这样的 harness 装不装插件都启动不了（见上面的冒烟一节）；插件在那里没法查，也没人能在那里运行它。
- **真实的「只有附件」图片经过对话自带的加载器，以及上游 `read_image` 视图在实测中胜出。** 这两点只由针对真实 slot core 的单测覆盖。
- **卡片模型的回放路径**（旧版本写下的会话日志、被截断的窗口）由单测覆盖，不靠截图。
- **真实模型回合。** 0.1.7 和早期版本的会话由模拟模型服务驱动，v0.1.1 的会话是预置的，所以这里不依赖任何模型服务可达。
