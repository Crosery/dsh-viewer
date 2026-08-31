# Pull Request 规范

> [English](pull-requests.md) · **中文** · [文档索引](README.zh.md)

## 开 PR 之前

```sh
npm run typecheck && npm test && npm run check
```

`npm run check` 是不变量检查器（`scripts/check-invariants.mjs`），专抓 diff 藏得住的漂移：README 里的数字与 `MEDIA_TABLE` 对不上、中英词典少一个键、peer 范围排除了自己 pin 的预发布版本。里面每一条都对应一个真实发生过或差点发生的缺陷，所以它报错时值得读，而不是绕过去。

## 提交信息

英文、祈使句、`type: 摘要` 控制在 72 字符内。在用的类型：`feat` `fix` `docs` `test` `ci` `chore` `refactor`。

正文回答**为什么**——做了什么 diff 已经写了：

```
fix: read on binary media is no longer a red failure row

The shipped fs provider throws FS_NOT_TEXT on a NUL byte, so this row
appeared with or without the plugin. Corrected in the tools/execute
around-dispatch waterfall without calling next(), so no filesystem I/O
happens at all.
```

写下**逼出这个设计的约束**，而不是把改动复述一遍。半年后读它的人需要知道的是「显而易见的那个做法为什么不行」。

## 一个 PR 一件事

既加格式又重写资源路由的 PR 是两个 PR。评审是拿 diff 对着一句声明核，一个 diff 里塞两句声明，结果是两句都没被认真核。

分支用 rebase 跟上 `main`，不要把 `main` merge 进来——历史保持成一串可分离的改动，`git log` 才有阅读价值。

## CI 跑什么

| 检查 | 触发 | 守住什么 |
| --- | --- | --- |
| `CI` | push、PR | 两个半边 typecheck、构建、66 个测试、不变量、客户端 bundle 纯度、打包产物内容 |
| `PR review` → `invariants` | PR，含 fork | 同一套不变量检查，外部贡献者拿到一样的反馈 |
| `PR review` → `claude` | 本仓库的 PR，且配了 `ANTHROPIC_API_KEY` | 判断题：展示器纯度、卡片降级、声明是否属实、测试能否证伪 |
| `Harness compatibility` | 每周、手动 | 对 `next` 与 `alpha` 两条 harness tag 的上游漂移 |

其中两条断言的是普通测试查不出的事：

- **客户端 bundle 纯度**：`lib/client.js` 只能 `require` 模块表答得出的 specifier。其余的会在浏览器里激活插件时才抛错，任何测试都看不见。
- **打包产物内容**：包里没有 `cordis.patch.yml` 时，dsh 会装上插件却不激活任何层——存在，且什么都不做。

检查失败会明确指出要改什么。在同一分支推修复即可。

## 评审

`claude` 那个 job 只报告，**不推提交**——工具白名单是只读的，合并权始终在人。

评审关注的顺序：它是否做了描述里声明的事、是否守住了[三条常驻约束](../AGENTS.md)、新增的测试在行为坏掉时是否真的会红。
