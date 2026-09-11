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

import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// Type-only: pulls the ctx.settings merge. The two value helpers this plugin
// used to import were removed in 0.1.2; `mountSettingsSection` below drives the
// service instead, on both trains.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: pulls the ctx.webServer / ctx.tools / ctx.systemPrompt merges.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ASSET_ROUTE, VIEWER_SETTINGS_NAMESPACE, type ViewerSettings } from './contract.ts'
import { ViewerSettingsSchema } from './settings.ts'
import { assetHandler } from './asset-route.ts'
import { loadAssetSecret } from './asset-token.ts'
import { applyDisplayTool } from './display-file.ts'
import { applyReadRedirect } from './read-redirect.ts'
import { applySupersedeReadImage } from './supersede-read-image.ts'

export {
  ASSET_ROUTE, DISPLAY_TOOL, VIEWER_SETTINGS_NAMESPACE,
  classifyPath, extensionOf, formatBytes, isOpaqueMediaPath, modelImageMediaTypeForPath,
} from './contract.ts'
export type { DisplayValue, ModelImage, ViewerKind, ViewerSettings } from './contract.ts'
export { ViewerSettingsSchema } from './settings.ts'
export { assetUrlFor, verifyAssetRequest } from './asset-token.ts'
export { guardHeaders, parseRange } from './asset-route.ts'
export { artifactName, convertDocument, resolveConverter } from './convert.ts'
export { isMisdirectedRead, mediaReadValue, readPathOf } from './read-redirect.ts'
export { applySupersedeReadImage } from './supersede-read-image.ts'

/**
 * Settings namespace this plugin owns, as the settings service keys it.
 *
 * Plain string rather than a branded one since 0.1.2 removed the `settingsNamespace`
 * constructor that produced the brand. Consumers hand it to `ctx.settings`, which
 * validates it at registration either way.
 */
export const VIEWER_NAMESPACE = VIEWER_SETTINGS_NAMESPACE

export const name = '@crosery/dsh-viewer'

/**
 * File holding the asset MAC key, one per harness home.
 *
 * Beside the harness's own state rather than inside the profile: a URL minted
 * under one profile has to keep resolving when the same home is opened under
 * another, and the key is not configuration a user should ever edit.
 */
const SECRET_FILE = '.dsh-viewer-asset-key'

/**
 * Directory owning converted document artifacts. Beside the key rather than in
 * a profile: conversion is expensive and its result depends only on the source
 * bytes and the LibreOffice version, so every profile on one machine should hit
 * the same cache.
 */
const CACHE_DIR = '.dsh-viewer-cache'

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
export const inject = ['tools', 'fs', 'systemPrompt']

export type Config = ViewerSettings

export const Config = ViewerSettingsSchema

/** One registered namespace's owner-facing handle, as this plugin reads it. */
interface SettingsScopeLike {
  get(): ViewerSettings
  watch(callback: () => void): () => void
}

/** Callbacks a mount invokes. Identical on every harness train that has a mount. */
export interface SettingsHooks {
  /** Receive the authoritative value: the resolved section while one is attached. */
  setSource(current: () => ViewerSettings): void
  /** Re-judge derived state after an attach, a detach, or a committed change. */
  onChange(): void
}

/**
 * Structural view of the settings service.
 *
 * 0.1.2 moved this mount from a package export to a service method:
 * `installSettingsSection(ctx, ns, schema, entry, hooks)` became
 * `ctx.settings.installSection(owner, ns, schema, entry, hooks)`, and
 * `settingsNamespace()` — the brand constructor — went with it. The hooks and
 * the registration they wire are unchanged, so this plugin drives whichever
 * surface the running harness publishes.
 *
 * A static import of the removed export is what actually broke users: ESM
 * resolves named exports before any code runs, so on 0.1.2 and later the whole
 * host entry failed to load — `does not provide an export named
 * 'installSettingsSection'` — instead of degrading to entry-config behavior.
 */
interface SettingsServiceLike {
  installSection?(
    owner: Context,
    ns: string,
    schema: unknown,
    entry: ViewerSettings,
    hooks: SettingsHooks,
  ): void
  register?(
    ns: string,
    schema: unknown,
    options: { base?: Partial<ViewerSettings> },
  ): SettingsScopeLike
}

/**
 * Value mirror of cordis's `FiberState` members {@link isUnloading} compares
 * against. A const enum has no runtime object to import, and the comparison has
 * to run — the same mirror the harness itself carries for this check.
 */
const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5

/**
 * Whether this plugin's own fiber is tearing down, rather than merely losing the
 * settings service.
 *
 * The detach path exists to hand a *still-running* plugin back its composition
 * entry. When the plugin itself is unloading there is nothing to fall back to:
 * re-reconciling would re-register the display tool on a fiber that is already
 * disposing it, so the fallback work is skipped instead.
 *
 * @param ctx - this plugin's context.
 * @returns true while its fiber is unloading or disposed.
 */
function isUnloading(ctx: Context): boolean {
  const state = ctx.fiber?.state
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED
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
export function mountSettingsSection(ctx: Context, config: ViewerSettings, hooks: SettingsHooks): void {
  ctx.inject(['settings'], (scoped) => {
    const settings = scoped.settings as unknown as SettingsServiceLike
    if (typeof settings.installSection === 'function') {
      settings.installSection(ctx, VIEWER_NAMESPACE, ViewerSettingsSchema, config, hooks)
      return
    }
    // 0.1.1 and earlier: drive the registration the removed helper drove, so
    // settings keep working across the rename instead of silently reverting to
    // the composition entry.
    if (typeof settings.register !== 'function') return
    const scope = settings.register(VIEWER_NAMESPACE, ViewerSettingsSchema, { base: config })
    hooks.setSource(() => scope.get())
    scoped.effect(() => () => {
      // Owner unload is not a detach: see {@link isUnloading}.
      if (isUnloading(ctx)) return
      hooks.setSource(() => config)
      hooks.onChange()
    }, '@crosery/dsh-viewer: settings detach')
    hooks.onChange()
    scope.watch(() => {
      if (isUnloading(ctx)) return
      hooks.onChange()
    })
  })
}

/**
 * Mount the settings section, the asset route, the tool, and the read redirect.
 * @param ctx - plugin context.
 * @param config - composition entry config, used as the settings `base` layer.
 */
export function apply(ctx: Context, config: Config): void {
  let source = (): ViewerSettings => config

  // Key material is loaded once, asynchronously, for the plugin's lifetime.
  // Everything that needs it reads through a thunk instead of awaiting, so a
  // slow first read delays only the asset URL of the very first call rather
  // than the whole activation.
  let secret: Buffer | undefined
  const secretPath = dshHomePath(SECRET_FILE)
  void loadAssetSecret(secretPath).then(
    (loaded) => { secret = loaded },
    (error: unknown) => {
      console.warn(`[dsh-viewer] could not open the asset key at ${secretPath}; media cards will stay unavailable`, error)
    },
  )

  // The route lives in a nested scope so a composition with no HTTP server
  // (headless, acp) keeps the tool and simply mints no asset URLs. `serving`
  // follows that scope's lifetime, which is what keeps a minted URL honest: a
  // card never receives a link to a route that is not listening.
  let serving = false
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() => {
      serving = true
      const dispose = scoped.webServer.register({
        kind: 'exact',
        path: ASSET_ROUTE,
        handler: assetHandler(() => secret),
      })
      return () => {
        serving = false
        dispose()
      }
    }, '@crosery/dsh-viewer: asset route')
  })

  // The tool is reconciled rather than gated inside: `tool: false` must remove
  // it from the assembled schema list, not leave a tool the model can still see
  // and call only to be refused.
  let disposeTool: (() => void) | undefined
  const reconcile = (): void => {
    const wanted = source().tool
    if (wanted && disposeTool === undefined) {
      disposeTool = applyDisplayTool(ctx, {
        feedModel: () => source().feedModel,
        secret: () => (serving ? secret : undefined),
        cacheDir: dshHomePath(CACHE_DIR),
      })
    } else if (!wanted && disposeTool !== undefined) {
      disposeTool()
      disposeTool = undefined
    }
  }
  ctx.effect(() => () => {
    disposeTool?.()
    disposeTool = undefined
  }, '@crosery/dsh-viewer: display tool')

  mountSettingsSection(ctx, config, {
    setSource: (current) => { source = current },
    onChange: reconcile,
  })
  // A composition with no settings provider never reaches `onChange`, so the
  // entry-config state has to be established here too. Reconciliation is
  // idempotent, which makes the redundant call in the provider case harmless.
  reconcile()

  // The redirect is a listener, not a schema fact, so it reads the setting live
  // instead of being re-registered — and it stands down entirely when the tool
  // it would point at is not registered.
  applyReadRedirect(ctx, () => source().tool && source().redirectRead)

  // Only meaningful while this plugin actually offers the replacement.
  applySupersedeReadImage(ctx, () => source().tool && source().supersedeReadImage)
}
