/**
 * The `display_file` tool: put a file on the user's screen.
 *
 * The difference from the shipped `read_image` is one deliberate inversion.
 * `read_image` exists to put an image into MODEL context, so it refuses outright
 * on a route that declares no image input, and it handles images only. This tool
 * exists to put a file on the SCREEN, so a text-only route is a normal outcome
 * rather than a refusal, and every medium a browser can play is in scope —
 * video, audio, PDF and HTML have no representation in model context at all and
 * would otherwise be undisplayable.
 *
 * That is why the durable facts ride `output.presentationMeta`. An image block
 * is model-facing and exists only for four raster types on one kind of route;
 * the meta is UI-facing, persists with `tool/result`, and therefore rebuilds
 * the card when the session is reopened.
 * @module @crosery/dsh-viewer/display-file
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import {
  DISPLAY_TOOL, classifyPath, formatBytes, modelImageMediaTypeForPath,
  type DisplayValue, type ModelImage, type ModelImageMediaType,
} from './contract.ts'
import { assetUrlFor } from './asset-token.ts'
import { CONVERTED_MEDIA_TYPE, convertDocument } from './convert.ts'
import { resolveDisplayTarget } from './read-target.ts'

/** Plugin name stamped on a deferred nested-dispatch context. */
const PLUGIN = '@crosery/dsh-viewer'

/** Live settings and key material {@link applyDisplayTool} reads per call. */
export interface DisplayToolOptions {
  /** Whether an image-capable route may also receive the image itself. */
  feedModel: () => boolean
  /** The harness asset MAC key, or `undefined` while it is still loading. */
  secret: () => Buffer | undefined
  /** Directory owning converted document artifacts. */
  cacheDir: string
}

/**
 * Whether the call's routed model accepts image input.
 *
 * Resolution mirrors the shipped `read_image` gate — request-header config
 * first, then the agent's own options — but the outcome is a boolean, not a
 * refusal: an unresolvable route simply means "not image-capable", which
 * degrades to a screen-only display instead of failing a call that would
 * otherwise have worked.
 * @param ctx - the plugin context used to reach the optional `llm` service.
 * @param exec - the execution whose calling agent names the route.
 * @returns whether an image block may be emitted for this call.
 */
export async function routeAcceptsImages(ctx: Context, exec: ToolExecution): Promise<boolean> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) return false
  try {
    const active = await llm.resolveModelInfo(provider, model, exec.signal)
    return active.inputModalities?.includes('image') === true
  } catch {
    // A capability lookup that fails (offline catalog, unknown model id) must
    // not fail the call: the picture still reaches the screen.
    return false
  }
}

/**
 * Project a durable attachment reference into the plugin's wire shape.
 * @param ref - the reference the attachment service published.
 * @returns the card-facing image facts.
 */
export function modelImageOf(ref: ImageAttachmentRef): ModelImage {
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType as ModelImageMediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
  }
}

/**
 * Re-brand the plugin's wire shape back into an attachment reference.
 * @param image - the canonical image facts.
 * @returns the branded reference an `ImageBlock` carries.
 */
export function attachmentRefOf(image: ModelImage): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Format the model-facing envelope. Pure, and — for every medium except an
 * in-context raster — the only thing the model receives, so it states plainly
 * what is on the user's screen and that the model itself cannot see it.
 * @param value - the canonical outcome.
 * @returns the envelope body.
 */
export function formatDisplayOutput(value: DisplayValue): string {
  const size = formatBytes(value.bytes)
  const dimensions = value.image === undefined ? '' : `, ${value.image.width}x${value.image.height} px`
  const facts = [value.mediaType, size].filter(part => part.length > 0).join(', ')
  const note = value.inContext
    ? 'The image is attached below and is also displayed in the web UI.'
    : 'It is displayed in the web UI for the user. You cannot see its content — do not describe or summarize it unless the user tells you what it shows.'
  // The three machine fields exist for one specific case: a NESTED dispatch.
  // The registry projects `presentationMeta` only for top-level calls
  // (`exec.parent === undefined`), so a `display_file` called from inside
  // `run_code` reaches the card with no metadata at all and would render as a
  // bare header. Content blocks are persisted for nested calls too, so the
  // envelope carries what the card needs to rebuild itself — this is the card
  // parsing its own structured envelope, not prose.
  const machine = [
    `<media>${value.mediaType}</media>`,
    `<bytes>${value.bytes}</bytes>`,
    ...value.assetUrl === undefined ? [] : [`<asset>${value.assetUrl}</asset>`],
  ].join('\n')
  return `<path>${value.path}</path>
<type>${value.kind}</type>
${machine}
<content>
${facts}${dimensions}
${note}
</content>`
}

/**
 * Project one canonical outcome into its model-facing blocks.
 * @param value - the canonical outcome.
 * @returns the envelope, plus the image itself when it entered model context.
 */
function displayContent(value: DisplayValue): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text: formatDisplayOutput(value) }]
  if (value.inContext && value.image !== undefined) {
    blocks.push({ type: 'image', attachment: attachmentRefOf(value.image) })
  }
  return blocks
}

/**
 * Commit a raster to the durable attachment store.
 * @param ctx - context supplying `fs` and `attachments`.
 * @param exec - the running execution, for cancellation.
 * @param target - the resolved target to read.
 * @param mediaType - the media type the extension declares.
 * @returns the published reference.
 * @throws a caller-correctable error when the bytes are not the declared format.
 */
async function commitImage(
  ctx: Context,
  exec: ToolExecution,
  target: FsTarget,
  mediaType: ModelImageMediaType,
): Promise<ImageAttachmentRef> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment service is mounted')
  // One result carries at most one image, so the per-message aggregate bound
  // applies beside the per-image bound.
  const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
  try {
    return await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
  } catch (error: unknown) {
    if (!(error instanceof AttachmentError) || error.code !== 'IMAGE_TYPE_MISMATCH') throw error
    const extension = extname(target.displayPath).toLowerCase()
    throw new Error(
      `cannot display "${target.displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format, or convert it`,
      { cause: error },
    )
  }
}

/**
 * Register `display_file` into the given context.
 *
 * The composing plugin owns the service gates: `src/index.ts` calls this inside
 * the `fs` injection, and execution treats `attachments` as optional so a
 * deployment with no durable store still displays every medium — it just cannot
 * put a raster into model context.
 * @param ctx - the registration scope; execution uses its `fs` service plus the
 *   optional `attachments`/`llm` services.
 * @param options - live settings reads and the asset MAC key.
 * @returns the disposer that unregisters the tool, so a settings change can
 *   remove it from the model's schema list rather than leave it there refusing.
 */
export function applyDisplayTool(ctx: Context, options: DisplayToolOptions): () => void {
  return ctx.tools.register(defineTool({
    name: DISPLAY_TOOL,
    description: 'Display a file to the user in the web UI: images (PNG/JPEG/WebP/GIF/SVG/AVIF/BMP), video (MP4/WebM/MOV/OGV), audio (MP3/WAV/FLAC/OGG/M4A/Opus), PDF, and HTML all render inline with a real player. Use this whenever the user should SEE or HEAR a file — the read tool decodes UTF-8 text and cannot show any of them. On a model route that accepts image input a PNG/JPEG/WebP/GIF also enters your own context; everything else is shown to the user only.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the file, resolved by the filesystem backend.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          kind: { type: 'string', enum: ['image', 'video', 'audio', 'pdf', 'document', 'html', 'file'], required: true },
          mediaType: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          inContext: { type: 'boolean', required: true },
          assetUrl: { type: 'string' },
          unavailable: { type: 'string' },
          image: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => displayContent(value),
      // The canonical value never reaches the wire, and most media carry no
      // content block at all — so without this projection a reopened session
      // would have nothing left to rebuild the card from.
      presentationMeta: (_args, value) => ({ ...value, ...value.image === undefined ? {} : { image: { ...value.image } } }),
    },
    // Content-addressed attachment writes are idempotent and the asset route is
    // a pure read, so concurrent displays of one file cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')

      let conversionError: string | undefined
      const spec = classifyPath(args.file_path)
      const { target, info } = await resolveDisplayTarget(ctx, exec, args.file_path)

      // A backend with no local execution path (a remote workspace) cannot be
      // streamed. That is not fatal: an admissible raster still reaches the card
      // through the attachment store below, and anything else degrades to a card
      // that says so rather than to a failed call.
      let assetUrl: string | undefined
      let servedType = spec.mediaType
      const secret = options.secret()
      if (secret !== undefined) {
        try {
          const processPath = ctx.fs.processPath(target)
          // A document is signed at its CONVERTED artifact, never at the source:
          // the route serves bytes verbatim, and no browser renders a .docx.
          if (spec.kind === 'document') {
            assetUrl = assetUrlFor(secret, await convertDocument(processPath, options.cacheDir, exec.signal))
            servedType = CONVERTED_MEDIA_TYPE
          } else {
            assetUrl = assetUrlFor(secret, processPath)
          }
        } catch (error: unknown) {
          // A missing LibreOffice, or a document it could not read, must not
          // fail the call — the card says why it cannot preview and the model
          // still learns the file exists and how big it is.
          if (spec.kind !== 'document') throw error
          conversionError = error instanceof Error ? error.message : String(error)
          assetUrl = undefined
        }
      }

      const imageMediaType = modelImageMediaTypeForPath(target.displayPath)
      const attachments = ctx.get('attachments')
      const admissible = imageMediaType !== undefined
        && attachments !== undefined
        && attachments.imageLimits.mediaTypes.includes(imageMediaType)
      const inContext = admissible && options.feedModel() && await routeAcceptsImages(ctx, exec)
      // Commit only when the bytes are actually needed: to reach model context,
      // or as the sole delivery path when no asset URL could be minted. A
      // display that already has a streaming URL and no vision route pays for no
      // extra copy of the file.
      const image = admissible && (inContext || assetUrl === undefined)
        ? modelImageOf(await commitImage(ctx, exec, target, imageMediaType))
        : undefined

      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)

      const value: DisplayValue = {
        path: target.displayPath,
        kind: spec.kind,
        mediaType: servedType,
        bytes: info.size ?? 0,
        inContext: inContext && image !== undefined,
        ...assetUrl === undefined ? {} : { assetUrl },
        ...image === undefined ? {} : { image },
        ...conversionError === undefined ? {} : { unavailable: conversionError },
      }
      // A nested (run_code) dispatch produces no model message of its own, so an
      // image that belongs in context has to be deferred explicitly.
      if (exec.parent !== undefined && value.inContext) {
        exec.deferContext(createUserMessage({
          content: displayContent(value),
          source: { kind: 'plugin', plugin: PLUGIN },
        }))
      }
      return value
    },
    // Pure display: a generic card in the read family with a follow-along
    // location, matching how the shipped read tools present.
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Display ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
