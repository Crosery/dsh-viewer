# Harness 版本兼容

> [English](harness-compatibility.md) · **中文** · [文档索引](README.zh.md)

## 本插件支持到哪

**Web 端**：从 `0.1.0-rc.8` 到 `0.1.7-rc.2` 的每一个已发布 harness 版本。**桌面版**：`0.1.7-rc.2`，即它的更新源今天分发的构建。桌面版启动的就是同版本的 `@deepseek-ai/dsh` Web 应用，所以「桌面版的版本」和「它对应的 Web 版本」是同一个版本。

| 元组 | 已验证版本 | 类型 + 测试 | 启动冒烟 | 浏览器实测 |
| --- | --- | --- | --- | --- |
| 0.1.0 | `0.1.0-rc.8` | 是 | `0.1.0-rc.8` | — |
| 0.1.1 | `0.1.1-rc.1`、`0.1.1-rc.2` | 是 | `0.1.1-rc.2`（最低线） | `0.1.1-rc.2`，v0.1.1 时 |
| 0.1.2 | `0.1.2-alpha.2`、`0.1.2-alpha.3`、`0.1.2-alpha.4`、`0.1.2-alpha.5`、`0.1.2-rc.1` | 是 | `0.1.2-rc.1` | — |
| 0.1.3 | `0.1.3-alpha.2` | 是 | `0.1.3-alpha.2` | — |
| 0.1.5 | `0.1.5-alpha.1`、`0.1.5-alpha.2`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.5-rc.3` | 是 | `0.1.5-rc.3` | `0.1.5-rc.2`，v0.1.1 时 |
| 0.1.6 | `0.1.6-alpha.1`、`0.1.6-alpha.2` | 是 | `0.1.6-alpha.2` | — |
| 0.1.7 | `0.1.7-alpha.1`、`0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2` | 是 | `0.1.7-alpha.2`；`0.1.7-rc.2`，npm 安装的和桌面版自带的各一次 | `0.1.7-rc.2`，Web 与桌面版 |

「类型 + 测试」指把每个 `@deepseek-ai/dsh-*` devDependency 精确改指到该版本后，两份类型检查和整套测试都通过（`node scripts/sweep-trains.mjs`）。每一列的证据见 [acceptance.zh.md](acceptance.zh.md)。CI 每周的全量扫描会把这两列都重新证明一遍：每个版本上的类型与测试，每个元组最新版本上的启动冒烟。

以下不支持，各有证据：

- **`0.0.1-rc.x`**。插件机制在那里已经存在（0.0.1-rc.5 就有客户端模块和 profile bundle），但浏览器半边编译依赖并注入的 `@deepseek-ai/dsh-client-ui-renderer` 到 `0.1.0-rc.8` 才首次发布；0.0.1-rc.1 与 rc.2 还缺 `@deepseek-ai/dsh-home-paths`。peer 范围拒绝这三个版本。
- **`0.1.0-rc.2` – `0.1.0-rc.7`** 同样早于这个 renderer 包，本插件在那里根本构建不出来。0.1.0 的比较器从 `0.1.0-rc.8` 起算，peer 范围拒绝它们。
- **`0.1.4`** 从未发布，范围里也没有对应它的比较器。
- **`0.1.8` 及以后**要等扫描验证过才接纳。在那之前范围拒绝它们，而 dsh ≥0.1.7 会强制执行这一点（见下一节）。

peer 范围，每个 `@deepseek-ai/dsh-*` peer 都一样：

```text
>=0.1.0-rc.8 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-alpha.0 <0.1.3-0 || >=0.1.3-alpha.0 <0.1.4-0 || >=0.1.5-alpha.0 <0.1.6-0 || >=0.1.6-alpha.0 <0.1.7-0 || >=0.1.7-alpha.0 <0.1.8-0
```

`npm run check` 断言：这个范围在两种 semver 规则下都接纳上表每个已验证版本，并拒绝支持范围外的每个构建。

### 自身 peer 图解析不了的版本

`0.1.1-rc.1`、`0.1.2-alpha.2` – `alpha.5`、`0.1.5-alpha.1` – `rc.2`、`0.1.6-alpha.1` 和 `0.1.7-alpha.1` 发布的 harness 包带脱字符 peer（`^0.1.1-rc.1`）。npm 自动安装 peer 时会拉进同一元组里更晚的预发布，而那个版本自己的 peer 又和被固定的版本冲突，`npm install` 于是以 `ERESOLVE` 中止。本页早先的版本因此把其中几条称为「发布不完整」。

harness 从来不跑那张图。`@deepseek-ai/dsh` 把它组合的每个包都钉在同一个精确版本上。所以 peer 图失败时（`ERESOLVE`、npm 找不到某个 peer，或 5 分钟内没有结果），扫描和 CI 改用该版本自己的 `@deepseek-ai/dsh` 来安装改指后的副本，这些版本在那里全部通过。只有当接下来单独安装 `@deepseek-ai/dsh@<版本>` 也在依赖图本身上失败（`ERESOLVE`、`ETARGET`、`E404`）时，一个版本才算**上游发布不完整**；目前没有这样的版本。单独安装超时或连不上 registry 什么也证明不了，这时该格直接失败。

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
| `sweep` | 从 peer 范围接纳的最低版本（`0.1.0-rc.8`）起，运行时从 npm 读出的每一个已发布 `@deepseek-ai/dsh` 版本 | — | 每周；最低线、每个元组的最新版本和每个 dist-tag 另跑冒烟 | 门禁，冒烟范围相同 |
| `desktop-bytes` | `mac-arm64` 更新源里的 macOS 压缩包：校验 sha512，与它的 `desktop-runtime.json` 交叉核对，再用应用自带的 Electron Node 和内置 pnpm 跑冒烟 | — | 每天、每周 | 门禁 |

读一次运行结果时要知道的细节：

- **桌面版只有一个频道。** 应用把 `nightly` 写死，而且只构建 `mac-arm64` 和 `win-x64`。两个更新源不一致时 `desktop` 格失败；更新源已公布而 npm 上还没有的版本记为**不完整**。
- **不完整是中性结果。** 早于本插件所需某个包的版本、npm 上还没有的版本、或者单独安装 `@deepseek-ai/dsh` 都失败的版本，既不开 issue 也不关 issue。类型、测试和冒烟在这种版本上不跑；`admission` 照跑，因为它不读任何包，范围拒绝的版本即使 npm 上还不全也算漂移。
- **只有 npm 明确回答「没有」才算不完整。** registry 没有应答（连接被拒、超时、5xx）时该格失败；npm 一个 `@deepseek-ai/dsh` 版本都列不出来时也一样。`pinned` 和 `floor` 永远不会是不完整：它们是本插件声明支持的版本，那里缺包就是失败。
- **新版本自己会出现。** 扫描在运行时读取版本列表。落在范围尚未覆盖的元组上的版本（比如 `0.1.8-alpha.1`）会以 `admission` 失败的形式出现，这就是去验证它的提示。
- **冒烟按发布时的样子安装 harness。** `smoke-boot.mjs --dsh <v>` 会带上 `npm install --before <下一个 @deepseek-ai/dsh 发布的时刻>`；只有该版本自己的某个包发布得比这还晚时才把时刻往后挪（`0.1.5-rc.3` 的 `dsh-client-ui-sidebar-documentpreview` 就发布在 `0.1.7-alpha.1` 之后）。cordis 一族的依赖在每个版本下面都是浮动的，它们 2026-09-22 的发布让全新执行的 `npm i @deepseek-ai/dsh@0.1.1-rc.2` 坏掉了：不装任何插件也启动不了（`user patch-layer watching requires the Cordis HMR service`）。想看今天全新安装得到什么，加 `--graph today`。启动失败时，冒烟会用同一个 harness 不装插件再启动一次，并报告是哪一种情况。
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

按这个顺序处理：

1. **看是哪个阶段失败。** 步骤摘要里写着，冒烟还会写出是哪个子阶段。
2. **`types` 或 `tests`**：改名或删除的导出会在输出里点名。用结构类型和特性探测适配。永远不要值导入某个受支持版本上缺失的符号：缺少的具名导出是 ESM 链接失败，会拖垮整个入口。
3. **新版本上的 `admission`**：先跑 `node scripts/sweep-trains.mjs --versions <v>`，再跑 `smoke-boot.mjs --dsh <v> --accept-risk`。两者都通过后，给每个 harness peer 加上新元组的一个带预发布标签的比较器，把版本加进 `scripts/check-invariants.mjs` 的 `VERIFIED_TRAINS` 和上面的表格，然后发版。
4. **`smoke`**：摘要会说明不装插件时 harness 能否启动。不能的话是上游的问题，漂移在它浮动的依赖里。
5. **以一次发版交付。** peer 范围是包契约的一部分。

永远不要为了让 job 安静而放宽范围。harness 会强制执行这个范围，范围错了，真实用户就真的会失败。

## 0.1.2 的 API 改名

0.1.2 把 settings 挂载从包导出挪到了服务方法上：

```ts
// 0.1.1 及以前
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
installSettingsSection(ctx, settingsNamespace('crosery-viewer'), schema, entry, hooks)

// 0.1.2 – 0.1.5
ctx.settings.installSection(ctx, 'crosery-viewer', schema, entry, hooks)
```

0.1.7 用生成的设置表单同时取代了这两者：harness 按条目 id（`viewer`）从每个条目自己的 `Config` schema 渲染表单，两个方法都不存在了。`src/index.ts` 里的 `mountSettingsSection` 驱动运行中的 harness 发布的那一套接口，在 0.1.7 上什么都不做，因为条目的 `Config` 本身就是表单。`tests/settings-mount.test.ts` 钉住了每一条分支。

真正坑过用户的是对已删除导出的**静态导入**：ESM 在任何代码运行之前就解析具名导出，所以在 0.1.2 上整个 host 入口加载失败，报 `does not provide an export named 'installSettingsSection'`。它没有降级，而是根本没启动。

0.1.2 还挪了两样东西，本插件刻意不绑定其中任何一个：

- 客户端 `sessions` 服务 0.1.1 及以前在 `@deepseek-ai/dsh-client-runtime` 里，0.1.2 起在 `@deepseek-ai/dsh-api-session-controller` 里。本插件用结构类型声明自己读取的那一小块，而不是导入任何一个包的类型，所以同一份构建在两边都能通过类型检查。
- `dsh-client-runtime` 在 `0.1.1-rc.2` 之后不再发布，所以它不是 devDependency。
