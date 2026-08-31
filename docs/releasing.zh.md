# 发版

> [English](releasing.md) · **中文** · [文档索引](README.zh.md)

## 发一个版本

1. 改 `package.json` 的 `version`；若有格式变动，同步两份 README 的数字。
2. CI 绿了之后合进 `main`。
3. 打 tag 并推：

```sh
git tag v0.2.0 && git push origin v0.2.0
```

剩下的交给 `.github/workflows/release.yml`：typecheck、测试、构建，**tag 与 `package.json` 不一致直接拒绝**，然后打包并附加 tarball。只有配了 `NPM_TOKEN` 才会发 npm——发布 release 本身不依赖 npm 可达。

## 为什么资产名不带版本号

附加的资产叫 `dsh-viewer.tgz` 而不是 `dsh-viewer-0.2.0.tgz`，因为大家复制的安装链接是：

```
https://github.com/Crosery/dsh-viewer/releases/latest/download/dsh-viewer.tgz
```

`latest/download/` **只在请求时解析 `latest`，文件名是照字面取的**。资产名带版本号的话，这个链接发布当天有效，下一次发版就 404——而且不会有人察觉，包括作者自己。要么让名字不带版本，要么在 URL 里钉住 tag。

## 为什么要有 tarball

从源码安装会让用户在 profile 的 `allowBuilds` 里批准一个构建步骤。预构建 tarball 免掉这一步。插件市场也更认它：条目可以带 `tarball:` 字段，市场会优先展示它而不是源码构建命令。

## npm

尚未发布。要发时：

```sh
npm login && npm publish --access public
```

或者把 `NPM_TOKEN` 配成仓库 secret 交给 release workflow。`package.json` 的 `files` 已经把包限制在 `lib/`、清单、文档和 `assets/`；CI 会断言打包产物里有 `cordis.patch.yml`——缺了它 dsh 会装上包却不激活任何层。

## 插件市场

上架是给 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，那是个精选列表，不是本仓库的日常。**只提一个文件** `data/plugins/Crosery__dsh-viewer.yml`，别的都不要动——改到别人条目的 PR 会被单独标出来问。

他们的 CI 有三道门，提交前值得知道：

- **`package.json` 要有 `dsh.bundle`。** 只声明 `dsh.client` 会失败，那样根本装不上。
- **仓库满 1 天且 ≥ 10 次提交。** 自动检查，用来过滤「PR 前几分钟才建好」的仓库。没到线不是对插件的评价，重新提交也没有任何代价。
- **描述会被当作声明，拿去对着代码核。** 写了 36 种扩展名就得真有 36 种。`npm run check` 存在的理由正是让两份 README 一直属实。

截图声明在**本仓库**（`screenshots.json`），不在那边——所以换截图是往这里推一次，而不是再提一个 PR。
