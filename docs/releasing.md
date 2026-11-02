# Releasing

> **English** · [中文](releasing.zh.md) · [Docs index](README.md)

## Cut a release

1. Bump `version` in `package.json` (and `package-lock.json`, `npm install --package-lock-only`), and update the counts in both READMEs if anything changed.
2. If the harness moved, run `node scripts/sweep-trains.mjs` and make `ADMITTED_TRAINS` in `scripts/check-invariants.mjs`, the peer ranges and [harness-compatibility.md](harness-compatibility.md) say the same thing. `npm run check` refuses a disagreement.
3. Merge to `main` with CI green.
4. Tag and push:

```sh
git tag v0.2.1 && git push origin v0.2.1
```

`.github/workflows/release.yml` takes it from there, in three jobs, around **one tarball packed once**.

**`pack`** **refuses a tag that disagrees with `package.json`**, runs typecheck, tests and invariants, runs `npm run check:dist` before `npm run build` and requires the build to leave `lib/` unchanged, then packs `dsh-viewer.tgz` and records its sha256.

**`gate`** calls `harness-compat.yml` on the tag's own tree, and every boot smoke in it installs that packed tarball, not a fresh pack. Nothing is attached until every part passes:

- the four stages (types, tests, peer admission, boot smoke) on the `pinned` train, the `0.1.1-rc.2` floor, and the version the desktop app ships that day;
- the boot smoke on the desktop zip itself (`desktop-bytes`, macOS);
- types, tests and peer admission on every published harness version the sweep finds, from the lowest the peer ranges admit, and the boot smoke on every one of them that installs. A version whose own `@deepseek-ai/dsh` does not install (`0.0.1-rc.1`, `0.0.1-rc.2`) is incomplete upstream: neutral, it does not block, and only its peer admission is judged.

One consequence: a new harness tuple published after the last sweep fails the gate's `admission` stage until the ranges admit it. That is intended. Verify it and widen the ranges ([harness-compatibility.md](harness-compatibility.md)), or re-run the release once that is done.

**`release`** checks that the tarball it attaches has the sha256 `pack` recorded, then attaches it. A new release's notes start with a table of the exact harness versions the gate smoked and name that sha256; `scripts/release-notes.mjs` fails the release if any smoke recorded different bytes. After npm Trusted Publishing is bootstrapped, the release gate publishes the same tarball through GitHub OIDC and records provenance (see [npm](#npm)). A release never depends on npm being reachable.

The built halves are **committed**, so the tag itself is installable by the official git command. `npm run build` writes what `src/` currently means; `npm run check:dist` refuses a commit whose `lib/` disagrees with it. CI runs `check:dist` first, because `npm run build` rewrites `lib/` in place and a stale commit would compare equal afterwards, and then fails if the build changed `lib/`.

## Why the asset name carries no version

The attached asset is `dsh-viewer.tgz`, not `dsh-viewer-0.2.0.tgz`, because the install URL people paste is:

```
https://github.com/Crosery/dsh-viewer/releases/latest/download/dsh-viewer.tgz
```

`latest/download/` resolves **`latest` at request time but takes the filename literally**. A versioned asset name makes that URL work the day it is published and 404 the moment the next release lands — a quiet rot nobody notices, least of all the author. Keep the name version-free, or pin the tag in the URL instead.

## Why the built halves are committed, and why a tarball still exists

pnpm refuses to run a git-hosted package's build scripts unless the user has pre-approved them in `allowBuilds`, and it decides "this package needs a build" from the `prepare` script alone. A repository that builds on install therefore hands every user `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` on the official install command — and the harness's own installer reports that as a plugin-side packaging problem.

So this repository's rule is: **no build script at install time, committed output**. `scripts/check-dist.mjs` is what keeps that honest.

The release tarball carries the same files for two other reasons: a pinned, versioned install URL, and the plugin market's `tarball:` field — storefronts offer it ahead of the build-from-source command.

## Following upstream

`.github/workflows/upstream-follow.yml` runs `scripts/follow-upstream.mjs` every day at 07:41 UTC, after the daily compatibility run, and records the `@deepseek-ai/dsh` versions upstream published — the two manual steps of "Cut a release", done by the pipeline:

1. `--check` reads every published version from npm and compares it with `ADMITTED_TRAINS` and the `PUBLISHED` fixture in `tests/harness-ci.test.ts`. An empty difference is one log line. A new tuple no peer range admits is named.
2. `--apply` first adds the comparator set for a new tuple (`>=M.m.p-alpha.0 <M.m.(p+1)-0`) to every harness peer, then runs `sweep-trains.mjs` on each new version (both typechecks, the whole suite, peer admission) and a nine-stage `smoke-boot.mjs` on the head of each tuple it touched. If any stage fails, the manifest is restored and nothing is written.
3. Only then does it write: `ADMITTED_TRAINS`, `PUBLISHED`, the "next unverified tuple" of the refusal test, the matching row of both support tables, a new section in both acceptance records, the version range / dist-tags / installable count of both READMEs, and the version in `package.json` and the lockfile (a patch inside an admitted tuple, a minor for a new one).
4. In the same job it runs what a push to `main` would: `typecheck`, `test`, `check`, `check:dist`, `build` (`lib/` must not move). Only a green tree is committed and pushed.
5. After recording and committing, `scripts/release-pending.mjs` checks whether the exact current `package.json` version is published on npm, even if no new harness version was recorded. An unpublished version is pending: the workflow creates its tag, or reuses it only if it points at the current verified commit, then calls `release.yml` (`workflow_call`) with `publish: true`. A tag pointing at another commit fails rather than being overwritten; registry failures fail the check too.

Worth knowing:

- **What GITHUB_TOKEN pushes triggers nothing**, tags included. So step 4 runs the push checks inside this job, and step 5 calls the gate through `workflow_call` instead of expecting a `v*` event.
- **Recording is a claim**, so verification comes before the write, not after; `npm run check` runs again inside `--apply` and fails the whole run if the four places disagree.
- **A failed gate or npm publish stays pending.** The next daily run checks the same exact plugin version and retries the same tag, even when upstream has not changed again. If code must change, cut a new version; a tag pointing at a different commit is never moved automatically.
- **Failures are reported.** An always-running report job opens or updates one issue, `Upstream follow or npm release failed`, when following or release fails or times out. A later successful retry, or a check confirming the version is already published, closes it. Turning off `release` while a version remains pending leaves the issue open.
- **No human is in the loop**, but deleting the workflow or turning off its `release` input is the way back to "record only, never release". Verification is always required for an automatic recording; `--skip-verify` is reserved for local diagnosis and is not exposed by the workflow.
- Automatic releases reuse **the same gate**: one tarball packed once, a boot smoke on every installable version, and npm Trusted Publishing through GitHub OIDC. The automation bypasses none of it.

## npm

The release gate publishes the exact tarball it smoke-tested through npm Trusted Publishing. GitHub OIDC supplies a short-lived credential and npm records provenance; no long-lived token or OTP is stored in this repository.

The one-time npm bootstrap is outside GitHub: create the `@crosery` scope or grant the publishing account access, then ask the release workflow to pack and gate the existing tag without publishing. In the Actions UI, run `Release` with `tag=vX.Y.Z` and `publish=false`; or use:

```sh
gh workflow run release.yml -f tag=vX.Y.Z -f publish=false
```

Download the `release-tarball` artifact from that successful run. It is the exact `dsh-viewer.tgz` that passed the gate. A local terminal cannot provide the GitHub OIDC provenance assertion, so publish this first tarball through npm's web login without forcing `--provenance`:

```sh
npm login --auth-type=web
npm publish ./dsh-viewer.tgz --access public --auth-type=web
```

After the package exists, register Trusted Publishers for both entry workflows in this repository:

```sh
npm trust github @crosery/dsh-viewer --repo Crosery/dsh-viewer --file release.yml --allow-publish --auth-type=web
npm trust github @crosery/dsh-viewer --repo Crosery/dsh-viewer --file upstream-follow.yml --allow-publish --auth-type=web
npm trust list @crosery/dsh-viewer
```

A package that has not yet been created cannot be bound to a Trusted Publisher, which is why the first publish is a one-time authenticated bootstrap. After the binding, tag pushes publish automatically; `workflow_dispatch` and `workflow_call` both default `publish` to `true`. Setting `publish=false` skips only npm: packing, the compatibility gate and the GitHub release still run. Do not re-publish the bootstrap version: npm versions are immutable; use a new version for the next OIDC release.

[npm validates the calling workflow's name](https://docs.npmjs.com/trusted-publishers/#troubleshooting) when publishing through a reusable workflow: direct release runs use `release.yml`, while automatic following uses `upstream-follow.yml`. Both need a matching Trusted Publisher with direct publishing allowed, and both caller and child need `id-token: write`. `upstream-follow` grants that permission and passes `publish: true` into the same gate. Both release paths publish the exact tarball the gate smoke-tested, with `--provenance`.

`files` in `package.json` already limits the package to `lib/`, the manifests, the docs and `assets/` — CI asserts the packed tarball contains `cordis.patch.yml`, without which dsh installs the package and activates nothing.

## Plugin market

Listing is a PR to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), which is a curated list, not this repo's concern day to day. One file, `data/plugins/Crosery__dsh-viewer.yml`, and nothing else — a PR that edits another entry gets flagged.

Their [contribution guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) describes the checks and review:

- **`dsh.bundle` in `package.json`.** Declaring only `dsh.client` fails; that alone is not installable.
- **Repo age ≥ 1 day.** There is no commit-count requirement. This is checked automatically; a repository just under the age limit can be submitted again once it qualifies.
- **The description is read as a claim and checked against the code.** If it says 36 extensions, there must be 36. `npm run check` keeps the READMEs honest for exactly this reason.

npm publishing is optional for listing. The market discovers the npm mapping from the registry, and the published package's `repository` must point back to `https://github.com/Crosery/dsh-viewer`. Do not add an `npm:` key to the market YAML: the schema rejects it. Once the mapping is found, storefronts can show npm downloads and npm installs. The format-1 market index reads the support range from the published package's `engines.dsh`; it must match every harness peer range exactly. The follow script updates both, and `npm run check` rejects drift. The market refreshes its probes daily; immediate builds after an entry merge use cached probe data.

An optional `icon:` in the market entry points to one GitHub-hosted HTTPS raster (`png`, `jpg`, `jpeg` or `webp`); a square image works best at the approximately 96px tile size. SVG and third-party image hosts are refused. Without an icon, storefronts fall back to the owner's GitHub avatar.

Screenshots are declared in **this** repo (`screenshots.json`), not over there — so updating them is a push here rather than another PR.
