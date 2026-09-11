/**
 * The card's own stylesheet, injected for exactly this plugin's lifetime.
 *
 * Plain prefixed class names rather than CSS Modules: the repository's module
 * pipeline is not published, so an out-of-tree package that wants a hashed class
 * map has to reproduce it. Colors come from `--dsw-alias-*` semantic tokens, so
 * the card follows the active palette with no theme branch of its own.
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Mount the card stylesheet for the owning plugin lifetime.
 * @param ctx - owning plugin context.
 */
export declare function installViewerStyles(ctx: Context): void;
