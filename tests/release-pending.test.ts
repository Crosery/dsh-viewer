import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pendingRelease, readPublished, registryVersions } from '../scripts/release-pending.mjs'

const manifest = { name: '@crosery/dsh-viewer', version: '0.3.0' }
const head = 'a'.repeat(40)
const decision = (published: string[], tagCommit?: string) => pendingRelease({ manifest, published, head, tagCommit })

describe('an exact npm version determines whether a release is pending', () => {
  it('retries an unpublished version even without a new upstream record', () => {
    assert.deepEqual(decision(['0.2.2']), { pending: true, name: manifest.name, version: '0.3.0', tag: 'v0.3.0', createTag: true })
  })

  it('does not repeat an exact published version regardless of latest', () => {
    assert.deepEqual(decision(['0.2.2', '0.3.0', '0.4.0']), { pending: false, name: manifest.name, version: '0.3.0', tag: '', createTag: false })
  })

  it('distinguishes stable and prerelease versions exactly', () => {
    assert.equal(decision(['0.3.0-rc.1']).pending, true)
    assert.equal(pendingRelease({ manifest: { ...manifest, version: '0.3.0-rc.1' }, published: ['0.3.0'], head }).pending, true)
  })

  it('reuses a tag only when its peeled commit equals HEAD', () => {
    assert.equal(decision([], head).createTag, false)
    assert.equal(decision([], head).tag, 'v0.3.0')
    assert.throws(() => decision([], 'b'.repeat(40)), /points at another commit/)
  })

  it('does not require tag identity for a version that is already published', () => {
    assert.equal(decision(['0.3.0'], 'b'.repeat(40)).pending, false)
  })

  it('fails closed on invalid package versions or missing HEAD', () => {
    assert.throws(() => pendingRelease({ manifest: { name: '', version: '0.3.0' }, published: [] }), /package name/)
    assert.throws(() => pendingRelease({ manifest: { name: 'example', version: 'bad' }, published: [] }), /valid version/)
    assert.throws(() => pendingRelease({ manifest, published: [] }), /determine HEAD/)
  })
})

describe('public registry responses', () => {
  it('treats only HTTP 404 as a missing package ready for first publication', async () => {
    const published = await readPublished(manifest.name, async () => ({ status: 404 }))
    assert.deepEqual(published, [])
    assert.equal(decision(published).pending, true)
  })

  it('uses all published versions and never relies on a dist-tag', async () => {
    let requested: string | undefined
    let options: Record<string, any> | undefined
    const published = await readPublished(manifest.name, async (url: string, init: Record<string, any>) => {
      requested = url
      options = init
      return { status: 200, text: async () => JSON.stringify({ versions: { '0.2.2': {}, '0.3.0': {} }, 'dist-tags': { latest: '0.2.2' } }) }
    })
    assert.equal(requested, 'https://registry.npmjs.org/%40crosery%2Fdsh-viewer')
    assert.deepEqual(options?.headers, { accept: 'application/json' })
    assert.equal(options?.redirect, 'error')
    assert.ok(options?.signal instanceof AbortSignal)
    assert.equal(decision(published).pending, false)
  })

  it('fails on authentication, rate limit and server errors', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      await assert.rejects(readPublished(manifest.name, async () => ({ status })), new RegExp(`HTTP ${status}`))
    }
  })

  it('propagates network failures and timeouts rather than reporting pending', async () => {
    for (const message of ['connection refused', 'request timed out']) {
      await assert.rejects(readPublished(manifest.name, async () => { throw new Error(message) }), new RegExp(message))
    }
  })

  it('rejects malformed success responses', () => {
    for (const body of ['not json', '{}', 'null', '{"versions":[]}', '{"versions":{"bad":{}}}']) {
      assert.throws(() => registryVersions({ status: 200, body }), /release state is unknown/)
    }
  })
})
