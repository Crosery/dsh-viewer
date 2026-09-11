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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type ViewerKey } from './locales.ts';
export type { CardState } from './card-model.ts';
export { cardModel, argumentPathOf, contentImageOf } from './card-model.ts';
export type { ViewerCardInjected } from './ViewerCard.tsx';
export type { ViewerKey } from './locales.ts';
/** Namespace owning this card's copy. */
export declare const VIEWER_NS = "tool.viewer";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The viewer card's copy. */
        'tool.viewer': ViewerKey;
    }
}
/**
 * Required services. `sessions` is required rather than optional because the
 * attachment channel is the card's fallback byte source; `locale` and `slots`
 * are the registration surface.
 */
export declare const inject: string[];
export declare const name = "@crosery/dsh-viewer";
/**
 * Client plugin body: own the URL cache and register the card under both keys.
 * @param ctx - client cordis context.
 */
export declare function apply(ctx: ClientContext): void;
