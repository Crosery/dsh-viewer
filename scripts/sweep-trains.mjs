/**
 * Typecheck and test this plugin against every published harness version.
 *
 *   node scripts/sweep-trains.mjs [--versions v1,v2] [--work DIR] [--markdown FILE] [--json FILE] [--reinstall]
 *
 * For each version of `@deepseek-ai/dsh` (all published ones unless
 * `--versions` narrows it) this builds a scratch copy of the repository whose
 * `@deepseek-ai/dsh-*` devDependencies — plus cordis and schemastery, taken
 * from that version's own `@deepseek-ai/dsh` manifest — are repointed at it,
 * installs the full peer graph, and runs both typechecks and the test suite.
 * The committed tree is never touched; `--work` defaults to a directory under
 * the system temp dir and is reused between runs, so a re-run only reinstalls
 * what changed (`--reinstall` forces it).
 *
 * Every version lands in one of these outcomes:
 *
 * - `pass` / `fail`: every harness package this plugin compiles against is
 *   published at that version, and the checks ran.
 * - `predates`: a package this plugin needs did not exist yet on that train
 *   (its first release is later) — the plugin cannot be built there as-is.
 * - `incomplete upstream`: the train itself is published incomplete — a
 *   package skipped at that version although it exists before and after it,
 *   or an install that fails with ERESOLVE because the train's own packages
 *   disagree (checked against a bare install of `@deepseek-ai/dsh` at the same
 *   version, so a conflict this repository causes is a `fail`, not upstream's).
 *
 * Early prereleases declare caret peers (`^0.1.1-rc.1`), so npm's automatic
 * peer install can drag in a LATER prerelease of the same tuple whose own peers
 * then conflict with the pinned one (ERESOLVE). The harness never runs that
 * graph — `@deepseek-ai/dsh` pins every package exactly — so on ERESOLVE the
 * scratch copy is reinstalled through the train's own `@deepseek-ai/dsh`
 * (legacy peer mode, its exact pins providing the peers), and the table says so.
 *
 * The peer-admission column applies the rule dsh >= 0.1.7 enforces before
 * installing or loading a plugin (every `@deepseek-ai/dsh*` peer satisfied
 * with prereleases included) and the default node-semver rule a package
 * manager applies; both must hold.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const work = resolve(option('--work') ?? join(tmpdir(), 'dsh-viewer-sweep'))
const reinstall = args.includes('--reinstall')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const harnessDeps = Object.keys(pkg.devDependencies).filter((name) => name.startsWith('@deepseek-ai/dsh-'))
const peers = Object.entries(pkg.peerDependencies ?? {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))

/** `npm view <spec> <field> --json`, or `undefined` when npm has nothing. */
function view(spec, field) {
  try {
    const out = execFileSync('npm', ['view', spec, field, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.trim() === '' ? undefined : JSON.parse(out)
  } catch {
    return undefined
  }
}

const published = new Map()
/** Every published version of one package. */
function versionsOf(name) {
  if (!published.has(name)) {
    const list = view(name, 'versions')
    published.set(name, Array.isArray(list) ? list : typeof list === 'string' ? [list] : [])
  }
  return published.get(name)
}

/** Why a package is absent at a version: it did not exist yet, or upstream skipped it. */
function absence(name, version) {
  const all = versionsOf(name)
  if (all.length === 0) return 'never published'
  return all.some((v) => semver.lt(v, version)) ? 'skipped by upstream' : 'predates'
}

/** Last lines of a command's combined output, for the report. */
function tail(text, lines = 6) {
  return text.trim().split('\n').slice(-lines).join('\n')
}

/** Run one command in a scratch copy; returns `{ ok, output }`. */
function run(cwd, command, argv, extraEnv = {}) {
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** The first TypeScript diagnostics in a typecheck's output. */
function diagnostics(output) {
  return output.split('\n').filter((line) => /error TS\d+/.test(line)).slice(0, 4).join('\n')
}

/** Whether `@deepseek-ai/dsh` itself resolves at a version, with nothing of ours involved. */
function bareHarnessInstalls(version) {
  const dir = join(work, '_bare', version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bare', version: '0.0.0', private: true }))
  const result = run(dir, 'npm', ['install', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${version}`])
  return { ok: result.ok, output: result.output }
}

/** Prepare (or reuse) the scratch copy for one version; returns the install outcome. */
function prepare(version) {
  const dir = join(work, version)
  const manifest = structuredClone(pkg)
  for (const name of harnessDeps) manifest.devDependencies[name] = version
  // The train's own cordis and schemastery, so a train that moved them is
  // compiled against what it actually ships.
  const harnessDependencies = view(`@deepseek-ai/dsh@${version}`, 'dependencies') ?? {}
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/schemastery']) {
    if (typeof harnessDependencies[name] === 'string') manifest.devDependencies[name] = harnessDependencies[name]
  }
  const wanted = JSON.stringify(manifest.devDependencies)
  const stamp = join(dir, '.sweep-installed')
  mkdirSync(dir, { recursive: true })
  // Source is refreshed on every run; the install only when the pins changed.
  for (const entry of ['src', 'tests', 'scripts']) {
    rmSync(join(dir, entry), { recursive: true, force: true })
    cpSync(join(root, entry), join(dir, entry), { recursive: true })
  }
  for (const file of ['tsconfig.json', 'tsconfig.client.json', 'cordis.patch.yml']) cpSync(join(root, file), join(dir, file))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  if (!reinstall && existsSync(stamp)) {
    const [pins, via = 'peer graph'] = readFileSync(stamp, 'utf8').split('\n')
    if (pins === wanted) return { ok: true, dir, reused: true, via, output: '' }
  }
  const fresh = () => {
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
    rmSync(join(dir, 'package-lock.json'), { force: true })
  }
  fresh()
  let result = run(dir, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'])
  let via = 'peer graph'
  if (!result.ok && /ERESOLVE/.test(result.output)) {
    // Early trains declare caret peers (`^0.1.1-rc.1`), so npm's automatic
    // peer install drags in a LATER prerelease whose own peers then conflict
    // with the pinned one. The harness never runs that graph: it pins every
    // package exactly. Install the train's own `@deepseek-ai/dsh` instead and
    // let its exact pins provide the peers, which is the graph a user runs.
    fresh()
    const shipped = structuredClone(manifest)
    shipped.devDependencies['@deepseek-ai/dsh'] = version
    // Legacy peer mode installs no peers at all, and some harness packages
    // reach others only as peers (dsh-tools → dsh-scope). Pin every such
    // harness peer the train published at exactly this version.
    for (const name of harnessDeps) {
      for (const peer of Object.keys(view(`${name}@${version}`, 'peerDependencies') ?? {})) {
        if (!peer.startsWith('@deepseek-ai/dsh') || peer in shipped.devDependencies) continue
        if (versionsOf(peer).includes(version)) shipped.devDependencies[peer] = version
      }
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(shipped, null, 2) + '\n')
    const second = run(dir, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'])
    if (second.ok) {
      result = second
      via = `@deepseek-ai/dsh@${version} graph (the peer graph hit ERESOLVE)`
    } else {
      result = { ok: false, output: `${result.output}\n--- retry through @deepseek-ai/dsh@${version}:\n${second.output}` }
    }
  }
  if (result.ok) writeFileSync(stamp, `${wanted}\n${via}`)
  return { ...result, dir, reused: false, via }
}

const requested = option('--versions')?.split(',').map((v) => v.trim()).filter(Boolean)
const versions = (requested ?? versionsOf('@deepseek-ai/dsh')).filter((v) => semver.valid(v)).sort(semver.compare)
mkdirSync(work, { recursive: true })

const rows = []
for (const version of versions) {
  const row = { version, admitted: true, refusedBy: [], missing: [], outcome: '', host: '', client: '', tests: '', detail: '' }
  for (const [name, range] of peers) {
    if (!semver.satisfies(version, range, { includePrerelease: true }) || !semver.satisfies(version, range)) {
      row.admitted = false
      row.refusedBy.push(name)
    }
  }
  row.missing = harnessDeps.filter((name) => !versionsOf(name).includes(version)).map((name) => `${name.replace('@deepseek-ai/', '')} (${absence(name, version)})`)
  process.stderr.write(`[sweep] ${version}: `)

  if (row.missing.length > 0) {
    const skipped = row.missing.some((entry) => entry.includes('skipped by upstream'))
    row.outcome = skipped ? 'incomplete upstream' : 'predates'
    row.detail = `not published at ${version}: ${row.missing.join(', ')}`
    process.stderr.write(`${row.outcome}\n`)
    rows.push(row)
    continue
  }

  const install = prepare(version)
  if (!install.ok) {
    const eresolve = /ERESOLVE/.test(install.output)
    const bare = eresolve ? bareHarnessInstalls(version) : undefined
    row.outcome = eresolve && bare?.ok === false ? 'incomplete upstream' : 'fail'
    row.detail = eresolve
      ? `ERESOLVE installing the repointed graph; bare @deepseek-ai/dsh@${version} ${bare?.ok ? 'installs' : 'fails too'}: ${tail(install.output, 3).replace(/\n/g, ' ')}`
      : `install failed: ${tail(install.output, 3).replace(/\n/g, ' ')}`
    process.stderr.write(`${row.outcome}\n`)
    rows.push(row)
    continue
  }

  const host = run(install.dir, 'npx', ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.json'])
  const client = run(install.dir, 'npx', ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.client.json'])
  const tests = run(install.dir, process.execPath, ['--test', ...readdirTests(install.dir)])
  row.host = host.ok ? 'ok' : 'FAIL'
  row.client = client.ok ? 'ok' : 'FAIL'
  const counts = /ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(tests.output)
  row.tests = counts === null ? (tests.ok ? 'ok' : 'FAIL') : `${counts[1]}/${Number(counts[1]) + Number(counts[2])}`
  row.outcome = host.ok && client.ok && tests.ok ? 'pass' : 'fail'
  const problems = [
    host.ok ? '' : `host: ${diagnostics(host.output) || tail(host.output)}`,
    client.ok ? '' : `client: ${diagnostics(client.output) || tail(client.output)}`,
    tests.ok ? '' : `tests: ${tail(tests.output.split('\n').filter((l) => /✖|not ok|Error/.test(l)).join('\n') || tests.output)}`,
  ].filter(Boolean)
  row.detail = [install.via === 'peer graph' ? '' : `installed via ${install.via}`, ...problems].filter(Boolean).join(' | ').replace(/\n/g, ' ')
  process.stderr.write(`${row.outcome}${install.reused ? ' (reused install)' : ''}\n`)
  rows.push(row)
}

/** Test files of a scratch copy, in a stable order. */
function readdirTests(dir) {
  return execFileSync('ls', [join(dir, 'tests')], { encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.test.ts')).sort().map((f) => join('tests', f))
}

const markdown = [
  '| dsh version | peers admit | outcome | host tsc | client tsc | tests | detail |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.version} | ${r.admitted ? 'yes' : `NO (${r.refusedBy.length})`} | ${r.outcome} | ${r.host || '—'} | ${r.client || '—'} | ${r.tests || '—'} | ${r.detail.replace(/\|/g, '\\|') || ''} |`),
].join('\n')
console.log(markdown)
if (option('--markdown')) writeFileSync(option('--markdown'), markdown + '\n')
if (option('--json')) writeFileSync(option('--json'), JSON.stringify(rows, null, 2) + '\n')
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Harness sweep\n\n${markdown}\n`, { flag: 'a' })
process.exit(rows.some((r) => r.outcome === 'fail' || (r.outcome === 'pass' && !r.admitted)) ? 1 : 0)
