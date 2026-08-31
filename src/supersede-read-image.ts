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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { READ_IMAGE_TOOL } from './contract.ts'

/**
 * Try to hide `read_image` from one agent.
 *
 * `tools.restrict()` throws on a name the composition does not have, and
 * `read_image` is registered inside `dsh-tool-fs`'s `attachments` injection —
 * so at `agent/created` time it may not exist yet, or may never exist. Failure
 * is therefore an ordinary outcome, not an error: this returns whether the
 * restriction actually took.
 * @param agent - the agent to restrict.
 * @returns true when `read_image` is now hidden from that agent.
 */
function hideFrom(agent: Agent): boolean {
  try {
    agent.ctx.tools.restrict({ deny: [READ_IMAGE_TOOL] })
    return true
  } catch {
    return false
  }
}

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
export function applySupersedeReadImage(ctx: Context, enabled: () => boolean): void {
  // Agents still missing the restriction. Weakly held: an agent that goes away
  // must not be kept alive by this retry list.
  const pending = new WeakSet<Agent>()
  const tracked = new Set<WeakRef<Agent>>()

  const apply = (agent: Agent): void => {
    if (!enabled()) return
    if (hideFrom(agent)) {
      pending.delete(agent)
      return
    }
    if (pending.has(agent)) return
    pending.add(agent)
    tracked.add(new WeakRef(agent))
  }

  ctx.on('agent/created', ({ agent }) => {
    // A throwing `agent/created` listener vetoes the agent's publication
    // entirely, so nothing here may escape.
    try {
      apply(agent)
    } catch {
      // Never block an agent over a presentation preference.
    }
  })

  // The tool set changed: `read_image` may have just appeared behind its
  // service injection. Retry every agent that is still waiting for it.
  ctx.on('tools/change', () => {
    if (!enabled()) return
    for (const ref of tracked) {
      const agent = ref.deref()
      if (agent === undefined) {
        tracked.delete(ref)
        continue
      }
      if (!pending.has(agent)) {
        tracked.delete(ref)
        continue
      }
      try {
        if (hideFrom(agent)) {
          pending.delete(agent)
          tracked.delete(ref)
        }
      } catch {
        // Contained: a retry failure leaves the agent on the list.
      }
    }
  })
}
