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
 * invisible. The key must also be stable across restarts, or nothing is ever
 * hit twice and the directory only grows; `cache.ts` bounds it either way.
 *
 * Two converters. From 0.1.6-alpha.2 the harness composes its own
 * `officeToPdf` service with a bundled LibreOffice kit, so a desktop user with
 * no LibreOffice installed still gets a preview of the six Office formats it
 * accepts; {@link convertWithOfficeToPdf} drives it. Every other document
 * format, and every older train, uses a locally installed LibreOffice through
 * {@link convertDocument}.
 * @module @crosery/dsh-viewer/convert
 */

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { schedulePrune, useArtifact } from './cache.ts'

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
  if (await useArtifact(artifact)) return artifact

  return await enqueue(async () => {
    // Re-check inside the queue: several cards for one document can be waiting
    // on the same slot, and only the first of them should pay for it.
    if (await useArtifact(artifact)) return artifact
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
      void schedulePrune(cacheDir)
      return artifact
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })
}

/**
 * Extensions the harness's own Office converter accepts (`dsh-office-to-pdf`,
 * shipped with 0.1.6-alpha.2 and later). Everything else a `document` card
 * shows — RTF and the OpenDocument trio — still goes through LibreOffice.
 */
export const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const

/** One extension {@link OfficeToPdfLike.convert} accepts. */
export type OfficeExtension = typeof OFFICE_EXTENSIONS[number]

/**
 * The slice of the harness `officeToPdf` service this plugin calls, declared
 * structurally.
 *
 * Not imported, not even as a type: `@deepseek-ai/dsh-office-to-pdf` does not
 * exist on the trains before 0.1.6, so naming it would fail the typecheck of
 * every older train this plugin still supports, and a value import would fail
 * the whole entry at ESM link time there. The service is read by name through
 * `ctx.get` and narrowed with {@link officeToPdfOf}.
 */
export interface OfficeToPdfLike {
  /**
   * The provider's resolved configuration — fonts, fallbacks, image
   * resolution, limits. Read only to key the cache: see {@link officeConverterIdentity}.
   */
  readonly config?: unknown
  /**
   * Convert Office bytes. The provider owns queueing, the bundled engine and
   * its own content cache; the caller owns authorization and the source read.
   */
  convert(request: {
    readonly extension: OfficeExtension
    readonly priority: 'foreground' | 'background'
    readonly source: {
      readonly key: string
      readonly version: string
      readonly bytes?: number
      read(signal: AbortSignal, maxBytes: number): Promise<{ readonly bytes: Uint8Array; readonly version: string }>
    }
  }, signal?: AbortSignal): Promise<{ readonly pdf: Uint8Array }>
}

/**
 * Narrow an optional service value to {@link OfficeToPdfLike}.
 * @param service - whatever `ctx.get('officeToPdf')` returned.
 * @returns the converter, or `undefined` when this train composes none.
 */
export function officeToPdfOf(service: unknown): OfficeToPdfLike | undefined {
  if (typeof service !== 'object' || service === null) return undefined
  return typeof (service as { convert?: unknown }).convert === 'function' ? service as OfficeToPdfLike : undefined
}

/**
 * The extension `officeToPdf` would accept for this path, if any.
 * @param sourcePath - the document's path.
 * @returns the bare lowercased extension, or `undefined` for a LibreOffice-only format.
 */
export function officeExtensionOf(sourcePath: string): OfficeExtension | undefined {
  const extension = extname(sourcePath).slice(1).toLowerCase()
  return (OFFICE_EXTENSIONS as readonly string[]).includes(extension) ? extension as OfficeExtension : undefined
}

/** The source one {@link convertWithOfficeToPdf} call converts. */
export interface OfficeSource {
  /** The Host's own path of the document; keys the artifact and the provider's dedup. */
  path: string
  /** The filesystem freshness token observed when the call resolved the file. */
  version: string
  /** Byte size, when the backend reported one. */
  bytes?: number
  /**
   * Read the document's bytes, bounded by the provider's reservation.
   * @param signal - the provider's conversion lifetime.
   * @param maxBytes - the capacity the provider reserved for this source.
   */
  read(signal: AbortSignal, maxBytes: number): Promise<Uint8Array>
}

/** JSON with object keys sorted, so equal configurations hash equally. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  }) ?? 'undefined'
}

/**
 * A stable identity for the bundled converter, for the artifact key.
 *
 * Not the provider's `generation`: that is `randomUUID()` per provider
 * instance, so keying on it made every restart a cold cache — the cache was
 * never hit across restarts and only grew. The provider replaces its
 * generation when its configuration is replaced, so the configuration itself
 * is the stable half of the same idea: different fonts or rendering settings
 * are a different artifact, a restart is not. What it cannot see is a harness
 * upgrade that ships a new engine under an unchanged configuration; such an
 * artifact is still a faithful render of unchanged bytes, and it ages out of
 * the cache like any other.
 * @param converter - the harness `officeToPdf` service.
 * @returns a string that changes exactly when the provider's configuration does.
 */
export function officeConverterIdentity(converter: OfficeToPdfLike): string {
  let config: string
  try {
    config = canonicalJson(converter.config)
  } catch {
    // A configuration that does not serialize is keyed as one identity, which
    // is still stable across restarts.
    config = 'unserializable'
  }
  return `officeToPdf\0${createHash('sha256').update(config).digest('hex')}`
}

/**
 * Artifact name for one conversion through the bundled converter.
 *
 * Keyed on the converter's identity as well as on the source identity, for the
 * same reason the LibreOffice key carries the LibreOffice version: the same
 * bytes through different fonts or rendering settings are a different PDF.
 * @param identity - {@link officeConverterIdentity} of the provider.
 * @param source - the converted document.
 * @returns the artifact's basename, extension included.
 */
export function officeArtifactName(identity: string, source: Pick<OfficeSource, 'path' | 'version' | 'bytes'>): string {
  const key = createHash('sha256')
    .update('office-to-pdf').update('\0')
    .update(identity).update('\0')
    .update(source.path).update('\0')
    .update(source.version).update('\0')
    .update(String(source.bytes ?? ''))
    .digest('hex')
    .slice(0, 32)
  return `${key}.pdf`
}

/**
 * Convert one Office document through the harness's bundled converter, or
 * return the cached artifact.
 *
 * The provider hands the PDF back as bytes, but the asset route serves files:
 * the bytes are written into this plugin's own cache and signed there, like a
 * LibreOffice artifact. The write lands under a unique temporary name first and
 * is renamed into place, so a concurrent reader either finds no artifact or a
 * complete one.
 * @param converter - the harness `officeToPdf` service.
 * @param source - the document and its bounded reader.
 * @param cacheDir - directory owning converted artifacts.
 * @param signal - cancellation for the whole operation.
 * @returns the artifact's absolute path.
 * @throws when the format is not one the provider accepts, or the provider refuses or fails.
 */
export async function convertWithOfficeToPdf(
  converter: OfficeToPdfLike,
  source: OfficeSource,
  cacheDir: string,
  signal?: AbortSignal,
): Promise<string> {
  const extension = officeExtensionOf(source.path)
  if (extension === undefined) throw new Error(`the bundled converter does not accept ${extname(source.path) || 'this file'}`)
  const artifact = join(cacheDir, officeArtifactName(officeConverterIdentity(converter), source))
  if (await useArtifact(artifact)) return artifact

  const result = await converter.convert({
    extension,
    priority: 'foreground',
    source: {
      // Unambiguous per plugin and path; the provider only uses it to share one
      // in-flight conversion between concurrent callers.
      key: JSON.stringify(['@crosery/dsh-viewer', source.path]),
      version: source.version,
      ...source.bytes === undefined ? {} : { bytes: source.bytes },
      read: async (readSignal, maxBytes) => ({ bytes: await source.read(readSignal, maxBytes), version: source.version }),
    },
  }, signal)

  await mkdir(cacheDir, { recursive: true })
  const partial = `${artifact}.${process.pid}.${randomUUID()}.partial`
  try {
    await writeFile(partial, result.pdf, { flag: 'wx' })
    await rename(partial, artifact)
  } finally {
    await rm(partial, { force: true })
  }
  void schedulePrune(cacheDir)
  return artifact
}
