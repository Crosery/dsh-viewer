# Releasing

> **English** · [中文](releasing.zh.md) · [Docs index](README.md)

## Cut a release

1. Bump `version` in `package.json` (and `package-lock.json`, `npm install --package-lock-only`), and update the counts in both READMEs if anything changed.
2. If the harness moved, run `node scripts/sweep-trains.mjs` and make `VERIFIED_TRAINS` in `scripts/check-invariants.mjs`, the peer ranges and [harness-compatibility.md](harness-compatibility.md) say the same thing. `npm run check` refuses a disagreement.
3. Merge to `main` with CI green.
4. Tag and push:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` takes it from there, in three jobs, around **one tarball packed once**.

**`pack`** **refuses a tag that disagrees with `package.json`**, runs typecheck, tests and invariants, runs `npm run check:dist` before `npm run build` and requires the build to leave `lib/` unchanged, then packs `dsh-viewer.tgz` and records its sha256.

**`gate`** calls `harness-compat.yml` on the tag's own tree, and every boot smoke in it installs that packed tarball, not a fresh pack. Nothing is attached until every part passes:

- the four stages (types, tests, peer admission, boot smoke) on the `pinned` train, the `0.1.1-rc.2` floor, and the version the desktop app ships that day;
- the boot smoke on the desktop zip itself (`desktop-bytes`, macOS);
- types, tests and peer admission on every published harness version the sweep finds, from the lowest the peer ranges admit, and the boot smoke on the newest version of each tuple. A version published incomplete upstream is neutral and does not block.

One consequence: a new harness tuple published after the last sweep fails the gate's `admission` stage until the ranges admit it. That is intended. Verify it and widen the ranges ([harness-compatibility.md](harness-compatibility.md)), or re-run the release once that is done.

**`release`** checks that the tarball it attaches has the sha256 `pack` recorded, then attaches it. A new release's notes start with a table of the exact harness versions the gate smoked and name that sha256; `scripts/release-notes.mjs` fails the release if any smoke recorded different bytes. npm publishing is a separate opt-in that publishes the same tarball and only runs when the repository variable `NPM_PUBLISH` is `true` (see [npm](#npm)). A release never depends on npm being reachable.

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

## npm

Not yet published. Publishing is **opt-in and off by default**: a tag push builds, verifies and attaches the tarball, and skips npm unless you say otherwise.

To publish, two things are required:

1. `NPM_TOKEN` as a repository secret — a token that can actually publish to the `@crosery` scope. A token alone is not enough: the first attempt with one configured came back `404 Not Found - PUT https://registry.npmjs.org/@crosery%2fdsh-viewer`, which is how npm reports an unauthorized scoped publish. No `@crosery/*` package exists on the registry yet, so the scope has to exist and the token's account has to be able to write to it.
2. `NPM_PUBLISH=true` as a repository **variable** (Settings → Secrets and variables → Actions → Variables). Without it the publish step is skipped, so a tag run stays green while npm is not set up. With it but without `NPM_TOKEN`, the step warns and skips rather than attempting a publish with no credentials.

To publish by hand instead:

```sh
npm login && npm publish --access public
```

`files` in `package.json` already limits the package to `lib/`, the manifests, the docs and `assets/` — CI asserts the packed tarball contains `cordis.patch.yml`, without which dsh installs the package and activates nothing.

## Plugin market

Listing is a PR to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), which is a curated list, not this repo's concern day to day. One file, `data/plugins/Crosery__dsh-viewer.yml`, and nothing else — a PR that edits another entry gets flagged.

Their CI gates on three things worth knowing before you submit:

- **`dsh.bundle` in `package.json`.** Declaring only `dsh.client` fails; that alone is not installable.
- **Repo age ≥ 1 day and ≥ 10 commits.** Checked automatically. It filters out repos created minutes before the PR; being under the bar is not a judgement and resubmission costs nothing.
- **The description is read as a claim and checked against the code.** If it says 36 extensions, there must be 36. `npm run check` keeps the READMEs honest for exactly this reason.

Screenshots are declared in **this** repo (`screenshots.json`), not over there — so updating them is a push here rather than another PR.
