/**
 * Office and OpenDocument conversion: turn a format no browser renders into
 * one every browser renders.
 *
 * The target is always PDF. A pure front-end path exists (`docx-preview` for
 * Word, `exceljs` + a grid for Excel) but does not survive this plugin's
 * constraints: the browser half is a lazy-CJS bundle whose module table answers
 * only the shell baseline, so every dependency would have to be inlined, and
 * there is no free PPTX renderer to inline in the first place. One converter
 * producing one format also means the card has exactly one document code path.
 *
 * Conversion costs seconds, so the cache is the real feature. The key covers
 * the converter version as well as the file identity, because the same bytes
 * through a newer LibreOffice are a different artifact and a stale hit would be
 * invisible.
 * @module @crosery/dsh-viewer/convert
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Where a macOS install puts the binary when it is not on PATH. */
const MAC_APP_BINARY = '/Applications/LibreOffice.app/Contents/MacOS/soffice'

/** Candidate binaries, in the order they are tried. */
const CANDIDATES = ['soffice', 'libreoffice', MAC_APP_BINARY]

/** Wall-clock budget for one conversion. A cold LibreOffice start is seconds. */
export const CONVERT_TIMEOUT_MS = 120_000

/** What a converted document is served as. */
export const CONVERTED_MEDIA_TYPE = 'application/pdf'

/** A resolved converter: its binary and the version string that keys the cache. */
export interface Converter {
  binary: string
  version: string
}

let probe: Promise<Converter | undefined> | undefined

/**
 * Locate LibreOffice and read its version, once per process.
 *
 * The version is part of the cache key, so it has to come from the binary
 * rather than be assumed; a machine that upgrades LibreOffice mid-session
 * simply starts writing artifacts under a new key.
 * @returns the converter, or `undefined` when no LibreOffice is installed.
 */
export async function resolveConverter(): Promise<Converter | undefined> {
  probe ??= (async () => {
    for (const binary of CANDIDATES) {
      try {
        const { stdout } = await run(binary, ['--version'], { timeout: 30_000 })
        const version = stdout.trim().split('\n')[0] ?? 'unknown'
        return { binary, version }
      } catch {
        // Not installed under this name; try the next candidate.
      }
    }
    return undefined
  })()
  return await probe
}

/** Reset the memoized probe. Test seam; production resolves once per process. */
export function resetConverterProbe(): void {
  probe = undefined
}

/**
 * Content-addressed artifact name for one source file.
 *
 * Keyed on path plus mtime plus size rather than on a digest of the bytes: a
 * multi-hundred-megabyte presentation should not be read twice just to decide
 * whether it was already converted, and the triple changes on every edit that
 * matters.
 * @param converter - the resolved converter, whose version joins the key.
 * @param sourcePath - absolute path of the source document.
 * @param mtimeMs - source modification time.
 * @param size - source byte length.
 * @returns the artifact's basename, extension included.
 */
export function artifactName(converter: Converter, sourcePath: string, mtimeMs: number, size: number): string {
  const key = createHash('sha256')
    .update(converter.version).update('\0')
    .update(sourcePath).update('\0')
    .update(String(Math.trunc(mtimeMs))).update('\0')
    .update(String(size))
    .digest('hex')
    .slice(0, 32)
  return `${key}.pdf`
}

/**
 * Conversions run one at a time.
 *
 * LibreOffice shares one user profile directory across invocations, and
 * concurrent runs corrupt each other through it. A private profile per
 * invocation avoids the corruption but not the cost — several cold LibreOffice
 * starts at once will exhaust a laptop — so the queue stays serial and the
 * cache absorbs the repeats.
 */
let queue: Promise<unknown> = Promise.resolve()

/** Append one job to the serial conversion queue. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job, job)
  // A failed job must not poison the queue for the next caller.
  queue = result.then(() => undefined, () => undefined)
  return result
}

/** Whether a path already exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Convert one document to PDF, or return the cached artifact.
 * @param sourcePath - absolute path of the source, in the Host's own filesystem.
 * @param cacheDir - directory owning converted artifacts.
 * @param signal - cancellation for the whole operation.
 * @returns the artifact's absolute path.
 * @throws when no converter is installed, or when LibreOffice produced nothing.
 */
export async function convertDocument(
  sourcePath: string,
  cacheDir: string,
  signal?: AbortSignal,
): Promise<string> {
  const converter = await resolveConverter()
  if (converter === undefined) {
    throw new Error(
      `cannot preview "${basename(sourcePath)}": converting ${extname(sourcePath)} needs LibreOffice, which is not installed. Install it (macOS: brew install --cask libreoffice) and the preview works with no other change.`,
    )
  }
  const info = await stat(sourcePath)
  const artifact = join(cacheDir, artifactName(converter, sourcePath, info.mtimeMs, info.size))
  if (await exists(artifact)) return artifact

  return await enqueue(async () => {
    // Re-check inside the queue: several cards for one document can be waiting
    // on the same slot, and only the first of them should pay for it.
    if (await exists(artifact)) return artifact
    await mkdir(cacheDir, { recursive: true })
    const work = await mkdtemp(join(tmpdir(), 'dsh-viewer-convert-'))
    try {
      await run(converter.binary, [
        // A private profile per invocation. Without it, a LibreOffice already
        // open on this desktop makes the headless call exit immediately with no
        // output at all — the single most common way this silently produces
        // nothing.
        `-env:UserInstallation=file://${join(work, 'profile')}`,
        '--headless',
        '--norestore',
        '--convert-to', 'pdf',
        '--outdir', work,
        sourcePath,
      ], { timeout: CONVERT_TIMEOUT_MS, ...signal === undefined ? {} : { signal } })

      // LibreOffice names the output after the source stem, and reports success
      // on stdout even when it wrote nothing, so the directory is the authority.
      const produced = (await readdir(work)).find(entry => entry.toLowerCase().endsWith('.pdf'))
      if (produced === undefined) {
        throw new Error(`cannot preview "${basename(sourcePath)}": LibreOffice produced no PDF for it`)
      }
      // Rename into place last: a reader either sees no artifact or a complete
      // one, never a half-written file being served to a PDF viewer.
      await rename(join(work, produced), artifact)
      return artifact
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })
}
