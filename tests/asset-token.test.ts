/**
 * The signed reference is the whole security boundary of the asset route: an
 * accepted forgery turns a loopback port into an arbitrary-file-read endpoint.
 */

import { equal, notEqual, ok } from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assetUrlFor, loadAssetSecret, verifyAssetRequest } from '../src/asset-token.ts'
import { ASSET_ROUTE } from '../src/contract.ts'

const KEY = randomBytes(32)

/** The query half of a minted URL, which is what the route hands to verify. */
function queryOf(url: string): string {
  return url.slice(url.indexOf('?') + 1)
}

test('a minted reference round-trips back to the exact path', () => {
  const path = '/Users/someone/My Videos/holiday (final).mp4'
  const url = assetUrlFor(KEY, path)
  ok(url.startsWith(`${ASSET_ROUTE}?`))
  equal(verifyAssetRequest(KEY, queryOf(url)), path)
})

test('paths with separators, plus signs and non-ASCII survive the encoding', () => {
  for (const path of ['/tmp/a+b/c d.png', '/tmp/相册/图 1.png', '/tmp/a?b=c#d.mp3', 'C:\\Media\\clip.mp4']) {
    equal(verifyAssetRequest(KEY, queryOf(assetUrlFor(KEY, path))), path)
  }
})

test('a path swapped under a valid signature is refused', () => {
  const url = assetUrlFor(KEY, '/tmp/ok.png')
  const signature = new URLSearchParams(queryOf(url)).get('s')
  const forged = `p=${Buffer.from('/etc/passwd', 'utf8').toString('base64url')}&s=${signature}`
  equal(verifyAssetRequest(KEY, forged), undefined)
})

test('an unsigned or truncated reference is refused', () => {
  const encoded = Buffer.from('/etc/passwd', 'utf8').toString('base64url')
  equal(verifyAssetRequest(KEY, `p=${encoded}`), undefined)
  equal(verifyAssetRequest(KEY, `p=${encoded}&s=`), undefined)
  equal(verifyAssetRequest(KEY, `p=${encoded}&s=${'0'.repeat(32)}`), undefined)
  equal(verifyAssetRequest(KEY, ''), undefined)
})

test('a reference minted under another harness key is refused', () => {
  const url = assetUrlFor(randomBytes(32), '/tmp/ok.png')
  equal(verifyAssetRequest(KEY, queryOf(url)), undefined)
})

test('a padded or otherwise non-canonical encoding of the same path is refused', () => {
  // Standard base64 of a path whose length forces padding; the route must not
  // accept an alternative spelling that its own signer would never produce.
  const path = '/tmp/ab.png'
  const padded = Buffer.from(path, 'utf8').toString('base64')
  ok(padded.includes('='))
  const url = assetUrlFor(KEY, path)
  const signature = new URLSearchParams(queryOf(url)).get('s')
  equal(verifyAssetRequest(KEY, `p=${encodeURIComponent(padded)}&s=${signature}`), undefined)
})

test('the harness key is created once and re-read afterwards, so minted URLs keep resolving', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-viewer-'))
  const keyPath = join(dir, 'nested', 'key')
  const first = await loadAssetSecret(keyPath)
  const second = await loadAssetSecret(keyPath)
  equal(first.length, 32)
  ok(first.equals(second))
  ok((await readFile(keyPath)).equals(first))
})

test('two harness homes get independent keys', async () => {
  const a = join(await mkdtemp(join(tmpdir(), 'dsh-viewer-')), 'key')
  const b = join(await mkdtemp(join(tmpdir(), 'dsh-viewer-')), 'key')
  notEqual((await loadAssetSecret(a)).toString('hex'), (await loadAssetSecret(b)).toString('hex'))
})

test('a truncated key file is replaced rather than used at reduced strength', async () => {
  const keyPath = join(await mkdtemp(join(tmpdir(), 'dsh-viewer-')), 'key')
  await writeFile(keyPath, randomBytes(4))
  const loaded = await loadAssetSecret(keyPath)
  equal(loaded.length >= 32, true)
})
