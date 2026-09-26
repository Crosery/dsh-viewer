/**
 * Typecheck and test this plugin against every published harness version.
 *
 *   node scripts/sweep-trains.mjs [--versions v1,v2] [--work DIR] [--markdown FILE] [--json FILE] [--reinstall]
 *
 * For each version of `@deepseek-ai/dsh` (all published ones unless
 * `--versions` narrows it) this builds a scratch copy of the repository whose
 * `@deepseek-ai/dsh-*` devDependencies — plus cordis and schemastery, taken
 * from that version's own `@deepseek-ai/dsh` manifest — are repointed at it,
 * with every other devDependency pinned to what package-lock.json resolved,
 * installs the full peer graph, and runs both typechecks and the test suite.
 * The committed tree is never touched; `--work` defaults to a directory under
 * the system temp dir and is reused between runs, so a re-run only reinstalls
 * what changed (`--reinstall` forces it).
 *
 * A harness devDependency the train never published keeps this repository's
 * pin, and the row names it (`dsh-client-ui-renderer` before 0.1.0-rc.8): the
 * pin supplies types, and whether the plugin runs there is the boot smoke's
 * question. Where the train publishes `dsh-client-runtime` (up to
 * 0.1.1-rc.2) it is added at exactly that version, because the early client
 * packages reach it only as a caret peer.
 *
 * Every version lands in one of these outcomes:
 *
 * - `pass` / `fail`: installed, and both typechecks and the suite ran.
 * - `incomplete upstream`: `@deepseek-ai/dsh` at that version does not install
 *   on its own — npm answers E404, ETARGET or ERESOLVE for the train's own
 *   graph, with nothing of ours involved (0.0.1-rc.1 and rc.2 depend on a
 *   `dsh-agent-tool-mode` that was never published) — or the repointed copy
 *   fails and so does that bare install. Types and tests still run on such a
 *   train when every package this plugin compiles against was published on
 *   it, and are shown, not judged.
 * - `registry error`: npm did not answer for this version (a refused
 *   connection, a timeout, a 5xx). Nothing is known about it, so it fails the
 *   sweep rather than passing as `incomplete upstream`.
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
 * manager applies; both must hold, on every version, installable or not.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { harnessInstallable, harnessPeers, harnessVersions, HARNESS, installTrain, RegistryError, refusals, repointManifest, run, tail } from './harness-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const work = resolve(option('--work') ?? join(tmpdir(), 'dsh-viewer-sweep'))
const reinstall = args.includes('--reinstall')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const peers = harnessPeers(pkg)

/** The first TypeScript diagnostics in a typecheck's output. */
function diagnostics(output) {
  return output.split('\n').filter((line) => /error TS\d+/.test(line)).slice(0, 4).join('\n')
}

/** Prepare (or reuse) the scratch copy for one version; returns the install outcome. */
function prepare(version, manifest) {
  const dir = join(work, version)
  const wanted = JSON.stringify(manifest.devDependencies)
  const stamp = join(dir, '.sweep-installed')
  mkdirSync(dir, { recursive: true })
  // Source is refreshed on every run; the install only when the pins changed.
  for (const entry of ['src', 'tests', 'scripts']) {
    rmSync(join(dir, entry), { recursive: true, force: true })
    cpSync(join(root, entry), join(dir, entry), { recursive: true })
  }
  for (const file of ['tsconfig.json', 'tsconfig.client.json', 'cordis.patch.yml']) cpSync(join(root, file), join(dir, file))
  if (!reinstall && existsSync(stamp)) {
    const [pins, via = 'peer graph', installed] = readFileSync(stamp, 'utf8').split('\n')
    if (pins === wanted) {
      // Keep the manifest the reused install was made from.
      writeFileSync(join(dir, 'package.json'), installed ?? JSON.stringify(manifest, null, 2) + '\n')
      return { ok: true, dir, reused: true, via, output: '' }
    }
  }
  const result = installTrain(dir, manifest, version)
  if (result.ok) writeFileSync(stamp, `${wanted}\n${result.via}\n${JSON.stringify(result.manifest)}`)
  return { ...result, dir, reused: false }
}

const requested = option('--versions')?.split(',').map((v) => v.trim()).filter(Boolean)
let versions
try {
  versions = (requested ?? harnessVersions()).filter((v) => semver.valid(v)).sort(semver.compare)
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exit(1)
}
mkdirSync(work, { recursive: true })

const rows = []
for (const version of versions) {
  const row = { version, admitted: true, refusedBy: [], kept: [], outcome: '', host: '', client: '', tests: '', detail: '' }
  row.refusedBy = refusals(version, peers).map((r) => r.name)
  row.admitted = row.refusedBy.length === 0
  try {
    sweep(version, row)
  } catch (error) {
    if (!(error instanceof RegistryError)) throw error
    row.outcome = 'registry error'
    row.detail = error.message.split('\n')[0]
    process.stderr.write(`${row.outcome}\n`)
  }
  rows.push(row)
}

/** Settle one version's row: installed and checked, or incomplete upstream with the evidence. */
function sweep(version, row) {
  process.stderr.write(`[sweep] ${version}: `)
  const { manifest, kept } = repointManifest(pkg, version, lock)
  row.kept = kept.map((k) => `${k.name.replace('@deepseek-ai/', '')}@${k.pin} (${k.why})`)
  const notes = []

  let own
  try {
    own = harnessInstallable(version)
  } catch (error) {
    // Timed out, or failed for no reason npm names: proves nothing either way.
    if (error instanceof RegistryError) throw error
    row.outcome = 'fail'
    row.detail = String(error?.message ?? error).split('\n')[0]
    process.stderr.write(`${row.outcome}\n`)
    return
  }
  if (!own.ok) {
    row.outcome = 'incomplete upstream'
    notes.push(`${HARNESS}@${version} does not install on its own: ${own.evidence}`)
    if (kept.length > 0) {
      notes.push(`types and tests not run: not published at ${version}: ${kept.map((k) => k.name.replace('@deepseek-ai/', '')).join(', ')}`)
      row.detail = notes.join(' | ').replace(/\n/g, ' ')
      process.stderr.write(`${row.outcome}\n`)
      return
    }
  }

  const install = prepare(version, manifest)
  if (!install.ok) {
    if (row.outcome !== 'incomplete upstream') row.outcome = install.incomplete ? 'incomplete upstream' : 'fail'
    notes.push(/ERESOLVE/.test(install.output)
      ? `ERESOLVE installing the repointed graph, also through ${HARNESS}@${version}: ${tail(install.output, 3)}`
      : `install failed: ${tail(install.output, 3)}`)
    row.detail = notes.join(' | ').replace(/\n/g, ' ')
    process.stderr.write(`${row.outcome}\n`)
    return
  }

  const host = run(install.dir, 'npx', ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.json'])
  const client = run(install.dir, 'npx', ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.client.json'])
  const tests = run(install.dir, process.execPath, ['--test', ...readdirTests(install.dir)])
  row.host = host.ok ? 'ok' : 'FAIL'
  row.client = client.ok ? 'ok' : 'FAIL'
  const counts = /ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(tests.output)
  row.tests = counts === null ? (tests.ok ? 'ok' : 'FAIL') : `${counts[1]}/${Number(counts[1]) + Number(counts[2])}`
  // On a train that does not install, the checks are shown, not judged.
  if (row.outcome !== 'incomplete upstream') row.outcome = host.ok && client.ok && tests.ok ? 'pass' : 'fail'
  const problems = [
    host.ok ? '' : `host: ${diagnostics(host.output) || tail(host.output)}`,
    client.ok ? '' : `client: ${diagnostics(client.output) || tail(client.output)}`,
    tests.ok ? '' : `tests: ${tail(tests.output.split('\n').filter((l) => /✖|not ok|Error/.test(l)).join('\n') || tests.output)}`,
  ].filter(Boolean)
  row.detail = [...notes, install.via === 'peer graph' ? '' : `installed via ${install.via}`, ...problems].filter(Boolean).join(' | ').replace(/\n/g, ' ')
  process.stderr.write(`${row.outcome}${install.reused ? ' (reused install)' : ''}\n`)
}

/** Test files of a scratch copy, in a stable order. */
function readdirTests(dir) {
  return execFileSync('ls', [join(dir, 'tests')], { encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.test.ts')).sort().map((f) => join('tests', f))
}

const markdown = [
  '| dsh version | peers admit | outcome | host tsc | client tsc | tests | kept at this repository\'s pin | detail |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.version} | ${r.admitted ? 'yes' : `NO (${r.refusedBy.length})`} | ${r.outcome} | ${r.host || '—'} | ${r.client || '—'} | ${r.tests || '—'} | ${r.kept.join(', ') || '—'} | ${r.detail.replace(/\|/g, '\\|') || ''} |`),
].join('\n')
console.log(markdown)
if (option('--markdown')) writeFileSync(option('--markdown'), markdown + '\n')
if (option('--json')) writeFileSync(option('--json'), JSON.stringify(rows, null, 2) + '\n')
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Harness sweep\n\n${markdown}\n`, { flag: 'a' })
// A version the ranges refuse is drift whether or not it installs, as in CI's admission stage.
process.exit(rows.some((r) => r.outcome === 'fail' || r.outcome === 'registry error' || !r.admitted) ? 1 : 0)
