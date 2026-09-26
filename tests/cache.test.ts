/**
 * The converted-document cache stays bounded: least-recently-used under an age,
 * a count and a byte cap, touching nothing it did not write.
 */

import { deepEqual, equal, ok } from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CACHE_LIMITS, isArtifactName, pruneCache, schedulePrune, useArtifact, useServedArtifact, type CacheLimits } from '../src/cache.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 26)

/** An artifact name for index `n`, as a converter would write one. */
const name = (n: number): string => `${n.toString(16).padStart(32, '0')}.pdf`

/** A cache directory holding files of the given sizes, last used `ageDays` ago. */
async function cacheWith(files: { file: string; bytes?: number; ageDays: number }[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-viewer-cache-'))
  for (const { file, bytes = 10, ageDays } of files) {
    const path = join(dir, file)
    await writeFile(path, new Uint8Array(bytes))
    const when = new Date(NOW - ageDays * DAY)
    await utimes(path, when, when)
  }
  return dir
}

const limits = (overrides: Partial<CacheLimits>): CacheLimits => ({ ...CACHE_LIMITS, ...overrides })

test('only names a converter writes are artifacts', () => {
  ok(isArtifactName(name(1)))
  for (const other of ['notes.pdf', `${name(1)}.bak`, 'ABCDEF0123456789ABCDEF0123456789.pdf', '.dsh-viewer-asset-key']) {
    equal(isArtifactName(other), false, other)
  }
})

test('an artifact unused past the age cap is removed, a recent one is kept', async () => {
  const dir = await cacheWith([{ file: name(1), ageDays: 1 }, { file: name(2), ageDays: 45 }])
  const removed = await pruneCache(dir, CACHE_LIMITS, NOW)
  deepEqual(removed, [join(dir, name(2))])
  deepEqual(await readdir(dir), [name(1)])
})

test('over the count cap, the least recently used go first', async () => {
  const dir = await cacheWith([1, 2, 3, 4].map(n => ({ file: name(n), ageDays: n })))
  await pruneCache(dir, limits({ maxEntries: 2 }), NOW)
  deepEqual((await readdir(dir)).sort(), [name(1), name(2)])
})

test('over the byte cap, eviction is strictly by recency, even for a smaller older file', async () => {
  const dir = await cacheWith([
    { file: name(1), bytes: 60, ageDays: 1 },
    { file: name(2), bytes: 60, ageDays: 2 },
    { file: name(3), bytes: 5, ageDays: 3 },
  ])
  await pruneCache(dir, limits({ maxBytes: 100 }), NOW)
  deepEqual(await readdir(dir), [name(1)])
})

test('the most recently used artifact survives any cap', async () => {
  const dir = await cacheWith([{ file: name(1), bytes: 500, ageDays: 90 }])
  deepEqual(await pruneCache(dir, limits({ maxBytes: 100, maxEntries: 0 }), NOW), [])
  deepEqual(await readdir(dir), [name(1)])
})

test('a prune touches nothing it did not write: foreign files, symlinks and directories stay', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'dsh-viewer-outside-'))
  const target = join(outside, 'precious.pdf')
  await writeFile(target, 'keep me')
  const dir = await cacheWith([
    { file: name(1), ageDays: 1 },
    { file: 'notes.pdf', ageDays: 400 },
    { file: 'README', ageDays: 400 },
  ])
  // A link wearing an artifact's name, pointing out of the directory.
  await symlink(target, join(dir, name(2)))
  await mkdir(join(dir, name(3)))
  const removed = await pruneCache(dir, limits({ maxEntries: 1, maxAgeMs: 0 }), NOW)
  deepEqual(removed, [])
  deepEqual((await readdir(dir)).sort(), [name(1), name(2), name(3), 'README', 'notes.pdf'].sort())
  equal((await stat(target)).size, 7, 'the link target is untouched')
})

test('an abandoned partial write is cleaned up; one still being written is not', async () => {
  const stale = `${name(1)}.4242.0f8fad5b-d9cb-469f-a165-70867728950e.partial`
  const fresh = `${name(2)}.4243.7c9e6679-7425-40de-944b-e07fc1f90ae7.partial`
  const dir = await cacheWith([{ file: stale, ageDays: 3 }, { file: fresh, ageDays: 0 }])
  deepEqual(await pruneCache(dir, CACHE_LIMITS, NOW), [join(dir, stale)])
  deepEqual(await readdir(dir), [fresh])
})

test('a missing cache directory is an empty cache', async () => {
  deepEqual(await pruneCache(join(tmpdir(), 'dsh-viewer-no-such-cache', String(process.pid)), CACHE_LIMITS, NOW), [])
})

test('using an artifact moves it to the front of the eviction order', async () => {
  const dir = await cacheWith([{ file: name(1), ageDays: 1 }, { file: name(2), ageDays: 2 }])
  equal(await useArtifact(join(dir, name(2))), true)
  equal(await useArtifact(join(dir, name(9))), false, 'a miss')
  await pruneCache(dir, limits({ maxEntries: 1 }))
  deepEqual(await readdir(dir), [name(2)])
})

test('serving marks a cache artifact used, at most hourly, and never touches other files', async () => {
  const dir = await cacheWith([{ file: name(1), ageDays: 2 }, { file: 'photo.png', ageDays: 2 }])
  const artifact = join(dir, name(1))
  const photo = join(dir, 'photo.png')
  const stale = (await stat(artifact)).mtimeMs

  await useServedArtifact(dir, photo, (await stat(photo)).mtimeMs)
  equal((await stat(photo)).mtimeMs, stale, 'a user file keeps its timestamp')
  await useServedArtifact(join(dir, 'elsewhere'), artifact, stale)
  equal((await stat(artifact)).mtimeMs, stale, 'an artifact of another directory is not ours')
  await useServedArtifact(dir, artifact, stale, stale + 60_000)
  equal((await stat(artifact)).mtimeMs, stale, 'used within the hour: no write')
  await useServedArtifact(dir, artifact, stale)
  ok((await stat(artifact)).mtimeMs > stale, 'stale: stamped as used now')
})

test('prunes requested during a prune fold into one more pass, and never reject', async () => {
  const dir = await cacheWith([1, 2, 3].map(n => ({ file: name(n), ageDays: n })))
  const tight = limits({ maxEntries: 1 })
  const first = schedulePrune(dir, tight)
  const second = schedulePrune(dir, tight)
  equal(first, second, 'the second call joins the first')
  await first
  deepEqual(await readdir(dir), [name(1)])
  await schedulePrune(join(dir, name(1)), tight) // not a directory: logged, not thrown
})
