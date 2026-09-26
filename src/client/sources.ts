/**
 * Where a card's durable image bytes come from — pure, so it is testable
 * without a DOM.
 * @module @crosery/dsh-viewer/client/sources
 */

import type { ModelImage } from '../contract.ts'

/**
 * The chat's own durable-image loader, as the 0.1.7 tool-view owner supplies
 * it. Its parameter is the harness's branded `ImageAttachmentRef`, which a
 * {@link ModelImage} matches field for field; `never` keeps any train's exact
 * loader type assignable here without importing the brand.
 */
export type OwnerImageLoader = (attachment: never) => Promise<string>

/** How one displayed file reaches its bytes and its Host-side opener. */
export interface ViewerSources {
  /** Resolve one durable image to a URL. */
  loadImage: (image: ModelImage) => Promise<string>
  /** Open the file through the Host, when the surrounding view offers that. */
  openFile?: ((path: string) => unknown) | undefined
}

/**
 * The loader a card uses for durable images: the chat's own where the owner
 * supplies one (0.1.7+), the plugin's attachment reader otherwise.
 *
 * The chat's loader is preferred because it shares one read and one browser URL
 * per image across every view of the session and releases them with the
 * session; the plugin's reader keeps its own URLs until the plugin unloads.
 * @param owner - the owner's optional loader.
 * @param fallback - the plugin's reader, by attachment id.
 * @returns a loader over the card's image facts.
 */
export function imageLoaderFor(
  owner: OwnerImageLoader | undefined,
  fallback: (attachmentId: string) => Promise<string>,
): ViewerSources['loadImage'] {
  if (typeof owner !== 'function') return image => fallback(image.attachmentId)
  // The owner's parameter is the branded upstream reference; ModelImage is that
  // reference field for field, minus only the brand.
  return image => owner({ ...image } as never)
}
