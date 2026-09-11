/**
 * Viewer taxonomy, field names, and wire shapes shared by both halves.
 *
 * Deliberately free of `@deepseek-ai/schemastery` and of every `node:` import:
 * the browser half imports this module, so a validator or a Node builtin
 * reaching it would be inlined into (or break) the client bundle. The Host
 * schema is built over this module in `settings.ts`.
 */
/** Wire name of the display tool this plugin registers. */
export declare const DISPLAY_TOOL = "display_file";
/**
 * Wire name of the shipped `dsh-tool-fs` image reader. This plugin does not own
 * it — it only registers a card for it, so an image the model pulled in through
 * the shipped tool is shown as a picture too instead of a bare text row.
 */
export declare const READ_IMAGE_TOOL = "read_image";
/** Wire name of the shipped text read, whose binary-media calls get redirected. */
export declare const READ_TOOL = "read";
/** Settings namespace this plugin owns. */
export declare const VIEWER_SETTINGS_NAMESPACE = "crosery-viewer";
/**
 * HTTP route serving one asset's bytes to the browser half.
 *
 * Scoped, because a duplicate exact route fails the WHOLE plugin tree at boot,
 * not just the offender.
 */
export declare const ASSET_ROUTE = "/crosery/dsh-viewer/asset";
/**
 * How the browser half renders one file.
 *
 * The axis is "which element plays this", not "what is this file" — `svg` and
 * `png` are both `image` because both go in an `<img>`, and everything with no
 * player at all lands on `file`, which still gets a card with the file's facts
 * and a link. There is no kind that renders nothing.
 */
export type ViewerKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'html' | 'file';
/** One extension's classification. */
interface MediaSpec {
    /** Which element plays it. */
    readonly kind: ViewerKind;
    /** Content type the asset route sends, and the card's declared type. */
    readonly mediaType: string;
}
/** Media type of a raster the durable attachment service admits. */
export type ModelImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
/** {@link ModelImageMediaType} as a runtime set, for narrowing replayed JSON. */
export declare const MODEL_IMAGE_MEDIA_TYPES: readonly ModelImageMediaType[];
/**
 * Lowercased extension (dot included) to its classification.
 *
 * Only formats a mainstream browser actually plays are listed: an entry here is
 * a promise that the card will render something, so a codec the browser would
 * refuse belongs on the `file` fallback instead of in this table.
 */
export declare const MEDIA_TABLE: Readonly<Record<string, MediaSpec>>;
/** Classification used for an extension {@link MEDIA_TABLE} does not list. */
export declare const UNKNOWN_MEDIA: MediaSpec;
/**
 * The extensions whose bytes the durable attachment service admits, mapped to
 * the media type it verifies them as. A file outside this set can still be
 * displayed — it just cannot enter model context, because there is no durable
 * attachment to reference it by.
 */
export declare const MODEL_IMAGE_EXTENSIONS: Readonly<Record<string, ModelImageMediaType>>;
/**
 * Viewer kinds whose bytes are useless as UTF-8 text, so a `read` naming one is
 * a mistake worth correcting rather than a decode that yields replacement
 * characters. `html` is absent on purpose: reading HTML source is a legitimate
 * text read, and displaying it is a different intent.
 */
export declare const OPAQUE_KINDS: readonly ViewerKind[];
/**
 * Extract a path's lowercased extension, dot included.
 *
 * Hand-rolled rather than `node:path`'s `extname` because the browser half
 * calls this too. A leading dot is a dotfile, not an empty extension, and both
 * separators are honored so a Windows-style path from a remote workspace still
 * classifies.
 * @param filePath - the raw path as the model wrote it; not yet resolved.
 * @returns the extension including its dot, or `undefined` when there is none.
 */
export declare function extensionOf(filePath: string): string | undefined;
/**
 * Classify a path into the element that will render it.
 * @param filePath - the raw path as the model wrote it.
 * @returns the viewer kind and the content type the asset route will send;
 *   {@link UNKNOWN_MEDIA} for anything the table does not list.
 */
export declare function classifyPath(filePath: string): MediaSpec;
/**
 * The media type the attachment service would verify this path's bytes as.
 * @param filePath - the raw path as the model wrote it.
 * @returns the admissible media type, or `undefined` when the bytes could never
 *   become a durable attachment.
 */
export declare function modelImageMediaTypeForPath(filePath: string): ModelImageMediaType | undefined;
/**
 * Whether a `read` naming this path is decoding bytes that are not text.
 * @param filePath - the raw path as the model wrote it.
 * @returns true when the path names an opaque binary medium.
 */
export declare function isOpaqueMediaPath(filePath: string): boolean;
/**
 * Durable image facts for a raster that also reached the attachment store.
 *
 * Structurally the attachment service's `ImageAttachmentRef` minus the fields a
 * card never reads. Restated instead of imported so the browser half stays free
 * of Host packages; the Host half projects a real reference into this shape.
 */
export interface ModelImage {
    /** Opaque durable storage id; never a filesystem path or a bearer URL. */
    attachmentId: string;
    /** Media type verified from the stored bytes. */
    mediaType: ModelImageMediaType;
    /** Exact encoded byte length. */
    bytes: number;
    /** Intrinsic encoded width in pixels. */
    width: number;
    /** Intrinsic encoded height in pixels. */
    height: number;
    /** Display name stripped of local path information. */
    name?: string;
}
/**
 * Canonical `display_file` outcome — what `execute` returns, what a `run_code`
 * program receives, and (verbatim) what rides `tool/result` as presentation
 * metadata so a reopened session rebuilds the same card.
 */
export interface DisplayValue {
    /** The backend-resolved path that was displayed. */
    path: string;
    /** Which element the card renders. */
    kind: ViewerKind;
    /** Content type the asset route sends for this file. */
    mediaType: string;
    /** Byte size, or 0 when the backend does not report one. */
    bytes: number;
    /**
     * Same-origin signed URL the card loads. Absent when the filesystem backend
     * exposes no local path for the target (a remote workspace), in which case an
     * admissible raster still reaches the card through {@link ModelImage}.
     */
    assetUrl?: string;
    /** Present only for a raster this call committed to the attachment store. */
    image?: ModelImage;
    /**
     * Why there is nothing to render, when the call succeeded but produced no
     * viewable bytes — a document whose conversion is unavailable, typically.
     * The card shows this verbatim instead of a generic placeholder.
     */
    unavailable?: string;
    /**
     * Whether the image ALSO entered model context. False is the ordinary
     * outcome for every non-raster and for every text-only model route: the file
     * is on the user's screen, not in the model's context.
     */
    inContext: boolean;
}
/** Narrow one unknown value to {@link ModelImage}. */
export declare function modelImageFrom(value: unknown): ModelImage | undefined;
/**
 * Narrow opaque live or replayed result metadata to a {@link DisplayValue}.
 *
 * Defensive because the browser side reads data written by an older version of
 * this plugin (or by nothing at all). Malformed metadata returns `undefined` so
 * the card falls back to a plain row instead of throwing during replay.
 * @param meta - the `tool/result` metadata, verbatim.
 * @returns the validated projection, or `undefined` when absent or malformed.
 */
export declare function displayValueFrom(meta: unknown): DisplayValue | undefined;
/**
 * Render a byte count the way a file manager does.
 * @param bytes - non-negative byte count.
 * @returns a short human string, or an empty string when the size is unknown.
 */
export declare function formatBytes(bytes: number): string;
/** Durable settings section owned by this plugin. */
export interface ViewerSettings {
    /** Whether to register the `display_file` tool at all. */
    tool: boolean;
    /**
     * Whether to refuse `read` on an opaque binary medium and point the model at
     * `display_file`. Off leaves the shipped `read` free to decode a raster as
     * UTF-8, which yields replacement characters rather than an error.
     */
    redirectRead: boolean;
    /**
     * Whether `display_file` may also put an admissible raster into model context
     * on routes that accept image input. Off keeps every display UI-only, which is
     * the cheaper choice when the files are for the human, not the model.
     */
    feedModel: boolean;
    /**
     * Whether to hide the shipped `read_image` from every agent, making
     * `display_file` the single image entry point. On is the default because the
     * two tools overlap on model-context ingestion, and a model offered both uses
     * both — the same image then enters context twice in one turn.
     */
    supersedeReadImage: boolean;
}
/** Field carrying {@link ViewerSettings.tool}. */
export declare const TOOL_FIELD = "tool";
/** Field carrying {@link ViewerSettings.redirectRead}. */
export declare const REDIRECT_READ_FIELD = "redirectRead";
/** Field carrying {@link ViewerSettings.feedModel}. */
export declare const FEED_MODEL_FIELD = "feedModel";
/** Field carrying {@link ViewerSettings.supersedeReadImage}. */
export declare const SUPERSEDE_READ_IMAGE_FIELD = "supersedeReadImage";
export {};
