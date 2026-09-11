<div align="center">

<img src="assets/logo.png" alt="dsh-viewer" width="132">

# @crosery/dsh-viewer

**万物皆可渲染。** 一个 `display_file` 工具，把图片、视频、音频、PDF、Office 文档和本地网页直接渲染进 DeepSeek Harness 的对话流——是真的能看、能播、能拖进度条，不是一个文件名加一个字节数。

[English](README.md) · [中文](README.zh.md) · MIT

</div>

---

## 支持的格式：6 类 36 种扩展名

| 类别 | 渲染元素 | 扩展名 |
| --- | --- | --- |
| 图片 | `<img>` + 点击开灯箱 | `png` `jpg` `jpeg` `webp` `gif` `svg` `avif` `bmp` `ico` `apng` |
| 视频 | `<video controls>`，可拖进度条 | `mp4` `m4v` `webm` `ogv` `mov` |
| 音频 | `<audio controls>` | `mp3` `m4a` `aac` `wav` `flac` `ogg` `oga` `opus` |
| PDF | 内嵌阅读器 | `pdf` |
| 文档 | Host 转 PDF 后内嵌 | `docx` `doc` `rtf` `odt` `xlsx` `xls` `ods` `pptx` `ppt` `odp` |
| 网页 | sandbox `<iframe>` | `html` `htm` |

其余格式仍然给一张带类型、大小和打开链接的卡片——**没有任何一种类别是渲染不出东西的**。

视觉路由上，`png`/`jpg`/`jpeg`/`webp`/`gif` **同时**进入模型上下文：一次调用既给你看，也让模型看见。其余只给你看，卡片会如实标注。

## 截图

图片、视频、音频，一个回合内全部渲染：

![图片、视频、音频](assets/screenshot-1-media.png)

Word / Excel / PowerPoint，Host 转换后内嵌：

![Office 文档](assets/screenshot-2-office.png)

PDF 与本地网页，实时渲染：

![PDF 与网页](assets/screenshot-3-pdf-html.png)

## 安装

```sh
dsh plugin --profile web add github:crosery/dsh-viewer
```

然后把包名加进 profile `package.json` 的 `dsh.profile.bundles`，并**重启 profile**——bundle 成员变更不走热重载。

仓库里直接提交了构建产物，所以这条命令不需要任何构建步骤，也不需要你在 profile 的 `allowBuilds` 里批准任何脚本。想要锁定版本安装的话，每次 release 也附带了同样的 tarball：

```sh
dsh plugin --profile web add https://github.com/Crosery/dsh-viewer/releases/latest/download/dsh-viewer.tgz
```

Office 渲染额外需要 LibreOffice（`PATH` 上的 `soffice`，或 macOS 的应用包）：

```sh
brew install --cask libreoffice
```

没装也不影响其余格式，文档卡片会明确说明缺什么。

---

## 它解决什么

dsh 出厂只有 `read_image`：它存在的目的是把图片塞进**模型上下文**，所以

- 路由模型不声明 `image` 输入时，它直接拒绝；
- 只认 PNG/JPEG/WebP/GIF；
- 视频、音频、PDF、网页完全没有入口；
- 而且**内置 Web 客户端不给它画卡片**——`read_image` 落在通用工具行上，人在屏幕前看到的只有一行 `Read image /path/to/a.png`。

这个插件反过来：它存在的目的是把文件放到**用户屏幕上**。所以纯文本路由不是拒绝理由，非图片媒体也不是。

| | `read_image`（出厂） | `display_file`（本插件） |
| --- | --- | --- |
| 目的 | 进模型上下文 | 进用户视野 |
| 纯文本路由 | 拒绝 | 正常显示，只是模型看不见 |
| 图片 | PNG/JPEG/WebP/GIF | 上述 + SVG/AVIF/BMP/ICO/APNG |
| 视频 / 音频 | 无 | MP4/WebM/MOV/OGV，MP3/WAV/FLAC/OGG/M4A/Opus |
| PDF / 网页 | 无 | 内嵌 iframe |
| Office 全家桶 | 无 | docx/doc/rtf/odt、xlsx/xls/ods、pptx/ppt/odp（Host 转 PDF 后内嵌） |
| Web 卡片 | 无（通用行） | 有（本插件同时接管 `read_image` 的卡片） |

## 两条字节通道

一个卡片可能从两个地方拿到字节，优先级如下。

**签名资源路由**（`/crosery/dsh-viewer/asset`）——Host 直接流式吐字节。这是唯一能承载视频/音频/PDF/网页的通道，也是唯一支持 Range 请求的通道，而 Range 正是 `<video>` 能出现进度条、Safari 肯开始播放的前提。

**持久化附件**——`ctx.attachments` 那条老通道。只有图片，但它在两种情况下不可替代：文件系统后端不暴露本地路径（远程 workspace）时，以及渲染出厂 `read_image` 结果时（那份结果只有附件，没有 URL）。

两条通道不是冗余：视觉路由上的 PNG 仍然要走附件，因为那是它进入模型上下文的唯一方式。

## 资源路由的安全边界

路由**从不接受浏览器给的路径**。工具执行时用一个每 harness 一份的密钥对已解析的绝对路径做 HMAC，路径和 MAC 一起放进 URL；路由只在 MAC 验过之后才认那个路径。

- 密钥：32 字节随机数，`$DSH_HOME/.dsh-viewer-asset-key`，0600，首次使用时生成。**自包含的签名而不是进程内 token 表**，是因为卡片必须活过重启：从会话日志重放出来的卡片手上只有几个月前铸的那个 URL。
- 篡改路径、换密钥、去掉签名、改用 padded base64 拼写——全部 404，且「没签名」和「签了但文件不存在」返回同一个状态码，探测者无法从状态码学到文件是否存在。
- `text/html` 和 `image/svg+xml` 带 CSP 响应头下发（前者 `sandbox`，后者 `default-src 'none'`）。同源直接导航到资源 URL 时，这两种文档否则会以应用的 origin 执行脚本。所有响应带 `nosniff`。
- 字节走 `createReadStream(processPath)` 而不是 `ctx.fs.readBytes`——后者会把整个文件读进内存，而两小时的视频正是这插件存在的理由。

## Office 全家桶怎么转

目标格式永远是 PDF。纯前端方案（`docx-preview` / `exceljs` + 表格网格）过不了本插件的约束：浏览器半边是 lazy-CJS bundle，模块表只答应 shell 基线，所有依赖都得内联，而 PPTX 根本没有可内联的免费渲染器。一个转换器产出一种格式，也意味着卡片只有一条文档代码路径。

- **转换器**：LibreOffice headless。PATH 上的 `soffice`/`libreoffice`，或 macOS 的 `/Applications/LibreOffice.app/...`；都没有时卡片如实说「需要安装 LibreOffice」并给出 `brew install --cask libreoffice`，**不失败整个调用**。
- **每次调用私有 profile**（`-env:UserInstallation=file://…`）。LibreOffice 多个实例共用用户 profile 目录会互相破坏；更要命的是**桌面上已经开着 LibreOffice 时，headless 调用会立刻退出且不产出任何文件**——这是「明明成功了却没有 PDF」最常见的原因。
- **串行队列**。私有 profile 解决了互相破坏，但没解决成本：几个 LibreOffice 冷启动同时跑会拖垮笔记本。重复由缓存吸收。
- **缓存键含 LibreOffice 版本** + 源文件 path/mtime/size。同样的字节经过新版 LibreOffice 是不同的产物，键里不带版本，升级后就会命中陈旧渲染而且看不出来。不对文件内容做摘要：几百 MB 的演示文稿不该为了「查一下转过没有」被读两遍。
- 产物写在 `$DSH_HOME/.dsh-viewer-cache/`，**先写临时目录再 rename 就位**——读者要么看不到产物，要么看到完整的，不会拿到半个 PDF 喂给阅读器。

实测冷启动 2.6–3.6 秒，之后命中缓存。

## 为什么把出厂 `read_image` 藏起来

`read_image` 和 `display_file` 只在一件事上重叠——把 raster 送进模型上下文——而同时看到这两个工具的模型会**两个都用**：先 `read_image`「我看一眼」，再 `display_file`「给你看」。真实会话里实测过：一张 1672×941 / 2.2 MB 的 PNG 在一个回合内**被吃进上下文两次**，对话流里出现两张长得一模一样的卡片。这不是提示词能可靠解决的问题，因为两个工具确实各自都在做模型以为它在做的事。

所以其中一个不再对模型可见。`display_file` 是严格超集：它处理所有媒体、在纯文本路由上照常工作（`read_image` 在那里直接拒绝），并且在视觉路由上仍然把可接纳的 raster 送进上下文。藏掉它是**纯粹去重，不是去能力**。

机制由注册表决定：`tools.restrict()` 明确拒绝 context-global 调用（「a context-global restriction would mask every agent」），所以限制是在**每个 agent 的 `agent.ctx`** 上施加的。

两个触发点，缺一不可：

- `agent/created` —— 覆盖在工具已存在之后创建的 agent。这里的 `restrict` 必须被 try 包住：`read_image` 只在挂了附件服务时存在，`restrict` 对未知名字会抛错，而**一个抛错的 `agent/created` 监听器会否决整个 agent 的发布**。
- `tools/change` —— 覆盖反过来的竞态。`read_image` 注册在 `dsh-tool-fs` 的异步 `attachments` 注入里，先创建的 agent 会**终生**看得见它。已经加上限制的 agent 会跳过，所以重试是幂等的；等待列表用 `WeakRef` 持有，不会把 agent 留活。

**这条改动需要重启 profile 才生效**——它在 Host 半边的 bundle 里，不走热重载。

卡片表头也不再一律叫「图片」：`read_image` 的卡片叫「读入图片」，这样万一有人关掉这个开关，两种来源在对话流里仍然一眼能分开。

## `read` 打到媒体上：不报错，也不返回垃圾

出厂 `read` 是 UTF-8 解码。更关键的是：**出厂的 `dsh-fs-local` 会采样文件头，遇到 NUL 字节直接抛 `FS_NOT_TEXT`（`cannot read "…": binary file`）**。所以 `read` 指向 PNG 时，**无论有没有这个插件，都会在对话流里画一条红色失败行**——而那个文件明明存在、可读、离上屏只差一次工具调用。

两种「显而易见」的纠正都去不掉那条红行：`tools/pre-execute` 拒绝会自己造一个 `isError`；`tools/post-execute` 也不行——替换 value 在失败结果上被明确拒绝，替换 content 又保留 `isError`。

所以纠正放在 **`tools/execute`（around-dispatch）**，并且**不调用 `next()`**：注定失败的读取根本不发生，一次文件 I/O 都没有。返回的自造结果会经过 `normalizeDispatchResult`，对成功结果它会**用本插件给的 value 重跑该工具自己的 `output.render` 和 `output.presentationMeta`**——于是持久化的 read 元数据也被替换掉，出厂 read 卡片照常渲染，只不过内容是一行指向 `display_file` 的说明，而且是一次**普通的成功读取**。

配套还有一段系统提示词（order 101，紧跟出厂 `tool:read` 的 100）。`.html` **不在**纠正范围内：读 HTML 源码是正当的文本读取，显示它是另一个意图。

## 配置

`crosery-viewer` 命名空间，三个开关，默认值都是「插件该有的行为」：

| 字段 | 默认 | 关掉之后 |
| --- | --- | --- |
| `tool` | `true` | 不注册 `display_file`（它会从模型看到的 schema 列表里消失，而不是留在那里拒绝调用） |
| `redirectRead` | `true` | `read` 可以自由地把 raster 解码成替换字符 |
| `feedModel` | `true` | 图片只上屏，永不进模型上下文——图给人看而不是给模型看时更省 token |
| `supersedeReadImage` | `true` | 出厂 `read_image` 重新对模型可见（于是又可能出现同一张图进两次上下文） |

改 `$DSH_HOME/settings.yaml` 即可，热重载，不需要重启。也可以在 `cordis.patch.yml` 里钉死；注意 patch **整行替换 `config`**，要重述每一个键。

## 装到 profile

```sh
dsh plugin --profile web add github:crosery/dsh-viewer     # 或本地开发：link:
```

然后在 profile `package.json` 的 `dsh.profile.bundles` 里加上包名。**bundle 成员变更必须重启 profile**（`cordis.patch.yml` 的编辑才走热重载）。

本地开发时客户端半边有个坑：装的 `dsh-client-modules@0.1.1-rc.2` 用 `require.resolve(spec + "/package.json")` 解析清单，**只认包名不认文件绝对路径**。所以 `--patch` 里写 `name: /abs/path/lib/index.js` 只会加载 Host 半边，客户端 bundle 静默不进 boot 图。让包能按名字解析（`link:` 或 symlink 进 profile 的 `node_modules`），patch 行写包名。

## 验证

```sh
npm run typecheck     # 两个 program 分开检查
npm run build         # 两份 .d.ts + 两个 bundle（产物提交进仓库，改动后要一并提交）
npm run check         # 仓库不变式（README 计数、locale 键、peer 范围、安装路径）
npm run check:dist    # 提交的 lib/ 与重新构建逐字节一致
npm test              # 71 个用例
```

已在真实环境跑通（`dsh 0.1.1-rc.2`，Node 26.7.0，claude-sonnet-5 路由，headless Chrome 驱动）：

- **七种卡片全部渲染**：图片（`<img>` 原尺寸，点击开灯箱、Esc 关闭）、视频（`<video>` 有进度条，`currentTime = 4` 跳转成功，`seekable.end = 6`）、音频（`<audio>`，duration 5）、PDF、**文档（docx / xlsx / pptx）**、网页、通用文件。
- **Office 三件套真的转出来了**：三个 iframe 的 src 全部返回 `200 application/pdf` 且以 `%PDF-` 开头，frame 内部含 Chrome PDF 阅读器的 `<embed>`；pptx 显示为 1/3 页并带幻灯片缩略图侧栏，正文是真实的幻灯片内容。
- **全部默认展开**（`aria-expanded="true"`），不再有「只有标题、看不到内容」的卡片。
- **徽标正确**：视觉路由上的 PNG 显示「已进入模型上下文」，且模型确实描述出了「64×48 红色图片」；其余显示「仅在页面显示」。
- **重放安全**：整页 reload 之后卡片全部从持久化的 `tool/result` meta 重建。
- **一次调用只进一次上下文**：模型可见工具里已无 `read_image`（问它「你能调用 read_image 吗」答「不能」）；一次 `display_file` 的会话日志里恰好一个 image content block。
- **`已进入模型上下文` 是真的**：给模型一个名字毫无提示的 `asset-0417.png`（蓝底黄色大数字 7），它答出「数字 7、背景蓝色、图形黄色」——只有真看到才答得出。
- **`read` 打到图片上不再报错**：会话日志里那条 `tool/result` 的 `isError` 不存在（成功），`meta` 是本插件替换后的单行 `FsReadMeta`；页面上是一条普通的 `Read · /tmp/…/red.png` 行，整页搜不到 `Error:`。
- **嵌套 `run_code` 调用有内容**：`# Code · Display page.html via display_file tool` 的子行下面，iframe 内真的渲染出了页面正文，且该 frame 仍带 `sandbox="allow-scripts allow-forms allow-popups"`。
- **资源路由**：`Range: bytes=4-9` → 206 + 精确 6 字节；`bytes=-4` → 尾部；`bytes=999999-` → 416 + `bytes */25515`；伪造签名、把路径换到 `/etc/passwd`、无签名 → 全部 404；POST → 405。

`tests/asset-route.test.ts` 把 handler 挂在真的 `node:http` 上跑真的请求：Range 的正确性无法靠解析器单测证明，必须看响应到底带了哪些字节和头。`tests/convert.test.ts` 用 LibreOffice 自己造 DOCX 再转回 PDF，断言产物头四字节是 `%PDF-`，并验证二次调用命中缓存不重写产物。

**两份 tsconfig 是必需的，不是洁癖。** 两个半边都在增强同一个 `@deepseek-ai/cordis` 的 `Context`，而 `sessions` 在 Host 侧是 `SessionStore`、在浏览器侧是 `ISessions`。一个同时看见两份增强的 program 会静默解析到错的那个（`skipLibCheck` 把冲突盖掉了），表现为 `ctx.sessions.binding` 不存在。

**`inject` 里不要写 `webServer`。** 未激活的条目是**硬启动失败**（`dsh: 1 entry did not activate`），不是优雅跳过——写进 `inject` 会让这个 bundle 无法与 `dsh-headless`/`acp` 组合，而不只是在那里失效。路由挂在 `ctx.inject(['webServer'], …)` 的嵌套作用域里，没有 HTTP 服务时工具照常注册，只是不铸 assetUrl。

## 两个只有真跑才会发现的坑

**嵌套 `run_code` 调用拿不到 `presentationMeta`。** 注册表只为顶层调用投影（`exec.parent === undefined`），所以模型在 `run_code` 里调 `tools.display_file` 时，卡片手上什么元数据都没有，只剩一行光秃秃的表头。修法是让模型可见的信封多带三个结构化字段（`<media>` / `<bytes>` / `<asset>`），meta 缺失时从 content 里的信封恢复——content 对嵌套调用同样会持久化。这是卡片解析**自己写的结构化信封**，不是从散文里抠 id；恢复出来的值仍然走和重放路径完全相同的校验，包括「assetUrl 必须是本插件路由」那道门。

**PDF 的 iframe 不能加 `sandbox`。** 不带 `allow-same-origin` 的 sandbox 给 frame 一个不透明 origin，而 Chrome 内置 PDF 阅读器拒绝在那里运行——frame 里显示的是「此页面已被 Chrome 屏蔽」而不是文档。PDF 本来也不需要 sandbox：它以 `application/pdf` + `nosniff` 下发，浏览器交给自己隔离的阅读器，不会在本 origin 执行任何东西。本地 HTML 正相反——那是 agent 可能刚写出来的任意脚本——所以它保留不透明 origin，并由 Host 随响应下发的 `sandbox` CSP 兜底。

## Harness 版本兼容

构建与测试针对**当前唯一完整**的 harness 序列：`next` = `0.1.1-rc.2`。peer 范围带显式预发布分支，否则看似很宽的范围会把 `0.1.x` 的所有预发布静默排除。

**不声明支持 `0.1.2-alpha.2`。** 那条序列发布不完整（`@deepseek-ai/dsh-client-runtime` 在该 tag 上没有构建，整体装不上），并且从 `@deepseek-ai/dsh-settings` 移除了 `installSettingsSection` 与 `settingsNamespace`，已发布的类型里没有替代品。声明支持只会让用户拿到 `ERESOLVE` 或运行时崩溃。因此 peer 范围止步于 `0.1.2` 之下；`.github/workflows/harness-compat.yml` 每周对 `next` 和 `alpha` 两条 tag 重跑类型检查与测试，上游一动就自动开 issue——范围按证据放宽，不靠乐观。

## 已知限制

- **只接受本地文件路径**，不接受 URL。规范值的形状留了扩展位，但 v1 没做。
- **视频/音频的时长和分辨率不在卡片头部**——那需要 ffprobe。`<video>` 元素自己会显示。
- **对象 URL 缓存到页面卸载才回收**。上界是一个页面生命周期内显示过的不同附件数量，与出厂对话图库按会话持有的上界同量级。
- 远程 workspace（后端不提供 `processPath`）上，非图片媒体没有可用通道，卡片如实显示「此文件系统后端不提供可预览的本地路径」。
- 未做视频转码：浏览器放不了的编码（例如 `.mov` 里的 ProRes）会落到 `<video>` 的降级文案上。
