/**
 * Making `display_file` the single image entry point.
 *
 * `read_image` and `display_file` overlap on exactly one thing — putting a
 * raster into model context — and a model presented with both will reasonably
 * use both: `read_image` "to look at it", then `display_file` "to show it to
 * the user". Observed in a real session on a 1672x941 PNG: the same 2.2 MB
 * image was ingested TWICE in one turn, and the transcript showed two
 * identical-looking cards. No prompt fixes this reliably, because both tools
 * genuinely do what the model thinks they do.
 *
 * So one of them stops being visible. `display_file` is the strict superset: it
 * handles every medium, works on text-only routes (where `read_image` refuses
 * outright), and still feeds an admissible raster into context on a vision
 * route. Hiding it is therefore a pure removal of duplication, not of ability.
 *
 * The mechanism is forced by the registry: `tools.restrict()` refuses a
 * context-global call outright ("a context-global restriction would mask every
 * agent"), so the restriction is applied per agent, on `agent.ctx`.
 * @module @crosery/dsh-viewer/supersede-read-image
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Hide `read_image` from every agent while this plugin owns image display.
 *
 * Two triggers, because one is not enough. `agent/created` covers agents made
 * after the tool exists; `tools/change` covers the race in the other order —
 * `read_image` is registered behind an async service injection, so an agent
 * created first would otherwise keep seeing it for its whole life. Agents that
 * already carry the restriction are skipped, so the retry is idempotent.
 * @param ctx - the plugin context; both listeners are effects on it.
 * @param enabled - live read of the `supersedeReadImage` setting.
 */
export declare function applySupersedeReadImage(ctx: Context, enabled: () => boolean): void;
