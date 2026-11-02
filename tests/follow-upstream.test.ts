/** The follow transforms and their effects, exercised only in scratch copies. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { FLOOR } from '../scripts/harness-lib.mjs'
import {
  acceptanceSection, addTuples, bumpVersion, comparatorSet, coveredTuples, formatList, insertSection, nextRefusedHead,
  patchCompatibilityRange, patchReadmeDistTags, patchReadmeInstallable, patchReadmeRange, readList, smokePlanLiteral,
  tupleOf, tuplesOf, widenPeers, writeList, writeRefusedHeads, writeTableRow,
} from '../scripts/follow-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const manifest = JSON.parse(read('package.json'))
const peer = (pkg: typeof manifest) => pkg.peerDependencies['@deepseek-ai/dsh-tools'] as string
const published = readList(read('scripts/check-invariants.mjs'), 'ADMITTED_TRAINS')
const newest = [...published].sort(semver.compare).at(-1)!
const latestTuple = tupleOf(newest)
// A sweep repoints package.json before copying this test. Include tuples already
// admitted by that manifest so the fixture's future version stays outside both
// the ledger and the temporary widened peer range.
const manifestTuples = coveredTuples(peer(manifest))
const future = nextRefusedHead([...published, ...manifestTuples.map((tuple) => `${tuple}-alpha.0`)] )
const futureTuple = tupleOf(future)
// A prerelease beyond every recorded prerelease, including after a stable release.
const sameTuple = `${latestTuple}-zz.${published.length + 1}`
const tags = { latest: newest, next: newest, alpha: newest }
// A sweep may be testing a pin the real ledger has not recorded yet. Supply
// those exact harness pins as registry facts so the scratch updater records
// the version check-invariants compares its repointed manifest against.
const fixturePublished = [...new Set([
  ...published,
  ...Object.entries(manifest.devDependencies as Record<string, string>)
    .filter(([name, version]) => name.startsWith('@deepseek-ai/dsh') && semver.valid(version))
    .map(([, version]) => version),
])].sort(semver.compare)

const targets = [
  'package.json', 'package-lock.json', 'scripts/check-invariants.mjs', 'tests/harness-ci.test.ts',
  'docs/harness-compatibility.zh.md', 'docs/harness-compatibility.md',
  'docs/acceptance.zh.md', 'docs/acceptance.md', 'README.zh.md', 'README.md',
]

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-viewer-follow-'))
  // Sweep copies have no .git, and live .dsh-ops files are not test inputs.
  const entries = [
    'src', 'tests', 'scripts', 'docs', 'lib', 'assets', '.github',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.client.json',
    'README.md', 'README.zh.md', 'cordis.patch.yml', 'screenshots.json', 'LICENSE', '.gitignore',
  ]
  for (const entry of entries) {
    if (existsSync(join(root, entry))) cpSync(join(root, entry), join(dir, entry), { recursive: true })
  }
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'))
  return dir
}

function inputs(dir: string, version = future) {
  const list = join(dir, 'published.json')
  const tagsFile = join(dir, 'tags.json')
  writeFileSync(list, JSON.stringify([...fixturePublished, version]))
  writeFileSync(tagsFile, JSON.stringify(tags))
  return ['--published', list, '--tags', tagsFile]
}

function runFollow(dir: string, args: string[], env = { ...process.env, GITHUB_ACTIONS: 'false' }) {
  return spawnSync(process.execPath, ['scripts/follow-upstream.mjs', ...args], { cwd: dir, encoding: 'utf8', env })
}

const snapshot = (dir: string) => new Map(targets.map((file) => [file, readFileSync(join(dir, file), 'utf8')]))
function assertRestored(dir: string, before: Map<string, string>) {
  for (const [file, text] of before) assert.equal(readFileSync(join(dir, file), 'utf8'), text, file)
}

function evidence(dir: string, version = future) {
  const rows = join(dir, 'rows.json')
  const smoke = join(dir, 'smoke.json')
  writeFileSync(rows, JSON.stringify([{ version, outcome: 'pass', host: 'ok', client: 'ok', tests: '174/174', detail: '' }]))
  writeFileSync(smoke, JSON.stringify([{ version, ok: true, entries: 71 }]))
  return ['--rows', rows, '--smoke-summary', smoke]
}

describe('the comparator set for one tuple', () => {
  it('admits every prerelease of its tuple under both rules and nothing after it', () => {
    const range = comparatorSet('0.2.1')
    for (const version of ['0.2.1-alpha.1', '0.2.1-rc.4', '0.2.1']) {
      assert.equal(semver.satisfies(version, range, { includePrerelease: true }), true, version)
      assert.equal(semver.satisfies(version, range), true, version)
    }
    for (const version of ['0.2.2-alpha.1', '0.2.0', '0.3.0']) assert.equal(semver.satisfies(version, range, { includePrerelease: true }), false, version)
  })

  it('appends only missing tuples, without depending on the latest recorded train', () => {
    const range = peer(manifest)
    assert.ok(coveredTuples(range).includes(latestTuple))
    assert.equal(addTuples(range, [latestTuple]), range)
    const widened = addTuples(range, [futureTuple])
    assert.equal(widened, `${range} || ${comparatorSet(futureTuple)}`)
    assert.deepEqual(coveredTuples(widened), [...coveredTuples(range), futureTuple])
    assert.equal(addTuples(widened, [futureTuple]), widened)
  })

  it('widens every harness peer without mutating the manifest', () => {
    const before = structuredClone(manifest)
    const widened = widenPeers(manifest, [futureTuple])
    const peers = Object.entries(widened.peerDependencies as Record<string, string>).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
    assert.ok(peers.length > 1)
    for (const [name, range] of peers) {
      assert.equal(coveredTuples(range).at(-1), futureTuple, name)
      assert.equal(semver.satisfies(future, range, { includePrerelease: true }), true, name)
      assert.equal(semver.satisfies(future, range), true, name)
    }
    assert.equal(widened.peerDependencies['@deepseek-ai/cordis'], manifest.peerDependencies['@deepseek-ai/cordis'])
    assert.equal(widened.engines.dsh, widened.peerDependencies['@deepseek-ai/dsh-tools'])
    assert.deepEqual(manifest, before)
  })

  it('rejects divergent harness peers or engines.dsh before widening', () => {
    const peerName = '@deepseek-ai/dsh-tools'
    const divergent = structuredClone(manifest)
    divergent.peerDependencies[peerName] = `${divergent.peerDependencies[peerName]} || >=9.0.0-alpha.0 <9.0.1-0`
    assert.throws(() => widenPeers(divergent, [futureTuple]), /harness peer ranges diverge/)
    const engineMismatch = structuredClone(manifest)
    engineMismatch.engines = { ...engineMismatch.engines, dsh: '>=9.0.0-alpha.0 <9.0.1-0' }
    assert.throws(() => widenPeers(engineMismatch, [futureTuple]), /engines.dsh differs/)
  })
})

describe('the admitted-train list and CI fixtures', () => {
  it('round-trips through its source', () => {
    const source = read('scripts/check-invariants.mjs')
    assert.ok(published.length > 0)
    assert.deepEqual(readList(writeList(source, 'ADMITTED_TRAINS', published), 'ADMITTED_TRAINS'), published)
  })

  it('keeps one tuple per line where it fits, with trailing commas', () => {
    const lines = formatList(['0.2.1-alpha.1', '0.2.1-rc.1', '0.1.5-rc.3', '0.1.5-rc.2']).split('\n')
    assert.deepEqual(lines.map((line: string) => line.trim().replace(/,$/, '')), ["'0.1.5-rc.2', '0.1.5-rc.3'", "'0.2.1-alpha.1', '0.2.1-rc.1'"])
    assert.ok(lines.every((line: string) => line.endsWith(',') && line.length <= 100))
  })

  it('reproduces the smoke plan and extends it for a future train', () => {
    const test = read('tests/harness-ci.test.ts')
    const versions = readList(test, 'PUBLISHED')
    const notable = [...(/resolved: \{([^}]*)\}/.exec(test)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
    const literal = /assert\.deepEqual\(smoked, \[([^\]]*)\]\)/.exec(test)![1]
    assert.equal(smokePlanLiteral(versions, { notable }), literal)
    assert.ok(literal.includes('FLOOR'))
    assert.ok(smokePlanLiteral([...versions, future], { notable }).endsWith(`'${future}'`))
  })

  it('moves the refused next tuple when new tuples are admitted', () => {
    const source = read('tests/harness-ci.test.ts')
    const versions = readList(source, 'PUBLISHED')
    const refused = (text: string) => [.../refuses the tuples nobody published[\s\S]*?for \(const version of \[([^\]]*)\]/.exec(text)![1].matchAll(/'([^']+)'/g)].map((match) => match[1])
    assert.equal(refused(writeRefusedHeads(source, [...versions, sameTuple])).at(-1), nextRefusedHead(versions))
    const updated = refused(writeRefusedHeads(source, [...versions, future]))
    assert.equal(updated.at(-1), nextRefusedHead([...versions, future]))
    assert.ok(!updated.includes(future))
  })
})

describe('the documents a person reads', () => {
  const doc = read('docs/harness-compatibility.zh.md')

  it('updates an existing tuple row', () => {
    const versions = published.filter((version) => tupleOf(version) === latestTuple)
    const next = writeTableRow(doc, latestTuple, { versions: [...versions, sameTuple], separator: '、', yes: '是', smoke: `\`${sameTuple}\`` })
    const row = next.split('\n').find((line) => line.startsWith(`| ${latestTuple} |`))!
    assert.ok(row.includes(`\`${sameTuple}\``))
    assert.equal(row.split('|').length, 7)
  })

  it('appends a new tuple after the existing rows', () => {
    const previous = doc.split('\n').filter((line) => /^\| \d+\.\d+\.\d+ \|/.test(line))
    const next = writeTableRow(doc, futureTuple, { versions: [future], separator: '、', yes: '是', smoke: `\`${future}\`` })
    const rows = next.split('\n').filter((line) => /^\| \d+\.\d+\.\d+ \|/.test(line))
    assert.deepEqual(rows.slice(0, -1), previous)
    assert.ok(rows.at(-1)!.startsWith(`| ${futureTuple} | \`${future}\` | 是 |`))
  })

  it('updates the support sentence and exact manifest range in both languages', () => {
    const range = peer(widenPeers(manifest, [futureTuple]))
    for (const file of ['docs/harness-compatibility.md', 'docs/harness-compatibility.zh.md']) {
      const next = patchCompatibilityRange(read(file), future, range)
      assert.ok(next.includes(`\`${future}\``), file)
      assert.equal(/```text\n([^\n]+)\n```/.exec(next)![1], range, file)
    }
    assert.throws(() => patchCompatibilityRange(doc.replace('```text', '```json'), future, range), /no peer-range code block/)
  })

  it('keeps README ranges, tags and counts in step', () => {
    for (const file of ['README.md', 'README.zh.md']) {
      const next = patchReadmeInstallable(patchReadmeDistTags(patchReadmeRange(read(file), future), tags), 999)
      assert.ok(next.includes(future), file)
      assert.ok(next.includes(newest), file)
      assert.ok(next.includes('999'), file)
    }
  })

  it('writes an acceptance section naming only the observed evidence', () => {
    const rows = [{ version: future, outcome: 'pass', host: 'ok', client: 'ok', tests: '174/174', detail: '' }]
    const common = { version: '99.0.0', date: '2026-10-27', node: '26.7.0', npm: '11.19.0', rows, smoke: { version: future, ok: true, entries: 71 }, tuples: [] }
    const zh = acceptanceSection({ ...common, lang: 'zh' })
    assert.ok(zh.includes(`\`${future}\``) && zh.includes('174/174') && zh.includes('71'))
    const en = acceptanceSection({ ...common, lang: 'en' })
    assert.ok(en.includes('These trains were not rendered in a browser by hand.'))
    const failed = acceptanceSection({ ...common, lang: 'en', rows: [{ ...rows[0], outcome: 'fail' }], smoke: undefined })
    assert.ok(failed.includes('did not pass, so no range was widened.'))
    const original = read('docs/acceptance.md')
    const target = insertSection(original, en)
    assert.equal(target.indexOf(en), original.indexOf('\n## ') + 1)
  })

  it('reports retained dependency pins from the actual sweep in both languages', () => {
    const kept = '@deepseek-ai/dsh-client-ui-renderer@0.1.7-rc.2 (not published)'
    const common = {
      version: '99.0.0', date: '2026-10-27', node: '24.0.0', npm: '11.0.0', tuples: [], smoke: undefined,
      rows: [{ version: future, outcome: 'pass', host: 'ok', client: 'ok', tests: '1/1', kept: [kept] }],
    }
    for (const lang of ['en', 'zh']) {
      const section = acceptanceSection({ ...common, lang })
      assert.ok(section.includes(`\`${kept}\``), lang)
      assert.ok(!section.includes('no dependency kept') && !section.includes('未报告任何保留'), lang)
      assert.ok(!section.includes('no package had to stay') && !section.includes('没有任何包需要留在'), lang)
    }
  })

  it('bumps a patch for a version and a minor for a new tuple', () => {
    assert.equal(bumpVersion('0.2.1'), '0.2.2')
    assert.equal(bumpVersion('0.2.9'), '0.2.10')
    assert.equal(bumpVersion('0.2.1', { minor: true }), '0.3.0')
    assert.equal(tupleOf('0.2.1-rc.4'), '0.2.1')
    assert.deepEqual(tuplesOf(['0.2.1-rc.4', '0.1.7-rc.2', '0.2.1-alpha.1']), ['0.1.7', '0.2.1'])
  })
})

describe('following future trains in a scratch tree', () => {
  for (const [version, tuple] of [[sameTuple, latestTuple], [future, futureTuple]] as const) {
    const minor = [...fixturePublished, version]
      .some((entry) => !published.includes(entry) && !manifestTuples.includes(tupleOf(entry)))
    it(`records a ${minor ? 'new' : 'known'} tuple and keeps checks green`, () => {
      const dir = scratch()
      const historicalRows = new Map<string, string[]>()
      for (const file of ['docs/harness-compatibility.zh.md', 'docs/harness-compatibility.md']) {
        const path = join(dir, file)
        // Seed an intentionally split historical tuple independent of the live
        // docs, so an updater that rewrites every tuple corrupts the fixture.
        const doc = readFileSync(path, 'utf8').split('\n').map((line) =>
          line.startsWith('| 0.0.1 |') && line.includes('0.0.1-rc.1')
            ? '| 0.0.1 | `0.0.1-rc.1`, `0.0.1-rc.2` | incomplete upstream | — | — |'
            : line).join('\n')
        writeFileSync(path, doc)
        historicalRows.set(file, doc.split('\n').filter((line) => line.startsWith('| 0.0.1 |')))
      }
      const before = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version as string
      const run = runFollow(dir, ['--apply', '--skip-verify', ...inputs(dir, version)])
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
      const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      assert.equal(after.version, bumpVersion(before, { minor }))
      assert.equal(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[''].version, after.version)
      const readme = readFileSync(join(dir, 'README.md'), 'utf8')
      assert.ok(readme.includes(`\`next\` (\`${newest}\`)`))
      // A future prerelease can sort before an already recorded stable version.
      const end = [...fixturePublished, version].sort(semver.compare).at(-1)
      assert.ok(readme.includes(`through \`${end}\``))
      const ranges = Object.entries(after.peerDependencies as Record<string, string>).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
      for (const [name, range] of ranges) {
        assert.ok(coveredTuples(range).includes(tuple), name)
        assert.equal(semver.satisfies(version, range), true, name)
      }
      for (const file of ['docs/harness-compatibility.zh.md', 'docs/harness-compatibility.md']) {
        const doc = readFileSync(join(dir, file), 'utf8')
        assert.ok(doc.includes(`\`${version}\``), file)
        assert.equal(/```text\n([^\n]+)\n```/.exec(doc)![1], peer(after), file)
        assert.deepEqual(doc.split('\n').filter((line) => line.startsWith('| 0.0.1 |')), historicalRows.get(file), `${file}: historical split rows stay untouched`)
        const row = doc.split('\n').find((line) => line.startsWith(`| ${tuple} |`))!
        for (const entry of fixturePublished.filter((entry) => tupleOf(entry) === tuple)) {
          assert.ok(row.includes(`\`${entry}\``), `${file}: touched tuple retains ${entry}`)
        }
      }
      const source = readFileSync(join(dir, 'tests/harness-ci.test.ts'), 'utf8')
      const versions = readList(source, 'PUBLISHED')
      assert.ok(versions.includes(version))
      const literal = /assert\.deepEqual\(smoked, \[([^\]]*)\]\)/.exec(source)![1]
      const notable = [...(/resolved: \{([^}]*)\}/.exec(source)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
      assert.equal(literal, smokePlanLiteral(versions, { notable }))
      const refused = [.../refuses the tuples nobody published[\s\S]*?for \(const version of \[([^\]]*)\]/.exec(source)![1].matchAll(/'([^']+)'/g)].map((match) => match[1])
      assert.equal(refused.at(-1), nextRefusedHead(versions))
      assert.ok(!refused.some((entry) => tupleOf(entry) === tuple))
      const check = spawnSync(process.execPath, ['scripts/check-invariants.mjs'], { cwd: dir, encoding: 'utf8' })
      assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`)
    })
  }

  it('restores every target after the final check fails, including pre-existing edits', () => {
    const dir = scratch()
    const checkFile = join(dir, 'scripts/check-invariants.mjs')
    writeFileSync(checkFile, `process.on('exit', () => { process.exitCode = 1 })\n${readFileSync(checkFile, 'utf8')}`)
    const readme = join(dir, 'README.md')
    writeFileSync(readme, `${readFileSync(readme, 'utf8')}\nAn existing local edit.\n`)
    const before = snapshot(dir)
    const run = runFollow(dir, ['--apply', ...inputs(dir), ...evidence(dir)])
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stderr, /npm run check refused the result/)
    assertRestored(dir, before)
  })

  it('restores the widened manifest and every target when evidence parsing throws', () => {
    const dir = scratch()
    const args = [...inputs(dir), ...evidence(dir)]
    writeFileSync(join(dir, 'rows.json'), '{broken')
    const before = snapshot(dir)
    const run = runFollow(dir, ['--apply', ...args])
    assert.equal(run.status, 1)
    assert.match(run.stderr, /all target files were restored/)
    assertRestored(dir, before)
  })

  it('refuses a failing sweep fixture without changing any target', () => {
    const dir = scratch()
    const args = [...inputs(dir), ...evidence(dir)]
    writeFileSync(join(dir, 'rows.json'), JSON.stringify([{ version: future, outcome: 'fail' }]))
    const before = snapshot(dir)
    const run = runFollow(dir, ['--apply', ...args])
    assert.equal(run.status, 1)
    assert.match(run.stderr, /sweep reported a train that does not pass/)
    assertRestored(dir, before)
  })

  it('blocks supplied evidence and skip-verify in GitHub Actions before writing', () => {
    const dir = scratch()
    const before = snapshot(dir)
    for (const flag of ['--rows', '--smoke-summary', '--published', '--tags', '--skip-verify']) {
      const run = runFollow(dir, ['--apply', flag, 'unused.json'], { ...process.env, GITHUB_ACTIONS: 'true' })
      assert.equal(run.status, 1)
      assert.match(run.stderr, /fixture inputs and --skip-verify are local-only/)
      assertRestored(dir, before)
    }
  })

  it('requires supplied evidence to accompany a local published fixture', () => {
    const dir = scratch()
    const before = snapshot(dir)
    const run = runFollow(dir, ['--apply', '--rows', 'unused.json'])
    assert.equal(run.status, 1)
    assert.match(run.stderr, /requires a local --published fixture/)
    assertRestored(dir, before)
  })

  it('reports nothing to do once every published version is recorded', () => {
    const dir = scratch()
    const list = join(dir, 'published.json')
    writeFileSync(list, JSON.stringify(published))
    const run = runFollow(dir, ['--check', '--published', list])
    assert.equal(run.status, 0)
    assert.match(run.stdout, /Nothing to follow/)
  })

  it('identifies a newly published tuple', () => {
    const dir = scratch()
    const run = runFollow(dir, ['--check', ...inputs(dir)])
    assert.equal(run.status, 0)
    assert.ok(run.stdout.includes(`New tuple(s) to admit: ${futureTuple}`))
  })

  it('releases a known tuple only when a dist-tag points at the new version', () => {
    const dir = scratch()
    const args = inputs(dir, sameTuple)
    const json = join(dir, 'check.json')
    const quiet = runFollow(dir, ['--check', ...args, '--json', json])
    assert.equal(quiet.status, 0)
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).release, false)
    writeFileSync(join(dir, 'tags.json'), JSON.stringify({ ...tags, next: sameTuple }))
    const tagged = runFollow(dir, ['--check', ...args, '--json', json])
    assert.equal(tagged.status, 0)
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).release, true)
  })
})

describe('the pins the updater may not move', () => {
  it('leaves the floor and current devDependencies alone, including repointed sweep copies', () => {
    assert.equal(FLOOR, '0.1.1-rc.2')
    const widened = widenPeers(manifest, [futureTuple])
    assert.deepEqual(widened.devDependencies, manifest.devDependencies)
    assert.equal(widened.devDependencies['@deepseek-ai/dsh-tools'], manifest.devDependencies['@deepseek-ai/dsh-tools'])
  })
})
