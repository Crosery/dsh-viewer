/**
 * The turn-tail entry: a completed turn's displayed files, outside the fold.
 *
 * Rendered by the chat between a completed turn's closing reply and its action
 * row, which is the one place a folded turn keeps visible — the harness's own
 * delivery cards live there for the same reason. See `turn-tail.ts` for where
 * the data comes from and when it is empty.
 * @module @crosery/dsh-viewer/client/ViewerTail
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import { type ViewerCardInjected } from './ViewerCard.tsx';
import { type FoldSource, type TurnLike } from './turn-tail.ts';
/** What the plugin injects into the tail entry. */
export interface ViewerTailInjected extends ViewerCardInjected {
    /** Whether the chat currently folds completed turns. */
    folds: FoldSource;
}
/** The tail owner's share, as far as this entry reads it. */
export interface ViewerTailOwner {
    /** The completed turn. */
    turn: TurnLike;
    /** The closing reply's log sequence. */
    seq: number;
    /** Open a path through the Host. */
    openFile?: ((path: string) => unknown) | undefined;
}
/** Full tail props: owner share, injected face, and the locale seat. */
export type ViewerTailProps = ViewerTailOwner & ViewerTailInjected & {
    t: TranslateNS<'tool.viewer'>;
};
/**
 * The completed turn's displays, or nothing.
 *
 * Nothing whenever the rows are on screen anyway — the chat does not fold, or
 * this turn is still open, aborted, failed, or (0.1.7) was steered — so the
 * tail never repeats a card the reader can already see.
 * @param props - owner share, injected face, and `t`.
 * @returns the tail section, or `null`.
 */
export declare function ViewerTail({ turn, seq, openFile, folds, loadAttachment, t }: ViewerTailProps): import("react").JSX.Element | null;
