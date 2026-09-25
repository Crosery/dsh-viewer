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
 *
 * Two converters. From 0.1.6-alpha.2 the harness composes its own
 * `officeToPdf` service with a bundled LibreOffice kit, so a desktop user with
 * no LibreOffice installed still gets a preview of the six Office formats it
 * accepts; {@link convertWithOfficeToPdf} drives it. Every other document
 * format, and every older train, uses a locally installed LibreOffice through
 * {@link convertDocument}.
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
/**
 * Extensions the harness's own Office converter accepts (`dsh-office-to-pdf`,
 * shipped with 0.1.6-alpha.2 and later). Everything else a `document` card
 * shows — RTF and the OpenDocument trio — still goes through LibreOffice.
 */
export declare const OFFICE_EXTENSIONS: readonly ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
/** One extension {@link OfficeToPdfLike.convert} accepts. */
export type OfficeExtension = typeof OFFICE_EXTENSIONS[number];
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
    /** Changes whenever the engine, fonts, or rendering settings are replaced. */
    readonly generation?: unknown;
    /**
     * Convert Office bytes. The provider owns queueing, the bundled engine and
     * its own content cache; the caller owns authorization and the source read.
     */
    convert(request: {
        readonly extension: OfficeExtension;
        readonly priority: 'foreground' | 'background';
        readonly source: {
            readonly key: string;
            readonly version: string;
            readonly bytes?: number;
            read(signal: AbortSignal, maxBytes: number): Promise<{
                readonly bytes: Uint8Array;
                readonly version: string;
            }>;
        };
    }, signal?: AbortSignal): Promise<{
        readonly pdf: Uint8Array;
    }>;
}
/**
 * Narrow an optional service value to {@link OfficeToPdfLike}.
 * @param service - whatever `ctx.get('officeToPdf')` returned.
 * @returns the converter, or `undefined` when this train composes none.
 */
export declare function officeToPdfOf(service: unknown): OfficeToPdfLike | undefined;
/**
 * The extension `officeToPdf` would accept for this path, if any.
 * @param sourcePath - the document's path.
 * @returns the bare lowercased extension, or `undefined` for a LibreOffice-only format.
 */
export declare function officeExtensionOf(sourcePath: string): OfficeExtension | undefined;
/** The source one {@link convertWithOfficeToPdf} call converts. */
export interface OfficeSource {
    /** The Host's own path of the document; keys the artifact and the provider's dedup. */
    path: string;
    /** The filesystem freshness token observed when the call resolved the file. */
    version: string;
    /** Byte size, when the backend reported one. */
    bytes?: number;
    /**
     * Read the document's bytes, bounded by the provider's reservation.
     * @param signal - the provider's conversion lifetime.
     * @param maxBytes - the capacity the provider reserved for this source.
     */
    read(signal: AbortSignal, maxBytes: number): Promise<Uint8Array>;
}
/**
 * Artifact name for one conversion through the bundled converter.
 *
 * Keyed on the provider generation as well as on the source identity, for the
 * same reason the LibreOffice key carries the LibreOffice version: the same
 * bytes through a replaced engine or font set are a different PDF.
 * @param generation - the provider's generation, or `'unknown'`.
 * @param source - the converted document.
 * @returns the artifact's basename, extension included.
 */
export declare function officeArtifactName(generation: string, source: Pick<OfficeSource, 'path' | 'version' | 'bytes'>): string;
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
export declare function convertWithOfficeToPdf(converter: OfficeToPdfLike, source: OfficeSource, cacheDir: string, signal?: AbortSignal): Promise<string>;
