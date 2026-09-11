/**
 * Browser half of the viewer plugin.
 *
 * Registers one card into the tool-view slot for two keys: the plugin's own
 * `display_file`, and the shipped `read_image` — which upstream renders as a
 * plain text row, so an image the model already pulled into context is invisible
 * to the human sitting in front of it. `read_image` has no card registered
 * upstream, so taking that key is additive rather than a takeover.
 *
 * The card's only Host dependency is the durable attachment channel, reached
 * through `ctx.sessions`. Everything else (video, audio, PDF, HTML) arrives over
 * the Host's signed asset route as an ordinary same-origin URL.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only throughout: these pull the Context merges that give `ctx` its
// services and declare the slot this plugin registers into. Cross-plugin
// collaboration goes through those services — a value import here would fail the
// client bundle-purity contract and, at runtime, require a specifier the
// loader's module table cannot answer.
//
// The session service merge is deliberately NOT imported: `sessions` was
// declared by `@deepseek-ai/dsh-client-runtime` up to harness 0.1.1 and by
// `@deepseek-ai/dsh-api-session-controller` from 0.1.2, and the former stopped
// publishing. Importing either one pins this plugin to a single train and
// fails the other's typecheck, so the slice this card reads is declared
// structurally below instead — the same contract, read the same way on both.
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { DISPLAY_TOOL, READ_IMAGE_TOOL } from '../contract.ts'
import { ViewerCard, type ViewerCardInjected } from './ViewerCard.tsx'
import { en, zh, type ViewerKey } from './locales.ts'
import { installViewerStyles } from './styles.ts'

export type { CardState } from './card-model.ts'
export { cardModel, argumentPathOf, contentImageOf } from './card-model.ts'
export type { ViewerCardInjected } from './ViewerCard.tsx'
export type { ViewerKey } from './locales.ts'

/** Namespace owning this card's copy. */
export const VIEWER_NS = 'tool.viewer'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The viewer card's copy. */
    'tool.viewer': ViewerKey
  }
}

/**
 * The client session-service slice this card reads, declared structurally.
 *
 * Two members, both stable across the trains this plugin supports: the service
 * is named `sessions` and a binding exposes `session.readAttachment`. The
 * result union is the carrier's own `RpcResult`/`RemoteResult` shape, which the
 * harness renamed without changing its arms. Nothing here is nominally tied to
 * a package name, so a train that moves this service to another package (0.1.2
 * moved it out of `dsh-client-runtime`) breaks neither the typecheck nor the
 * bundle.
 */
interface ViewerSessionFace {
  /** Durable image bytes, or the carrier's failure. */
  readAttachment(id: string): Promise<
    | { ok: true; value: { attachment: { mediaType: string }; data: Uint8Array } }
    | { ok: false; error: { code: string; message: string } }
  >
}

/** The `sessions` service, as far as this plugin is concerned. */
interface ViewerSessions {
  binding(id: SessionId): { session: ViewerSessionFace } | undefined
}

/**
 * Why the service is read by name instead of through the context's own merge:
 * every harness train declares `ctx.sessions`, but each declares it from a
 * different package (`dsh-client-runtime` up to 0.1.1, `dsh-api-session-controller`
 * from 0.1.2) — and on the older train that declaration still reaches this
 * program through another plugin's imports. Importing either one pins the build
 * to a train; declaring the property here collides with the one already in the
 * graph. Reading the service by name is what works on both, and the value is
 * narrowed once to the slice this card actually calls.
 */

/**
 * Durable attachments resolved to browser URLs, once each.
 *
 * Object URLs are process-global and are not reclaimed by unmounting the `<img>`
 * that used them, so somebody has to own their lifetime. Caching per
 * session+attachment means scrolling a long conversation re-renders cards
 * without re-fetching bytes, and one revoke pass at plugin disposal releases
 * everything. The bound is the number of DISTINCT attachments displayed in one
 * page lifetime — a session that views hundreds of images holds hundreds of blob
 * URLs until reload, which is the same bound the shipped conversation gallery
 * accepts per session.
 */
class AttachmentUrls {
  private readonly pending = new Map<string, Promise<string>>()
  private readonly created = new Set<string>()
  private disposed = false

  /** @param ctx - client context used to reach the sessions service. */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Resolve one attachment to a URL this page can load.
   * @param sessionId - the session authorizing the read.
   * @param attachmentId - the opaque durable id.
   * @returns a URL valid until this plugin unloads.
   */
  resolve(sessionId: SessionId, attachmentId: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('dsh-viewer: the plugin was unloaded'))
    const key = `${sessionId}:${attachmentId}`
    const cached = this.pending.get(key)
    if (cached !== undefined) return cached

    // The cast is the narrowing step described above: `ctx.get` types the value
    // as the ambient declaration's `ISessions`, and this plugin reads exactly
    // two members of it.
    const sessions = this.ctx.get('sessions') as unknown as ViewerSessions | undefined
    const session = sessions?.binding(sessionId)?.session
    if (session === undefined) return Promise.reject(new Error(`dsh-viewer: unknown session "${sessionId}"`))

    const request = session.readAttachment(attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (this.disposed) throw new Error('dsh-viewer: the plugin unloaded before the image arrived')
        const { data, attachment } = result.value
        if (typeof URL.createObjectURL !== 'function') {
          return `data:${attachment.mediaType};base64,${base64Of(data)}`
        }
        // Copying through `Uint8Array.from` detaches the blob from whatever
        // buffer the transport handed over, which may be a pooled one.
        const bytes = Uint8Array.from(data)
        const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: attachment.mediaType }))
        this.created.add(url)
        return url
      })
      .catch((error: unknown) => {
        // A failed load must not poison the cache: the card's retry re-enters
        // this method and has to start a fresh request.
        this.pending.delete(key)
        throw error
      })
    this.pending.set(key, request)
    return request
  }

  /** Revoke every URL this cache minted. */
  dispose(): void {
    this.disposed = true
    this.pending.clear()
    for (const url of this.created) URL.revokeObjectURL(url)
    this.created.clear()
  }
}

/** Base64 of raw bytes, for the environments with no object-URL support. */
function base64Of(data: Uint8Array): string {
  let binary = ''
  // Chunked so a multi-megabyte image cannot blow the argument limit of
  // `String.fromCharCode`.
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/**
 * Required services. `sessions` is required rather than optional because the
 * attachment channel is the card's fallback byte source; `locale` and `slots`
 * are the registration surface.
 */
export const inject = ['slots', 'locale', 'sessions']

export const name = '@crosery/dsh-viewer'

/**
 * Client plugin body: own the URL cache and register the card under both keys.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  installViewerStyles(ctx)

  const urls = new AttachmentUrls(ctx)
  ctx.effect(() => () => { urls.dispose() }, '@crosery/dsh-viewer: attachment URLs')
  ctx.effect(() => ctx.locale.register(VIEWER_NS, { zh, en }), '@crosery/dsh-viewer: card dictionaries')

  // One factory, two keys. The slot is session-scoped, so the framework hands
  // the factory the resolved session id and the loader closes over it — the
  // component never learns which session it belongs to.
  const injected = (sessionId: SessionId): ViewerCardInjected => ({
    loadAttachment: attachmentId => urls.resolve(sessionId, attachmentId),
  })

  for (const key of [DISPLAY_TOOL, READ_IMAGE_TOOL]) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key,
      locale: VIEWER_NS,
      inject: injected,
    }, ViewerCard))
  }
}
