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
import type { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import { type DisplayValue, type ModelImage } from './contract.ts';
/** Live settings and key material {@link applyDisplayTool} reads per call. */
export interface DisplayToolOptions {
    /** Whether an image-capable route may also receive the image itself. */
    feedModel: () => boolean;
    /** The harness asset MAC key, or `undefined` while it is still loading. */
    secret: () => Buffer | undefined;
    /** Directory owning converted document artifacts. */
    cacheDir: string;
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
export declare function routeAcceptsImages(ctx: Context, exec: ToolExecution): Promise<boolean>;
/**
 * Project a durable attachment reference into the plugin's wire shape.
 * @param ref - the reference the attachment service published.
 * @returns the card-facing image facts.
 */
export declare function modelImageOf(ref: ImageAttachmentRef): ModelImage;
/**
 * Re-brand the plugin's wire shape back into an attachment reference.
 * @param image - the canonical image facts.
 * @returns the branded reference an `ImageBlock` carries.
 */
export declare function attachmentRefOf(image: ModelImage): ImageAttachmentRef;
/**
 * Format the model-facing envelope. Pure, and — for every medium except an
 * in-context raster — the only thing the model receives, so it states plainly
 * what is on the user's screen and that the model itself cannot see it.
 * @param value - the canonical outcome.
 * @returns the envelope body.
 */
export declare function formatDisplayOutput(value: DisplayValue): string;
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
export declare function applyDisplayTool(ctx: Context, options: DisplayToolOptions): () => void;
