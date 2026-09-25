/**
 * Browser half of the viewer plugin.
 *
 * Registers one card into the tool-view slot for two keys: the plugin's own
 * `display_file`, and the shipped `read_image`. The two registrations differ in
 * one way that matters. Up to 0.1.2 upstream renders `read_image` as a plain
 * text row, so the plugin's card is the only picture of an image the model
 * pulled into context. From 0.1.3 upstream ships its own `read_image` view at
 * the default priority, and a second entry for the same key AT THE SAME
 * PRIORITY is a hard error in the slot core — which is how v0.1.1 took its own
 * `display_file` card down with it on 0.1.7. So `read_image` is registered one
 * step behind the default: the core renders the lowest priority, which is
 * upstream's view wherever one exists and this card everywhere else.
 *
 * Every registration is isolated from the others. A registration that throws
 * inside `slots.inject` while its slot is already declared rethrows into this
 * plugin's `apply`, and cordis answers a failed apply by unloading the whole
 * client half — so one bad key must never be able to take the rest with it.
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
export { READ_IMAGE_PRIORITY, TURN_TAIL_SLOT, VIEWER_NS, contribute, turnTailJoinable } from './registration.ts';
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
