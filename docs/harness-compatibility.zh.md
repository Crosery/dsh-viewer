# Harness 版本兼容

> [English](harness-compatibility.md) · **中文** · [文档索引](README.zh.md)

## 本插件支持到哪

构建与测试针对当前唯一**完整**的 harness 序列：`next`，目前是 `0.1.1-rc.2`。「完整」是关键词——一条序列只有在本插件需要的每个包都发布到它上面时才算数。

`0.1.2-alpha.2` 被刻意排除，两条依据都是实测出来的，不是推测：

- **发布不完整。** `@deepseek-ai/dsh-client-runtime` 在该 tag 上没有构建，整套装不上，`npm install` 直接 `ERESOLVE`。
- **删掉了本插件在用的 API。** `@deepseek-ai/dsh-settings` 不再导出 `installSettingsSection` 和 `settingsNamespace`，子路径和兄弟包里也都没有。

声明支持只会让用户拿到安装失败或运行时崩溃，所以 peer 范围止步于 `0.1.2` 之下。**按证据放宽，不靠乐观。**

## 预发布陷阱

node-semver 只有在范围里**某个比较符与该版本的 `major.minor.patch` 元组完全一致、且自身也带预发布标签**时，才放行预发布版本。看着很宽的范围没有用：

```jsonc
// 看起来很宽，实际一个 0.1.x 预发布都匹配不到
">=0.0.1-rc.1 <0.2.0"

// 每个元组一条显式预发布分支 —— 我们用的是这个
">=0.1.0-rc.1 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0"
```

harness 正处在预发布序列上，这里写错就意味着每个用户都撞 `ERESOLVE` 然后自己手工绕。`npm run check` 会断言 peer 范围能接纳 `devDependencies` 里 pin 的那个版本，这是让两者不脱节的最省事办法。

## 漂移 job 开了 issue 之后

`.github/workflows/harness-compat.yml` 每周对 `next` 和 `alpha` 两条 tag 跑一遍：把所有 harness devDependency 重新指向该 tag 当前解析到的版本，安装、typecheck、测试。**失败就是信号本身**，不是意外，所以它会开一个带 `upstream-drift` 标签的 issue。

按这个顺序处理：

1. **先读 typecheck 输出。** 被改名或删除的导出会自己报出来。
2. **判断那条序列是否完整。** 确认本插件依赖的每个 harness 包都真的发了那个版本。不完整的序列还不到适配的时候。
3. **先适配，再放宽。** 先改代码、对着那个 tag 验过，**然后**才扩 peer 范围——并且要在新元组上带预发布标签的比较符。
4. **以 patch 版本发出去。** peer 范围是包契约的一部分，改它需要一个版本号。

**不要为了让 job 变绿而放宽范围。** 范围是一句「什么能跑」的承诺，而这个 job 存在的意义就是让这句承诺保持属实。
