/**
 * Follow `@deepseek-ai/dsh`: when upstream publishes a train this repository
 * has not recorded, verify it and write the support table, the peer ranges and
 * the acceptance record the way a person would by hand.
 *
 *   node scripts/follow-upstream.mjs --check [--published FILE] [--json FILE]
 *   node scripts/follow-upstream.mjs --apply [--skip-verify] [--rows FILE] [--smoke-summary FILE]
 *
 * `--check` reads npm and reports what is missing; it never writes. `--apply`
 * widens the peer ranges first (the sweep reads them from package.json),
 * sweeps every new version, boot-smokes the head of each tuple it touched,
 * and only then rewrites the tracked files — restoring every target file if
 * any stage fails, so a failed run leaves no half-widened claim behind.
 *
 * `--published` and `--rows` exist so tests and dry runs can supply what the
 * registry would have said; the workflow passes neither.
 *
 * Everything it writes is checked by `npm run check`, which the run itself
 * executes last: the admitted list, both compatibility docs, the range under
 * both semver rules and the READMEs must agree, or the run fails.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { DIST_TAGS, HARNESS, harnessPeers, harnessVersions, view } from './harness-lib.mjs'
import {
  acceptanceSection, bumpVersion, coveredTuples, insertSection, patchCompatibilityRange,
  patchReadmeDistTags, patchReadmeInstallable, patchReadmeRange, readList, smokePlanLiteral, tupleOf, tuplesOf,
  widenPeers, writeList, writeRefusedHeads, writeTableRow, writeVersion,
} from './follow-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const apply = args.includes('--apply')
const skipVerify = args.includes('--skip-verify')
const fixtureOptions = ['--published', '--tags', '--rows', '--smoke-summary']
if (process.env.GITHUB_ACTIONS === 'true' && (skipVerify || fixtureOptions.some((flag) => args.includes(flag)))) {
  console.error('GitHub Actions must verify live upstream versions; fixture inputs and --skip-verify are local-only')
  process.exit(1)
}
if (['--rows', '--smoke-summary'].some((flag) => args.includes(flag)) && option('--published') === undefined) {
  console.error('supplied evidence requires a local --published fixture')
  process.exit(1)
}
const read = (path) => readFileSync(join(root, path), 'utf8')
const write = (path, text) => writeFileSync(join(root, path), text)

/**
 * Published versions whose own `@deepseek-ai/dsh` does not install, so nobody
 * can run the plugin there. Everything else that npm lists installs; see
 * docs/harness-compatibility.md.
 */
const INCOMPLETE = ['0.0.1-rc.1', '0.0.1-rc.2']

function output(pairs) {
  const file = process.env.GITHUB_OUTPUT
  const text = Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  if (file === undefined) process.stdout.write(text)
  else writeFileSync(file, text, { flag: 'a' })
}

function published() {
  const supplied = option('--published')
  if (supplied !== undefined) return JSON.parse(readFileSync(supplied, 'utf8'))
  return harnessVersions()
}

const manifest = () => JSON.parse(read('package.json'))
const lock = () => JSON.parse(read('package-lock.json'))

/** Versions npm lists that neither the admitted list nor the test fixture records. */
function plan(all) {
  const admitted = readList(read('scripts/check-invariants.mjs'), 'ADMITTED_TRAINS')
  const fixture = readList(read('tests/harness-ci.test.ts'), 'PUBLISHED')
  const known = new Set([...admitted, ...fixture])
  const versions = all.filter((version) => semver.valid(version) && !known.has(version)).sort(semver.compare)
  const ranges = harnessPeers(manifest()).map(([, range]) => range)
  const tuples = tuplesOf(versions).filter((tuple) => ranges.some((range) => !coveredTuples(range).includes(tuple)))
  return { admitted, fixture, versions, tuples }
}

const all = published()
const current = plan(all)
const date = new Date().toISOString().slice(0, 10)
// With `--published` the run is a ledger, not a network read: the tags come
// from `--tags` (or not at all) so a test never depends on npm being reachable.
const tags = option('--published') === undefined
  ? view(HARNESS, 'dist-tags') ?? {}
  : option('--tags') === undefined ? {} : JSON.parse(readFileSync(option('--tags'), 'utf8'))
/**
 * A version a dist-tag now points at is what `npm i` gives a user, and a new
 * tuple is a claim this repository did not make before; either is worth a
 * release. An intermediate prerelease nobody points at is recorded without
 * one, so following upstream does not spend a version number per alpha.
 */
const release = current.tuples.length > 0 || current.versions.some((version) => Object.values(tags).includes(version))

if (!apply) {
  const lines = current.versions.length === 0
    ? [`Nothing to follow: ${all.length} published versions, all recorded.`]
    : [
        `${current.versions.length} published version(s) not recorded yet: ${current.versions.join(', ')}`,
        current.tuples.length === 0
          ? 'Every one lands in a tuple the peer ranges already admit; only the tables and the evidence are missing.'
          : `New tuple(s) to admit: ${current.tuples.join(', ')}`,
        release
          ? `A dist-tag or a new tuple points at one of them (${DIST_TAGS.map((name) => `${name}=${tags[name]}`).join(', ')}): a release follows.`
          : `No dist-tag points at one of them (${DIST_TAGS.map((name) => `${name}=${tags[name]}`).join(', ')}): recorded without a release.`,
      ]
  console.log(lines.join('\n'))
  output({
    new: current.versions.join(','),
    tuples: current.tuples.join(','),
    newest: all.filter((version) => semver.valid(version)).sort(semver.compare).at(-1) ?? '',
    changed: current.versions.length > 0 ? 'true' : 'false',
    release: release ? 'true' : 'false',
    tags: DIST_TAGS.map((name) => `${name}=${tags[name]}`).join(' '),
  })
  if (option('--json')) writeFileSync(option('--json'), JSON.stringify({ ...current, tags, release }, null, 2) + '\n')
  process.exit(0)
}

if (current.versions.length === 0) {
  console.log('Nothing to follow.')
  output({ changed: 'false', version: '', new: '', tuples: '' })
  process.exit(0)
}

// 1. The ranges first: the sweep reads them from package.json and refuses a
//    version they do not admit.
const targets = [
  'package.json', 'package-lock.json', 'scripts/check-invariants.mjs', 'tests/harness-ci.test.ts',
  'docs/harness-compatibility.zh.md', 'docs/harness-compatibility.md',
  'docs/acceptance.zh.md', 'docs/acceptance.md', 'README.zh.md', 'README.md',
]
const before = new Map(targets.map((file) => [file, read(file)]))
function restore() {
  for (const [file, text] of before) write(file, text)
}

try {
const widened = widenPeers(manifest(), current.tuples)
if (current.tuples.length > 0) {
  const nextLock = lock()
  nextLock.packages[''].peerDependencies = widened.peerDependencies
  write('package.json', JSON.stringify(widened, null, 2) + '\n')
  write('package-lock.json', JSON.stringify(nextLock, null, 2) + '\n')
  // The sweep exercises the temporarily widened contract. Move the refusal
  // fixture past those tuples before running it; the transaction restores it
  // along with the manifest if verification fails.
  write('tests/harness-ci.test.ts', writeRefusedHeads(read('tests/harness-ci.test.ts'), all))
}

// 2. Local fixtures can stand in for evidence; production always runs both checks.
let rows = option('--rows') === undefined ? undefined : JSON.parse(readFileSync(option('--rows'), 'utf8'))
let smoke = option('--smoke-summary') === undefined ? undefined : JSON.parse(readFileSync(option('--smoke-summary'), 'utf8'))
if (rows === undefined && !skipVerify) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-viewer-follow-'))
  const json = join(work, 'sweep.json')
  console.log(`sweeping ${current.versions.join(', ')}`)
  const sweep = spawnSync(process.execPath, ['scripts/sweep-trains.mjs', '--versions', current.versions.join(','), '--json', json], { cwd: root, stdio: 'inherit' })
  if (sweep.status !== 0 || !existsSync(json)) {
    throw new Error('the sweep did not pass')
  }
  rows = JSON.parse(readFileSync(json, 'utf8'))
}

if (!skipVerify && rows !== undefined && rows.some((row) => row.outcome !== 'pass')) {
  throw new Error('the sweep reported a train that does not pass')
}

if (smoke === undefined && !skipVerify) {
  const heads = tuplesOf(current.versions).map((tuple) => current.versions.filter((version) => tupleOf(version) === tuple).at(-1))
  smoke = []
  for (const head of heads) {
    console.log(`boot smoke on ${head}`)
    const result = spawnSync(process.execPath, ['scripts/smoke-boot.mjs', '--dsh', head], { cwd: root, encoding: 'utf8' })
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const entries = /client-graph — (\d+) entries/.exec(text)?.[1]
    const summary = { version: head, ok: result.status === 0, entries: entries === undefined ? undefined : Number(entries) }
    smoke.push(summary)
    if (!summary.ok) {
      throw new Error(`the boot smoke on ${head} did not pass`)
    }
  }
}

// 3. The files.
const bumped = bumpVersion(manifest().version, { minor: current.tuples.length > 0 })
const versioned = writeVersion(manifest(), lock(), bumped)
write('package.json', JSON.stringify(versioned.manifest, null, 2) + '\n')
write('package-lock.json', JSON.stringify(versioned.lock, null, 2) + '\n')

const admitted = [...new Set([...current.admitted, ...all.filter((version) => semver.valid(version))])].sort(semver.compare)
write('scripts/check-invariants.mjs', writeList(read('scripts/check-invariants.mjs'), 'ADMITTED_TRAINS', admitted))

const fixture = [...new Set([...current.fixture, ...all.filter((version) => semver.valid(version))])].sort(semver.compare)
const testSource = read('tests/harness-ci.test.ts')
// The dist-tag and desktop resolutions the plan fixture names, so the literal
// keeps matching what `planCells` produces for those facts.
const notable = [...(/resolved: \{([^}]*)\}/.exec(testSource)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
let test = writeList(testSource, 'PUBLISHED', fixture)
test = test.replace(/(assert\.deepEqual\(smoked, \[)[^\]]*(\]\))/, (_, open, close) => `${open}${smokePlanLiteral(fixture, { notable })}${close}`)
test = writeRefusedHeads(test, fixture)
write('tests/harness-ci.test.ts', test)

const newest = all.filter((version) => semver.valid(version)).sort(semver.compare).at(-1)
// A train whose own harness does not install is published but not installable;
// the README states how many install, so it is not counted.
const uninstallable = new Set([...INCOMPLETE, ...(rows ?? []).filter((row) => row.outcome === 'incomplete upstream').map((row) => row.version)])
const installable = all.filter((version) => semver.valid(version) && !uninstallable.has(version)).length

for (const [file, separator, yes] of [
  ['docs/harness-compatibility.zh.md', '、', '是'],
  ['docs/harness-compatibility.md', ', ', 'yes'],
]) {
  let doc = patchCompatibilityRange(read(file), newest, harnessPeers(manifest())[0][1])
  // Historical rows may split one tuple by outcome (for example incomplete
  // early builds). Preserve their evidence unless this run touched the tuple.
  for (const tuple of tuplesOf(current.versions)) {
    const versions = fixture.filter((version) => tupleOf(version) === tuple)
    const smoked = Array.isArray(smoke) ? smoke : []
    const cell = smoked.some((entry) => tupleOf(entry.version) === tuple)
      ? smoked.filter((entry) => tupleOf(entry.version) === tuple).map((entry) => `\`${entry.version}\``).join(separator)
      : undefined
    doc = writeTableRow(doc, tuple, { versions, separator, yes, smoke: cell })
  }
  write(file, doc)
}

if (rows !== undefined) {
  for (const [file, lang] of [['docs/acceptance.zh.md', 'zh'], ['docs/acceptance.md', 'en']]) {
    write(file, insertSection(read(file), acceptanceSection({
      lang, version: bumped, date, node: process.version.slice(1), npm: process.env.npm_config_user_agent?.match(/npm\/[\d.]+/)?.[0].slice(4) ?? '—',
      rows, smoke: Array.isArray(smoke) ? smoke.at(-1) : smoke, tuples: current.tuples,
    })))
  }
}

for (const file of ['README.zh.md', 'README.md']) {
  let doc = patchReadmeRange(read(file), newest)
  if (DIST_TAGS.every((name) => typeof tags[name] === 'string')) doc = patchReadmeDistTags(doc, tags)
  doc = patchReadmeInstallable(doc, installable)
  write(file, doc)
}

// 4. The check that keeps the four places in agreement.
const check = spawnSync(process.execPath, ['scripts/check-invariants.mjs'], { cwd: root, stdio: 'inherit' })
if (check.status !== 0) {
  throw new Error('npm run check refused the result')
}

console.log(`recorded ${current.versions.length} version(s): ${current.versions.join(', ')}`)
console.log(`version ${JSON.parse(before.get('package.json')).version} → ${bumped}${current.tuples.length > 0 ? ' (new tuple)' : ''}`)
output({
  changed: 'true',
  version: bumped,
  tag: `v${bumped}`,
  new: current.versions.join(','),
  tuples: current.tuples.join(','),
  newest: newest ?? '',
  installable: String(installable),
})
} catch (error) {
  restore()
  console.error(`${error.message}; all target files were restored, nothing was committed`)
  process.exitCode = 1
}
