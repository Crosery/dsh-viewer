# Releasing

> **English** · [中文](releasing.zh.md) · [Docs index](README.md)

## Cut a release

1. Bump `version` in `package.json` and update the counts in both READMEs if anything changed.
2. Merge to `main` with CI green.
3. Tag and push:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` takes it from there: it typechecks, tests, builds, **refuses a tag that disagrees with `package.json`**, packs, and attaches the tarball. Publishing to npm happens only when an `NPM_TOKEN` secret exists — the release itself never depends on npm being reachable.

## Why the asset name carries no version

The attached asset is `dsh-viewer.tgz`, not `dsh-viewer-0.2.0.tgz`, because the install URL people paste is:

```
https://github.com/Crosery/dsh-viewer/releases/latest/download/dsh-viewer.tgz
```

`latest/download/` resolves **`latest` at request time but takes the filename literally**. A versioned asset name makes that URL work the day it is published and 404 the moment the next release lands — a quiet rot nobody notices, least of all the author. Keep the name version-free, or pin the tag in the URL instead.

## Why a tarball at all

Installing from source makes the user approve a build step in their profile's `allowBuilds`. A prebuilt tarball skips it. The plugin market also prefers it: an entry may carry a `tarball:` field, and storefronts offer it instead of the build-from-source command.

## npm

Not yet published. When you publish:

```sh
npm login && npm publish --access public
```

Or set `NPM_TOKEN` as a repository secret and let the release workflow do it. `files` in `package.json` already limits the package to `lib/`, the manifests, the docs and `assets/` — CI asserts the packed tarball contains `cordis.patch.yml`, without which dsh installs the package and activates nothing.

## Plugin market

Listing is a PR to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), which is a curated list, not this repo's concern day to day. One file, `data/plugins/Crosery__dsh-viewer.yml`, and nothing else — a PR that edits another entry gets flagged.

Their CI gates on three things worth knowing before you submit:

- **`dsh.bundle` in `package.json`.** Declaring only `dsh.client` fails; that alone is not installable.
- **Repo age ≥ 1 day and ≥ 10 commits.** Checked automatically. It filters out repos created minutes before the PR; being under the bar is not a judgement and resubmission costs nothing.
- **The description is read as a claim and checked against the code.** If it says 36 extensions, there must be 36. `npm run check` keeps the READMEs honest for exactly this reason.

Screenshots are declared in **this** repo (`screenshots.json`), not over there — so updating them is a push here rather than another PR.
