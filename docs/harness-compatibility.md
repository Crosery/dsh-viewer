# Harness compatibility

> **English** · [中文](harness-compatibility.zh.md) · [Docs index](README.md)

## What this plugin supports

Built and tested against the newest **coherent** harness train: `next`, currently `0.1.1-rc.2`. "Coherent" is the operative word — a train counts only when every package this plugin needs is published on it.

`0.1.2-alpha.2` is deliberately excluded on two grounds, both verified rather than assumed:

- It is **published incomplete**. `@deepseek-ai/dsh-client-runtime` has no build on that tag, so the set cannot install; `npm install` ends in `ERESOLVE`.
- It **removes API this plugin uses**. `@deepseek-ai/dsh-settings` no longer exports `installSettingsSection` or `settingsNamespace`, and no subpath or sibling package exports them either.

Claiming support would hand users an install failure or a runtime crash, so the peer range stops below `0.1.2`. It widens on evidence, not optimism.

## The prerelease trap

node-semver lets a prerelease version satisfy a range **only if some comparator in that range shares its exact `major.minor.patch` tuple and itself carries a prerelease tag.** A range that looks generous does not help:

```jsonc
// looks broad, matches NO 0.1.x prerelease at all
">=0.0.1-rc.1 <0.2.0"

// explicit prerelease branch per tuple — this is what we use
">=0.1.0-rc.1 <0.1.1-0 || >=0.1.1-rc.0 <0.1.2-0"
```

The harness is on a prerelease train, so getting this wrong means every user hits `ERESOLVE` and works around it by hand. `npm run check` asserts that the peer range admits the version pinned in `devDependencies`, which is the cheapest way to keep the two in step.

## When the drift job opens an issue

`.github/workflows/harness-compat.yml` runs weekly against the `next` and `alpha` tags: it repoints every harness devDependency at whatever that tag resolves to, installs, typechecks and tests. A failure is the signal, not an accident, so it opens an issue labelled `upstream-drift`.

Work it in this order:

1. **Read the typecheck output.** A renamed or removed export names itself there.
2. **Decide whether the train is coherent.** Check that every harness package this plugin depends on actually publishes that version. An incomplete train is not something to adapt to yet.
3. **Adapt, then widen.** Fix the code first, verify against the tag, and only then extend the peer range — with a comparator that carries a prerelease tag on the new tuple.
4. **Ship it as a patch release.** The peer range is part of the package contract; changing it needs a version.

Never widen the range to silence the job. The range is a promise about what works, and the job exists to keep that promise honest.
