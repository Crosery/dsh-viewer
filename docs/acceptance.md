# Acceptance record

> **English** · [中文](acceptance.zh.md) · [Docs index](README.md)

What was verified end to end for the 0.1.1 → 0.1.5 harness trains, and how. Every number below came from a running host, not from reasoning about one.

## Trains

A train counts as **supported** only when every harness package this plugin needs is published on it *and* the plugin's own typecheck and tests pass against those exact versions. A train counts as **incoherent** when the harness packages on it cannot even resolve each other — nothing to adapt to, and not this plugin's doing.

| Train | Status | Evidence |
| --- | --- | --- |
| `0.1.1-rc.2` | supported | typecheck + 71 tests |
| `0.1.2-rc.1` | supported | typecheck + 71 tests |
| `0.1.3-alpha.2` | supported | typecheck + 71 tests |
| `0.1.5-rc.2` | supported | typecheck + 71 tests |
| `0.1.2-alpha.5` | incoherent | `dsh-tools` wants `dsh-user-approval@^0.1.2-alpha.5`; only `0.1.2-rc.1` exists, and that one wants `dsh-agent@^0.1.2-rc.1` |
| `0.1.5-alpha.1` / `.2` | incoherent | `dsh-tools` wants `dsh-user-approval@^0.1.5-alpha.x`, never published on those tags |
| `0.1.5-rc.1` | incoherent | `dsh-tools` wants `dsh-user-approval@^0.1.5-rc.1`; only `0.1.5-rc.2` exists, and that one wants `dsh-agent@^0.1.5-rc.2` |

The incoherent rows were confirmed **without this plugin in the graph at all**: a package.json naming only harness packages fails to install on those tags. They are upstream publication gaps, not a promise this plugin failed to keep.

The peer range is `>=0.1.0-rc.1 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-rc.0 <0.1.3-0 || >=0.1.3-rc.0 <0.1.4-0 || >=0.1.5-rc.0 <0.1.6-0`, which admits every supported train and no incoherent one.

## Cards, on a live host

Both hosts were real `dsh --profile web` processes with their own `$DSH_HOME`, the plugin installed over the git channel, and a seeded session whose asset URLs were minted with that home's own HMAC key.

### 0.1.1-rc.2

![Image, video, audio and document cards](acceptance/pinned-cards.png)

### 0.1.5-rc.2 — the train issue #3 was filed against

![Video, audio and document cards](acceptance/next-cards.png)

This host did not start at all before the fix: the entry failed to load with `does not provide an export named 'installSettingsSection'`.

## Measurements

| Property | Value |
| --- | --- |
| Image card pixels | rendered `1200x750` from the source PNG |
| Card ↔ source correlation | `0.9958` (screenshot region vs the source file; 1.0 is identical) |
| Video | `960x540`, `6s`, `mediaError: null` |
| Seek | `currentTime 3.5s → 4.24s`, `buffered 0.00-6.00` — the range path, exercised from the player |
| Audio | `4.05s`, played from the same signed route |
| Range response | `HTTP 206` |
| Tampered signature | `HTTP 404` |
| `settings/describe` | `crosery-viewer` listed with its four fields and defaults |
| `settings/update` | `{tool: false}` → read back `user.tool: false`, `revision 1`; restore → `revision 2` |

## What this record does not claim

- **Windows and Linux** were not exercised. The build outputs are platform-neutral and CI runs on Linux; the macOS hosts above are the only *runtime* evidence.
- **The card model's replay paths** (a session log written by an older build, a truncated window) are covered by unit tests, not by these screenshots.
- **Live model turns.** The seeded sessions exercise the plugin's own path — log → card model → asset route → bytes on screen — without an LLM call, so nothing here depends on a model provider being reachable.
