/**
 * What the harness trains are, and how to put this repository on one of them.
 *
 * Shared by `harness-target.mjs` (one CI cell at a time) and
 * `sweep-trains.mjs` (every published train, locally). The pure functions at
 * the top take their facts as arguments so `tests/harness-target.test.ts` can
 * pin them without a network; the npm-backed helpers below them are thin.
 */

import { spawnSync } from 'node:child_process'
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


/**
 * Whether a failed npm run failed because the registry did not answer — a
 * refused or reset connection, DNS, a timeout, throttling, a 5xx — rather
 * than because the graph does not resolve. Such a failure proves nothing
 * about the train.
 */
export function registryFailed(output) {
  return /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_\w+|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|E429|E5\d\d)\b|socket hang up|network (?:request|timeout)/.test(output)
}

/** Whether a failed npm install failed on the graph itself: a conflict, or a package or version that does not exist. */
export function graphFailed(output) {
  return /\b(ERESOLVE|ETARGET|E404)\b|No matching version found|notarget/.test(output)
}

/** The npm error code of a failed `npm … --json` run: the JSON body on stdout, else the stderr banner. */
export function npmErrorCode(stdout, stderr) {
  try {
    const code = JSON.parse(stdout)?.error?.code
    if (typeof code === 'string') return code
  } catch {}
  return /^npm (?:error|ERR!) code (\S+)/m.exec(stderr ?? '')?.[1]
}

// ---------------------------------------------------------------------------
// npm-backed helpers

/**
 * The registry could not answer: a network failure, a 5xx, a timeout. Never a
 * reason to call a train incomplete or out of scope — the cell has to fail
 * where someone will read it, not go neutral.
 */
export class RegistryError extends Error {}

/** How long one `npm view` may take, npm's own retries included. */
export const VIEW_TIMEOUT_MS = 180_000

/**
 * `npm view <spec> <field> --json`.
 *
 * `undefined` when npm has nothing: the package or the version does not exist
 * (E404), or the version exists without that field. Any other failure throws
 * {@link RegistryError}: an unreachable registry answering "no versions" is
 * exactly how a train used to be reported incomplete — neutral — while every
 * later stage stood down.
 */
export function view(spec, field) {
  const r = spawnSync('npm', ['view', spec, field, '--json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: VIEW_TIMEOUT_MS, killSignal: 'SIGKILL',
  })
  if (r.status === 0) {
    const out = r.stdout.trim()
    return out === '' ? undefined : JSON.parse(out)
  }
  const code = r.error?.code === 'ETIMEDOUT' || r.signal !== null ? `killed after ${VIEW_TIMEOUT_MS / 1000} s` : npmErrorCode(r.stdout, r.stderr)
  if (code === 'E404') return undefined
  const detail = tail(`${r.stderr ?? ''}${r.error?.message ?? ''}`, 3)
  throw new RegistryError(`npm view ${spec} ${field} failed (${code ?? `exit ${r.status}`}); the registry did not answer, so nothing can be concluded about ${spec}:\n${detail}`)
}

const published = new Map()
/** Every published version of one package; `[]` only when npm says it does not exist. */
export function versionsOf(name) {
  if (!published.has(name)) {
    const list = view(name, 'versions')
    published.set(name, Array.isArray(list) ? list : typeof list === 'string' ? [list] : [])
  }
  return published.get(name)
}

/**
 * Every published `@deepseek-ai/dsh` version. The package exists, so npm
 * answering that it does not is a registry that is not answering — never a
 * reason to report a cell incomplete or to sweep nothing.
 */
export function harnessVersions() {
  const all = versionsOf(HARNESS)
  if (all.length === 0) throw new RegistryError(`npm lists no version of ${HARNESS} at all; the registry is not answering for it`)
  return all
}

/** Why a package is absent at a version: it did not exist yet, or upstream skipped it. */
export function absence(name, version) {
  const all = versionsOf(name)
  if (all.length === 0) return 'never published'
  return all.some((v) => semver.valid(v) && semver.lt(v, version)) ? 'skipped by upstream' : 'predates'
}

/**
 * How long the first, plain `npm install` of a train may take. Some early
 * trains make npm's peer resolution burn minutes of CPU before it settles or
 * gives up (0.1.1-rc.2 under npm 11); past this the install is retried the way
 * the harness itself installs, as on ERESOLVE.
 */
export const PEER_GRAPH_TIMEOUT_MS = 5 * 60_000

/** How long any other `npm install` of a train may take before it is killed. */
export const INSTALL_TIMEOUT_MS = 15 * 60_000

/**
 * Run one command; returns `{ ok, output, timedOut }` with stdout and stderr
 * joined. The command is killed (SIGKILL) once it runs longer than `timeout`.
 */
export function run(cwd, command, argv, extraEnv = {}, { timeout = INSTALL_TIMEOUT_MS } = {}) {
  const result = spawnSync(command, argv, {
    cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024, timeout, killSignal: 'SIGKILL',
  })
  const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL'
  const note = timedOut ? `\n${command} ${argv.join(' ')} was killed after ${Math.round(timeout / 1000)} s` : ''
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}${note}`, timedOut }
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
 * then conflict with the pinned one (ERESOLVE), or not settle for minutes. The
 * harness never runs that graph — `@deepseek-ai/dsh` pins every package
 * exactly — so when the peer graph fails to resolve (ERESOLVE, or a peer
 * npm cannot find) or has not settled within `graphTimeout`, the copy is
 * reinstalled through the train's own `@deepseek-ai/dsh` (legacy peer mode,
 * its exact pins providing the peers).
 *
 * The train is reported as published **incomplete** only when that fails too
 * and a bare install of `@deepseek-ai/dsh` at that version fails on the graph
 * itself (ERESOLVE, ETARGET, E404). A conflict this repository causes — the
 * bare install resolves — stays a failure, and so does anything that proves
 * nothing either way (a timeout, a script). A registry that did not answer
 * throws {@link RegistryError}.
 *
 * @returns {{ ok: boolean, incomplete: boolean, via: string, output: string, manifest: object }}
 */
export function installTrain(dir, manifest, version, { graphTimeout = PEER_GRAPH_TIMEOUT_MS, timeout = INSTALL_TIMEOUT_MS } = {}) {
  const fresh = () => {
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
    rmSync(join(dir, 'package-lock.json'), { force: true })
  }
  const flags = ['--ignore-scripts', '--no-audit', '--no-fund']
  const install = (argv, limit) => {
    const result = run(dir, 'npm', ['install', ...flags, ...argv], {}, { timeout: limit })
    if (!result.ok && registryFailed(result.output)) throw new RegistryError(`npm install in ${dir} could not reach the registry:\n${tail(result.output, 12)}`)
    return result
  }
  fresh()
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const first = install([], graphTimeout)
  if (first.ok) return { ok: true, incomplete: false, via: 'peer graph', output: first.output, manifest }
  if (!first.timedOut && !graphFailed(first.output)) return { ok: false, incomplete: false, via: 'peer graph', output: first.output, manifest }

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
  const second = install(['--legacy-peer-deps'], timeout)
  const why = first.timedOut ? `did not settle within ${Math.round(graphTimeout / 1000)} s`
    : /ERESOLVE/.test(first.output) ? 'hit ERESOLVE' : 'named a package npm cannot find'
  const via = `${HARNESS}@${version} graph (the peer graph ${why})`
  if (second.ok) return { ok: true, incomplete: false, via, output: second.output, manifest: shipped }
  const bare = bareHarnessInstalls(version)
  if (!bare.ok && registryFailed(bare.output)) throw new RegistryError(`npm could not reach the registry to install ${HARNESS}@${version} on its own:\n${tail(bare.output, 12)}`)
  return {
    ok: false,
    incomplete: !bare.ok && !bare.timedOut && graphFailed(bare.output),
    via,
    output: `${first.output}\n--- retry through ${HARNESS}@${version}:\n${second.output}\n--- bare ${HARNESS}@${version} ${bare.ok ? 'installs' : 'fails too'}:\n${tail(bare.output, 12)}`,
    manifest: shipped,
  }
}
