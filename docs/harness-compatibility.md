# Harness compatibility

> **English** · [中文](harness-compatibility.zh.md) · [Docs index](README.md)

## What this plugin supports

| Harness train | Verified | Evidence |
| --- | --- | --- |
| `0.1.1-rc.2` | yes | the pinned `devDependencies`; `npm run typecheck`, `npm test` |
| `0.1.2-rc.1` | yes | typecheck + tests against that train's published packages |
| `0.1.3-alpha.2` | yes | same |
| `0.1.5-rc.2` | yes | same, on the train `next` currently resolves to |

Verified trains and the evidence for each are recorded in [acceptance.md](acceptance.md).

The peer range is `>=0.1.0-rc.1 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-rc.0 <0.1.3-0 || >=0.1.3-rc.0 <0.1.4-0 || >=0.1.5-rc.0 <0.1.6-0`. It widens on evidence, not optimism: the `0.1.4` tuple is absent because nothing has been published on it at all.

A train is only installable when every harness package it needs is published on it, and several are not. The pattern is the same each time: a tag ships `@deepseek-ai/dsh-tools` requiring a `@deepseek-ai/dsh-user-approval` that the tag never published, and the nearest release that does exist requires a third package that the tag also never published. `0.1.2-alpha.5`, `0.1.5-alpha.1`, `0.1.5-alpha.2` and `0.1.5-rc.1` all fail that way, and each was confirmed with no trace of this plugin in the dependency graph. That is upstream's state, not this plugin's claim; the scheduled job keeps reporting it.

## The 0.1.2 API rename

0.1.2 moved the settings mount from a package export to a service method:

```ts
// up to 0.1.1
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
installSettingsSection(ctx, settingsNamespace('crosery-viewer'), schema, entry, hooks)

// 0.1.2 onward
ctx.settings.installSection(ctx, 'crosery-viewer', schema, entry, hooks)
```

The hooks and the registration they wire are identical; only the spelling moved. `settingsNamespace()` is gone with no replacement, because the service validates the namespace itself.

A **static import** of the removed exports is what actually broke users: ESM resolves named exports before any code runs, so on 0.1.2 and later the whole host entry failed to load with `does not provide an export named 'installSettingsSection'` — the plugin did not degrade to its entry config, it did not start. `mountSettingsSection` in `src/index.ts` drives whichever surface the running harness publishes, and `tests/settings-mount.test.ts` pins both arms plus the "neither API" fallback.

Two more things moved in the same train, and this plugin is deliberately not pinned to either:

- The client `sessions` service lived in `@deepseek-ai/dsh-client-runtime` up to 0.1.1 and in `@deepseek-ai/dsh-api-session-controller` from 0.1.2. The plugin declares the slice it reads structurally (`ViewerSessionFace`, `ViewerSessions`, `ToolCallBlockLike`) instead of importing either package's type, so one build typechecks on both.
- `dsh-client-runtime` stopped publishing after `0.1.1-rc.2`, which is why it is no longer a devDependency.

## The prerelease trap

node-semver lets a prerelease version satisfy a range **only if some comparator in that range shares its exact `major.minor.patch` tuple and itself carries a prerelease tag.** A range that looks generous does not help:

```jsonc
// looks broad, matches NO 0.1.x prerelease at all
">=0.0.1-rc.1 <0.2.0"

// explicit prerelease branch per tuple — this is what we use
">=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-rc.0 <0.1.3-0"
```

The harness is on a prerelease train, so getting this wrong means every user hits `ERESOLVE` and works around it by hand. `npm run check` asserts that the peer range admits the version pinned in `devDependencies`, which is the cheapest way to keep the two in step.

## When the drift job opens an issue

`.github/workflows/harness-compat.yml` runs weekly against the `next` and `alpha` tags: it repoints every harness devDependency at whatever that tag resolves to, installs, typechecks and tests. A failure is the signal, not an accident, so it opens an issue labelled `upstream-drift`.

The job answers two questions with two installs, and reports them differently:

- **Does the plugin still compile against the train's published types?** Always asked. A failure here is the drift signal.
- **Do its own tests pass?** They import the harness packages at runtime, so they need a peer graph that actually resolved. Several `alpha` tags publish `dsh-tools` peer-requiring packages that tag never shipped, so npm's own resolver refuses; the job recognizes that as an **incomplete train**, skips the runtime tests, and says so in the run summary instead of opening a drift issue. Only `ERESOLVE` counts — any other install failure is real and still reports.

Work it in this order:

1. **Read the typecheck output.** A renamed or removed export names itself there.
2. **Decide whether the train is coherent.** Check that every harness package this plugin depends on actually publishes that version. An incomplete train is not something to adapt to yet.
3. **Adapt, then widen.** Fix the code first, verify against the tag, and only then extend the peer range — with a comparator that carries a prerelease tag on the new tuple.
4. **Ship it as a patch release.** The peer range is part of the package contract; changing it needs a version.

Never widen the range to silence the job. The range is a promise about what works, and the job exists to keep that promise honest.
