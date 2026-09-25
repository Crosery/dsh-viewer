/**
 * The card's own stylesheet, injected for exactly this plugin's lifetime.
 *
 * Plain prefixed class names rather than CSS Modules: the repository's module
 * pipeline is not published, so an out-of-tree package that wants a hashed class
 * map has to reproduce it. Colors come from `--dsw-alias-*` semantic tokens, so
 * the card follows the active palette with no theme branch of its own.
 */

import type { Context } from '@deepseek-ai/cordis'

const PLUGIN_ID = '@crosery/dsh-viewer'

const SHEET = `
.dshview-card { display: flex; flex-direction: column; gap: 6px; margin: 2px 0; min-width: 0; }

.dshview-head {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  padding: 2px 0; border: 0; background: transparent; text-align: left;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 20px;
  cursor: pointer;
}
.dshview-head:hover { color: var(--dsw-alias-label-primary); }
.dshview-icon { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
.dshview-kind { flex: none; color: var(--dsw-alias-label-primary); font-weight: 500; }
.dshview-path {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
}
.dshview-meta { flex: none; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dshview-badge {
  flex: none; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 16px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}

.dshview-body {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  min-width: 0; overflow: hidden;
}

.dshview-imageButton {
  display: block; padding: 0; border: 0; background: transparent; cursor: zoom-in;
  line-height: 0; max-width: 100%;
}
/* A transparent PNG on a themed panel is unreadable without a backdrop; the
   checkerboard is the conventional one and reads in both palettes. Shared by
   the card thumbnail and the zoomed preview so the two cannot drift apart. */
.dshview-image,
.dshview-lightboxImage {
  background-color: var(--dsw-alias-bg-layer-2);
  background-image:
    linear-gradient(45deg, rgb(128 128 128 / .16) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(128 128 128 / .16) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(128 128 128 / .16) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(128 128 128 / .16) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.dshview-image {
  display: block; max-width: 100%; max-height: 420px; width: auto; height: auto;
  border-radius: 6px; object-fit: contain;
}
.dshview-video { display: block; max-width: 100%; max-height: 420px; border-radius: 6px; background: #000; }
.dshview-audio { display: block; width: 100%; }
.dshview-frame {
  display: block; width: 100%; height: 460px; border: 0; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
}

.dshview-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshview-error { color: var(--dsw-alias-state-error-primary); }
.dshview-retry {
  align-self: flex-start; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-state-error-primary);
}
.dshview-link {
  align-self: flex-start; font-size: 12px; color: var(--dsw-alias-brand-primary);
  text-decoration: none;
}
.dshview-link:hover { text-decoration: underline; }

.dshview-lightbox {
  position: fixed; inset: 0; z-index: 2000; display: flex;
  align-items: center; justify-content: center;
  padding: 32px; background: rgb(0 0 0 / .72);
  backdrop-filter: blur(4px);
  cursor: zoom-out;
}
.dshview-lightboxImage {
  position: relative;
  max-width: min(100%, 1600px); max-height: calc(100vh - 64px);
  object-fit: contain; border-radius: 8px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  cursor: default;
}
.dshview-lightboxClose {
  position: fixed; top: 20px; right: 20px; z-index: 2001;
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(255, 255, 255, 0.2));
  background: var(--dsw-specific-input-major, rgba(0, 0, 0, 0.5));
  color: var(--dsw-alias-label-primary, #fff);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
/* Hover inverts the button using the alias pair that exists for exactly this:
   --dsw-alias-label-primary-foreground is by definition the readable colour on
   --dsw-alias-label-primary, and the two swap between palettes. A literal black
   here put a near-black glyph on black in the light theme. */
.dshview-lightboxClose:hover {
  background: var(--dsw-alias-label-primary, #fff);
  color: var(--dsw-alias-label-primary-foreground, #0f1115);
  transform: scale(1.05);
}
`

/**
 * Mount the card stylesheet for the owning plugin lifetime.
 * @param ctx - owning plugin context.
 */
export function installViewerStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/viewer-card.css`
    tag.textContent = SHEET
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, '@crosery/dsh-viewer: card stylesheet')
}
