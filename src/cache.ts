/**
 * Bounds on the converted-document cache.
 *
 * Every conversion leaves one PDF in a directory beside the asset key, shared
 * by every profile on the machine. Without a bound that directory only grows:
 * a user who previews a few documents a day accumulates gigabytes nobody asked
 * to keep. So the cache is least-recently-used with three caps — age, entry
 * count and total bytes — and "used" means either converted-or-hit by
 * `display_file` or served to a card by the asset route, which is what keeps
 * the artifact behind a card someone is looking at from aging out.
 *
 * Pruning is lazy: once when the plugin activates and after each write, never
 * on a timer. It only ever considers regular files in the cache directory
 * itself whose names this plugin writes, so a stray file, a symlink or a
 * subdirectory placed there is never touched, and nothing outside the
 * directory is reachable at all.
 * @module @crosery/dsh-viewer/cache
 */

import { randomUUID } from 'node:crypto'
import { lstat, readdir, rename, rm, utimes } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

/** How long one hour lasts, in milliseconds. */
const HOUR_MS = 60 * 60 * 1000

/** The three caps one prune enforces. */
export interface CacheLimits {
  /** An artifact unused for longer than this is removed. */
  maxAgeMs: number
  /** At most this many artifacts are kept, most recently used first. */
  maxEntries: number
  /** Kept artifacts total at most this many bytes. */
  maxBytes: number
}

/**
 * The shipped caps: a month unused, 256 documents, 512 MiB. Generous enough
 * that a card in an active conversation never loses its artifact; small enough
 * that the directory stays an unremarkable size on a laptop.
 */
export const CACHE_LIMITS: CacheLimits = {
  maxAgeMs: 30 * 24 * HOUR_MS,
  maxEntries: 256,
  maxBytes: 512 * 1024 * 1024,
}

/** A partial write this old belongs to a process that died mid-write. */
const PARTIAL_GRACE_MS = 24 * HOUR_MS

/**
 * How stale an artifact's last-use stamp must be before serving it refreshes
 * the stamp. A seeking video issues dozens of range requests; one write an
 * hour is plenty for a cap measured in weeks.
 */
const TOUCH_INTERVAL_MS = HOUR_MS

/** An artifact name, as both converters write it: 32 hex digits and `.pdf`. */
const ARTIFACT_NAME = /^[0-9a-f]{32}\.pdf$/

/** A write still in flight, or abandoned: `<artifact>.<pid>.<uuid>.partial`. */
const PARTIAL_NAME = /^[0-9a-f]{32}\.pdf\.\d+\.[0-9a-f-]{36}\.partial$/

/**
 * Whether a file name is one of this cache's artifacts.
 * @param name - a bare file name.
 * @returns true for a name a converter writes.
 */
export function isArtifactName(name: string): boolean {
  return ARTIFACT_NAME.test(name)
}

/**
 * Write an artifact into place.
 *
 * The bytes land under a unique partial name beside the artifact — in the cache
 * directory itself, never in the system temp directory — and are renamed into
 * place last. Beside it because `rename` only works within one filesystem: a
 * temp directory on another mount (a Linux `tmpfs` `/tmp`) fails it with
 * `EXDEV`. Renamed last so a reader either finds no artifact or a complete
 * one, never a half-written file served to a PDF viewer. The partial name is
 * one {@link pruneCache} recognizes, so even a process killed mid-write leaves
 * nothing behind for long; any failure here removes it at once.
 * @param artifact - the artifact's absolute path.
 * @param write - writes the complete bytes to the path it is given.
 */
export async function placeArtifact(artifact: string, write: (partial: string) => Promise<void>): Promise<void> {
  const partial = `${artifact}.${process.pid}.${randomUUID()}.partial`
  try {
    await write(partial)
    await rename(partial, artifact)
  } finally {
    await rm(partial, { force: true })
  }
}

/**
 * Stamp an artifact as used now, if it exists.
 *
 * Doubles as the cache-hit test: a successful stamp is a hit, and the stamp is
 * what moves the artifact to the front of the eviction order.
 * @param path - the artifact's absolute path.
 * @returns true when the artifact exists.
 */
export async function useArtifact(path: string): Promise<boolean> {
  const now = new Date()
  try {
    await utimes(path, now, now)
    return true
  } catch {
    return false
  }
}

/**
 * Refresh a served file's last-use stamp when it is one of this cache's
 * artifacts. Any other file the asset route serves — the user's own images and
 * videos — is left exactly as it is.
 * @param cacheDir - the cache directory.
 * @param path - the absolute path the route is serving.
 * @param mtimeMs - its modification time, as the route's `stat` saw it.
 * @param now - the current time.
 */
export async function useServedArtifact(cacheDir: string, path: string, mtimeMs: number, now = Date.now()): Promise<void> {
  if (dirname(path) !== resolve(cacheDir) || !isArtifactName(basename(path))) return
  if (now - mtimeMs < TOUCH_INTERVAL_MS) return
  await useArtifact(path)
}

/** One artifact as a prune sees it. */
interface Candidate {
  path: string
  mtimeMs: number
  size: number
}

/**
 * Remove a file unless it was used after the prune looked at it. Two processes
 * share this directory; the re-check keeps a prune from deleting an artifact
 * another process just handed to a card.
 */
async function removeUnlessUsed(path: string, mtimeMs: number): Promise<boolean> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.mtimeMs !== mtimeMs) return false
    await rm(path, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Enforce the caps once.
 *
 * The most recently used artifact always survives, whatever the caps say: it
 * is the one a card was most likely just handed.
 * @param cacheDir - the cache directory; a missing directory is an empty cache.
 * @param limits - the caps to enforce.
 * @param now - the current time.
 * @returns the absolute paths removed.
 */
export async function pruneCache(cacheDir: string, limits: CacheLimits = CACHE_LIMITS, now = Date.now()): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(cacheDir)
  } catch (error: unknown) {
    if ((error as { code?: unknown }).code === 'ENOENT') return []
    throw error
  }
  const removed: string[] = []
  const artifacts: Candidate[] = []
  for (const name of names) {
    const artifact = ARTIFACT_NAME.test(name)
    if (!artifact && !PARTIAL_NAME.test(name)) continue
    const path = join(cacheDir, name)
    let info
    try {
      info = await lstat(path)
    } catch {
      continue
    }
    if (!info.isFile()) continue
    if (artifact) {
      artifacts.push({ path, mtimeMs: info.mtimeMs, size: info.size })
    } else if (now - info.mtimeMs > PARTIAL_GRACE_MS && await removeUnlessUsed(path, info.mtimeMs)) {
      removed.push(path)
    }
  }

  artifacts.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let kept = 0
  let bytes = 0
  let full = false
  for (const entry of artifacts) {
    // Strictly least-recently-used: once one artifact falls outside a cap,
    // every older one does too, even if it would still fit on its own.
    full ||= kept > 0 && (
      now - entry.mtimeMs > limits.maxAgeMs || kept >= limits.maxEntries || bytes + entry.size > limits.maxBytes
    )
    if (!full) {
      kept += 1
      bytes += entry.size
    } else if (await removeUnlessUsed(entry.path, entry.mtimeMs)) {
      removed.push(entry.path)
    }
  }
  return removed
}

/** Prunes in flight, by directory, and whether another was asked for meanwhile. */
const pruning = new Map<string, { again: boolean; done: Promise<void> }>()

/**
 * Prune in the background.
 *
 * Calls that arrive while a prune of the same directory runs fold into one
 * more pass after it, so a burst of conversions costs two directory scans, not
 * one per conversion. A failure is logged, never thrown: a cache that could not
 * be trimmed still serves every card.
 * @param cacheDir - the cache directory.
 * @param limits - the caps to enforce.
 * @returns settles when the directory has been pruned; never rejects.
 */
export function schedulePrune(cacheDir: string, limits: CacheLimits = CACHE_LIMITS): Promise<void> {
  const current = pruning.get(cacheDir)
  if (current !== undefined) {
    current.again = true
    return current.done
  }
  const state = { again: false, done: Promise.resolve() }
  state.done = (async () => {
    try {
      do {
        state.again = false
        await pruneCache(cacheDir, limits)
      } while (state.again)
    } catch (error: unknown) {
      console.warn(`[dsh-viewer] could not prune the conversion cache at ${cacheDir}`, error)
    } finally {
      pruning.delete(cacheDir)
    }
  })()
  pruning.set(cacheDir, state)
  return state.done
}
