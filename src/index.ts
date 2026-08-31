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
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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

/** Settings namespace this plugin owns. */
export const VIEWER_NAMESPACE = settingsNamespace(VIEWER_SETTINGS_NAMESPACE)

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

  installSettingsSection(ctx, VIEWER_NAMESPACE, ViewerSettingsSchema, config, {
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
