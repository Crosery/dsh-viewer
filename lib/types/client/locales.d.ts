/**
 * Card copy. Two dictionaries with identical key sets — the locale service
 * fails a namespace whose dictionaries disagree, so a key added here has to be
 * added to both.
 */
/** Dictionary key domain of this plugin's namespace. */
export type ViewerKey = 'title.image' | 'title.video' | 'title.audio' | 'title.pdf' | 'title.document' | 'title.html' | 'title.file' | 'title.readImage' | 'state.running' | 'state.loading' | 'state.loadFailed' | 'state.retry' | 'state.unavailable' | 'state.unsupported' | 'badge.inContext' | 'badge.screenOnly' | 'action.open' | 'action.openNew' | 'action.close' | 'action.expand' | 'action.collapse' | 'media.noVideo' | 'media.noAudio';
/** Simplified Chinese copy. */
export declare const zh: Record<ViewerKey, string>;
/** English copy. */
export declare const en: Record<ViewerKey, string>;
