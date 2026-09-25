/**
 * Keeping displayed files on screen after their turn completes.
 *
 * From 0.1.6 the chat folds a completed turn's work — every tool row, this
 * card included — behind one "used N s" disclosure, and from 0.1.7 that is the
 * default (`transcriptView: standard`). A viewer whose purpose is putting a
 * file in front of the user then hides it the moment the answer lands. The
 * harness's own deliverables solve the same problem through two public
 * surfaces, and this module uses the same two:
 *
 * - a Conversation Definition (`uiConversation.events.register`) that folds a
 *   turn's events into Turn-scoped data — here, the turn's successful
 *   `display_file` results; and
 * - an entry in the chat's `conversation.chat.turnTail` list, which renders
 *   between a completed turn's closing reply and its action row, outside the
 *   fold. The component lives in `ViewerTail.tsx`.
 *
 * Everything here is pure and structurally typed: the events come from a
 * session log this build may not have written, and the Definition contract is
 * declared by a package (`dsh-client-ui-conversation` 0.1.6+) that older
 * trains do not publish in this shape.
 * @module @crosery/dsh-viewer/client/turn-tail
 */
import { type DisplayValue } from '../contract.ts';
/** Definition kind, and the key the turn's data is published under. */
export declare const VIEWER_TURN_DATA = "crosery-viewer";
/** One file a turn displayed. */
export interface TurnDisplay {
    /** Log sequence of the settled result. */
    seq: number;
    /** The call that displayed it. */
    callId: string;
    /** What the card shows. */
    value: DisplayValue;
}
/** Turn-scoped data this Definition publishes. */
export interface ViewerTurnData {
    displayed: readonly TurnDisplay[];
}
/** The Definition's per-turn accumulator. */
export interface ViewerTurnState {
    turn: number;
    /** `display_file` calls of this turn, by call id. */
    calls: ReadonlySet<string>;
    displayed: readonly TurnDisplay[];
}
/** The slice of a session event this module reads. */
export interface EventLike {
    type?: unknown;
    seq?: unknown;
    data?: unknown;
    /** How a surface event entered the log; replacement copies are model-only. */
    surfaceOp?: unknown;
}
/** A Definition match, as far as this module reads one. */
export interface MatchLike {
    event: EventLike;
}
/**
 * The card payload a settled `display_file` result carries.
 *
 * The same recovery the tool row performs: the presentation metadata first,
 * then the plugin's own envelope for a result written without it.
 * @param data - the `tool/result` event's data.
 * @returns the payload, or `undefined` when the result is not a displayable success.
 */
export declare function displayedValueOf(data: unknown): DisplayValue | undefined;
/**
 * The Conversation Definition that collects each turn's displayed files.
 *
 * Shaped after the harness's own deliverables Definition: `turn/start` opens a
 * turn's context, `display_file` calls are remembered by id, and their
 * successful results are appended in log order. Nothing is published as a view
 * node — only Turn data, which the tail entry reads.
 */
export declare const viewerTurnDefinition: {
    kind: string;
    match(event: EventLike): {
        id: string;
        role: "start" | "update";
    } | null;
    start(_context: unknown, match: MatchLike): ViewerTurnState;
    update(context: {
        state: ViewerTurnState;
    }, match: MatchLike): ViewerTurnState;
    buildLocationData(context: {
        state?: ViewerTurnState | undefined;
    }, scope: string, previous?: {
        kind?: string;
        turn?: number;
        key?: string;
        value?: ViewerTurnData;
    } | null): {
        kind: "turn";
        turn: number;
        key: string;
        value: ViewerTurnData;
    } | null;
};
/** The slice of the tail owner's `turn` this module reads. */
export interface TurnLike {
    status?: unknown;
    end?: unknown;
    data?: {
        get?: (key: string) => unknown;
    } | undefined;
}
/**
 * Whether the chat keeps this turn's work open, in which case the tool rows
 * are already on screen and a tail would only repeat them: a turn still
 * running, and one that ended aborted or in error.
 * @param turn - the tail owner's turn.
 * @returns true when the turn's process is not foldable.
 */
export declare function turnStaysOpen(turn: TurnLike): boolean;
/**
 * The files a completed turn's tail shows.
 *
 * Only results logged before the closing reply belong to it, and a file
 * displayed several times appears once, where it was last displayed.
 * @param turn - the tail owner's turn.
 * @param closingSeq - the closing reply's log sequence.
 * @returns the displays to render, oldest first; empty when there are none.
 */
export declare function tailDisplays(turn: TurnLike, closingSeq: number): readonly TurnDisplay[];
/** An observable boolean the tail reads with `useSyncExternalStore`. */
export interface FoldSource {
    getSnapshot(): boolean;
    subscribe(listener: () => void): () => void;
}
/**
 * Whether a transcript mode folds completed turns.
 *
 * `verbose` (0.1.7) never folds; every other mode does on the trains that have
 * the turn tail, including the unset value, whose default is `standard` on
 * 0.1.7 and `compact` on 0.1.6.
 * @param mode - the persisted `transcriptView`, verbatim.
 * @returns whether the tail should carry the turn's displays.
 */
export declare function foldsCompletedTurns(mode: unknown): boolean;
/**
 * Follow the chat's transcript preference, read from the chat's own settings
 * form (`configForms.get('ui-chat')`).
 *
 * Looked up on every read rather than once: the form service arrives with the
 * settings plugin, which need not have activated before this one. A train with
 * no such form is treated as folding — its default.
 * @param forms - reads the optional `configForms` service.
 * @returns the fold preference as an observable.
 */
export declare function foldSourceOf(forms: () => unknown): FoldSource;
