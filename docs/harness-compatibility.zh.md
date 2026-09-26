# Harness 版本兼容

> [English](harness-compatibility.md) · **中文** · [文档索引](README.zh.md)

## 本插件支持到哪

**Web 端**：每一个已发布的 harness 版本，从 `0.0.1-rc.1` 到 `0.1.7-rc.2`。其中凡是能装上的（`0.0.1-rc.5` 及以后），都能安装、启动并渲染卡片。`0.0.1-rc.1` 和 `0.0.1-rc.2` 也被接纳，但谁都跑不起来：它们自己的 `@deepseek-ai/dsh` 依赖 `@deepseek-ai/dsh-agent-tool-mode`，而这个包从未发布，`npm install @deepseek-ai/dsh@0.0.1-rc.1` 回答 `E404`。**桌面版**：`0.1.7-rc.2`，即它的更新源今天分发的构建。桌面版启动的就是同版本的 `@deepseek-ai/dsh` Web 应用，所以「桌面版的版本」和「它对应的 Web 版本」是同一个版本。

| 元组 | 版本 | 类型 + 测试 | 启动冒烟 | 浏览器实测 |
| --- | --- | --- | --- | --- |
| 0.0.1 | `0.0.1-rc.1`、`0.0.1-rc.2` | 上游发布不完整：harness 本身装不上 | — | — |
| 0.0.1 | `0.0.1-rc.5` | 是 | `0.0.1-rc.5` | `0.0.1-rc.5` |
| 0.1.0 | `0.1.0-rc.2`、`0.1.0-rc.3`、`0.1.0-rc.6`、`0.1.0-rc.7`、`0.1.0-rc.8` | 是 | 每一个 | `0.1.0-rc.2`、`0.1.0-rc.6` |
| 0.1.1 | `0.1.1-rc.1`、`0.1.1-rc.2` | 是 | `0.1.1-rc.2`（最低线） | `0.1.1-rc.2`，v0.1.1 时 |
| 0.1.2 | `0.1.2-alpha.2`、`0.1.2-alpha.3`、`0.1.2-alpha.4`、`0.1.2-alpha.5`、`0.1.2-rc.1` | 是 | `0.1.2-rc.1` | — |
| 0.1.3 | `0.1.3-alpha.2` | 是 | `0.1.3-alpha.2` | — |
| 0.1.5 | `0.1.5-alpha.1`、`0.1.5-alpha.2`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.5-rc.3` | 是 | `0.1.5-rc.3` | `0.1.5-rc.2`，v0.1.1 时 |
| 0.1.6 | `0.1.6-alpha.1`、`0.1.6-alpha.2` | 是 | `0.1.6-alpha.2` | — |
| 0.1.7 | `0.1.7-alpha.1`、`0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2` | 是 | `0.1.7-alpha.2`；`0.1.7-rc.2`，npm 安装的和桌面版自带的各一次 | `0.1.7-rc.2`，Web 与桌面版 |

「类型 + 测试」指把每个 `@deepseek-ai/dsh-*` devDependency 精确改指到该版本后，两份类型检查和整套测试都通过（`node scripts/sweep-trains.mjs`）。「启动冒烟」一列是本次发版在本地跑过的；CI 每周的全量扫描和发版门禁会启动**每一个**能装上的版本。每一列的证据见 [acceptance.zh.md](acceptance.zh.md)。

### 0.1.0-rc.8 之前的版本

在 `0.0.1-rc.5` 到 `0.1.0-rc.6` 上，harness 的前端是另一套：`dsh-client-web` 外壳，slot 注册表由 `@deepseek-ai/dsh-client-runtime` 声明，没有 `@deepseek-ai/dsh-client-ui-renderer`（`0.1.0-rc.8` 才首次发布）。`0.1.0-rc.7` 也没发布 renderer，但按发布时的样子安装，它跑的已经是 `0.1.0-rc.8` 的前端：它的时间窗在 rc.8 的子包发布之后才关上，而它的脱字符范围够得到那些子包。这些都碰不到本插件：

- **浏览器半边只需要两个服务：`slots` 和 `locale`**，每个版本都有。renderer 包只做仅类型导入，取的是 `slots` 的声明。在从未发布它的版本上，类型检查保留本仓库钉住的那个 renderer 版本，并把 `dsh-client-runtime` 钉到该版本——那几个版本正是在这里声明 `slots` 的；构建产物从来不含它的任何值。
- **`dsh.client.inject` 仍然写着 renderer。** 这份清单只是依赖图元数据：客户端 fiber 等的是入口注入的服务，不是包名。启动冒烟在这些版本上报告这个名字不存在，然后照常加载 bundle。
- **老外壳的模块表回答 10 个标识符**（react、它的 JSX runtime、react-dom，外加另外七个），是本 bundle 需要的三个的超集；rc.8 的外壳回答 7 个。
- **0.1.1 及以前的 settings 接口是 `ctx.settings.register`**，`mountSettingsSection` 本来就会驱动它。

如果不按发布时的样子、而是今天全新安装（`--graph today`），这些版本每一个都会把 cordis 一族解析到它们 2026-09-22 的发布（cordis 4.0.4、cordis-plugin-hmr 1.0.19、cordis-plugin-loader 1.0.5），0.1.0 各版本的子包则解析到 `0.1.0-rc.8` 的。这样装出来的 harness 装不装插件都启动不了（`dsh: user patch-layer watching requires the Cordis HMR service`），和全新安装 `0.1.1-rc.2` 坏掉是同一个上游漂移，所以谁都没法在那里运行本插件，也就没有什么可查。冒烟如实报告的正是这一点，见 [acceptance.zh.md](acceptance.zh.md)。

以下不支持，各有证据：

- **`0.1.4`** 从未发布，范围里也没有对应它的比较器。
- **`0.1.8` 及以后**要等扫描验证过才接纳。在那之前范围拒绝它们，而 dsh ≥0.1.7 会强制执行这一点（见下一节）。

peer 范围，每个 `@deepseek-ai/dsh-*` peer 都一样，每个元组一组比较器：

```text
>=0.0.1-rc.0 <0.0.2-0 || >=0.1.0-rc.0 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-alpha.0 <0.1.3-0 || >=0.1.3-alpha.0 <0.1.4-0 || >=0.1.5-alpha.0 <0.1.6-0 || >=0.1.6-alpha.0 <0.1.7-0 || >=0.1.7-alpha.0 <0.1.8-0
```

`npm run check` 断言：这个范围在两种 semver 规则下都接纳上表每个已发布版本，拒绝支持范围外的每个构建，并且每个元组保持一组带预发布下限的比较器。

没有哪个 peer 是可选的，因为标成可选什么也改变不了。dsh ≥0.1.7 的 `evaluatePluginCompatibility`（dsh-app-boot）把每个 `@deepseek-ai/dsh*` peer 都拿去比对运行中的版本，计入预发布版，可选与否一样；0.1.7 没有任何包读取 `peerDependenciesMeta`，`dsh-plugin-manager` 也不读。只有当某个装得上的版本缺这个 peer、而插件没有它也能跑时，才值得把它标成可选。唯一在某些已发布版本上缺席的 peer 是 `@deepseek-ai/dsh-home-paths`：`0.0.1-rc.1` 和 `rc.2` 上没有，而 Host 半边对它是值导入；那两个版本本来就装不上。

### 自身 peer 图解析不了的版本

`0.1.0-rc.2` – `rc.7`、`0.1.1-rc.1`、`0.1.2-alpha.2` – `alpha.5`、`0.1.5-alpha.1` – `rc.2`、`0.1.6-alpha.1` 和 `0.1.7-alpha.1` 发布的 harness 包带脱字符 peer（`^0.1.1-rc.1`）。npm 自动安装 peer 时会拉进同一元组里更晚的预发布，而那个版本自己的 peer 又和被固定的版本冲突，`npm install` 于是以 `ERESOLVE` 中止。本页早先的版本因此把其中几条称为「发布不完整」。

harness 从来不跑那张图。`@deepseek-ai/dsh` 把它组合的每个包都钉在同一个精确版本上。所以 peer 图失败时（`ERESOLVE`、npm 找不到某个 peer，或 5 分钟内没有结果），扫描和 CI 改用该版本自己的 `@deepseek-ai/dsh` 来安装改指后的副本，这些版本在那里全部通过。

一个版本算**上游发布不完整**，是指 `@deepseek-ai/dsh@<版本>` 在不掺任何本仓库东西的情况下自己就装不上：npm 对该版本自身的依赖图回答 `E404` 或 `ETARGET`（用 legacy peer 模式检查，和冒烟安装的方式一致，几秒就出结果，peer 图要几分钟）。扫描和 CI 的每个格都先查这一点。目前就是 `0.0.1-rc.1` 和 `0.0.1-rc.2`：`npm error 404 Not Found - GET https://registry.npmjs.org/@deepseek-ai%2fdsh-agent-tool-mode`。改指后的副本装不上、随后单独安装也在依赖图上失败（包括 `ERESOLVE`）的版本，同样算不完整。单独安装超时或连不上 registry 什么也证明不了，这时该格直接失败。

## 0.1.7 的版本门

从 0.1.7 起，harness 自己会拿插件的每个 `@deepseek-ai/dsh*` peer 范围去比对自身版本，而且把预发布算进去（dsh-app-boot `evaluatePluginCompatibility` 里的 `semver.satisfies(version, range, { includePrerelease: true })`）：

- **安装时**，`dsh plugin add` 和桌面版的**插件 → 添加插件**都会拒绝这个包并回滚 profile：`dsh: installation rejected: Plugin @crosery/dsh-viewer@0.1.1 is incompatible with dsh 0.1.7-rc.2: peerDependencies …`。
- **启动时**，已经装好但通不过检查的插件被跳过，stderr 只有一行（`dsh: skipping profile bundle "@crosery/dsh-viewer": …`）。界面照常起来，插件就是不在。

这就是 v0.1.1 在 0.1.7 桌面版里什么都显示不出来的原因：它的范围止于 `0.1.6` 以下。类型检查和测试都看不到这一点，因为 npm 从不拿根项目的 peer 范围去校验它自己的 devDependencies。下面的 `admission` 和 `smoke` 两个阶段就是为此存在的。

两个推论：

- **peer 范围就是已验证版本的清单。** 放宽它就是一次发版。一个接纳了未验证版本的范围，是一个会被版本门强制执行的承诺。
- **只有精确版本豁免能绕过版本门**（`dsh plugin --profile <p> allow-version <pkg>@<v> --dsh-version <dsh> --accept-risk`）。`smoke-boot.mjs --accept-risk` 只在诊断时用它：区分「范围太窄」和「代码坏了」。它永远不算通过。

## 预发布陷阱

node-semver 只在范围里**存在某个比较器与该预发布版本的 `major.minor.patch` 元组完全相同、且自身带预发布标签**时，才让预发布版本满足范围。看起来很宽的范围没用：

```jsonc
// 看着宽，在 npm 的规则下一个 0.1.x 预发布都匹配不上
">=0.0.1-rc.1 <0.2.0"

// 每个元组一个带预发布标签的比较器——本插件用的就是这种
">=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-alpha.0 <0.1.3-0"
```

那个宽范围在 dsh 自己的 `includePrerelease` 规则下确实接纳这些预发布。结果就是经由 harness 能装上，却在每一次 npm 或 pnpm 的 peer 检查里失败。所以每条声明都要在两种规则下各查一遍。

## CI 查什么、什么时候查

`.github/workflows/harness-compat.yml` 用 `scripts/harness-target.mjs` 把每个**格**（cell）解析成一个精确版本，再对它跑四个阶段：

| 阶段 | 证明什么 |
| --- | --- |
| `types` | 两份类型检查对着该版本发布的 `.d.ts` 通过 |
| `tests` | 本插件自己的测试对着该版本的包通过 |
| `admission` | 每个 harness peer 范围在两种 semver 规则下都接纳该版本 |
| `smoke` | `scripts/smoke-boot.mjs`：打包后的插件不带任何豁免经 `dsh plugin add` 装上、激活，并由真实的 `dsh --profile web` 提供它的浏览器半边。子阶段依次是 harness → pnpm → install → boot → host-activation → client-graph → client-load → client-exports |

| 格 | 解析为 | Pull request | 定时 | 发版 |
| --- | --- | --- | --- | --- |
| `pinned` | `devDependencies` 钉的版本，`0.1.7-rc.2` | 必需 | — | 门禁 |
| `floor` | `0.1.1-rc.2` | 必需 | — | 门禁 |
| `desktop` | 两个桌面更新源公布的版本；要求两者一致，且 npm 上有同版本的 `@deepseek-ai/dsh` | 会跑，非必需 | 每天 | 门禁 |
| `latest` / `next` / `alpha` | `@deepseek-ai/dsh` 的 npm dist-tag | — | 每天 | — |
| `sweep` | 从 peer 范围接纳的最低版本（`0.0.1-rc.0`，也就是全部）起，运行时从 npm 读出的每一个已发布 `@deepseek-ai/dsh` 版本 | — | 每周；每个能装上的版本都跑冒烟 | 门禁，冒烟范围相同 |
| `desktop-bytes` | `mac-arm64` 更新源里的 macOS 压缩包：校验 sha512，与它的 `desktop-runtime.json` 交叉核对，再用应用自带的 Electron Node 和内置 pnpm 跑冒烟 | — | 每天、每周 | 门禁 |

读一次运行结果时要知道的细节：

- **桌面版只有一个频道。** 应用把 `nightly` 写死，而且只构建 `mac-arm64` 和 `win-x64`。两个更新源不一致时 `desktop` 格失败；更新源已公布而 npm 上还没有的版本记为**不完整**。
- **不完整是中性结果。** npm 上还没有的版本、或者自己的 `@deepseek-ai/dsh` 装不上的版本，既不开 issue 也不关 issue。冒烟在这种版本上不跑。`admission` 照跑，因为它不读任何包，范围拒绝的版本即使 npm 上还不全也算漂移。如果该版本发布了类型检查和测试所需的每个包，类型和测试也照跑（解析步骤会输出 `compiles=true`）；`0.0.1-rc.1` 和 `rc.2` 没有，所以那里只跑 `admission`。
- **某个包从未在该版本发布，不是跳过它的理由。** 那个包保留本仓库钉住的版本，只用于类型，解析步骤会列出它（`kept=`）：`0.1.0-rc.8` 之前每个版本上的 `dsh-client-ui-renderer`。在发布了 `dsh-client-runtime` 的版本上（到 `0.1.1-rc.2` 为止），该格把它钉到该版本，因为早期客户端包只以脱字符 peer 的形式引用它，npm 会把它解析到同一元组里最新的预发布。插件在那里能不能跑，由冒烟回答；在每一个这样的版本上都能。
- **只有 npm 明确回答「没有」才算不完整。** registry 没有应答（连接被拒、超时、5xx）时该格失败；npm 一个 `@deepseek-ai/dsh` 版本都列不出来时也一样。`pinned` 和 `floor` 永远不会是不完整：它们是本插件声明支持的版本，那里缺包就是失败。
- **只有 harness 会变。** 除了钉住的那个版本，其余格都不用 lockfile 安装，因为那个版本的依赖图必须重新解析。`@deepseek-ai/` 之外的每个 devDependency（TypeScript、`@types/*`、esbuild、semver）都保持在 `package-lock.json` 解析出的精确版本上，所以工具链发了新版本，也不会出现 `floor` 或扫描变红而 `pinned` 仍然是绿的情况。
- **新版本自己会出现。** 扫描在运行时读取版本列表。落在范围尚未覆盖的元组上的版本（比如 `0.1.8-alpha.1`）会以 `admission` 失败的形式出现，这就是去验证它的提示。
- **冒烟按发布时的样子安装 harness。** `smoke-boot.mjs --dsh <v>` 会带上 `npm install --before <下一个 @deepseek-ai/dsh 发布的时刻>`；只有该版本依赖图需要的某个包发布得比这还晚时才把时刻往后挪：可以是它自己的包（`0.1.5-rc.3` 的 `dsh-client-ui-sidebar-documentpreview` 就发布在 `0.1.7-alpha.1` 之后），也可以是它的脱字符范围已经够到的更晚预发布所要求的 peer（`0.1.0-rc.3` 的时间窗在 `0.1.0-rc.6` 还没发布完时就关上了，而 `dsh-timeout@0.1.0-rc.6` 比 `@deepseek-ai/dsh@0.1.0-rc.6` 晚了六分钟）。cordis 一族的依赖在每个版本下面都是浮动的，它们 2026-09-22 的发布让全新执行的 `npm i @deepseek-ai/dsh@0.1.1-rc.2` 坏掉了：不装任何插件也启动不了（`user patch-layer watching requires the Cordis HMR service`）。想看今天全新安装得到什么，加 `--graph today`。如果 npm 的 peer 图报 `ERESOLVE`，或 120 秒内没有算完（`--install-timeout-ms`；`0.1.1-rc.2` 会让 npm 11 在上面烧几分钟 CPU，CI 的一个 floor 格用了 653 秒），冒烟改用 legacy peer 模式安装，再把没满足的 peer 按各自声明的范围补装上，得到的是同一个 harness。启动失败时，冒烟会用同一个 harness 不装插件再启动一次，并报告是哪一种情况。
- **没有任何阶段覆盖**：Electron 渲染进程、桌面版 preload 桥接和原生拖放。这些需要 GUI，靠人工验收（[acceptance.zh.md](acceptance.zh.md)）。

本地可以单独跑任何一段：

```sh
node scripts/harness-target.mjs desktop --admits          # 解析一个格并检查 admission
node scripts/harness-target.mjs --plan pinned,floor,sweep # CI 会跑的矩阵
node scripts/smoke-boot.mjs --dsh 0.1.1-rc.2              # 从 npm 安装后冒烟（需要联网）
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  scripts/smoke-boot.mjs --harness-dir "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
node scripts/sweep-trains.mjs                             # 每个已发布版本上跑类型 + 测试
```

冒烟拒绝任何不在系统临时目录下的 `DSH_HOME`，所以碰不到真实的 profile。`--harness-dir` 指向桌面版时，要像 `desktop-bytes` 任务那样在 `PATH` 上放一个运行应用自带 `Contents/Resources/runtime/pnpm/bin/pnpm.mjs` 的 `pnpm`。pnpm 10 执行 `dsh plugin add` 会报 `ERR_PNPM_ADDING_TO_ROOT`；其余情况冒烟会自己装 pnpm 11.7.0。

## 漂移 issue 打开之后

定时运行给每个失败的格开一个 `upstream-drift` issue，标题是 `Harness compatibility broken against @<cell>`，之后每次失败都在上面追加评论。该格所有阶段第一次全部通过的那次运行会评论并关闭它。

定时运行的任何失败都不会悄无声息地结束：

- **每个阶段都有时限**（安装 40 分钟、冒烟 45 分钟，等等），因超时被取消的阶段算作失败。只有被人手动取消的运行不做判定。
- **`setup`**（checkout、Node、`npm ci`）也是一个阶段，所以在第一个真正的阶段之前出了 runner 或 registry 问题也会上报。
- **`unreported` 任务**在所有格之后运行。某个格在自己的判定步骤能上报之前就失败或超时了（checkout 失败、任务本身的时限到了），它会被记进同一个 issue，并写明是哪一步停下的。`plan` 任务失败时会开 `Harness compatibility run could not plan its cells`，下一次成功规划的运行会把它关掉。

按这个顺序处理：

1. **看是哪个阶段失败。** 步骤摘要里写着，冒烟还会写出是哪个子阶段。
2. **`types` 或 `tests`**：改名或删除的导出会在输出里点名。用结构类型和特性探测适配。永远不要值导入某个受支持版本上缺失的符号：缺少的具名导出是 ESM 链接失败，会拖垮整个入口。
3. **新版本上的 `admission`**：先跑 `node scripts/sweep-trains.mjs --versions <v>`，再跑 `smoke-boot.mjs --dsh <v> --accept-risk`。两者都通过后，给每个 harness peer 加上新元组的一个带预发布标签的比较器，把版本加进 `scripts/check-invariants.mjs` 的 `ADMITTED_TRAINS` 和上面的表格，然后发版。
4. **`smoke`**：摘要会说明不装插件时 harness 能否启动。不能的话是上游的问题，漂移在它浮动的依赖里。
5. **以一次发版交付。** peer 范围是包契约的一部分。

永远不要为了让 job 安静而放宽范围。harness 会强制执行这个范围，范围错了，真实用户就真的会失败。

## 0.1.2 的 API 改名

0.1.2 把 settings 挂载从包导出挪到了服务方法上：

```ts
// 0.1.1 及以前
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
installSettingsSection(ctx, settingsNamespace('crosery-viewer'), schema, entry, hooks)

// 0.1.2 – 0.1.6
ctx.settings.installSection(ctx, 'crosery-viewer', schema, entry, hooks)
```

0.1.7 把两者都去掉了。`ctx.settings` 变成了一个表单服务，两个方法都没有；它的表单只展示插件标成 volatile 的字段——本插件一个都没有，所以 0.1.7 上本插件没有设置表单。条目自己的 `Config`（条目 id `viewer`）是唯一来源，写在 profile 的 `cordis.patch.yml` 里，见 [配置](../README.zh.md#配置)。`src/index.ts` 里的 `mountSettingsSection` 驱动运行中的 harness 发布的那一套接口，在 0.1.7 上什么都不做。`tests/settings-mount.test.ts` 钉住了每一条分支。

真正坑过用户的是对已删除导出的**静态导入**：ESM 在任何代码运行之前就解析具名导出，所以在 0.1.2 上整个 host 入口加载失败，报 `does not provide an export named 'installSettingsSection'`。它没有降级，而是根本没启动。

0.1.2 还挪了两样东西，本插件刻意不绑定其中任何一个：

- 客户端 `sessions` 服务 0.1.1 及以前在 `@deepseek-ai/dsh-client-runtime` 里，0.1.2 起在 `@deepseek-ai/dsh-api-session-controller` 里。本插件用结构类型声明自己读取的那一小块，而不是导入任何一个包的类型，所以同一份构建在两边都能通过类型检查。
- `dsh-client-runtime` 在 `0.1.1-rc.2` 之后不再发布，所以它不是 devDependency。在有它的版本上，扫描行和 CI 格会把它钉到该版本（`scripts/harness-lib.mjs` 里的 `TRAIN_ONLY`）。
