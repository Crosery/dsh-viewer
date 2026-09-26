/**
 * The tool card: one row plus whatever element actually plays the file.
 *
 * Registered for both `display_file` and the shipped `read_image`, so an image
 * the model pulled in through the shipped tool is shown as a picture rather
 * than as a bare text row on the trains whose `read_image` has no view of its
 * own (see `client/index.ts` for how the two coexist where it does).
 *
 * Two byte sources, in priority order. A signed asset URL streams straight from
 * the Host and is the only one that can carry video, audio, PDF or HTML — and
 * the only one that supports range requests, which is what makes a `<video>`
 * seekable. A durable attachment is the fallback: it is images-only, but it
 * works when the filesystem backend exposes no local path, and it is the only
 * source a shipped `read_image` result has at all. From 0.1.7 the chat hands
 * every tool view its own session-authorized image loader, and the card uses
 * it; on older trains the plugin's own attachment reader stands in.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import { type DisplayValue } from '../contract.ts';
import { cardModel } from './card-model.ts';
import { type OwnerImageLoader, type ViewerSources } from './sources.ts';
/** Business face the plugin injects into every card occurrence. */
export interface ViewerCardInjected {
    /**
     * Resolve one durable attachment into a browser URL scoped to this session.
     * The fallback for trains whose tool-view owner carries no `loadImage`.
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
    /**
     * Open a path through the Host: the operating system's default application
     * up to 0.1.5, the right-Sidebar preview from 0.1.7. Every supported train
     * supplies it; optional only so a card rendered outside a tool row (the turn
     * tail) or by a test can omit it.
     */
    openFile?: ((path: string) => unknown) | undefined;
    /** 0.1.7+: the chat's session-authorized loader for durable images. */
    loadImage?: OwnerImageLoader | undefined;
}
/** Full card props: owner share, injected face, and the locale seat. */
export type ViewerCardProps = ViewerCardOwner & ViewerCardInjected & {
    t: TranslateNS<'tool.viewer'>;
};
/** The element that plays one file, or the reason there is none. */
export declare function Viewer({ value, sources, t }: {
    value: DisplayValue;
    sources: ViewerSources;
    t: TranslateNS<'tool.viewer'>;
}): import("react").JSX.Element;
/**
 * One settled, displayable file: the header and its player.
 *
 * Shared by the tool row and by the turn tail, so a file shown after a turn
 * completes looks exactly like the one shown while it ran.
 * @param props - the display, how to reach its bytes, the tool it came from, and `t`.
 * @returns the card.
 */
export declare function DisplayedFile({ value, toolName, sources, t }: {
    value: DisplayValue;
    toolName: string;
    sources: ViewerSources;
    t: TranslateNS<'tool.viewer'>;
}): import("react").JSX.Element;
/**
 * One `display_file` (or `read_image`) call, as a row plus its player.
 * @param props - the toolview owner share, the injected loader, and `t`.
 * @returns the card.
 */
export declare function ViewerCard({ toolName, block, t, openFile, loadImage, loadAttachment }: ViewerCardProps): import("react").JSX.Element;
