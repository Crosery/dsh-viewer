/**
 * Host half of the viewer plugin: a `display_file` tool the model calls to put
 * a file on the user's screen, and the signed HTTP route that carries the bytes.
 *
 * Why a route at all, when the harness already has a durable attachment service:
 * that service is images-only, by design (`saveImage`, `readImage`,
 * `ImageAttachmentLimits.mediaTypes`). Video, audio, PDF and HTML have no
 * representation in it and no representation in model context either, so the
 * only way to get them in front of the user is to serve their bytes to the page.
 * Serving them by signed reference — rather than by a path the browser supplies
 * — is what keeps that route from being an arbitrary-file-read endpoint.
 *
 * The two paths are complementary, not redundant: an admissible raster on a
 * vision route still goes through the attachment store, because that is the only
 * way it also reaches the model.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ViewerSettings } from './contract.ts';
export { ASSET_ROUTE, DISPLAY_TOOL, VIEWER_SETTINGS_NAMESPACE, classifyPath, extensionOf, formatBytes, isOpaqueMediaPath, modelImageMediaTypeForPath, } from './contract.ts';
export type { DisplayValue, ModelImage, ViewerKind, ViewerSettings } from './contract.ts';
export { ViewerSettingsSchema } from './settings.ts';
export { assetUrlFor, verifyAssetRequest } from './asset-token.ts';
export { guardHeaders, parseRange } from './asset-route.ts';
export { artifactName, convertDocument, resolveConverter } from './convert.ts';
export { isMisdirectedRead, mediaReadValue, readPathOf } from './read-redirect.ts';
export { applySupersedeReadImage } from './supersede-read-image.ts';
/**
 * Settings namespace this plugin owns, as the settings service keys it.
 *
 * Plain string rather than a branded one since 0.1.2 removed the `settingsNamespace`
 * constructor that produced the brand. Consumers hand it to `ctx.settings`, which
 * validates it at registration either way.
 */
export declare const VIEWER_NAMESPACE = "crosery-viewer";
export declare const name = "@crosery/dsh-viewer";
/**
 * Required services — deliberately the smallest set that lets the tool exist.
 *
 * `webServer` is NOT here even though the asset route is the transport for
 * every non-raster medium. An entry that never activates is a hard boot failure
 * (`dsh: 1 entry did not activate`), not a graceful skip, so requiring it would
 * make this bundle un-composable with `dsh-headless` or `acp` rather than
 * merely inert there. It is injected as a nested scope below instead.
 *
 * `attachments` and `llm` are likewise optional and read through `ctx.get`: a
 * deployment without a durable store still displays everything it can reach —
 * it just cannot put an image into model context.
 */
export declare const inject: string[];
export type Config = ViewerSettings;
export declare const Config: import("@deepseek-ai/schemastery").default<ViewerSettings>;
/** Callbacks a mount invokes. Identical on every harness train that has a mount. */
export interface SettingsHooks {
    /** Receive the authoritative value: the resolved section while one is attached. */
    setSource(current: () => ViewerSettings): void;
    /** Re-judge derived state after an attach, a detach, or a committed change. */
    onChange(): void;
}
/**
 * Mount the `crosery-viewer` namespace over whichever settings API exists.
 *
 * Only called while a settings service is present: a composition without one
 * keeps the composition entry as the sole source, which `reconcile()` in
 * {@link apply} establishes on its own.
 *
 * @param ctx - plugin context: the mount's owner, and the injection parent.
 * @param config - composition entry config; both the `base` layer and the
 *   fallback value once the settings service detaches.
 * @param hooks - source and change callbacks.
 */
export declare function mountSettingsSection(ctx: Context, config: ViewerSettings, hooks: SettingsHooks): void;
/**
 * Mount the settings section, the asset route, the tool, and the read redirect.
 * @param ctx - plugin context.
 * @param config - composition entry config, used as the settings `base` layer.
 */
export declare function apply(ctx: Context, config: Config): void;
