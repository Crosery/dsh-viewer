# 验收记录

> [English](acceptance.md) · **中文** · [文档索引](README.zh.md)

针对 0.1.1 → 0.1.5 各条 harness 序列做过端到端验证的内容与方式。下面每个数字都来自真实运行的 host，不是对着代码推出来的。

## 各条序列

一条序列算**已支持**，需要它上面本插件依赖的每个 harness 包都发布了，**且**本插件的 typecheck 与测试对着那些确切版本通过。一条序列算**发布不完整**，是指它上面的 harness 包彼此都解析不起来——那种情况没有可适配的东西，也不是本插件造成的。

| 序列 | 状态 | 证据 |
| --- | --- | --- |
| `0.1.1-rc.2` | 已支持 | typecheck + 71 个测试 |
| `0.1.2-rc.1` | 已支持 | typecheck + 71 个测试 |
| `0.1.3-alpha.2` | 已支持 | typecheck + 71 个测试 |
| `0.1.5-rc.2` | 已支持 | typecheck + 71 个测试 |
| `0.1.2-alpha.5` | 发布不完整 | `dsh-tools` 要求 `dsh-user-approval@^0.1.2-alpha.5`，而该版本只有 `0.1.2-rc.1`，那个又要求 `dsh-agent@^0.1.2-rc.1` |
| `0.1.5-alpha.1` / `.2` | 发布不完整 | `dsh-tools` 要求 `dsh-user-approval@^0.1.5-alpha.x`，那些 tag 上从未发布 |
| `0.1.5-rc.1` | 发布不完整 | `dsh-tools` 要求 `dsh-user-approval@^0.1.5-rc.1`，而该版本只有 `0.1.5-rc.2`，那个又要求 `dsh-agent@^0.1.5-rc.2` |

「发布不完整」这几行是**在整个依赖图里完全没有本插件**的情况下确认的：一个只写 harness 包的 package.json 在这些 tag 上同样装不上。它们是上游的发布缺口，不是本插件没兑现的承诺。

peer 范围是 `>=0.1.0-rc.1 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-rc.0 <0.1.3-0 || >=0.1.3-rc.0 <0.1.4-0 || >=0.1.5-rc.0 <0.1.6-0`，覆盖全部已支持的序列，且不含任何发布不完整的那条。

## 真实 host 上的卡片

两个 host 都是真的 `dsh --profile web` 进程，各有自己的 `$DSH_HOME`，插件走 git 通道安装，会话里的资源 URL 全部用该 home 自己的 HMAC 密钥铸造。

### 0.1.1-rc.2

![图片、视频、音频、文档卡片](acceptance/pinned-cards.png)

### 0.1.5-rc.2 —— 就是 issue #3 立案时那条序列

![视频、音频、文档卡片](acceptance/next-cards.png)

修复前这个 host 根本起不来：入口加载就报 `does not provide an export named 'installSettingsSection'`。

## 实测数据

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

- **没跑 Windows 与 Linux。** 构建产物是平台中立的，CI 在 Linux 上跑；但上面的 host 是 macOS，这也是唯一的**运行时**证据。
- **卡片模型的回放路径**（旧版本写下的会话日志、被截断的窗口）由单测覆盖，不靠这些截图。
- **没有真实模型回合。** 预置会话走的是插件自身的路径——日志 → 卡片模型 → 资源路由 → 屏幕上的字节——不需要 LLM 调用，所以这里不依赖任何模型服务可达。
