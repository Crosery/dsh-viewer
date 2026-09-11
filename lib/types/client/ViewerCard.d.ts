/**
 * The tool card: one row plus whatever element actually plays the file.
 *
 * Registered for both `display_file` and the shipped `read_image`, so an image
 * the model pulled in through the shipped tool is shown as a picture rather
 * than as a bare text row.
 *
 * Two byte sources, in priority order. A signed asset URL streams straight from
 * the Host and is the only one that can carry video, audio, PDF or HTML — and
 * the only one that supports range requests, which is what makes a `<video>`
 * seekable. A durable attachment is the fallback: it is images-only, but it
 * works when the filesystem backend exposes no local path, and it is the only
 * source a shipped `read_image` result has at all.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import { cardModel } from './card-model.ts';
/** Business face the plugin injects into every card occurrence. */
export interface ViewerCardInjected {
    /**
     * Resolve one durable attachment into a browser URL scoped to this session.
     * @param attachmentId - the opaque durable id.
     * @returns a URL valid until the plugin unloads.
     */
    loadAttachment: (attachmentId: string) => Promise<string>;
}
/** The runtime share this card actually reads off the toolview slot. */
export interface ViewerCardOwner {
    /** Wire tool name this entry was dispatched for. */
    toolName: string;
    /** Frozen running call or settled result node. */
    block: Parameters<typeof cardModel>[0];
}
/** Full card props: owner share, injected face, and the locale seat. */
export type ViewerCardProps = ViewerCardOwner & ViewerCardInjected & {
    t: TranslateNS<'tool.viewer'>;
};
/**
 * One `display_file` (or `read_image`) call, as a row plus its player.
 * @param props - the toolview owner share, the injected loader, and `t`.
 * @returns the card.
 */
export declare function ViewerCard({ toolName, block, t, ...injected }: ViewerCardProps): import("react").JSX.Element;
