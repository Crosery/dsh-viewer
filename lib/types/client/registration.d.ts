/**
 * How the browser half joins the slot registry — the part of `index.ts` that
 * carries no component, so it can be exercised against the real slot core in
 * tests on every train.
 * @module @crosery/dsh-viewer/client/registration
 */
/** Namespace owning this card's copy. */
export declare const VIEWER_NS = "tool.viewer";
/**
 * Priority of the `read_image` card: one behind the default, so a view the
 * harness registers for the same key renders instead (the slot core renders
 * the lowest priority per key, and refuses a second entry at an occupied one),
 * and this one renders where there is none.
 */
export declare const READ_IMAGE_PRIORITY = 1;
/** List slot the chat renders after a completed turn's closing reply (0.1.6+). */
export declare const TURN_TAIL_SLOT = "conversation.chat.turnTail";
/**
 * The slot registry as this plugin drives it: by name, including slots whose
 * declarations this build does not import (the turn tail is declared by
 * `dsh-client-ui-chat`, which the oldest supported train does not publish).
 */
export interface LooseSlots {
    inject(key: string, callback: () => () => void): () => void;
    register(options: Record<string, unknown>, component: unknown): () => void;
    spec?(key: string): {
        kind?: string;
    } | undefined;
}
/**
 * Register one slot entry so that its failure stays its own.
 *
 * `slots.inject` runs the callback synchronously when the slot is already
 * declared and rethrows what it throws — into `apply`, where cordis unloads the
 * whole plugin. The callback therefore never throws: a refused registration is
 * reported and replaced by a no-op disposer, and every other entry lives on.
 * @param slots - the slot registry.
 * @param key - the slot to register into.
 * @param register - performs the registration; returns its disposer.
 * @param warn - where a refusal is reported.
 */
export declare function contribute(slots: Pick<LooseSlots, 'inject'>, key: string, register: () => () => void, warn?: (message: string, error: unknown) => void): void;
/**
 * Whether the turn tail may be joined.
 *
 * Up to 0.1.5 the slot is a CHAIN — one winner per turn — so an entry there
 * would compete with the harness's own delivery cards instead of sitting beside
 * them. Only the list form (0.1.6+) is joined; a registry that cannot say which
 * form it has is trusted to be the one the Conversation registry came with.
 * @param spec - the slot's declared spec, when the registry exposes it.
 * @returns true for a list slot, or an unknown one.
 */
export declare function turnTailJoinable(spec: {
    kind?: string;
} | undefined): boolean;
