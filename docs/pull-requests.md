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
| `CI` | push, PR | typecheck (both halves), build, 71 tests, invariants, dist freshness, client bundle purity, packed-tarball contents |
| `PR review` → `invariants` | PR, forks included | the same invariant checker, so an external contributor gets the same feedback |
| `PR review` → `claude` | PR from this repo, only when `ANTHROPIC_API_KEY` exists | judgement: purity of display projections, card degradation, claim accuracy, whether the tests could falsify anything |
| `Harness compatibility` | weekly, manual | upstream drift against the `next` and `alpha` harness tags |

Two of those assert things a normal test run cannot:

- **Client bundle purity.** `lib/client.js` may only `require` specifiers the loader's module table answers. Anything else throws when the plugin activates in a browser — no test would ever see it.
- **Packed tarball contents.** Without `cordis.patch.yml` in the package, dsh installs the plugin and activates no layer: present, and doing nothing.

If a check fails it names what to change. Push a fix to the same branch.

## Review

The `claude` job reports; it never pushes commits. Its tool allowlist is read-only by design, and merging stays a human decision.

Reviewers weigh, in order: does it do what the description claims, does it keep the [three always-on constraints](../AGENTS.md), and are the new tests capable of failing when the behaviour breaks.
