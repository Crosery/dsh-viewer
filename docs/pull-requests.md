# Pull requests

> **English** · [中文](pull-requests.zh.md) · [Docs index](README.md)

## Before you open one

```sh
npm run typecheck && npm test && npm run check
```

`npm run check` is the invariant checker (`scripts/check-invariants.mjs`). It catches the drifts a diff hides: a README count that no longer matches `MEDIA_TABLE`, a locale dictionary short one key, a peer range that excludes the prerelease it is pinned to. Every rule in it corresponds to a defect that shipped or nearly did, so a failure is worth reading rather than working around.

## Commit messages

English, imperative mood, `type: summary` under ~72 characters. Types in use: `feat` `fix` `docs` `test` `ci` `chore` `refactor`.

The body answers **why**, because the diff already shows what:

```
fix: read on binary media is no longer a red failure row

The shipped fs provider throws FS_NOT_TEXT on a NUL byte, so this row
appeared with or without the plugin. Corrected in the tools/execute
around-dispatch waterfall without calling next(), so no filesystem I/O
happens at all.
```

Write the constraint that forced the design, not a restatement of the change. A reader six months out needs the reason the obvious approach was rejected.

## One PR, one thing

A PR that adds a format and also rewrites the asset route is two PRs. The reviewer reads a diff against a claim; two claims in one diff means neither gets read properly.

Keep the branch rebased on `main` rather than merging `main` into it — the history stays a sequence of separable changes, which is what makes `git log` worth reading.

## What CI runs

| Check | Trigger | What it guards |
| --- | --- | --- |
| `CI` → `node 22.19`, `node 24` | push, PR | typecheck (both halves), build, 165 tests, invariants, dist freshness, client bundle purity, packed-tarball contents |
| `CI` → `harness / harness@pinned`, `harness / harness@floor` | push, PR | on the pinned train and on the `0.1.1-rc.2` floor: typecheck and tests against that version's packages, peer admission under both semver rules, and a boot smoke of the packed plugin in a real `dsh --profile web` |
| `CI` → `desktop / harness@desktop` | push, PR | the same four stages on the version the desktop app ships today. Visible, but not a required check: the feed can move under an open PR |
| `PR review` → `invariants` | PR, forks included | the same invariant checker, so an external contributor gets the same feedback |
| `PR review` → `claude` | PR from this repo, only when `ANTHROPIC_API_KEY` exists | judgement: purity of display projections, card degradation, claim accuracy, whether the tests could falsify anything |
| `Harness compatibility` | daily, weekly, manual | daily: the desktop app, npm `latest` / `next` / `alpha`, and the desktop zip itself; weekly: every published harness version. Opens and closes `upstream-drift` issues — see [harness-compatibility.md](harness-compatibility.md) |

The required checks in branch protection are the two `node` legs, `harness / harness@pinned` and `harness / harness@floor`.

Four of those assert things a normal test run cannot:

- **Client bundle purity.** `lib/client.js` may only `require` specifiers the oldest supported shell's module table answers. Anything else throws when the plugin activates in a browser; no test would ever see it.
- **Packed tarball contents.** Without `cordis.patch.yml` in the package, dsh installs the plugin and activates no layer: present, and doing nothing.
- **Peer admission.** From 0.1.7 the harness refuses to install or load a plugin whose peer ranges do not admit it. v0.1.1 passed every other check and still showed nothing in the 0.1.7 desktop app.
- **Boot smoke.** The packed plugin is installed with `dsh plugin add` and no exemption, the harness boots, the startup audit names nothing of ours, and the served browser bundle evaluates against that train's real module table.

To run the harness stages locally before pushing, see [harness-compatibility.md](harness-compatibility.md#what-ci-checks-and-when).

If a check fails it names what to change. Push a fix to the same branch.

## Review

The `claude` job reports; it never pushes commits. Its tool allowlist is read-only by design, and merging stays a human decision.

Reviewers weigh, in order: does it do what the description claims, does it keep the [three always-on constraints](../AGENTS.md), and are the new tests capable of failing when the behaviour breaks.
