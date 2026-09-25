/**
 * The turn-tail entry: a completed turn's displayed files, outside the fold.
 *
 * Rendered by the chat between a completed turn's closing reply and its action
 * row, which is the one place a folded turn keeps visible — the harness's own
 * delivery cards live there for the same reason. See `turn-tail.ts` for where
 * the data comes from and when it is empty.
 * @module @crosery/dsh-viewer/client/ViewerTail
 */

import { useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { DISPLAY_TOOL } from '../contract.ts'
import { DisplayedFile, type ViewerCardInjected } from './ViewerCard.tsx'
import { imageLoaderFor } from './sources.ts'
import { tailDisplays, type FoldSource, type TurnLike } from './turn-tail.ts'

/** What the plugin injects into the tail entry. */
export interface ViewerTailInjected extends ViewerCardInjected {
  /** Whether the chat currently folds completed turns. */
  folds: FoldSource
}

/** The tail owner's share, as far as this entry reads it. */
export interface ViewerTailOwner {
  /** The completed turn. */
  turn: TurnLike
  /** The closing reply's log sequence. */
  seq: number
  /** Open a path through the Host. */
  openFile?: ((path: string) => unknown) | undefined
}

/** Full tail props: owner share, injected face, and the locale seat. */
export type ViewerTailProps = ViewerTailOwner & ViewerTailInjected & {
  t: TranslateNS<'tool.viewer'>
}

/** Stable no-op subscription for a fold source that never changes. */
const never = (): (() => void) => () => {}

/**
 * The completed turn's displays, or nothing.
 *
 * Nothing whenever the rows are on screen anyway — the chat does not fold, or
 * this turn is still open, aborted, or failed — so the tail never repeats a
 * card the reader can already see.
 * @param props - owner share, injected face, and `t`.
 * @returns the tail section, or `null`.
 */
export function ViewerTail({ turn, seq, openFile, folds, loadAttachment, t }: ViewerTailProps) {
  const folding = useSyncExternalStore(folds?.subscribe ?? never, folds?.getSnapshot ?? (() => true))
  if (!folding) return null
  const displays = tailDisplays(turn, seq)
  if (displays.length === 0) return null
  const sources = { loadImage: imageLoaderFor(undefined, loadAttachment), openFile }
  return (
    <section className="dshview-tail" aria-label={t('tail.label')}>
      {displays.map(entry => (
        <DisplayedFile key={entry.callId} value={entry.value} toolName={DISPLAY_TOOL} sources={sources} t={t} />
      ))}
    </section>
  )
}
