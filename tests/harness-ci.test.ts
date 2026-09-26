/**
 * The decisions the compatibility pipeline makes, pinned without a network:
 * which versions a sweep covers, which peers refuse a version under which
 * rule, how a feed and a shell bundle are read, how the boot audit is split,
 * when a train is incomplete rather than failed, and when a drift issue is
 * opened, left alone or closed. The npm-backed paths run against a registry
 * served from this process, never the real one.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { FLOOR, graphFailed, npmErrorCode, planCells, parseFeed, refusals, registryFailed, sweepStart, tupleHeads } from '../scripts/harness-lib.mjs'
import { bootGraphOf, classifyDiagnostics, exportedNames, maskTokens, membersRead, moduleTableOf, publishedTooLate, unmetPeers } from '../scripts/smoke-lib.mjs'

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
/** The first train that publishes `dsh-client-ui-renderer`, which the browser half injects. */
const SUPPORTED = PUBLISHED.slice(PUBLISHED.indexOf('0.1.0-rc.8'))

describe('peer admission', () => {
  it('admits every published train from 0.1.0-rc.8 up under both semver rules', () => {
    for (const version of SUPPORTED) {
      assert.deepEqual(refusals(version, peers), [], version)
    }
  })

  it('refuses every train that predates the renderer package, and the next, unverified tuple', () => {
    for (const version of ['0.0.1-rc.5', '0.1.0-rc.2', '0.1.0-rc.3', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.8-alpha.1', '0.1.8', '0.2.0-rc.1']) {
      const refused = refusals(version, peers)
      assert.equal(refused.length, peers.length, version)
      assert.ok(refused.every((r: { runtime: boolean; installer: boolean }) => !r.runtime && !r.installer), `${version} must fail both rules`)
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
    assert.equal(sweepStart(peers), '0.1.0-rc.8')
  })

  it('covers every published version from there, and a newly published one without a code change', () => {
    const rows = planCells(['sweep'], { ...facts, published: [...PUBLISHED, '0.1.8-alpha.1'] })
    assert.deepEqual(rows.map((r: { cell: string }) => r.cell), [...SUPPORTED, '0.1.8-alpha.1'])
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

  it('reads the boot graph in the 0.1.0 and the 0.1.1+ spelling', () => {
    const graph = { entries: [{ id: '@crosery/dsh-viewer', url: '/plugins/x/client.js?rev=1' }] }
    assert.deepEqual(bootGraphOf(`<head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(graph)}</script></head>`), graph)
    assert.deepEqual(bootGraphOf(`<script src="/a.js"></script><script>window.__DSH_BOOT__ = ${JSON.stringify(graph)}</script>`), graph)
    assert.equal(bootGraphOf('<html></html>'), undefined)
  })

  it('names the package a release depends on that was published after the cutoff', () => {
    const npm = 'npm error notarget No matching version found for @deepseek-ai/dsh-client-ui-sidebar-documentpreview@^0.1.5-rc.3 with a date before 2026/9/22 14:23:31.'
    assert.deepEqual(publishedTooLate(npm), { name: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview', version: '0.1.5-rc.3' })
    assert.equal(publishedTooLate('npm error code ERESOLVE'), undefined)
  })

  it('never lets a session token through', () => {
    assert.equal(maskTokens('dsh web: http://127.0.0.1:8/?token=Zx-9_a.b~c%2F'), 'dsh web: http://127.0.0.1:8/?token=***')
  })

  it('finds the peers a legacy install left unmet, the way Node would resolve them', () => {
    const modules = join(mkdtempSync(join(tmpdir(), 'dsh-viewer-peers-')), 'node_modules')
    const put = (dir: string, manifest: object) => {
      mkdirSync(join(modules, dir), { recursive: true })
      writeFileSync(join(modules, dir, 'package.json'), JSON.stringify(manifest))
    }
    try {
      put('@deepseek-ai/dsh', { name: '@deepseek-ai/dsh', peerDependencies: { react: '^18.3.1', '@deepseek-ai/cordis': '^4.0.0', 'left-out': '^2.0.0' }, peerDependenciesMeta: { 'left-out': { optional: true } } })
      put('react', { name: 'react' })
      put('@deepseek-ai/dsh-tools', { name: '@deepseek-ai/dsh-tools', peerDependencies: { '@deepseek-ai/dsh-scope': '0.1.1-rc.2', '@deepseek-ai/cordis': '^4.0.2' } })
      put('@deepseek-ai/dsh-tools/node_modules/nested', { name: 'nested', peerDependencies: { own: '1.x', react: '*' } })
      put('@deepseek-ai/dsh-tools/node_modules/own', { name: 'own' })
      assert.deepEqual([...unmetPeers(modules)].sort(), [['@deepseek-ai/cordis', '^4.0.0'], ['@deepseek-ai/dsh-scope', '0.1.1-rc.2']])
      put('@deepseek-ai/cordis', { name: '@deepseek-ai/cordis' })
      put('@deepseek-ai/dsh-scope', { name: '@deepseek-ai/dsh-scope' })
      assert.equal(unmetPeers(modules).size, 0)
    } finally {
      rmSync(join(modules, '..'), { recursive: true, force: true })
    }
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

  it('reports an incomplete train whose version the peer ranges refuse', async () => {
    const issues: Issue[] = []
    const { github, calls } = fakeGithub(issues)
    const { core, state } = fakeCore()
    const result = await verdict({ github, context, core, env: { CELL: 'desktop', VERSION: '0.1.8-rc.1', REPORT: 'true', INCOMPLETE: 'true', EXPECTED: 'types,tests,admission,smoke', ...stages({ resolve: 'success', install: '', types: '', tests: '', admission: 'failure', smoke: '' }) } })
    assert.deepEqual(result.failed, ['admission'])
    assert.deepEqual(calls, ['create Harness compatibility broken against @desktop'])
    assert.match(state.failed, /admission/)
  })

  it('fails the job but files nothing when not reporting', async () => {
    const { github, calls } = fakeGithub([])
    const { core, state } = fakeCore()
    await verdict({ github, context, core, env: { CELL: 'floor', REPORT: 'false', EXPECTED: 'types', ...stages({ types: 'failure' }) } })
    assert.deepEqual(calls, [])
    assert.match(state.failed, /types/)
  })
})

describe('registry failures are failures, not incomplete trains', () => {
  const repo = fileURLToPath(new URL('..', import.meta.url))
  /** A copy of what the scripts need, so no run can rewrite this checkout's manifest. */
  let copy = ''
  let cache = ''
  const servers: Server[] = []

  /** A registry that knows `packuments` and answers 404 for anything else, or 500 for everything. */
  async function registry(mode: '500' | Record<string, string[]>): Promise<string> {
    const server = createServer((req, res) => {
      const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]!)
      res.setHeader('content-type', 'application/json')
      if (mode === '500') { res.statusCode = 500; res.end('{"error":"boom"}'); return }
      const versions = mode[name]
      if (versions === undefined) { res.statusCode = 404; res.end('{"error":"Not found"}'); return }
      res.end(JSON.stringify({
        name,
        'dist-tags': { latest: versions.at(-1) },
        versions: Object.fromEntries(versions.map((version) => [version, { name, version }])),
      }))
    })
    servers.push(server)
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  }
  /** Nothing listens on the discard port: every request is refused. */
  const DOWN = 'http://127.0.0.1:9/'

  function node(args: string[], registryUrl: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const env = {
      ...process.env,
      npm_config_registry: registryUrl, npm_config_cache: cache, npm_config_fetch_retries: '0',
      npm_config_update_notifier: 'false', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '',
    }
    return new Promise((ok) => {
      execFile(process.execPath, args, { cwd: copy, env, encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => {
        ok({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr })
      })
    })
  }
  /** Run a snippet against harness-lib; it prints one JSON line. */
  const lib = (code: string, registryUrl: string) =>
    node(['--input-type=module', '-e', `import * as lib from ${JSON.stringify(join(copy, 'scripts/harness-lib.mjs'))}\n${code}`], registryUrl)

  before(() => {
    copy = mkdtempSync(join(tmpdir(), 'dsh-viewer-registry-'))
    cache = join(copy, '.npm-cache')
    mkdirSync(join(copy, 'scripts'))
    for (const file of ['harness-lib.mjs', 'harness-target.mjs', 'sweep-trains.mjs']) cpSync(join(repo, 'scripts', file), join(copy, 'scripts', file))
    for (const file of ['package.json', 'package-lock.json']) cpSync(join(repo, file), join(copy, file))
    symlinkSync(join(repo, 'node_modules'), join(copy, 'node_modules'), 'dir')
  })
  after(() => {
    for (const server of servers) server.close()
    rmSync(copy, { recursive: true, force: true })
  })

  it('tells a registry that did not answer from a graph that does not resolve', () => {
    assert.ok(registryFailed('npm error code ECONNREFUSED\nnpm error errno ECONNREFUSED'))
    assert.ok(registryFailed('npm error code E503\nnpm error 503 Service Unavailable - GET https://registry.npmjs.org/x'))
    assert.ok(registryFailed('npm error code EAI_AGAIN'))
    assert.ok(!registryFailed('npm error code ERESOLVE\nnpm error ERESOLVE could not resolve'))
    assert.ok(graphFailed('npm error code ETARGET\nnpm error notarget No matching version found for x@9.9.9.'))
    assert.ok(graphFailed('npm error code E404\nnpm error 404 Not Found - GET http://127.0.0.1/x'))
    assert.ok(!graphFailed('npm error code ECONNRESET'))
    assert.equal(npmErrorCode('{"error":{"code":"E404","summary":"Not found"}}', ''), 'E404')
    assert.equal(npmErrorCode('', 'npm error code ECONNREFUSED\n'), 'ECONNREFUSED')
  })

  it('reads E404 as "does not exist" and anything else as a registry error', async () => {
    const known = await registry({ '@deepseek-ai/dsh': ['0.1.7-rc.2'] })
    const probe = `
      const out = {}
      for (const [key, spec, field] of [['missing', '@crosery/surely-not-published', 'versions'], ['version', '@deepseek-ai/dsh@9.9.9', 'version'], ['list', '@deepseek-ai/dsh', 'versions']]) {
        try { out[key] = lib.view(spec, field) ?? null } catch (error) { out[key] = error.constructor.name }
      }
      console.log(JSON.stringify(out))`
    assert.deepEqual(JSON.parse((await lib(probe, known)).stdout), { missing: null, version: null, list: ['0.1.7-rc.2'] })
    for (const url of [DOWN, await registry('500')]) {
      const { stdout } = await lib(`try { lib.versionsOf('@deepseek-ai/dsh'); console.log('"answered"') } catch (error) { console.log(JSON.stringify(error.constructor.name)) }`, url)
      assert.equal(JSON.parse(stdout), 'RegistryError', url)
    }
  })

  it('fails a cell when the registry is down instead of calling the train incomplete', async () => {
    for (const url of [DOWN, await registry('500')]) {
      const r = await node(['scripts/harness-target.mjs', '0.1.7-rc.2', '--admits'], url)
      assert.equal(r.code, 1, `${url}: ${r.stdout}${r.stderr}`)
      assert.doesNotMatch(r.stdout, /incomplete=true/)
      assert.match(r.stderr, /npm registry did not answer/)
    }
  })

  it('calls a version npm does not have incomplete, but never the floor or an empty harness', async () => {
    const url = await registry({ '@deepseek-ai/dsh': ['0.1.7-rc.1', '0.1.7-rc.2'] })
    const absent = await node(['scripts/harness-target.mjs', '9.9.9'], url)
    assert.equal(absent.code, 3, absent.stderr)
    assert.match(absent.stdout, /incomplete=true/)

    const floor = await node(['scripts/harness-target.mjs', 'floor'], url)
    assert.equal(floor.code, 1, floor.stdout)
    assert.match(floor.stderr, /claims \(the floor\)/)
    // The install step names the floor by its version.
    assert.equal((await node(['scripts/harness-target.mjs', FLOOR], url)).code, 1)

    const nothing = await registry({})
    const plan = await node(['scripts/harness-target.mjs', '--plan', 'sweep'], nothing)
    assert.equal(plan.code, 1, plan.stdout)
    assert.doesNotMatch(plan.stdout, /matrix=/)
    assert.match(plan.stderr, /lists no version of @deepseek-ai\/dsh/)
  })

  it('installs through the train only on a graph failure, and calls it incomplete only when upstream fails too', async () => {
    const install = (url: string) => lib(`
      const dir = ${JSON.stringify(join(copy, 'train'))}
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dir, { recursive: true })
      const manifest = { name: 'probe', version: '0.0.0', private: true, devDependencies: { 'not-published-anywhere': '1.0.0' } }
      try {
        const r = lib.installTrain(dir, manifest, '0.1.7-rc.2')
        console.log(JSON.stringify({ ok: r.ok, incomplete: r.incomplete, via: r.via }))
      } catch (error) { console.log(JSON.stringify(error.constructor.name)) }`, url)
    const empty = JSON.parse((await install(await registry({}))).stdout)
    assert.deepEqual(empty, { ok: false, incomplete: true, via: '@deepseek-ai/dsh@0.1.7-rc.2 graph (the peer graph named a package npm cannot find)' })
    assert.equal(JSON.parse((await install(DOWN)).stdout), 'RegistryError')
  })

  it('fails the sweep on a registry error instead of passing the version as out of scope', async () => {
    const r = await node(['scripts/sweep-trains.mjs', '--versions', '0.1.7-rc.2', '--work', join(copy, 'sweep')], DOWN)
    assert.equal(r.code, 1, r.stdout)
    assert.match(r.stdout, /\| 0\.1\.7-rc\.2 \| yes \| registry error \|/)
  })
})
