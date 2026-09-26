# 发版

> [English](releasing.md) · **中文** · [文档索引](README.zh.md)

## 发一个版本

1. 改 `package.json` 的 `version`（以及 `package-lock.json`：`npm install --package-lock-only`）；若有格式变动，同步两份 README 的数字。
2. harness 有变动时，跑 `node scripts/sweep-trains.mjs`，让 `scripts/check-invariants.mjs` 里的 `ADMITTED_TRAINS`、peer 范围和 [harness-compatibility.zh.md](harness-compatibility.zh.md) 说的是同一件事。三者不一致时 `npm run check` 会拒绝。
3. CI 绿了之后合进 `main`。
4. 打 tag 并推：

```sh
git tag v0.2.1 && git push origin v0.2.1
```

剩下的交给 `.github/workflows/release.yml`，分三个任务，围绕**只打包一次的同一个 tarball**。

**`pack`** **在 tag 与 `package.json` 不一致时直接拒绝**，然后跑 typecheck、测试和不变量；在 `npm run build` 之前先跑 `npm run check:dist`，并要求构建不改动 `lib/`；最后打包出 `dsh-viewer.tgz`，记下它的 sha256。

**`gate`** 对 tag 自己的代码树调用 `harness-compat.yml`，其中每一次启动冒烟安装的都是 `pack` 打出的那个 tarball，而不是另行打包。以下全部通过之前，什么都不会附加：

- 在 `pinned` 版本、`0.1.1-rc.2` 最低线、以及桌面版当天分发的版本上跑四个阶段（types、tests、peer 接纳、启动冒烟）；
- 对桌面版压缩包本身跑启动冒烟（`desktop-bytes`，macOS）；
- 从 peer 范围接纳的最低版本起，扫描找到的每一个已发布 harness 版本上的 types、tests 和 peer 接纳，外加其中每个能装上的版本上的启动冒烟。自己的 `@deepseek-ai/dsh` 装不上的版本（`0.0.1-rc.1`、`0.0.1-rc.2`）算上游发布不完整：中性结果，不阻塞，只判定它的 peer 接纳。

一个推论：上次扫描之后才发布的新 harness 元组，会让门禁的 `admission` 阶段失败，直到范围接纳它为止。这是有意的。先验证它并放宽范围（见 [harness-compatibility.zh.md](harness-compatibility.zh.md)），或者等那件事做完再重跑发版。

**`release`** 先核对要附加的 tarball 的 sha256 与 `pack` 记下的一致，再附加它。新 release 的说明开头是一张表，列出门禁冒烟过的确切 harness 版本，并写明这个 sha256；只要有一次冒烟记录的是别的字节，`scripts/release-notes.mjs` 就让发版失败。发 npm 是单独的显式开关，发布的也是同一个 tarball，只有仓库变量 `NPM_PUBLISH` 为 `true` 时才会执行（见 [npm](#npm)）。发布 release 本身从不依赖 npm 可达。

构建产物是**提交进仓库**的，所以 tag 本身就能用官方 git 命令装。`npm run build` 写出 `src/` 当前的含义，`npm run check:dist` 负责拒绝 `lib/` 与之**不一致**的提交。CI 先跑 `check:dist`，因为 `npm run build` 会原地重写 `lib/`，之后再比较，过期的提交也会显得一致；构建之后如果 `lib/` 有改动，CI 同样失败。

## 为什么资产名不带版本号

附加的资产叫 `dsh-viewer.tgz` 而不是 `dsh-viewer-0.2.0.tgz`，因为大家复制的安装链接是：

```
https://github.com/Crosery/dsh-viewer/releases/latest/download/dsh-viewer.tgz
```

`latest/download/` **只在请求时解析 `latest`，文件名是照字面取的**。资产名带版本号的话，这个链接发布当天有效，下一次发版就 404——而且不会有人察觉，包括作者自己。要么让名字不带版本，要么在 URL 里钉住 tag。

## 为什么构建产物进仓库、为什么还留 tarball

pnpm 默认拒绝执行 git 来源包的构建脚本，除非用户在 `allowBuilds` 里预先批准；而它判断「这个包需要构建」的依据就是 `prepare` 脚本本身。只要仓库在安装期构建，用户用官方安装命令就必然撞 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`——而 harness 自带的安装器会把它归类成插件侧的分发问题。

所以本仓库的规矩是：**安装期不跑任何构建脚本，产物进仓库**。`scripts/check-dist.mjs` 就是让这条规矩不烂掉的东西。

release tarball 带着同样的文件，另有两条理由：可锁定版本的安装 URL，以及插件市场的 `tarball:` 字段——市场会优先展示它而不是源码构建命令。

## npm

尚未发布。发布是**显式开关、默认关闭**：推 tag 只负责构建、校验并附加 tarball，除非你明确要求，否则跳过 npm。

要发布需要两样东西：

1. `NPM_TOKEN` 仓库 secret —— 一个**确实能发布到 `@crosery` scope** 的 token。光有 token 不够：第一次带着 token 尝试，结果就是 `404 Not Found - PUT https://registry.npmjs.org/@crosery%2fdsh-viewer`，这是 npm 对「无权发布该 scope」的报法。registry 上还从未有过任何 `@crosery/*` 包，所以 scope 得先存在，token 对应的账号也得能写它。
2. `NPM_PUBLISH=true` 仓库**变量**（Settings → Secrets and variables → Actions → Variables）。没有它发布步骤直接跳过，npm 还没准备好时推 tag 也能保持绿色。设了它却没有 `NPM_TOKEN` 时，该步骤给出警告并跳过，不会在没有凭据的情况下尝试发布。

要手工发布：

```sh
npm login && npm publish --access public
```

`package.json` 的 `files` 已经把包限制在 `lib/`、清单、文档和 `assets/`；CI 会断言打包产物里有 `cordis.patch.yml`——缺了它 dsh 会装上包却不激活任何层。

## 插件市场

上架是给 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，那是个精选列表，不是本仓库的日常。**只提一个文件** `data/plugins/Crosery__dsh-viewer.yml`，别的都不要动——改到别人条目的 PR 会被单独标出来问。

他们的 CI 有三道门，提交前值得知道：

- **`package.json` 要有 `dsh.bundle`。** 只声明 `dsh.client` 会失败，那样根本装不上。
- **仓库满 1 天且 ≥ 10 次提交。** 自动检查，用来过滤「PR 前几分钟才建好」的仓库。没到线不是对插件的评价，重新提交也没有任何代价。
- **描述会被当作声明，拿去对着代码核。** 写了 36 种扩展名就得真有 36 种。`npm run check` 存在的理由正是让两份 README 一直属实。

截图声明在**本仓库**（`screenshots.json`），不在那边——所以换截图是往这里推一次，而不是再提一个 PR。
