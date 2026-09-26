# Harness compatibility

> **English** · [中文](harness-compatibility.zh.md) · [Docs index](README.md)

## What this plugin supports

**Web:** every published harness version, `0.0.1-rc.1` through `0.1.7-rc.2`. Every one that can be installed at all, `0.0.1-rc.5` and later, installs, boots and renders the cards. `0.0.1-rc.1` and `0.0.1-rc.2` are admitted too, but nobody can run them: their own `@deepseek-ai/dsh` depends on `@deepseek-ai/dsh-agent-tool-mode`, which was never published, so `npm install @deepseek-ai/dsh@0.0.1-rc.1` answers `E404`. **Desktop app:** `0.1.7-rc.2`, the build its update feed ships today. The desktop app boots the same `@deepseek-ai/dsh` Web app at the same version, so "the desktop version" and "its Web version" are one version.

| Tuple | Versions | Types + tests | Boot smoke | Live, in a browser |
| --- | --- | --- | --- | --- |
| 0.0.1 | `0.0.1-rc.1`, `0.0.1-rc.2` | incomplete upstream: the harness itself does not install | — | — |
| 0.0.1 | `0.0.1-rc.5` | yes | `0.0.1-rc.5` | `0.0.1-rc.5` |
| 0.1.0 | `0.1.0-rc.2`, `0.1.0-rc.3`, `0.1.0-rc.6`, `0.1.0-rc.7`, `0.1.0-rc.8` | yes | every one | `0.1.0-rc.2`, `0.1.0-rc.6` |
| 0.1.1 | `0.1.1-rc.1`, `0.1.1-rc.2` | yes | `0.1.1-rc.2` (the floor) | `0.1.1-rc.2`, with v0.1.1 |
| 0.1.2 | `0.1.2-alpha.2`, `0.1.2-alpha.3`, `0.1.2-alpha.4`, `0.1.2-alpha.5`, `0.1.2-rc.1` | yes | `0.1.2-rc.1` | — |
| 0.1.3 | `0.1.3-alpha.2` | yes | `0.1.3-alpha.2` | — |
| 0.1.5 | `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.5-rc.3` | yes | `0.1.5-rc.3` | `0.1.5-rc.2`, with v0.1.1 |
| 0.1.6 | `0.1.6-alpha.1`, `0.1.6-alpha.2` | yes | `0.1.6-alpha.2` | — |
| 0.1.7 | `0.1.7-alpha.1`, `0.1.7-alpha.2`, `0.1.7-rc.1`, `0.1.7-rc.2` | yes | `0.1.7-alpha.2`; `0.1.7-rc.2`, from npm and from the desktop app's own bytes | `0.1.7-rc.2`, Web and desktop |

"Types + tests" means both typechecks and the whole suite pass with every `@deepseek-ai/dsh-*` devDependency repointed at exactly that version (`node scripts/sweep-trains.mjs`). The boot smoke column is what ran locally for this release, and since the browser stage it includes running the plugin in headless Chrome on each of those versions; CI's weekly sweep and the release gate smoke **every** installable version. The last column is a `display_file` card checked by hand. The evidence for each column is in [acceptance.md](acceptance.md).

### The trains before 0.1.0-rc.8

On `0.0.1-rc.5` through `0.1.0-rc.7` the harness has a different front end: the `dsh-client-web` shell, the slot registry declared by `@deepseek-ai/dsh-client-runtime`, and no `@deepseek-ai/dsh-client-ui-renderer` (first published at `0.1.0-rc.8`). None of that reaches the plugin:

- **The browser half needs two services, `slots` and `locale`**, and every train has both. The renderer package is imported type-only, for the `slots` declaration. On a train that never published it, the typecheck keeps this repository's pin of it and pins `dsh-client-runtime` to the train, which is where those trains declare `slots`; the build never contained a value from it.
- **`dsh.client.inject` still names the renderer.** That list is graph metadata: a client fiber waits on the services its entry injects, not on package names. The boot smoke reports the name as absent on these trains and goes on to load the bundle.
- **The old shell's module table answers 10 specifiers** (react, its JSX runtime, react-dom and seven more), a superset of the three this bundle requires; the rc.8 shell answers 7.
- **Up to 0.1.1 the settings API is `ctx.settings.register`**, which `mountSettingsSection` already drives.

Installed today (`--graph today`) instead of as released, every one of these trains resolves the cordis family to its 2026-09-22 releases (cordis 4.0.4, cordis-plugin-hmr 1.0.19, cordis-plugin-loader 1.0.5), and the 0.1.0 trains' sub-packages to `0.1.0-rc.8`'s. That harness does not boot with or without any plugin (`dsh: user patch-layer watching requires the Cordis HMR service`), the same upstream drift that breaks a fresh `0.1.1-rc.2`, so nobody can run the plugin there and nothing about it can be checked. The smoke reports exactly that; see [acceptance.md](acceptance.md).

Not supported, on evidence:

- **`0.1.4`** was never published, and the ranges have no comparator for it.
- **`0.1.8` and later** are admitted only after a sweep has verified them. Until then the ranges refuse them, and dsh ≥0.1.7 enforces that (next section).

The peer range, identical for every `@deepseek-ai/dsh-*` peer, one comparator set per tuple:

```text
>=0.0.1-rc.0 <0.0.2-0 || >=0.1.0-rc.0 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-alpha.0 <0.1.3-0 || >=0.1.3-alpha.0 <0.1.4-0 || >=0.1.5-alpha.0 <0.1.6-0 || >=0.1.6-alpha.0 <0.1.7-0 || >=0.1.7-alpha.0 <0.1.8-0
```

`npm run check` asserts that this range admits every published version above under both semver rules, refuses every build outside the support, and keeps one prerelease-floored comparator set per tuple.

No peer is optional, because optional would change nothing. dsh ≥0.1.7's `evaluatePluginCompatibility` (dsh-app-boot) checks every `@deepseek-ai/dsh*` peer against the running version, prerelease-inclusive, optional or not; no package of 0.1.7 reads `peerDependenciesMeta` at all, `dsh-plugin-manager` included. A peer would be worth marking optional only if an installable train lacked it and the plugin ran without it. The only peer some published train lacks is `@deepseek-ai/dsh-home-paths`, absent on `0.0.1-rc.1` and `rc.2`, and the Host half value-imports it; those two trains do not install anyway.

### Trains whose own peer graph does not resolve

`0.1.0-rc.2` – `rc.7`, `0.1.1-rc.1`, `0.1.2-alpha.2` – `alpha.5`, `0.1.5-alpha.1` – `rc.2`, `0.1.6-alpha.1` and `0.1.7-alpha.1` publish harness packages with caret peers (`^0.1.1-rc.1`). npm's automatic peer install then drags in a later prerelease of the same tuple whose own peers conflict with the pinned one, and `npm install` stops with `ERESOLVE`. Earlier versions of this page therefore called several of them incoherent.

The harness never runs that graph. `@deepseek-ai/dsh` pins every package it composes to one exact version. So when the peer graph fails (`ERESOLVE`, a peer npm cannot find, or no answer within 5 minutes), the sweep and the CI install the repointed copy through that version's own `@deepseek-ai/dsh` instead, and every one of these versions passes there.

A version counts as **incomplete upstream** when `@deepseek-ai/dsh@<version>` does not install on its own, with nothing of ours involved: npm answers `E404` or `ETARGET` for the train's own graph (checked in legacy peer mode, as the smoke installs it, which takes seconds instead of the peer graph's minutes). The sweep and every CI cell check that first. Today that is `0.0.1-rc.1` and `0.0.1-rc.2`: `npm error 404 Not Found - GET https://registry.npmjs.org/@deepseek-ai%2fdsh-agent-tool-mode`. A version whose repointed copy fails and whose bare install then fails on the graph (`ERESOLVE` included) is incomplete too. A bare install that times out or cannot reach the registry proves nothing, so it fails the cell instead.

## The 0.1.7 version gate

From 0.1.7 the harness itself checks every `@deepseek-ai/dsh*` peer range of a plugin against its own version, with prereleases included (`semver.satisfies(version, range, { includePrerelease: true })` in dsh-app-boot's `evaluatePluginCompatibility`):

- **At install**, `dsh plugin add` and the desktop app's **Plugins → Add plugin** refuse the package and roll the profile back: `dsh: installation rejected: Plugin @crosery/dsh-viewer@0.1.1 is incompatible with dsh 0.1.7-rc.2: peerDependencies …`.
- **At boot**, an already-installed plugin that fails the check is skipped with one stderr line (`dsh: skipping profile bundle "@crosery/dsh-viewer": …`). The UI comes up normally and the plugin is simply absent.

That is why v0.1.1 showed nothing in the 0.1.7 desktop app: its ranges stopped below `0.1.6`. Typecheck and tests could not see it, because npm never checks a root project's peer ranges against its own devDependencies. The `admission` and `smoke` stages below exist for this.

Two consequences:

- **The peer range is the list of verified trains.** Widening it is a release. A range that admits an unverified train is a promise the gate will enforce.
- **Only an exact-version exemption bypasses the gate** (`dsh plugin --profile <p> allow-version <pkg>@<v> --dsh-version <dsh> --accept-risk`). `smoke-boot.mjs --accept-risk` uses it for diagnosis only: it separates "the range is too narrow" from "the code is broken". It never counts as a pass.

## The prerelease trap

node-semver lets a prerelease version satisfy a range **only if some comparator in that range shares its exact `major.minor.patch` tuple and itself carries a prerelease tag.** A range that looks generous does not help:

```jsonc
// looks broad, matches NO 0.1.x prerelease under npm's rule
">=0.0.1-rc.1 <0.2.0"

// one prerelease-carrying comparator per tuple — what this plugin uses
">=0.1.1-rc.0 <0.1.2-0 || >=0.1.2-alpha.0 <0.1.3-0"
```

The broad range does admit those prereleases under dsh's own `includePrerelease` rule. So it would install through the harness and fail every npm or pnpm peer check. That is why every claim is checked under both rules.

## What CI checks, and when

`.github/workflows/harness-compat.yml` resolves each **cell** to one exact version with `scripts/harness-target.mjs` and runs four stages against it:

| Stage | What it proves |
| --- | --- |
| `types` | both typechecks pass against that version's published `.d.ts` |
| `tests` | the plugin's own tests pass against that version's packages |
| `admission` | every harness peer range admits the version under both semver rules |
| `smoke` | `scripts/smoke-boot.mjs`: the packed plugin installs through `dsh plugin add` with no exemption, activates, a real `dsh --profile web` serves its browser half, and headless Chrome runs it: the app mounts and nothing on the page reports an error naming the plugin. The stages are harness → pnpm → install → boot → host-activation → client-graph → client-load → client-exports → client-boot |

| Cell | Resolves to | Pull request | Schedule | Release |
| --- | --- | --- | --- | --- |
| `pinned` | the `devDependencies` pin, `0.1.7-rc.2` | required | — | gate |
| `floor` | `0.1.1-rc.2` | required | — | gate |
| `desktop` | the version both desktop update feeds announce, required to agree and to exist as `@deepseek-ai/dsh` on npm | runs, not required | daily | gate |
| `latest` / `next` / `alpha` | npm dist-tags of `@deepseek-ai/dsh` | — | daily | — |
| `sweep` | every published `@deepseek-ai/dsh` version from the lowest the peer ranges admit (`0.0.1-rc.0`, so every one), read from npm at run time | — | weekly, with the smoke on every installable version | gate, with the same smoke |
| `desktop-bytes` | the macOS zip from the `mac-arm64` feed: sha512-verified, cross-checked against its `desktop-runtime.json`, smoked with the app's own Electron Node and bundled pnpm | — | daily and weekly | gate |

Details that matter when reading a run:

- **Only one desktop channel exists.** The app hard-codes `nightly`, and only `mac-arm64` and `win-x64` are built. A disagreement between the two feeds fails the `desktop` cell; a version the feeds announce before npm has it is **incomplete**.
- **Incomplete is neutral.** A version that is not on npm yet, or whose own `@deepseek-ai/dsh` does not install, neither opens nor closes an issue. The smoke stands down on it. `admission` still runs, because it reads no package, so a version the ranges refuse is drift even before npm has all of it. Types and tests still run when the train published every package they compile against (the resolve step says `compiles=true`); `0.0.1-rc.1` and `rc.2` did not, so there only `admission` runs.
- **A package the train never published is not a reason to skip it.** It keeps this repository's pin, for types only, and the resolve step lists it (`kept=`): `dsh-client-ui-renderer` on every version before `0.1.0-rc.8`. Where the train publishes `dsh-client-runtime` (up to `0.1.1-rc.2`) the cell pins it to the train, because the early client packages reach it only as a caret peer, which npm would resolve to the newest prerelease of the tuple. Whether the plugin runs there is the smoke's question, and on every such train it does.
- **Only npm saying "not there" is incomplete.** A registry that does not answer (a refused connection, a timeout, a 5xx) fails the cell, and so does npm listing no `@deepseek-ai/dsh` version at all. `pinned` and `floor` are never incomplete: they are versions this plugin claims, so a package missing there is a failure.
- **Only the harness moves.** A cell on any version but the pin installs without the lockfile, since that version's graph has to resolve fresh. Every devDependency outside `@deepseek-ai/` (TypeScript, `@types/*`, esbuild, semver) stays at the exact version `package-lock.json` resolved, so a new toolchain release cannot turn `floor` or the sweep red while `pinned` stays green.
- **A new release shows up by itself.** The sweep reads the version list at run time. A version on a tuple the ranges do not cover yet (say `0.1.8-alpha.1`) arrives as an `admission` failure, which is the prompt to verify it.
- **The smoke installs a train as it was released.** `smoke-boot.mjs --dsh <v>` passes `npm install --before <one second after that version's own @deepseek-ai/dsh was published>`. Not the next release's publication: `@deepseek-ai/dsh` lists its packages with caret ranges, which accept the next prerelease of the same tuple, and a train's packages go out minutes before its own `@deepseek-ai/dsh`. Cut at the next release, `0.1.6-alpha.1` took `0.1.6-alpha.2`'s `dsh-app-boot`, and its CLI could not start (`does not provide an export named 'watchUserPatches'`); `0.1.0-rc.7` ran `0.1.0-rc.8`'s front end. The cutoff moves later only when npm refuses one of the train's own packages as not yet published: `0.1.5-rc.3`'s `dsh-client-ui-sidebar-documentpreview` went out almost seven hours after its `@deepseek-ai/dsh`, and `0.0.1-rc.5`'s `dsh-shell` 96 s after it, as that package's first version (npm answers `No versions available`, not `No matching version`). The installed tree must then hold no harness package at a later train's version, or the `harness` stage fails rather than vouch for a graph that is not the train. The cordis family floats under every train, and its 2026-09-22 releases broke a fresh `npm i @deepseek-ai/dsh@0.1.1-rc.2`, which no longer boots even with no plugin installed (`user patch-layer watching requires the Cordis HMR service`). Pass `--graph today` to see what a fresh install gets. If npm's peer graph answers `ERESOLVE` or has not settled within 120 s (`--install-timeout-ms`; `0.1.1-rc.2` makes npm 11 burn minutes of CPU on it, and one CI floor cell took 653 s), the smoke installs in legacy peer mode and then adds every peer left unmet at its declared range, which is the same harness. When a boot fails, the smoke boots the same harness again without the plugin and reports which of the two it was.
- **The smoke runs the browser half in a real browser (`client-boot`).** `client-load` and `client-exports` evaluate the bundle in a `vm` against inert modules, which never runs `apply`: a plugin can pass both and still break once a shell runs it. So headless Google Chrome — the one GitHub's `ubuntu-latest` and `macos-latest` images ship, or `CHROME_PATH` / `--browser` — opens the tokenized URL with a fresh profile inside the smoke's temp directory. Every shell, the early one included, shows "Loading plugins…" until every entry of its boot graph is active, mounts the app only then, and shows "Failed to load plugins" with the entry ids when one is not. The stage gives the app 2 minutes to mount, requires the page to have loaded this plugin's bundle, and then watches 5 more seconds. It fails on the failure page, on an app that never mounts (from `0.1.0-rc.8` a composition without a renderer waits without any error), and on any uncaught error, console error, failed request or HTTP error whose text, stack or URL names this plugin or its bundle. It fails too on this plugin's own warning that the train refused one of its slot registrations, which would leave the plugin active without that card. Anything naming someone else is printed as a note.
- **The browser stage does not render a card.** A `display_file` card needs a real tool call — a model, a workspace and a session — set up through a provider config, a workspace store and a UI flow that each differ across the three front ends. The cards are checked live by hand instead, per the table above.
- **Not covered by any stage:** a card rendered from a real tool call, the Electron renderer, the desktop preload bridge and native drag-and-drop. Those are verified by hand ([acceptance.md](acceptance.md)).

Run any of it locally:

```sh
node scripts/harness-target.mjs desktop --admits          # resolve a cell, check admission
node scripts/harness-target.mjs --plan pinned,floor,sweep # the matrix CI would run
node scripts/smoke-boot.mjs --dsh 0.1.1-rc.2              # boot smoke from npm (needs network and Google Chrome)
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  scripts/smoke-boot.mjs --harness-dir "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
node scripts/sweep-trains.mjs                             # types + tests on every published version
```

The smoke refuses any `DSH_HOME` outside the OS temp directory, so it cannot touch a real profile, and Chrome runs headless with a fresh profile in that same directory, never a real one. It is the installed Google Chrome unless `CHROME_PATH` or `--browser <path>` names another Chromium build; `playwright-core` (a devDependency, so `npm ci` first) drives it and downloads nothing. With `--harness-dir` pointing at the desktop app, put a `pnpm` on `PATH` that runs the app's `Contents/Resources/runtime/pnpm/bin/pnpm.mjs`, as the `desktop-bytes` job does. pnpm 10 fails `dsh plugin add` with `ERR_PNPM_ADDING_TO_ROOT`; otherwise the smoke installs pnpm 11.7.0 itself.

## When a drift issue opens

Scheduled runs file one `upstream-drift` issue per failing cell, titled `Harness compatibility broken against @<cell>`, and comment on it on every further failure. The first run where every stage of that cell passes comments on the issue and closes it.

Nothing a scheduled run does ends silently:

- **Every stage has a time limit** (the install 40 minutes, the smoke 45, and so on), and a stage cancelled by its limit counts as failed. Only a run someone cancelled is not judged.
- **`setup`** (checkout, Node, `npm ci`) is a stage too, so a runner or registry problem before the first real stage still reports.
- **The `unreported` job** runs after every cell. A cell that failed or ran out of time before its own verdict could report (a failed checkout, the job's own time limit) is filed in the same issue, naming the step that stopped it. A `plan` job that failed opens `Harness compatibility run could not plan its cells`, which closes on the next run that plans.

Work it in this order:

1. **Read which stage failed.** The step summary names it, and for the smoke also the sub-stage.
2. **`types` or `tests`:** a renamed or removed export names itself in the output. Adapt with structural types and feature detection. Never value-import a symbol one supported train lacks: a missing named export is an ESM link failure that takes the whole entry down.
3. **`admission` on a new train:** run `node scripts/sweep-trains.mjs --versions <v>`, then `smoke-boot.mjs --dsh <v> --accept-risk`. When both pass, add one prerelease-carrying comparator for the new tuple to every harness peer, add the version to `ADMITTED_TRAINS` in `scripts/check-invariants.mjs` and to the table above, and release.
4. **`smoke`:** the summary says whether the harness boots without the plugin. If it does not, it is upstream's, and the drift is in its floating dependencies.
5. **Ship it as a release.** The peer range is part of the package contract.

Never widen the range to silence the job. The harness enforces the range, so a wrong one fails for real users.

## The 0.1.2 API rename

0.1.2 moved the settings mount from a package export to a service method:

```ts
// up to 0.1.1
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
installSettingsSection(ctx, settingsNamespace('crosery-viewer'), schema, entry, hooks)

// 0.1.2 – 0.1.6
ctx.settings.installSection(ctx, 'crosery-viewer', schema, entry, hooks)
```

0.1.7 removed both. `ctx.settings` became a forms service with neither method, and its forms show only the fields a plugin marks volatile — none of this plugin's, so 0.1.7 has no settings form for it. The entry's own `Config` (entry id `viewer`) is the only source, set in the profile's `cordis.patch.yml`; see [Configuration](../README.md#configuration). `mountSettingsSection` in `src/index.ts` drives whichever surface the running harness publishes and does nothing on 0.1.7. `tests/settings-mount.test.ts` pins every arm.

A **static import** of a removed export is what actually broke users once: ESM resolves named exports before any code runs, so on 0.1.2 the whole host entry failed to load with `does not provide an export named 'installSettingsSection'`. It did not degrade; it did not start.

Two more things moved in 0.1.2, and this plugin is deliberately pinned to neither:

- The client `sessions` service lived in `@deepseek-ai/dsh-client-runtime` up to 0.1.1 and in `@deepseek-ai/dsh-api-session-controller` from 0.1.2. The plugin declares the slice it reads structurally instead of importing either package's type, so one build typechecks on both.
- `dsh-client-runtime` stopped publishing after `0.1.1-rc.2`, which is why it is not a devDependency. A sweep row or CI cell on a train that has it pins it there (`TRAIN_ONLY` in `scripts/harness-lib.mjs`).
