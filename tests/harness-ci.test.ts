/**
 * The decisions the compatibility pipeline makes, pinned without a network:
 * which versions a sweep covers, which peers refuse a version under which
 * rule, how a feed and a shell bundle are read, how the boot audit is split,
 * and when a drift issue is opened, left alone or closed.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { FLOOR, planCells, parseFeed, refusals, sweepStart, tupleHeads } from '../scripts/harness-lib.mjs'
import { classifyDiagnostics, exportedNames, maskTokens, membersRead, moduleTableOf } from '../scripts/smoke-lib.mjs'

const require = createRequire(import.meta.url)
const verdict = require('../scripts/harness-verdict.cjs')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const peers = Object.entries(pkg.peerDependencies as Record<string, string>).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))

const PUBLISHED = [
  '0.0.1-rc.1', '0.0.1-rc.2', '0.0.1-rc.5',
  '0.1.0-rc.2', '0.1.0-rc.3', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8',
  '0.1.1-rc.1', '0.1.1-rc.2',
  '0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5', '0.1.2-rc.1',
  '0.1.3-alpha.2',
  '0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.5-rc.3',
  '0.1.6-alpha.1', '0.1.6-alpha.2',
  '0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1', '0.1.7-rc.2',
]

describe('peer admission', () => {
  it('admits every published train from 0.1.0 up under both semver rules', () => {
    for (const version of PUBLISHED.filter((v) => !v.startsWith('0.0.'))) {
      assert.deepEqual(refusals(version, peers), [], version)
    }
  })

  it('refuses 0.0.1 and the next, unverified tuple', () => {
    for (const version of ['0.0.1-rc.5', '0.1.8-alpha.1', '0.1.8', '0.2.0-rc.1']) {
      assert.equal(refusals(version, peers).length, peers.length, version)
    }
  })

  it('names the rule that refuses: a broad range fails npm on prereleases but passes dsh', () => {
    const [refused] = refusals('0.1.7-rc.2', [['@deepseek-ai/dsh-tools', '>=0.1.0 <0.2.0']])
    assert.deepEqual(refused, { name: '@deepseek-ai/dsh-tools', runtime: true, installer: false })
  })
})

describe('sweep plan', () => {
  const facts = { published: PUBLISHED, sweepFrom: sweepStart(peers), pinned: '0.1.7-rc.2', resolved: { desktop: '0.1.7-rc.2', latest: '0.1.5-rc.3', next: '0.1.7-rc.2', alpha: '0.1.7-alpha.2' } }

  it('starts where the peer ranges start admitting', () => {
    assert.equal(sweepStart(peers), '0.1.0-rc.0')
  })

  it('covers every published version from there, and a newly published one without a code change', () => {
    const rows = planCells(['sweep'], { ...facts, published: [...PUBLISHED, '0.1.8-alpha.1'] })
    assert.deepEqual(rows.map((r: { cell: string }) => r.cell), [...PUBLISHED.filter((v) => !v.startsWith('0.0.')), '0.1.8-alpha.1'])
  })

  it('smokes the floor, each tuple head and every dist-tag or desktop version', () => {
    const smoked = planCells(['sweep'], facts).filter((r: { smoke: boolean }) => r.smoke).map((r: { cell: string }) => r.cell)
    assert.deepEqual(smoked, ['0.1.0-rc.8', FLOOR, '0.1.2-rc.1', '0.1.3-alpha.2', '0.1.5-rc.3', '0.1.6-alpha.2', '0.1.7-alpha.2', '0.1.7-rc.2'])
    assert.equal(planCells(['sweep'], facts, 'none').some((r: { smoke: boolean }) => r.smoke), false)
    assert.equal(planCells(['sweep'], facts, 'all').every((r: { smoke: boolean }) => r.smoke), true)
  })

  it('does not repeat a version a named cell in the same plan covers', () => {
    const rows = planCells(['pinned', 'floor', 'desktop', 'sweep'], facts).map((r: { cell: string }) => r.cell)
    assert.deepEqual(rows.slice(0, 3), ['pinned', 'floor', 'desktop'])
    assert.ok(!rows.includes(FLOOR) && !rows.includes('0.1.7-rc.2'))
    assert.ok(rows.includes('0.1.7-rc.1'))
  })

  it('rejects an unknown cell or smoke policy', () => {
    assert.throws(() => planCells(['nightly'], facts), /unknown cell/)
    assert.throws(() => planCells(['sweep'], facts, 'some'), /unknown smoke policy/)
  })

  it('knows the head of each tuple', () => {
    assert.deepEqual([...tupleHeads(['0.1.2-alpha.5', '0.1.2-rc.1', '0.1.3-alpha.2'])].sort(), ['0.1.2-rc.1', '0.1.3-alpha.2'])
  })
})

describe('desktop feed', () => {
  it('reads the folded scalars electron-builder writes', () => {
    const feed = parseFeed([
      'version: 0.1.7-rc.2',
      'files:',
      '  - url: >-',
      '      https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.1.7-rc.2-mac-arm64.zip',
      '    sha512: >-',
      '      aOfxtRvFqTRRp3zqu6nXNgILgVdHDPyfslhUVNnU1wMYw1dY1vTelptJeAmUDt7G822SCqHzxtPwMmvCGekveA==',
      '    size: 372794444',
      'path: >-',
      '  https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.1.7-rc.2-mac-arm64.zip',
      'sha512: >-',
      '  aOfxtRvFqTRRp3zqu6nXNgILgVdHDPyfslhUVNnU1wMYw1dY1vTelptJeAmUDt7G822SCqHzxtPwMmvCGekveA==',
      "releaseDate: '2026-09-24T14:10:00.562Z'",
    ].join('\n'))
    assert.deepEqual(feed, {
      version: '0.1.7-rc.2',
      path: 'https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.1.7-rc.2-mac-arm64.zip',
      sha512: 'aOfxtRvFqTRRp3zqu6nXNgILgVdHDPyfslhUVNnU1wMYw1dY1vTelptJeAmUDt7G822SCqHzxtPwMmvCGekveA==',
      releaseDate: '2026-09-24T14:10:00.562Z',
      size: 372794444,
    })
  })
})

describe('boot smoke parsing', () => {
  it('reads the shell module table of 0.1.1 and of 0.1.7', () => {
    const v011 = 'function Jd(){return{react:e6,"react/jsx-runtime":i6,"react-dom":a6,"react-dom/client":d6,"@deepseek-ai/cordis":H5,"@deepseek-ai/dsh-client-ui-slots":g6,"@deepseek-ai/dsh-client-ui-primitives":Kd}}const h1={PENDING:0}'
    const v017 = 'async function BS(e,n){await e.inject(["uiRenderer"],o=>{})}function WS(){return{react:yf,"react/jsx-runtime":jf,"react-dom":Lf,"react-dom/client":Tf,"@deepseek-ai/cordis":Jd,"@deepseek-ai/dsh-client-store":th,"@deepseek-ai/dsh-client-ui-slots":lh,"@deepseek-ai/dsh-client-ui-primitives":qb,"@deepseek-ai/dsh-client-ui-dockkit":FS}}'
    assert.equal(moduleTableOf(v011).length, 7)
    assert.ok(!moduleTableOf(v011).includes('@deepseek-ai/dsh-client-store'))
    assert.deepEqual(moduleTableOf(v017).slice(-2), ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit'])
    assert.equal(moduleTableOf('const a={b:1}'), undefined)
  })

  it('holds a skipped bundle and an audit line naming this package against it, and nothing else', () => {
    const name = '@crosery/dsh-viewer'
    const skipped = classifyDiagnostics(`dsh: skipping profile bundle "${name}": peer @deepseek-ai/dsh-tools@<0.1.6-0 does not admit 0.1.7-rc.2\n`, name)
    assert.equal(skipped.ours.length, 1)
    const audit017 = classifyDiagnostics(`dsh: warning: 2 entries did not activate\nviewer (${name}): pending (waiting for service: sessions)\nremote-x (@deepseek-ai/dsh-remote-x): boom\n\nlater`, name)
    assert.deepEqual(audit017.ours, [`viewer (${name}): pending (waiting for service: sessions)`])
    assert.deepEqual(audit017.others, ['remote-x (@deepseek-ai/dsh-remote-x): boom'])
    const audit011 = classifyDiagnostics(`Error: dsh: 1 entry did not activate\n${name}: TypeError: x is not a function\n`, name)
    assert.equal(audit011.ours.length, 1)
    assert.deepEqual(classifyDiagnostics('dsh web: http://127.0.0.1:1/?token=abc\n', name), { ours: [], others: [] })
    const rejected = classifyDiagnostics(`dsh: installation rejected: Plugin ${name}@0.1.1 is incompatible with dsh 0.1.7-rc.2: peerDependencies {}\nPlugin ${name}@0.1.1 is incompatible with dsh 0.1.7-rc.2: peerDependencies {}\n`, name)
    assert.equal(rejected.ours.length, 1)
  })

  it('never lets a session token through', () => {
    assert.equal(maskTokens('dsh web: http://127.0.0.1:8/?token=Zx-9_a.b~c%2F'), 'dsh web: http://127.0.0.1:8/?token=***')
  })

  it('finds the seed members a bundle reads and the names a module exports', () => {
    const bundle = 'var import_dsh_client_ui_primitives = require("x"); import_dsh_client_ui_primitives.IconCloseOutline16; import_dsh_client_ui_primitives2.Button'
    assert.deepEqual([...membersRead(bundle, 'dsh_client_ui_primitives')].sort(), ['Button', 'IconCloseOutline16'])
    assert.deepEqual([...exportedNames('export { a, b as Button, c as IconCloseRegular16 };')].sort(), ['Button', 'IconCloseRegular16', 'a'])
    assert.equal(exportedNames('export * from "./x.js"'), undefined)
  })
})

describe('verdict', () => {
  type Issue = { number: number; title: string; state: string; comments: string[] }
  function fakeGithub(issues: Issue[]) {
    const calls: string[] = []
    const github = {
      paginate: async (_fn: unknown, _args: unknown) => issues.filter((i) => i.state === 'open'),
      rest: {
        issues: {
          listForRepo: () => undefined,
          getLabel: async () => ({}),
          createLabel: async () => { calls.push('createLabel') },
          create: async ({ title, body }: { title: string; body: string }) => { calls.push(`create ${title}`); issues.push({ number: issues.length + 1, title, state: 'open', comments: [body] }) },
          createComment: async ({ issue_number, body }: { issue_number: number; body: string }) => { calls.push(`comment #${issue_number}`); issues.find((i) => i.number === issue_number)!.comments.push(body) },
          update: async ({ issue_number, state }: { issue_number: number; state: string }) => { calls.push(`${state} #${issue_number}`); issues.find((i) => i.number === issue_number)!.state = state },
        },
      },
    }
    return { github, calls }
  }
  const context = { serverUrl: 'https://github.com', repo: { owner: 'Crosery', repo: 'dsh-viewer' }, runId: 1 }
  function fakeCore() {
    const state = { failed: '' }
    const summary = { addHeading: () => summary, addList: () => summary, write: async () => undefined }
    return { core: { summary, setFailed: (m: string) => { state.failed = m } }, state }
  }
  const stages = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`STAGE_${k}`, v]))

  it('closes issue #10 on the first fully green run of its cell', async () => {
    const issues = [{ number: 10, title: 'Harness compatibility broken against @alpha', state: 'open', comments: [] }]
    const { github, calls } = fakeGithub(issues)
    const { core, state } = fakeCore()
    const env = { CELL: 'alpha', VERSION: '0.1.7-alpha.2', REPORT: 'true', INCOMPLETE: 'false', EXPECTED: 'types,tests,admission,smoke', ...stages({ resolve: 'success', install: 'success', types: 'success', tests: 'success', admission: 'success', smoke: 'success' }) }
    const result = await verdict({ github, context, core, env })
    assert.equal(result.green, true)
    assert.deepEqual(calls, ['comment #10', 'closed #10'])
    assert.equal(state.failed, '')
  })

  it('opens one issue per failing cell, then comments on it', async () => {
    const issues: Issue[] = []
    const { github, calls } = fakeGithub(issues)
    const env = { CELL: 'desktop', VERSION: '0.1.8-rc.1', REPORT: 'true', INCOMPLETE: 'false', EXPECTED: 'types,tests,admission,smoke', ...stages({ types: 'success', tests: 'success', admission: 'failure', smoke: 'failure' }) }
    const first = fakeCore()
    await verdict({ github, context, core: first.core, env })
    await verdict({ github, context, core: fakeCore().core, env })
    assert.deepEqual(calls, ['create Harness compatibility broken against @desktop', 'comment #1'])
    assert.match(issues[0]!.comments[0]!, /admission.*dsh ≥0\.1\.7 refuses/s)
    assert.match(first.state.failed, /admission, smoke/)
  })

  it('leaves the issue alone on an incomplete train or a partial run', async () => {
    const issues = [{ number: 3, title: 'Harness compatibility broken against @alpha', state: 'open', comments: [] }]
    const { github, calls } = fakeGithub(issues)
    await verdict({ github, context, core: fakeCore().core, env: { CELL: 'alpha', REPORT: 'true', INCOMPLETE: 'true', EXPECTED: 'types,tests,admission', ...stages({ resolve: 'success', types: '', tests: '' }) } })
    await verdict({ github, context, core: fakeCore().core, env: { CELL: 'alpha', REPORT: 'true', INCOMPLETE: 'false', EXPECTED: 'types,tests,admission,smoke', ...stages({ types: 'success', tests: 'success', admission: 'success', smoke: 'cancelled' }) } })
    assert.deepEqual(calls, [])
  })

  it('fails the job but files nothing when not reporting', async () => {
    const { github, calls } = fakeGithub([])
    const { core, state } = fakeCore()
    await verdict({ github, context, core, env: { CELL: 'floor', REPORT: 'false', EXPECTED: 'types', ...stages({ types: 'failure' }) } })
    assert.deepEqual(calls, [])
    assert.match(state.failed, /types/)
  })
})
