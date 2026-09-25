/**
 * What the harness trains are, and how to put this repository on one of them.
 *
 * Shared by `harness-target.mjs` (one CI cell at a time) and
 * `sweep-trains.mjs` (every published train, locally). The pure functions at
 * the top take their facts as arguments so `tests/harness-target.test.ts` can
 * pin them without a network; the npm-backed helpers below them are thin.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import semver from 'semver'

/** The Web app package. The desktop app boots this same package at the same version. */
export const HARNESS = '@deepseek-ai/dsh'

/**
 * The oldest train with live evidence, and the one the owner runs every day.
 * It gates pull requests next to the pinned train; the sweep reaches further
 * back, down to the lowest version the peer ranges admit.
 */
export const FLOOR = '0.1.1-rc.2'

/**
 * Every update feed the desktop app has. The channel is hard-coded to
 * `nightly` (`updater.channel = "nightly"` in the app's main.js) and only
 * these two platforms are built; every other path answers 404.
 */
export const DESKTOP_FEEDS = {
  'mac-arm64': 'https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml',
  'win-x64': 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml',
}

/** The npm dist-tags a cell may name. */
export const DIST_TAGS = ['latest', 'next', 'alpha']

/** Cells with a fixed meaning; anything else must be an exact version. */
export const NAMED_CELLS = ['pinned', 'floor', 'desktop', ...DIST_TAGS]

export const isHarnessPeer = (name) => name === HARNESS || name.startsWith('@deepseek-ai/dsh-')

/** `[name, range]` for every harness peer — the ones dsh ≥0.1.7 checks. */
export function harnessPeers(pkg) {
  return Object.entries(pkg.peerDependencies ?? {}).filter(([name]) => isHarnessPeer(name))
}

/**
 * The peers that refuse a version, under each of the two rules that matter:
 * the one dsh ≥0.1.7 applies at install and at boot
 * (`semver.satisfies(v, range, { includePrerelease: true })` in dsh-app-boot's
 * `evaluatePluginCompatibility`), and node-semver's default, which npm and
 * pnpm apply to peers. A prerelease passes the default rule only when a
 * comparator on its own major.minor.patch tuple carries a prerelease tag.
 */
export function refusals(version, peers) {
  const refused = []
  for (const [name, range] of peers) {
    const runtime = semver.satisfies(version, range, { includePrerelease: true })
    const installer = semver.satisfies(version, range)
    if (!runtime || !installer) refused.push({ name, runtime, installer })
  }
  return refused
}

/** One line per refusing peer, naming which rule refused it. */
export function describeRefusals(refused) {
  return refused.map(({ name, runtime, installer }) => {
    const rules = [!runtime && 'dsh ≥0.1.7 refuses to install or load it', !installer && 'npm/pnpm peer check fails'].filter(Boolean)
    return `${name} (${rules.join('; ')})`
  })
}

/** The lowest version every harness peer range admits: where the sweep starts. */
export function sweepStart(peers) {
  let start
  for (const [, range] of peers) {
    const min = semver.minVersion(range)
    if (min !== null && (start === undefined || semver.gt(min, start))) start = min.version
  }
  return start
}

/** The newest published version on each `major.minor.patch` tuple. */
export function tupleHeads(versions) {
  const heads = new Map()
  for (const version of versions) {
    if (!semver.valid(version)) continue
    const tuple = `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}`
    const current = heads.get(tuple)
    if (current === undefined || semver.gt(version, current)) heads.set(tuple, version)
  }
  return new Set(heads.values())
}

/**
 * Expand a cell list into matrix rows.
 *
 * `sweep` becomes one row per published `@deepseek-ai/dsh` version from
 * `facts.sweepFrom` up, read at run time — so a release published yesterday is
 * in today's rows, and a new tuple the peer ranges do not cover arrives as an
 * admission failure rather than as silence. A version already covered by a
 * named cell in the same plan is not repeated.
 *
 * Named cells always run the boot smoke. Sweep rows run it per `smoke`:
 * `heads` (default) — the floor, the newest version of each tuple and whatever
 * desktop / latest / next / alpha resolve to; `all`; or `none`.
 *
 * @param {string[]} cells
 * @param {{ published: string[], sweepFrom: string, pinned?: string, resolved?: Record<string, string | undefined> }} facts
 * @param {'heads' | 'all' | 'none'} smoke
 */
export function planCells(cells, facts, smoke = 'heads') {
  if (!['heads', 'all', 'none'].includes(smoke)) throw new Error(`unknown smoke policy ${JSON.stringify(smoke)}`)
  const rows = []
  const seen = new Set()
  const resolved = { pinned: facts.pinned, floor: FLOOR, ...(facts.resolved ?? {}) }
  const push = (cell, runSmoke) => {
    if (seen.has(cell)) return
    seen.add(cell)
    rows.push({ cell, smoke: runSmoke })
  }
  for (const cell of cells) {
    if (cell === 'sweep') continue
    if (!NAMED_CELLS.includes(cell) && !semver.valid(cell)) throw new Error(`unknown cell ${JSON.stringify(cell)}`)
    push(cell, true)
  }
  if (!cells.includes('sweep')) return rows

  const covered = new Set(cells.filter((c) => c !== 'sweep').map((c) => (semver.valid(c) ? c : resolved[c])).filter(Boolean))
  const versions = facts.published.filter((v) => semver.valid(v) && semver.gte(v, facts.sweepFrom)).sort(semver.compare)
  const heads = tupleHeads(versions)
  const notable = new Set([FLOOR, ...Object.values(resolved).filter(Boolean)])
  for (const version of versions) {
    if (covered.has(version)) continue
    push(version, smoke === 'all' || (smoke === 'heads' && (heads.has(version) || notable.has(version))))
  }
  return rows
}

/**
 * The fields of an electron-builder update feed this pipeline reads. The feed
 * folds long scalars (`path: >-` and the value on the next line), which a
 * line-oriented `key: value` read would miss.
 */
export function parseFeed(text) {
  const field = (key) => {
    const match = new RegExp(`^${key}:[ \\t]*(?:>-?[ \\t]*\\r?\\n[ \\t]+)?(\\S+)[ \\t]*$`, 'm').exec(text)
    return match?.[1].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
  }
  const size = /^[ \t]+size:[ \t]*(\d+)/m.exec(text)?.[1]
  return { version: field('version'), path: field('path'), sha512: field('sha512'), releaseDate: field('releaseDate'), size: size === undefined ? undefined : Number(size) }
}

// ---------------------------------------------------------------------------
// npm-backed helpers

/** `npm view <spec> <field> --json`, or `undefined` when npm has nothing. */
export function view(spec, field) {
  try {
    const out = execFileSync('npm', ['view', spec, field, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.trim() === '' ? undefined : JSON.parse(out)
  } catch {
    return undefined
  }
}

const published = new Map()
/** Every published version of one package. */
export function versionsOf(name) {
  if (!published.has(name)) {
    const list = view(name, 'versions')
    published.set(name, Array.isArray(list) ? list : typeof list === 'string' ? [list] : [])
  }
  return published.get(name)
}

/** Why a package is absent at a version: it did not exist yet, or upstream skipped it. */
export function absence(name, version) {
  const all = versionsOf(name)
  if (all.length === 0) return 'never published'
  return all.some((v) => semver.valid(v) && semver.lt(v, version)) ? 'skipped by upstream' : 'predates'
}

/** Run one command; returns `{ ok, output }` with stdout and stderr joined. */
export function run(cwd, command, argv, extraEnv = {}) {
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** Last lines of a command's combined output, for a report. */
export function tail(text, lines = 6) {
  return text.trim().split('\n').slice(-lines).join('\n')
}

/**
 * A copy of the manifest whose `@deepseek-ai/dsh-*` devDependencies name one
 * exact version, with cordis and schemastery taken from that version's own
 * `@deepseek-ai/dsh` manifest so a train that moved them is compiled against
 * what it ships. `missing` lists harness devDependencies the train never
 * published; with any of them the plugin cannot be built there as-is.
 */
export function repointManifest(pkg, version) {
  const manifest = structuredClone(pkg)
  const harnessDeps = Object.keys(manifest.devDependencies).filter((name) => name.startsWith('@deepseek-ai/dsh-'))
  const missing = harnessDeps
    .filter((name) => !versionsOf(name).includes(version))
    .map((name) => ({ name, why: absence(name, version) }))
  for (const name of harnessDeps) manifest.devDependencies[name] = version
  const shipped = view(`${HARNESS}@${version}`, 'dependencies') ?? {}
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/schemastery']) {
    if (typeof shipped[name] === 'string') manifest.devDependencies[name] = shipped[name]
  }
  return { manifest, missing }
}

/** Whether `@deepseek-ai/dsh` itself resolves at a version, with nothing of ours involved. */
export function bareHarnessInstalls(version, work) {
  const dir = work ?? mkdtempSync(join(tmpdir(), 'dsh-bare-'))
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bare', version: '0.0.0', private: true }))
    return run(dir, 'npm', ['install', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund', `${HARNESS}@${version}`])
  } finally {
    if (work === undefined) rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Install a repointed manifest in `dir` from scratch, the way the train is
 * actually run.
 *
 * Early trains declare caret peers (`^0.1.1-rc.1`), so npm's automatic peer
 * install can drag in a LATER prerelease of the same tuple whose own peers
 * then conflict with the pinned one (ERESOLVE). The harness never runs that
 * graph — `@deepseek-ai/dsh` pins every package exactly — so on ERESOLVE the
 * copy is reinstalled through the train's own `@deepseek-ai/dsh` (legacy peer
 * mode, its exact pins providing the peers). Only when a bare install of
 * `@deepseek-ai/dsh` at that version fails as well is the train reported as
 * published incomplete; a conflict this repository causes stays a failure.
 *
 * @returns {{ ok: boolean, incomplete: boolean, via: string, output: string, manifest: object }}
 */
export function installTrain(dir, manifest, version) {
  const fresh = () => {
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
    rmSync(join(dir, 'package-lock.json'), { force: true })
  }
  const flags = ['--ignore-scripts', '--no-audit', '--no-fund']
  fresh()
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const first = run(dir, 'npm', ['install', ...flags])
  if (first.ok) return { ok: true, incomplete: false, via: 'peer graph', output: first.output, manifest }
  if (!/ERESOLVE/.test(first.output)) return { ok: false, incomplete: false, via: 'peer graph', output: first.output, manifest }

  fresh()
  const shipped = structuredClone(manifest)
  shipped.devDependencies[HARNESS] = version
  // Legacy peer mode installs no peers at all, and some harness packages reach
  // others only as peers (dsh-tools → dsh-scope). Pin every such harness peer
  // the train published at exactly this version.
  for (const name of Object.keys(manifest.devDependencies).filter((n) => n.startsWith('@deepseek-ai/dsh-'))) {
    for (const peer of Object.keys(view(`${name}@${version}`, 'peerDependencies') ?? {})) {
      if (!isHarnessPeer(peer) || peer in shipped.devDependencies) continue
      if (versionsOf(peer).includes(version)) shipped.devDependencies[peer] = version
    }
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(shipped, null, 2) + '\n')
  const second = run(dir, 'npm', ['install', ...flags, '--legacy-peer-deps'])
  const via = `${HARNESS}@${version} graph (the peer graph hit ERESOLVE)`
  if (second.ok) return { ok: true, incomplete: false, via, output: second.output, manifest: shipped }
  const bare = bareHarnessInstalls(version)
  return {
    ok: false,
    incomplete: !bare.ok,
    via,
    output: `${first.output}\n--- retry through ${HARNESS}@${version}:\n${second.output}\n--- bare ${HARNESS}@${version} ${bare.ok ? 'installs' : 'fails too'}:\n${tail(bare.output, 12)}`,
    manifest: shipped,
  }
}
