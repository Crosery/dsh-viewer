/**
 * The asset route, driven over a real socket.
 *
 * Range handling is what makes a `<video>` seekable, and no unit test of the
 * parser proves the response actually carries the right bytes and headers — so
 * the handler is mounted on a real `node:http` server here and exercised with
 * real requests.
 */

import { deepEqual, equal, ok } from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, after, test } from 'node:test'
import { assetHandler, guardHeaders, parseRange } from '../src/asset-route.ts'
import { assetUrlFor } from '../src/asset-token.ts'

const KEY = randomBytes(32)
const BODY = Buffer.from('0123456789abcdef')

let server: Server | undefined
let origin = ''
let mediaPath = ''
let htmlPath = ''

/** Start the route on a loopback port, once for the whole file. */
async function ready(): Promise<string> {
  if (server !== undefined) return origin
  const dir = await mkdtemp(join(tmpdir(), 'dsh-viewer-route-'))
  mediaPath = join(dir, 'clip.mp4')
  htmlPath = join(dir, 'page.html')
  await writeFile(mediaPath, BODY)
  await writeFile(htmlPath, '<p>hi</p>')

  const handler = assetHandler(() => KEY)
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((resolve) => { server!.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`
  return origin
}

// The fixture paths are module-level bindings, so they have to be assigned
// before any test body evaluates one as a call argument.
before(ready)
after(() => { server?.close() })

/** Fetch one signed asset. */
async function get(path: string, init?: RequestInit): Promise<Response> {
  const base = await ready()
  return await fetch(`${base}${assetUrlFor(KEY, path)}`, init)
}

test('parseRange covers the forms a media element actually sends', () => {
  deepEqual(parseRange('bytes=0-', 16), { start: 0, end: 15 })
  deepEqual(parseRange('bytes=4-9', 16), { start: 4, end: 9 })
  // An open end past EOF clamps rather than failing: Safari asks for more than
  // it can get on the first probe.
  deepEqual(parseRange('bytes=8-99', 16), { start: 8, end: 15 })
  // Suffix form, used to read a trailing index box.
  deepEqual(parseRange('bytes=-4', 16), { start: 12, end: 15 })
  deepEqual(parseRange('bytes=-999', 16), { start: 0, end: 15 })
  equal(parseRange(undefined, 16), undefined)
  // Multi-range is not honored; answering the whole entity is the fallback.
  equal(parseRange('bytes=0-1,4-5', 16), undefined)
  equal(parseRange('items=0-1', 16), undefined)
  equal(parseRange('bytes=20-', 16), 'invalid')
  equal(parseRange('bytes=9-4', 16), 'invalid')
  equal(parseRange('bytes=0-', 0), 'invalid')
})

test('html and svg are served under a CSP, so opening the URL in a tab cannot run script on the app origin', () => {
  ok(guardHeaders('html')['content-security-policy']?.includes('sandbox'))
  ok(guardHeaders('image')['content-security-policy']?.includes("default-src 'none'"))
  deepEqual(guardHeaders('video'), {})
})

test('a whole-entity GET returns the bytes and advertises range support', async () => {
  const response = await get(mediaPath)
  equal(response.status, 200)
  equal(response.headers.get('content-type'), 'video/mp4')
  equal(response.headers.get('accept-ranges'), 'bytes')
  equal(response.headers.get('content-length'), String(BODY.length))
  equal(response.headers.get('x-content-type-options'), 'nosniff')
  equal(Buffer.from(await response.arrayBuffer()).toString(), BODY.toString())
})

test('a range request returns 206 with exactly the requested bytes', async () => {
  const response = await get(mediaPath, { headers: { range: 'bytes=4-9' } })
  equal(response.status, 206)
  equal(response.headers.get('content-range'), `bytes 4-9/${BODY.length}`)
  equal(response.headers.get('content-length'), '6')
  equal(await response.text(), '456789')
})

test('a suffix range returns the tail', async () => {
  const response = await get(mediaPath, { headers: { range: 'bytes=-4' } })
  equal(response.status, 206)
  equal(await response.text(), 'cdef')
})

test('an unsatisfiable range is refused with the entity size', async () => {
  const response = await get(mediaPath, { headers: { range: 'bytes=99-' } })
  equal(response.status, 416)
  equal(response.headers.get('content-range'), `bytes */${BODY.length}`)
})

test('HEAD reports the size without a body', async () => {
  const response = await get(mediaPath, { method: 'HEAD' })
  equal(response.status, 200)
  equal(response.headers.get('content-length'), String(BODY.length))
  equal(await response.text(), '')
})

test('an html asset carries the sandbox CSP', async () => {
  const response = await get(htmlPath)
  equal(response.headers.get('content-type'), 'text/html')
  ok(response.headers.get('content-security-policy')?.includes('sandbox'))
})

test('an unsigned path is not served, however real the file is', async () => {
  const base = await ready()
  const encoded = Buffer.from(mediaPath, 'utf8').toString('base64url')
  const response = await fetch(`${base}/crosery/dsh-viewer/asset?p=${encoded}&s=${'0'.repeat(32)}`)
  equal(response.status, 404)
})

test('a signed path that has since been deleted answers 404 rather than throwing', async () => {
  const response = await get(join(tmpdir(), 'dsh-viewer-does-not-exist.png'))
  equal(response.status, 404)
})

test('a signed directory is not served as a file', async () => {
  const response = await get(tmpdir())
  equal(response.status, 404)
})

test('a write method is rejected outright', async () => {
  const response = await get(mediaPath, { method: 'POST' })
  equal(response.status, 405)
  equal(response.headers.get('allow'), 'GET, HEAD')
})

test('the route answers 503 rather than serving anything while the key is still loading', async () => {
  const handler = assetHandler(() => undefined)
  const bare = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((resolve) => { bare.listen(0, '127.0.0.1', resolve) })
  const address = bare.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const response = await fetch(`http://127.0.0.1:${port}${assetUrlFor(KEY, mediaPath)}`)
  equal(response.status, 503)
  bare.close()
})
