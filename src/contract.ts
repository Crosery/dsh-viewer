/**
 * Viewer taxonomy, field names, and wire shapes shared by both halves.
 *
 * Deliberately free of `@deepseek-ai/schemastery` and of every `node:` import:
 * the browser half imports this module, so a validator or a Node builtin
 * reaching it would be inlined into (or break) the client bundle. The Host
 * schema is built over this module in `settings.ts`.
 */

/** Wire name of the display tool this plugin registers. */
export const DISPLAY_TOOL = 'display_file'

/**
 * Wire name of the shipped `dsh-tool-fs` image reader. This plugin does not own
 * it — it only registers a card for it, so an image the model pulled in through
 * the shipped tool is shown as a picture too instead of a bare text row.
 */
export const READ_IMAGE_TOOL = 'read_image'

/** Wire name of the shipped text read, whose binary-media calls get redirected. */
export const READ_TOOL = 'read'

/** Settings namespace this plugin owns. */
export const VIEWER_SETTINGS_NAMESPACE = 'crosery-viewer'

/**
 * HTTP route serving one asset's bytes to the browser half.
 *
 * Scoped, because a duplicate exact route fails the WHOLE plugin tree at boot,
 * not just the offender.
 */
export const ASSET_ROUTE = '/crosery/dsh-viewer/asset'

/**
 * How the browser half renders one file.
 *
 * The axis is "which element plays this", not "what is this file" — `svg` and
 * `png` are both `image` because both go in an `<img>`, and everything with no
 * player at all lands on `file`, which still gets a card with the file's facts
 * and a link. There is no kind that renders nothing.
 */
export type ViewerKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'html' | 'file'

/** One extension's classification. */
interface MediaSpec {
  /** Which element plays it. */
  readonly kind: ViewerKind
  /** Content type the asset route sends, and the card's declared type. */
  readonly mediaType: string
}

/** Media type of a raster the durable attachment service admits. */
export type ModelImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** {@link ModelImageMediaType} as a runtime set, for narrowing replayed JSON. */
export const MODEL_IMAGE_MEDIA_TYPES: readonly ModelImageMediaType[] = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]

/**
 * Lowercased extension (dot included) to its classification.
 *
 * Only formats a mainstream browser actually plays are listed: an entry here is
 * a promise that the card will render something, so a codec the browser would
 * refuse belongs on the `file` fallback instead of in this table.
 */
export const MEDIA_TABLE: Readonly<Record<string, MediaSpec>> = {
  // Rasters and vectors an <img> renders. The first four are also the exact
  // set the durable attachment service admits, which is what lets them reach
  // model context; the rest are display-only.
  '.png': { kind: 'image', mediaType: 'image/png' },
  '.jpg': { kind: 'image', mediaType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mediaType: 'image/jpeg' },
  '.webp': { kind: 'image', mediaType: 'image/webp' },
  '.gif': { kind: 'image', mediaType: 'image/gif' },
  '.svg': { kind: 'image', mediaType: 'image/svg+xml' },
  '.avif': { kind: 'image', mediaType: 'image/avif' },
  '.bmp': { kind: 'image', mediaType: 'image/bmp' },
  '.ico': { kind: 'image', mediaType: 'image/x-icon' },
  '.apng': { kind: 'image', mediaType: 'image/apng' },

  '.mp4': { kind: 'video', mediaType: 'video/mp4' },
  '.m4v': { kind: 'video', mediaType: 'video/x-m4v' },
  '.webm': { kind: 'video', mediaType: 'video/webm' },
  '.ogv': { kind: 'video', mediaType: 'video/ogg' },
  '.mov': { kind: 'video', mediaType: 'video/quicktime' },

  '.mp3': { kind: 'audio', mediaType: 'audio/mpeg' },
  '.m4a': { kind: 'audio', mediaType: 'audio/mp4' },
  '.aac': { kind: 'audio', mediaType: 'audio/aac' },
  '.wav': { kind: 'audio', mediaType: 'audio/wav' },
  '.flac': { kind: 'audio', mediaType: 'audio/flac' },
  '.ogg': { kind: 'audio', mediaType: 'audio/ogg' },
  '.oga': { kind: 'audio', mediaType: 'audio/ogg' },
  '.opus': { kind: 'audio', mediaType: 'audio/ogg' },

  '.pdf': { kind: 'pdf', mediaType: 'application/pdf' },

  // Office and OpenDocument. No browser renders any of these, so the Host
  // converts them before the card ever sees them — `mediaType` here is the
  // SOURCE type, and the served artifact's type replaces it in the outcome.
  '.docx': { kind: 'document', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.doc': { kind: 'document', mediaType: 'application/msword' },
  '.rtf': { kind: 'document', mediaType: 'application/rtf' },
  '.odt': { kind: 'document', mediaType: 'application/vnd.oasis.opendocument.text' },
  '.xlsx': { kind: 'document', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.xls': { kind: 'document', mediaType: 'application/vnd.ms-excel' },
  '.ods': { kind: 'document', mediaType: 'application/vnd.oasis.opendocument.spreadsheet' },
  '.pptx': { kind: 'document', mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.ppt': { kind: 'document', mediaType: 'application/vnd.ms-powerpoint' },
  '.odp': { kind: 'document', mediaType: 'application/vnd.oasis.opendocument.presentation' },

  '.html': { kind: 'html', mediaType: 'text/html' },
  '.htm': { kind: 'html', mediaType: 'text/html' },
}

/** Classification used for an extension {@link MEDIA_TABLE} does not list. */
export const UNKNOWN_MEDIA: MediaSpec = { kind: 'file', mediaType: 'application/octet-stream' }

/**
 * The extensions whose bytes the durable attachment service admits, mapped to
 * the media type it verifies them as. A file outside this set can still be
 * displayed — it just cannot enter model context, because there is no durable
 * attachment to reference it by.
 */
export const MODEL_IMAGE_EXTENSIONS: Readonly<Record<string, ModelImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Viewer kinds whose bytes are useless as UTF-8 text, so a `read` naming one is
 * a mistake worth correcting rather than a decode that yields replacement
 * characters. `html` is absent on purpose: reading HTML source is a legitimate
 * text read, and displaying it is a different intent.
 */
export const OPAQUE_KINDS: readonly ViewerKind[] = ['image', 'video', 'audio', 'pdf', 'document']

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
export function extensionOf(filePath: string): string | undefined {
  const base = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  return base.slice(dot).toLowerCase()
}

/**
 * Classify a path into the element that will render it.
 * @param filePath - the raw path as the model wrote it.
 * @returns the viewer kind and the content type the asset route will send;
 *   {@link UNKNOWN_MEDIA} for anything the table does not list.
 */
export function classifyPath(filePath: string): MediaSpec {
  const extension = extensionOf(filePath)
  if (extension === undefined) return UNKNOWN_MEDIA
  // Own-property check only: a filename whose extension collides with an
  // Object.prototype key (`clip.constructor`) must fall back, not resolve to
  // the inherited member.
  return Object.hasOwn(MEDIA_TABLE, extension) ? MEDIA_TABLE[extension]! : UNKNOWN_MEDIA
}

/**
 * The media type the attachment service would verify this path's bytes as.
 * @param filePath - the raw path as the model wrote it.
 * @returns the admissible media type, or `undefined` when the bytes could never
 *   become a durable attachment.
 */
export function modelImageMediaTypeForPath(filePath: string): ModelImageMediaType | undefined {
  const extension = extensionOf(filePath)
  if (extension === undefined) return undefined
  return Object.hasOwn(MODEL_IMAGE_EXTENSIONS, extension) ? MODEL_IMAGE_EXTENSIONS[extension] : undefined
}

/**
 * Whether a `read` naming this path is decoding bytes that are not text.
 * @param filePath - the raw path as the model wrote it.
 * @returns true when the path names an opaque binary medium.
 */
export function isOpaqueMediaPath(filePath: string): boolean {
  return OPAQUE_KINDS.includes(classifyPath(filePath).kind)
}

/**
 * Durable image facts for a raster that also reached the attachment store.
 *
 * Structurally the attachment service's `ImageAttachmentRef` minus the fields a
 * card never reads. Restated instead of imported so the browser half stays free
 * of Host packages; the Host half projects a real reference into this shape.
 */
export interface ModelImage {
  /** Opaque durable storage id; never a filesystem path or a bearer URL. */
  attachmentId: string
  /** Media type verified from the stored bytes. */
  mediaType: ModelImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Display name stripped of local path information. */
  name?: string
}

/**
 * Canonical `display_file` outcome — what `execute` returns, what a `run_code`
 * program receives, and (verbatim) what rides `tool/result` as presentation
 * metadata so a reopened session rebuilds the same card.
 */
export interface DisplayValue {
  /** The backend-resolved path that was displayed. */
  path: string
  /** Which element the card renders. */
  kind: ViewerKind
  /** Content type the asset route sends for this file. */
  mediaType: string
  /** Byte size, or 0 when the backend does not report one. */
  bytes: number
  /**
   * Same-origin signed URL the card loads. Absent when the filesystem backend
   * exposes no local path for the target (a remote workspace), in which case an
   * admissible raster still reaches the card through {@link ModelImage}.
   */
  assetUrl?: string
  /** Present only for a raster this call committed to the attachment store. */
  image?: ModelImage
  /**
   * Why there is nothing to render, when the call succeeded but produced no
   * viewable bytes — a document whose conversion is unavailable, typically.
   * The card shows this verbatim instead of a generic placeholder.
   */
  unavailable?: string
  /**
   * Whether the image ALSO entered model context. False is the ordinary
   * outcome for every non-raster and for every text-only model route: the file
   * is on the user's screen, not in the model's context.
   */
  inContext: boolean
}

/** Narrow one unknown value to {@link ModelImage}. */
export function modelImageFrom(value: unknown): ModelImage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { attachmentId, mediaType, bytes, width, height, name } = value as Record<string, unknown>
  if (typeof attachmentId !== 'string' || attachmentId.length === 0) return undefined
  if (typeof mediaType !== 'string' || !MODEL_IMAGE_MEDIA_TYPES.includes(mediaType as ModelImageMediaType)) return undefined
  // Every numeric field must be a positive integer: a card built from a zero or
  // fractional dimension would divide by zero while fitting its preview box.
  if (!isPositiveInteger(bytes) || !isPositiveInteger(width) || !isPositiveInteger(height)) return undefined
  if (name !== undefined && typeof name !== 'string') return undefined
  return {
    attachmentId,
    mediaType: mediaType as ModelImageMediaType,
    bytes,
    width,
    height,
    ...name === undefined ? {} : { name },
  }
}

/** Every {@link ViewerKind}, for narrowing replayed JSON. */
const VIEWER_KINDS: readonly ViewerKind[] = ['image', 'video', 'audio', 'pdf', 'document', 'html', 'file']

/**
 * Narrow opaque live or replayed result metadata to a {@link DisplayValue}.
 *
 * Defensive because the browser side reads data written by an older version of
 * this plugin (or by nothing at all). Malformed metadata returns `undefined` so
 * the card falls back to a plain row instead of throwing during replay.
 * @param meta - the `tool/result` metadata, verbatim.
 * @returns the validated projection, or `undefined` when absent or malformed.
 */
export function displayValueFrom(meta: unknown): DisplayValue | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { path, kind, mediaType, bytes, assetUrl, image, inContext, unavailable } = meta as Record<string, unknown>
  if (typeof path !== 'string' || path.length === 0) return undefined
  if (typeof kind !== 'string' || !VIEWER_KINDS.includes(kind as ViewerKind)) return undefined
  if (typeof mediaType !== 'string' || mediaType.length === 0) return undefined
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) return undefined
  if (typeof inContext !== 'boolean') return undefined
  // An asset URL must be a same-origin absolute path. Anything else — an
  // absolute URL, a protocol-relative one — is refused rather than handed to an
  // <img>/<iframe> src, because replayed metadata is not a trusted source.
  if (assetUrl !== undefined && (typeof assetUrl !== 'string' || !assetUrl.startsWith(`${ASSET_ROUTE}?`))) return undefined
  if (unavailable !== undefined && typeof unavailable !== 'string') return undefined
  const narrowedImage = image === undefined ? undefined : modelImageFrom(image)
  if (image !== undefined && narrowedImage === undefined) return undefined
  return {
    path,
    kind: kind as ViewerKind,
    mediaType,
    bytes,
    inContext,
    ...assetUrl === undefined ? {} : { assetUrl },
    ...narrowedImage === undefined ? {} : { image: narrowedImage },
    ...unavailable === undefined ? {} : { unavailable },
  }
}

/** Whether `value` is a finite integer greater than zero. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * Render a byte count the way a file manager does.
 * @param bytes - non-negative byte count.
 * @returns a short human string, or an empty string when the size is unknown.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** Durable settings section owned by this plugin. */
export interface ViewerSettings {
  /** Whether to register the `display_file` tool at all. */
  tool: boolean
  /**
   * Whether to refuse `read` on an opaque binary medium and point the model at
   * `display_file`. Off leaves the shipped `read` free to decode a raster as
   * UTF-8, which yields replacement characters rather than an error.
   */
  redirectRead: boolean
  /**
   * Whether `display_file` may also put an admissible raster into model context
   * on routes that accept image input. Off keeps every display UI-only, which is
   * the cheaper choice when the files are for the human, not the model.
   */
  feedModel: boolean
  /**
   * Whether to hide the shipped `read_image` from every agent, making
   * `display_file` the single image entry point. On is the default because the
   * two tools overlap on model-context ingestion, and a model offered both uses
   * both — the same image then enters context twice in one turn.
   */
  supersedeReadImage: boolean
}

/** Field carrying {@link ViewerSettings.tool}. */
export const TOOL_FIELD = 'tool'

/** Field carrying {@link ViewerSettings.redirectRead}. */
export const REDIRECT_READ_FIELD = 'redirectRead'

/** Field carrying {@link ViewerSettings.feedModel}. */
export const FEED_MODEL_FIELD = 'feedModel'

/** Field carrying {@link ViewerSettings.supersedeReadImage}. */
export const SUPERSEDE_READ_IMAGE_FIELD = 'supersedeReadImage'
