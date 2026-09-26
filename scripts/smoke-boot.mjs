/**
 * Boot smoke: does the packed plugin install into a real dsh profile, activate
 * its Host half, and get its browser half served by the running Web server?
 *
 * Typecheck and unit tests answer "does the source still compile against the
 * train's types". They cannot see the things that actually stop a user:
 *
 * - dsh ≥0.1.7 refuses a plugin whose `@deepseek-ai/dsh*` peer ranges do not
 *   admit the running version (`evaluatePluginCompatibility` in dsh-app-boot,
 *   prerelease-inclusive). `dsh plugin add` rolls the install back; an
 *   already-installed plugin is skipped at boot with one stderr line while the
 *   Web UI comes up fine — the plugin is simply absent. That is how v0.1.1 of
 *   this plugin "could not display anything" on the 0.1.7 desktop app.
 * - a Host entry that throws or waits on a service the composition lacks is
 *   reported by the startup audit as "did not activate" (fatal on 0.1.1, a
 *   warning on 0.1.7 — the server still starts).
 * - a browser half that is not in `window.__DSH_BOOT__`, is not served, or
 *   requires a specifier the shell's module table cannot answer, or reads a
 *   named export a harness seed module no longer has.
 *
 * Stages, in order: harness → pnpm → install → boot → host-activation →
 * client-graph → client-load → client-exports.
 *
 * Everything runs in a throwaway DSH_HOME under the OS temp directory; the
 * script refuses any other home, so running it on a workstation cannot touch a
 * real profile. The session token `dsh` prints is masked in Actions and never
 * logged.
 *
 * Usage:
 *   node scripts/smoke-boot.mjs --dsh <exact version>          # installs @deepseek-ai/dsh from npm
 *   node scripts/smoke-boot.mjs --harness-dir <dir>            # <dir>/node_modules/@deepseek-ai/dsh, e.g. the
 *                                                              # desktop app's Contents/Resources/app.asar/dsh,
 *                                                              # run with that app's binary and ELECTRON_RUN_AS_NODE=1
 *   [--graph released|today]  with --dsh: resolve the harness's floating
 *                           dependencies as of its release — before the next
 *                           @deepseek-ai/dsh was published (default) — or as
 *                           of today. The cordis family floats under every
 *                           train, and its 2026-09-22 releases broke a fresh
 *                           `npm i @deepseek-ai/dsh@0.1.1-rc.2`, with or
 *                           without any plugin; `released` keeps a train's
 *                           smoke about the plugin, not about that drift.
 *   [--tarball <path>]      install this tarball instead of packing the checkout
 *   [--pnpm-version <v>]    pnpm `dsh plugin` drives (default: the desktop runtime's, else 11.7.0)
 *   [--timeout-ms <n>]      how long `dsh web` may take to announce its URL (default 240 s)
 *   [--install-timeout-ms <n>]  how long the plain `npm install` of the harness may
 *                           take before legacy peer mode is used instead (default 120 s)
 *   [--keep]
 *   [--accept-risk]         diagnostic only: grant the exact-version exemption
 *                           first, to separate "peer range too narrow" from
 *                           "code broken". Never a gate.
 *
 * Appends one JSON line to $SMOKE_RESULT and a section to $GITHUB_STEP_SUMMARY.
 * Exit 0 passed, 1 failed.
 */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import vm from 'node:vm'
import { bootGraphOf, classifyDiagnostics, exportedNames, maskTokens as mask, membersRead, moduleTableOf, publishedTooLate, unmetPeers } from './smoke-lib.mjs'

const { values } = parseArgs({
  options: {
    dsh: { type: 'string' },
    'harness-dir': { type: 'string' },
    tarball: { type: 'string' },
    graph: { type: 'string', default: 'released' },
    'pnpm-version': { type: 'string' },
    'accept-risk': { type: 'boolean', default: false },
    'timeout-ms': { type: 'string', default: '240000' },
    'install-timeout-ms': { type: 'string', default: '120000' },
    keep: { type: 'boolean', default: false },
  },
})
const root = fileURLToPath(new URL('..', import.meta.url))
/** The manifest of what is installed: the given tarball's, or the checkout's. */
const pkg = JSON.parse(values.tarball === undefined
  ? readFileSync(join(root, 'package.json'), 'utf8')
  : spawnSync('tar', ['-xzOf', resolve(values.tarball), 'package/package.json'], { encoding: 'utf8' }).stdout)
const timeoutMs = Number(values['timeout-ms'])
/** pnpm 10 answers `dsh plugin add` with ERR_PNPM_ADDING_TO_ROOT; the desktop runtime ships 11.7.0. */
const DEFAULT_PNPM = '11.7.0'

const work = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-smoke-')))
const home = join(work, 'home')
assert.ok(home.startsWith(realpathSync(tmpdir())) && !home.startsWith(join(homedir(), '.dsh')), 'refusing a non-temporary DSH_HOME')
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', FORCE_COLOR: '0' }
const result = { plugin: `${pkg.name}@${pkg.version}`, dsh: undefined, runtime: undefined, strict: !values['accept-risk'], stages: {} }

function stage(name, outcome, detail) {
  result.stages[name] = { outcome, ...(detail === undefined ? {} : { detail }) }
  const shown = detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
  console.log(`${outcome === 'passed' ? 'ok' : outcome.toUpperCase()}  ${name}${mask(shown)}`)
}

class StageFailed extends Error {}
function fail(name, detail) {
  stage(name, 'failed', detail)
  throw new StageFailed(name)
}

/** How long any one command may run: a hung install fails its stage instead of the job's clock. */
const COMMAND_TIMEOUT_MS = 10 * 60_000

function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL', ...options })
  if (r.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} exited ${r.status ?? r.signal}\n${mask((r.stderr || r.stdout || r.error?.message || '').slice(-4000))}`)
  }
  return r
}

async function freePort() {
  return new Promise((ok, reject) => {
    const server = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => ok(port))
    })
  })
}

const diagnostics = (stderr) => classifyDiagnostics(stderr, pkg.name)

/** The directory of an installed package, resolved the way `from` would resolve it. */
function packageDir(from, name) {
  const lookup = createRequire(from)
  return (lookup.resolve.paths(name) ?? []).map((base) => join(base, name)).find((dir) => existsSync(join(dir, 'package.json')))
}

/**
 * When `version` stopped being the newest `@deepseek-ai/dsh` on npm: the
 * publish time of the next release, or `undefined` for the newest one.
 */
function supersededAt(version) {
  const times = JSON.parse(run('npm', ['view', '@deepseek-ai/dsh', 'time', '--json']).stdout)
  const own = times[version]
  if (own === undefined) fail('harness', `@deepseek-ai/dsh@${version} is not on npm`)
  const later = Object.entries(times)
    .filter(([key, at]) => key !== 'created' && key !== 'modified' && at > own)
    .map(([, at]) => at)
    .sort()
  return later[0]
}

/** When one version of a package was published, or `undefined`. */
function publishedAt(name, version) {
  const r = run('npm', ['view', name, 'time', '--json'], { allowFailure: true })
  try { return JSON.parse(r.stdout)[version] } catch { return undefined }
}

/**
 * A `--before` later than `before` when npm refused one of the train's own
 * packages as not yet published then. Upstream sometimes publishes a train's
 * package after the next @deepseek-ai/dsh (0.1.5-rc.3's
 * sidebar-documentpreview came 6 h later): the release became installable
 * only then.
 */
function laterCutoff(output, before) {
  const late = publishedTooLate(output)
  if (before === undefined || late === undefined) return undefined
  const at = publishedAt(late.name, late.version)
  return at !== undefined && at >= before ? new Date(Date.parse(at) + 1000).toISOString() : undefined
}

/** An empty project to install the harness into. */
function freshProject(dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'harness', version: '0.0.0', private: true }))
}

/**
 * Install `spec` into `dir` the way a user gets it, and say how.
 *
 * As released (`--graph released`, the default): `--before` the next harness
 * publication, moved later if the train's own packages went out after it. The
 * plain peer graph first; early prereleases carry caret peers that pull a
 * later prerelease of the same tuple, and npm then either answers ERESOLVE or
 * — 0.1.1-rc.2 under npm 11 — burns minutes of CPU before it settles (one CI
 * floor cell took 653 s). @deepseek-ai/dsh lists every package it composes as
 * a dependency, so legacy peer mode plus the peers it leaves unmet, each at
 * its declared range, is the same harness.
 */
function installHarness(spec, dir) {
  let before
  if (values.graph === 'released') before = supersededAt(values.dsh)
  else if (values.graph !== 'today') fail('harness', `--graph must be released or today, not ${values.graph}`)
  const common = () => ['install', '--prefix', dir, '--no-audit', '--no-fund', ...(before === undefined ? [] : ['--before', before])]
  const describe = (how) => `npm install${before === undefined ? '' : ` --before ${before} (as released)`}${how}`
  const limit = Number(values['install-timeout-ms'])
  const failed = (what, r) => `${what} ${r.status === null ? `was killed (${r.signal ?? r.error?.code})` : `exited ${r.status}`}: ${mask(`${r.stdout}${r.stderr}`.slice(-2000))}`

  for (let attempt = 0; attempt < 8; attempt += 1) {
    freshProject(dir)
    const first = run('npm', [...common(), spec], { allowFailure: true, timeout: limit })
    if (first.status === 0) return describe('')
    const later = laterCutoff(`${first.stdout}${first.stderr}`, before)
    if (later !== undefined) { before = later; continue }
    const settled = first.error?.code !== 'ETIMEDOUT' && first.signal === null
    if (settled && !/ERESOLVE/.test(`${first.stdout}${first.stderr}`)) fail('harness', failed(`npm install ${spec}`, first))

    freshProject(dir)
    const legacy = run('npm', [...common(), '--legacy-peer-deps', spec], { allowFailure: true })
    if (legacy.status !== 0) {
      // A plain install that timed out never got as far as naming a late package.
      const again = laterCutoff(`${legacy.stdout}${legacy.stderr}`, before)
      if (again !== undefined) { before = again; continue }
      fail('harness', failed(`npm install --legacy-peer-deps ${spec}`, legacy))
    }
    let added = 0
    for (let round = 0; round < 8; round += 1) {
      const unmet = unmetPeers(join(dir, 'node_modules'))
      if (unmet.size === 0) break
      added += unmet.size
      const peers = run('npm', [...common(), '--legacy-peer-deps', ...[...unmet].map(([name, range]) => `${name}@${range}`)], { allowFailure: true })
      if (peers.status !== 0) fail('harness', failed(`npm install --legacy-peer-deps ${[...unmet.keys()].join(' ')}`, peers))
    }
    const left = unmetPeers(join(dir, 'node_modules'))
    if (left.size > 0) fail('harness', `peers still unmet after legacy install: ${[...left.keys()].join(', ')}`)
    return describe(` --legacy-peer-deps + ${added} unmet peers at their ranges (the peer graph ${settled ? 'hit ERESOLVE' : `did not settle within ${Math.round(limit / 1000)} s`})`)
  }
  fail('harness', `npm install ${spec} kept refusing its own packages as unpublished before ${before}`)
}

/** Boot `dsh --profile web` in `dshHome`; resolves once the URL is printed and survived, or it failed. */
async function boot(dshBin, dshHome) {
  const port = await freePort()
  const proc = spawn(process.execPath, [dshBin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
    env: { ...env, DSH_HOME: dshHome }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  const io = { stdout: '', stderr: '' }
  proc.stdout.setEncoding('utf8').on('data', (s) => { io.stdout += s })
  proc.stderr.setEncoding('utf8').on('data', (s) => { io.stderr += s })
  const exited = new Promise((ok) => proc.once('exit', (code, signal) => ok({ code, signal })))
  // Unreferenced: a race's losing timer must not hold the process open for
  // the whole boot timeout after the smoke is done.
  const sleep = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms).unref())
  let waiting = true
  let outcome = await Promise.race([
    (async () => { while (waiting && !/^dsh web: https?:\/\//m.test(io.stdout)) await sleep(250); return 'url' })(),
    exited.then(() => 'exit'),
    sleep(timeoutMs, 'timeout'),
  ])
  waiting = false
  // Up to 0.1.1 the URL is printed before the startup audit, which then exits
  // the process on an entry that did not activate. Give it time to.
  if (outcome === 'url') outcome = await Promise.race([exited.then(() => 'exit after url'), sleep(5000, 'url')])
  return { proc, port, outcome, io }
}

async function stop(proc) {
  if (proc === undefined || proc.exitCode !== null || proc.signalCode !== null) return
  try { process.kill(-proc.pid, 'SIGINT') } catch {}
  const stopped = await Promise.race([new Promise((r) => proc.once('exit', () => r(true))), new Promise((r) => setTimeout(() => r(false), 15000).unref())])
  if (!stopped) try { process.kill(-proc.pid, 'SIGKILL') } catch {}
}

let child
try {
  // 1. The harness under test.
  let dshBin
  let harnessRoot
  if (values['harness-dir'] !== undefined) {
    harnessRoot = resolve(values['harness-dir'])
    dshBin = join(harnessRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const runtimeFile = join(harnessRoot, 'desktop-runtime.json')
    if (existsSync(runtimeFile)) {
      const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'))
      result.runtime = { release: runtime.release?.version, node: runtime.release?.nodeVersion, pnpm: runtime.release?.pnpmVersion, executingNode: process.versions.node }
    }
  } else {
    assert.ok(values.dsh, '--dsh <exact version> or --harness-dir is required')
    harnessRoot = join(work, 'harness')
    result.install = installHarness(`@deepseek-ai/dsh@${values.dsh}`, harnessRoot)
    dshBin = join(harnessRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  }
  if (!existsSync(dshBin)) fail('harness', `no dsh entry at ${dshBin}`)
  const dshManifest = join(dshBin, '../../package.json')
  result.dsh = JSON.parse(readFileSync(dshManifest, 'utf8')).version
  if (values.dsh !== undefined && result.dsh !== values.dsh) fail('harness', `asked for ${values.dsh}, installed ${result.dsh}`)
  if (result.runtime?.release !== undefined && result.runtime.release !== result.dsh) {
    fail('harness', `desktop-runtime.json says ${result.runtime.release} but the bundled @deepseek-ai/dsh is ${result.dsh}`)
  }
  stage('harness', 'passed', `@deepseek-ai/dsh@${result.dsh} on node ${process.versions.node}${result.runtime ? ` (desktop runtime ${result.runtime.release})` : ''}${result.install ? `, ${result.install}` : ''}`)
  const dsh = (args, options) => run(process.execPath, [dshBin, ...args], options)

  // 2. pnpm — `dsh plugin` forwards to whatever `pnpm` is on PATH.
  const wantedPnpm = values['pnpm-version'] ?? result.runtime?.pnpm ?? DEFAULT_PNPM
  const pnpmVersion = () => {
    const r = spawnSync('pnpm', ['--version'], { encoding: 'utf8', env })
    return r.status === 0 ? r.stdout.trim() : undefined
  }
  let pnpm = pnpmVersion()
  if (pnpm !== wantedPnpm) {
    const prefix = join(work, 'pnpm')
    run('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--no-save', `pnpm@${wantedPnpm}`])
    env.PATH = `${join(prefix, 'node_modules/.bin')}${delimiter}${env.PATH}`
    pnpm = pnpmVersion()
  }
  if (pnpm !== wantedPnpm) fail('pnpm', `wanted pnpm ${wantedPnpm}, PATH answers ${pnpm ?? 'nothing'}`)
  stage('pnpm', 'passed', pnpm)

  // 3. The artifact a user installs: the committed dist, packed.
  let tarball = values.tarball && resolve(values.tarball)
  if (tarball === undefined) {
    const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: root }).stdout)[0]
    tarball = join(work, packed.filename)
  }
  result.tarball = tarball.startsWith(work) ? 'packed from the checkout' : tarball

  // 4. Install through the official command, so the version gate runs.
  if (values['accept-risk']) {
    const allow = dsh(['plugin', '--profile', 'web', 'allow-version', `${pkg.name}@${pkg.version}`, '--dsh-version', result.dsh, '--accept-risk'], { allowFailure: true })
    console.log(allow.status === 0 ? 'diagnostic run: granted an exact-version exemption' : 'diagnostic run: this harness has no version gate to exempt from')
  }
  const add = dsh(['plugin', '--profile', 'web', 'add', tarball], { allowFailure: true })
  if (add.status !== 0) {
    const found = diagnostics(add.stderr)
    fail('install', found.ours.length > 0 ? found.ours : mask(`${add.stderr}${add.stdout}`.slice(-2000)))
  }
  stage('install', 'passed', values['accept-risk'] ? 'with an exact-version exemption (diagnostic run, not a gate)' : 'strict: no exemption')

  // 5. Boot the Web profile and wait for the URL line — from 0.1.7 printed
  //    only after the loader settled and the startup audit ran.
  const booted = await boot(dshBin, home)
  child = booted.proc
  const { stdout, stderr } = booted.io
  const url = /^dsh web: (https?:\/\/\S+)/m.exec(stdout)?.[1]
  const token = url === undefined ? null : new URL(url).searchParams.get('token')
  if (token && process.env.GITHUB_ACTIONS) console.log(`::add-mask::${token}`)
  await new Promise((r) => setTimeout(r, 1500)) // let the audit's stderr land
  const found = diagnostics(booted.io.stderr)
  if (booted.outcome !== 'url') {
    // Tell "this plugin breaks the boot" from "this harness does not boot":
    // the same harness, a home without the plugin.
    await stop(child)
    const bare = await boot(dshBin, join(work, 'bare-home'))
    await stop(bare.proc)
    fail('boot', {
      reason: booted.outcome,
      withoutThisPlugin: bare.outcome === 'url' ? 'boots — the failure is this plugin\'s' : `fails too (${bare.outcome}) — the harness itself does not boot`,
      diagnostics: found.ours,
      stderrTail: mask(stderr).slice(-3000),
    })
  }
  stage('boot', 'passed', `port ${booted.port}`)
  if (found.ours.length > 0) fail('host-activation', found.ours)
  if (found.others.length > 0) console.log(`note: entries outside this plugin did not activate on this train:\n  ${found.others.join('\n  ')}`)
  stage('host-activation', 'passed', found.others.length > 0 ? `other entries did not activate: ${found.others.length} line(s), see log` : undefined)

  // 6. Browser half: authenticated index, boot graph, served bundle.
  const first = await fetch(url, { redirect: 'manual' })
  const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0]
  const headers = cookie ? { cookie } : {}
  const base = new URL('/', url)
  const index = first.status === 200 ? first : await fetch(base, { headers })
  if (index.status !== 200) fail('client-graph', `the index answered ${index.status} after the token exchange (${first.status})`)
  const html = await index.text()
  const graph = bootGraphOf(html)
  if (graph === undefined) fail('client-graph', 'the index carries no __DSH_BOOT__ graph')
  const entries = new Map(graph.entries.map((e) => [e.id, e]))
  const entry = entries.get(pkg.name)
  if (entry === undefined) fail('client-graph', `${pkg.name} is not in __DSH_BOOT__ (${graph.entries.length} entries)`)
  const absent = (pkg.dsh?.client?.inject ?? []).filter((name) => !entries.has(name))
  if (absent.length > 0) fail('client-graph', `dsh.client.inject names services this train does not ship: ${absent.join(', ')}`)
  stage('client-graph', 'passed', `${graph.entries.length} entries; this plugin and its inject targets present`)

  // The shell's own module table: the specifiers a client bundle may require
  // without a graph row. Read from the served shell, never assumed — 0.1.1
  // answers 7, 0.1.7 answers 9.
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1])
  let table
  for (const asset of assets) {
    const res = await fetch(new URL(asset, base), { headers })
    if (!res.ok) continue
    table = moduleTableOf(await res.text())
    if (table !== undefined) { result.moduleTable = { asset: asset.replace(/^.*\//, ''), specifiers: table }; break }
  }
  if (table === undefined) fail('client-load', `no static module table found in the shell's scripts (${assets.join(', ') || 'none'}); smoke-boot.mjs needs to learn this train's shell`)

  const bundle = await fetch(new URL(entry.url, base), { headers })
  if (bundle.status !== 200) fail('client-load', `the bundle answered ${bundle.status}`)
  const source = await bundle.text()
  const factories = new Map()
  const window = { __ModuleLoader__: { load: (row) => factories.set(row.id, row.factory) } }
  vm.runInNewContext(source, { window, globalThis: window, console })
  if (factories.size !== 1 || !factories.has(pkg.name)) fail('client-load', `the served script registered ${JSON.stringify([...factories.keys()])}, not exactly ${pkg.name}`)
  const inert = () => new Proxy(function () {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : key === '__esModule' ? true : inert()),
    apply: () => inert(),
    construct: () => inert(),
  })
  const requested = new Set()
  const misses = []
  let exported
  try {
    exported = factories.get(pkg.name)((spec) => {
      requested.add(spec)
      const id = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
      if (table.includes(spec) || entries.has(id)) return inert()
      misses.push(spec)
      throw new Error(`require("${spec}") misses the module table`)
    })
  } catch (error) {
    fail('client-load', misses.length > 0 ? `requires specifiers this shell cannot answer: ${misses.join(', ')}` : `the factory threw: ${String(error?.message ?? error).slice(0, 500)}`)
  }
  const plugin = exported?.default ?? exported
  if (typeof plugin?.apply !== 'function' && typeof plugin !== 'function') fail('client-load', 'the factory exported no cordis plugin (no apply)')
  stage('client-load', 'passed', `factory evaluated against a ${table.length}-specifier module table; requires ${[...requested].join(', ')}`)

  // 7. Named members the bundle reads off harness seed modules must exist in
  //    this train. esbuild keeps `import_<pkg>N.Member` reads lazy, so a
  //    renamed export materializes fine and only crashes at render — as
  //    `undefined` handed to React, which removes the slot entry.
  const missingMembers = {}
  const unchecked = []
  let readsSeeds = false
  for (const [binding, name] of [
    ['dsh_client_ui_primitives', 'dsh-client-ui-primitives'],
    ['dsh_client_ui_slots', 'dsh-client-ui-slots'],
    ['dsh_client_store', 'dsh-client-store'],
    ['dsh_client_ui_dockkit', 'dsh-client-ui-dockkit'],
    ['cordis', 'cordis'],
  ]) {
    const used = membersRead(source, binding)
    if (used.size === 0) continue
    readsSeeds = true
    // Up to 0.1.1 the shell bundles some seeds instead of installing them.
    const dir = packageDir(dshManifest, `@deepseek-ai/${name}`)
    if (dir === undefined) { unchecked.push(`@deepseek-ai/${name}`); continue }
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const main = manifest.exports?.['.']?.browser ?? manifest.exports?.['.']?.default ?? manifest.exports?.['.'] ?? manifest.main
    const text = readFileSync(join(dir, typeof main === 'string' ? main : 'lib/index.js'), 'utf8')
    const names = exportedNames(text)
    if (names === undefined) { unchecked.push(`@deepseek-ai/${name} (re-exports *)`); continue }
    const missing = [...used].filter((member) => !names.has(member))
    if (missing.length > 0) missingMembers[`@deepseek-ai/${name}`] = missing
  }
  if (Object.keys(missingMembers).length > 0) fail('client-exports', missingMembers)
  stage('client-exports', 'passed', unchecked.length > 0 ? `not installed with this harness, unchecked: ${unchecked.join(', ')}` : readsSeeds ? 'every seed member read is exported' : 'reads no named member of a harness seed module')
} catch (error) {
  if (!(error instanceof StageFailed)) stage('smoke', 'failed', mask(String(error?.message ?? error)).slice(0, 2000))
} finally {
  await stop(child)
  if (!values.keep) rmSync(work, { recursive: true, force: true })
  else console.log(`kept ${work} (holds a session secret under home/; delete it when done)`)
  const failed = Object.values(result.stages).some((s) => s.outcome === 'failed')
  result.outcome = failed ? 'failed' : 'passed'
  console.log(`boot smoke: ${result.plugin} on dsh ${result.dsh ?? '?'} — ${result.outcome}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Boot smoke: ${result.plugin} on dsh ${result.dsh ?? '?'} — ${result.outcome}${result.strict ? '' : ' (diagnostic, --accept-risk)'}`, '',
      ...Object.entries(result.stages).map(([name, s]) => `- **${name}**: ${s.outcome}${s.detail === undefined ? '' : ` — \`${mask(JSON.stringify(s.detail)).slice(0, 800).replace(/`/g, "'")}\``}`), '',
    ].join('\n'))
  }
  if (process.env.SMOKE_RESULT) appendFileSync(process.env.SMOKE_RESULT, JSON.stringify(result) + '\n')
  process.exitCode = failed ? 1 : 0
}
