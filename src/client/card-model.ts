/**
 * Pure derivation of a card's state from one tool block.
 *
 * Everything here runs during replay of a session logged by an older build, so
 * every read is defensive and every failure mode is a narrower card rather than
 * a throw: a crashing entry is removed from its slot for the rest of the
 * session, which would take the whole conversation's viewer cards down with it.
 *
 * Content blocks are narrowed structurally instead of through the Host's
 * `ContentBlock` union. The union is merge-extensible, so a build that knows
 * fewer arms than the log contains must still find the image arm it does know.
 * @module @crosery/dsh-viewer/client/card-model
 */

import {
  DISPLAY_TOOL, classifyPath, displayValueFrom, modelImageFrom,
  type DisplayValue,
} from '../contract.ts'

/**
 * The slice of one tool-call block this card reads, declared structurally.
 *
 * NOT imported from the client shell's package: that block type has lived in
 * two different packages across harness trains (`dsh-client-runtime` up to
 * 0.1.1, `dsh-client-ui-chat` from 0.1.2) and the older one stopped publishing
 * entirely. A type-only import would pin this plugin's toolchain to one train
 * and make the other fail to typecheck — the same class of breakage as an
 * import of a removed value export, one compilation later.
 *
 * Structure is also what this module actually uses. Every read below is
 * defensive and every field is optional: the block may be a live call, a
 * replayed log entry from an older build, or a shape a newer build wrote.
 */
export interface ToolCallBlockLike {
  /** Discriminates the running arm from the settled one. */
  kind?: string
  /** Raw arguments, on the running arm. */
  argsRaw?: string
  /** The settled call this result belongs to. */
  call?: { argsRaw?: string } | null
  /** Whether the tool reported a failure. */
  isError?: boolean
  /** Model-facing content blocks. */
  content?: readonly unknown[]
  /** Structured failure, when there is one. */
  error?: { code?: string } | null
  /** Presentation metadata this plugin wrote, on the settled arm. */
  meta?: unknown
}

/** What the card renders right now. */
export type CardState =
  /** The call is dispatched and no result has landed. */
  | { phase: 'running'; path: string | undefined }
  /** The call failed; `message` is the tool's own text. */
  | { phase: 'failed'; path: string | undefined; message: string }
  /** A displayable file, with everything the viewer needs. */
  | { phase: 'ready'; value: DisplayValue }
  /**
   * The call settled, but this build could not recover a viewer payload from
   * it — an older log, a truncated window, a shape a newer build wrote. The row
   * still renders; it just has nothing to play.
   */
  | { phase: 'bare'; path: string | undefined; message: string }

/** Whether one block is the settled arm of the union, which carries the result. */
function isSettled(
  block: ToolCallBlockLike,
): block is ToolCallBlockLike & { kind: 'tool-result'; content: readonly unknown[] } {
  return 'kind' in block && block.kind === 'tool-result'
}

/**
 * Recover the `file_path` argument from either arm of the block.
 *
 * The raw arguments are whatever the model emitted, so a parse failure is an
 * ordinary outcome — a card with no path in its header, not an error.
 * @param block - the running or settled call.
 * @returns the requested path, or `undefined` when it cannot be read.
 */
export function argumentPathOf(block: ToolCallBlockLike): string | undefined {
  const raw = isSettled(block) ? block.call?.argsRaw : block.argsRaw
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const { file_path: filePath } = parsed as Record<string, unknown>
    return typeof filePath === 'string' && filePath.length > 0 ? filePath : undefined
  } catch {
    return undefined
  }
}

/** Join a settled block's text blocks — the only human-readable failure detail. */
function textOf(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const { type, text } = block as Record<string, unknown>
    if (type === 'text' && typeof text === 'string') parts.push(text)
  }
  return parts.join('\n').trim()
}

/**
 * Find the first durable image carried by a settled result's content.
 *
 * This is what lets the plugin render the SHIPPED `read_image` tool, which
 * writes no presentation metadata at all: its image rides the model-facing
 * content blocks, and those are persisted with the result.
 * @param content - the settled result's content blocks.
 * @returns the validated image facts, or `undefined` when there is no image.
 */
export function contentImageOf(content: readonly unknown[]): DisplayValue['image'] | undefined {
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const { type, attachment } = block as Record<string, unknown>
    if (type !== 'image') continue
    const image = modelImageFrom(attachment)
    if (image !== undefined) return image
  }
  return undefined
}

/** Read one element out of a result envelope. */
function element(text: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  const value = match?.[1]?.trim()
  return value !== undefined && value.length > 0 ? value : undefined
}

/**
 * Recover the displayed path from a settled `read_image`-style result whose
 * only structured record is its text envelope.
 * @param content - the settled result's content blocks.
 * @returns the path inside the envelope's `<path>` element, when present.
 */
function envelopePathOf(content: readonly unknown[]): string | undefined {
  return element(textOf(content), 'path')
}

/**
 * Rebuild a viewer payload from this plugin's own result envelope.
 *
 * The recovery path for a NESTED dispatch: the registry projects
 * `presentationMeta` only for top-level calls, so a `display_file` invoked from
 * inside `run_code` persists content blocks and nothing else. The envelope is
 * this plugin's own structured output, and the result is validated through the
 * same narrowing every replayed payload goes through — including the guard that
 * refuses an asset URL which is not this plugin's route.
 * @param content - the settled result's content blocks.
 * @param inContext - whether the result also carried a durable image block.
 * @returns the validated payload, or `undefined` when the envelope is not ours.
 */
export function envelopeValueOf(content: readonly unknown[], inContext: boolean): DisplayValue | undefined {
  const text = textOf(content)
  const path = element(text, 'path')
  const kind = element(text, 'type')
  const mediaType = element(text, 'media')
  const bytes = Number(element(text, 'bytes') ?? Number.NaN)
  if (path === undefined || kind === undefined || mediaType === undefined || !Number.isInteger(bytes)) return undefined
  const assetUrl = element(text, 'asset')
  return displayValueFrom({
    path,
    kind,
    mediaType,
    bytes,
    inContext,
    ...assetUrl === undefined ? {} : { assetUrl },
  })
}

/**
 * Derive the card state for one call.
 * @param block - the running or settled call.
 * @param toolName - the wire tool name this entry was dispatched for; it selects
 *   which recovery path applies, since only `display_file` writes metadata.
 * @returns the state to render.
 */
export function cardModel(block: ToolCallBlockLike, toolName: string): CardState {
  const path = argumentPathOf(block)
  if (!isSettled(block)) return { phase: 'running', path }
  if (block.isError) {
    const message = textOf(block.content)
    return { phase: 'failed', path, message: message.length > 0 ? message : block.error?.code ?? 'failed' }
  }

  const image = contentImageOf(block.content)

  if (toolName === DISPLAY_TOOL) {
    const value = displayValueFrom(block.meta)
    if (value !== undefined) return { phase: 'ready', value }
    // No metadata: a nested `run_code` dispatch, which the registry never
    // projects. The envelope this tool wrote is the remaining structured record.
    const recovered = envelopeValueOf(block.content, image !== undefined)
    if (recovered !== undefined) {
      return { phase: 'ready', value: { ...recovered, ...image === undefined ? {} : { image } } }
    }
  }

  // A foreign tool (the shipped `read_image`) writes no metadata and no envelope
  // of ours: the persisted image block is the remaining source.
  if (image !== undefined) {
    const displayPath = path ?? envelopePathOf(block.content) ?? image.name ?? ''
    return {
      phase: 'ready',
      value: {
        path: displayPath,
        kind: 'image',
        mediaType: image.mediaType,
        bytes: image.bytes,
        // No asset URL: this result was not minted by this plugin, so the bytes
        // come over the session attachment channel instead.
        image,
        inContext: true,
      },
    }
  }
  return {
    phase: 'bare',
    path,
    message: path === undefined ? '' : classifyPath(path).mediaType,
  }
}
