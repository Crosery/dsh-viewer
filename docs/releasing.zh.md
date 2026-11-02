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

**`release`** 先核对要附加的 tarball 的 sha256 与 `pack` 记下的一致，再附加它。新 release 的说明开头是一张表，列出门禁冒烟过的确切 harness 版本，并写明这个 sha256；只要有一次冒烟记录的是别的字节，`scripts/release-notes.mjs` 就让发版失败。完成 npm Trusted Publishing 的首次配置后，release 门禁会通过 GitHub OIDC 发布同一个 tarball，并记录 provenance（见 [npm](#npm)）。发布 release 本身从不依赖 npm 可达。

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

## 自动追随上游

`.github/workflows/upstream-follow.yml` 每天 07:41 UTC（在兼容性日检之后）跑一次 `scripts/follow-upstream.mjs`，把 `@deepseek-ai/dsh` 新发布的版本记录下来，做的事和上面「发一个版本」里人工的两步一样：

1. `--check` 读出 npm 上每一个已发布版本，和 `ADMITTED_TRAINS`、`tests/harness-ci.test.ts` 的 `PUBLISHED` 比对。差集为空就是一条日志。落在 peer 范围之外的新元组会被点出来。
2. `--apply` 先给每个 harness peer 加上新元组的比较器集合（`>=M.m.p-alpha.0 <M.m.(p+1)-0`），再对每个新版本跑 `sweep-trains.mjs`（两份类型检查、整套测试、peer 接纳），并对每个动过的元组头跑一次 `smoke-boot.mjs` 九阶段冒烟。任何一步不过，manifest 还原，什么也不写。
3. 都过了才写：`ADMITTED_TRAINS`、`PUBLISHED`、拒绝清单里的「下一个未验证元组」、两份兼容表的对应行、两份验收记录的新小节、两份 README 的版本范围 / dist-tag / 可安装数，以及 `package.json` 与 lockfile 的版本号（同元组内 +1 patch，新元组进 minor）。
4. 在同一个 job 里跑一遍推送 `main` 会触发的检查：`typecheck`、`test`、`check`、`check:dist`、`build`（`lib/` 不许变）。全绿才提交并推送 `main`。
5. 记录并提交后，`scripts/release-pending.mjs` 检查 npm 上是否已发布当前 `package.json` 的精确版本，即使本次没有新记录 harness 版本也会检查。未发布就算 pending：工作流创建对应 tag，或只在既有 tag 指向当前已验证提交时复用它，再以 `publish: true` 调用 `release.yml`（`workflow_call`）。tag 指向别的提交时直接失败，绝不覆盖；registry 错误也会让检查失败。

要点：

- **GITHUB_TOKEN 推出去的东西不会触发别的 workflow**，包括 tag。所以第 4 步在本 job 里自己跑检查，第 5 步用 `workflow_call` 调门禁，而不是指望 `v*` 事件。
- **记录就是一次声明**，所以验证在写之前，不在写之后；`npm run check` 在 `--apply` 内部还会再跑一次，四处不一致就整体失败。
- **门禁或 npm 发布失败后仍为 pending**：下次日检会检查同一个插件精确版本并重试同一个 tag，即使上游没再更新。如果需要改代码，发新版本；已有 tag 指向其他提交时绝不会自动移动。
- **失败会被上报**：始终运行的报告 job 会在追随或发版失败、超时时创建或更新同一个 issue，`Upstream follow or npm release failed`。之后重试成功、或确认版本已发布的运行会关闭它。版本仍为 pending 时关掉 `release` 不会误关闭 issue。
- **人不参与**，但删掉工作流、或把 `workflow_dispatch` 的 `release` 关掉，就等于回到「只记录不发版」。自动记录始终必须验证；`--skip-verify` 只保留给本地诊断，工作流不会暴露这个开关。
- 自动发版复用的是**同一个门禁**：一次打包的 tarball、每个能装上的版本上的冒烟，以及通过 GitHub OIDC 的 npm Trusted Publishing。自动化没有绕过任何一道。

## npm

release 门禁会发布经过兼容性检查、并且实际冒烟验证过的同一份 tarball，使用 npm Trusted Publishing。GitHub OIDC 提供短期发布凭据，npm 同时记录 provenance（来源证明）；仓库不保存长期 token 或 OTP。

首次配置在 GitHub 之外完成：创建 `@crosery` scope 或授予发布账号权限，然后让 release 工作流只对已有 tag 打包、跑门禁而不发布 npm。在 Actions 界面运行 `Release`，填写 `tag=vX.Y.Z`、`publish=false`；或执行：

```sh
gh workflow run release.yml -f tag=vX.Y.Z -f publish=false
```

从成功的这次运行下载 `release-tarball` artifact，其中就是通过门禁的确切 `dsh-viewer.tgz`。本地终端无法提供 GitHub OIDC 的 provenance 断言，所以首次发布用 npm 网页登录发布这份 tarball，不强制加 `--provenance`：

```sh
npm login --auth-type=web
npm publish ./dsh-viewer.tgz --access public --auth-type=web
```

包创建后，为本仓库的两个入口工作流分别配置 Trusted Publisher：

```sh
npm trust github @crosery/dsh-viewer --repo Crosery/dsh-viewer --file release.yml --allow-publish --auth-type=web
npm trust github @crosery/dsh-viewer --repo Crosery/dsh-viewer --file upstream-follow.yml --allow-publish --auth-type=web
npm trust list @crosery/dsh-viewer
```

包尚未创建前不能绑定 Trusted Publisher，因此首发是一次人工认证的 bootstrap。绑定完成后，tag push 自动发布；`workflow_dispatch` 与 `workflow_call` 的 `publish` 都默认 `true`。设置 `publish=false` 只跳过 npm，打包、兼容性门禁和 GitHub release 仍会运行。不要再次发布 bootstrap 的同一个版本：npm 版本不可覆盖，下一次 OIDC 发版使用新版本号。

通过 reusable workflow 发布时，[npm 验证的是调用方工作流名称](https://docs.npmjs.com/trusted-publishers/#troubleshooting)：直接运行 release 时是 `release.yml`，自动追随时是 `upstream-follow.yml`。两者都需要对应的 Trusted Publisher，并允许直接发布；调用方与被调用方也都需要 `id-token: write`。`upstream-follow` 已授予这一权限，并以 `publish: true` 调用同一个门禁。因此两条发布路径都发布门禁冒烟验证过的确切 tarball，并带上 `--provenance`。

`package.json` 的 `files` 已经把包限制在 `lib/`、清单、文档和 `assets/`；CI 会断言打包产物里有 `cordis.patch.yml`——缺了它 dsh 会装上包却不激活任何层。

## 插件市场

上架是给 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，那是个精选列表，不是本仓库的日常。**只提一个文件** `data/plugins/Crosery__dsh-viewer.yml`，别的都不要动——改到别人条目的 PR 会被单独标出来问。

他们的[贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)说明了检查与评审规则：

- **`package.json` 要有 `dsh.bundle`。** 只声明 `dsh.client` 会失败，那样根本装不上。
- **仓库满 1 天。** 没有提交数门槛。这一项自动检查，暂未达到年龄线时，达标后可以重新提交。
- **描述会被当作声明，拿去对着代码核。** 写了 36 种扩展名就得真有 36 种。`npm run check` 存在的理由正是让两份 README 一直属实。

是否发布 npm 不影响收录。市场从 registry 自动发现 npm 映射；已发布包的 `repository` 必须指回 `https://github.com/Crosery/dsh-viewer`。不要在市场 YAML 条目里添加 `npm:`，schema 会拒绝这个字段。映射发现后，市场才能展示 npm 下载量和 npm 安装入口。市场的 format-1 索引从已发布包的 `engines.dsh` 读取支持范围；该值必须与所有 harness peer 范围完全一致，自动追随脚本同步更新两者，`npm run check` 拒绝漂移。市场每天重新采集，合并条目后的即时构建只使用缓存。

市场条目可选的 `icon:` 指向一张 GitHub 托管的 HTTPS 位图（`png`、`jpg`、`jpeg` 或 `webp`）；卡片约 96px，方形图更清楚。SVG 与第三方图床会被拒绝。不声明图标时，市场回退到作者的 GitHub 头像。

DSH 原生「已安装插件」独立读取已安装包的顶层 `package.json.icon`，不读取市场 YAML 或 README。它必须指向包目录内的 SVG、PNG、JPEG 或 WebP，最多 256 KiB。本仓库声明 `assets/icon.png`（同款 logo 的 256×256 版本）；README 的 `assets/logo.png` 超过该限制，不能直接用作原生图标。`npm run check` 检查声明、文件存在和大小；`files` 中的 `assets/**` 负责随包发布。已安装旧版需要更新包，运行中的实例如何刷新由宿主决定。

截图声明在**本仓库**（`screenshots.json`），不在那边——所以换截图是往这里推一次，而不是再提一个 PR。
