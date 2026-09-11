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
/** Wall-clock budget for one conversion. A cold LibreOffice start is seconds. */
export declare const CONVERT_TIMEOUT_MS = 120000;
/** What a converted document is served as. */
export declare const CONVERTED_MEDIA_TYPE = "application/pdf";
/** A resolved converter: its binary and the version string that keys the cache. */
export interface Converter {
    binary: string;
    version: string;
}
/**
 * Locate LibreOffice and read its version, once per process.
 *
 * The version is part of the cache key, so it has to come from the binary
 * rather than be assumed; a machine that upgrades LibreOffice mid-session
 * simply starts writing artifacts under a new key.
 * @returns the converter, or `undefined` when no LibreOffice is installed.
 */
export declare function resolveConverter(): Promise<Converter | undefined>;
/** Reset the memoized probe. Test seam; production resolves once per process. */
export declare function resetConverterProbe(): void;
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
export declare function artifactName(converter: Converter, sourcePath: string, mtimeMs: number, size: number): string;
/**
 * Convert one document to PDF, or return the cached artifact.
 * @param sourcePath - absolute path of the source, in the Host's own filesystem.
 * @param cacheDir - directory owning converted artifacts.
 * @param signal - cancellation for the whole operation.
 * @returns the artifact's absolute path.
 * @throws when no converter is installed, or when LibreOffice produced nothing.
 */
export declare function convertDocument(sourcePath: string, cacheDir: string, signal?: AbortSignal): Promise<string>;
