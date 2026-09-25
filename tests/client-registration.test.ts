/**
 * How the browser half joins the slot registry. The slot cases drive the harness's REAL slot core — the one
 * the pinned train publishes, and the one each train in the sweep publishes —
 * so a change in how a second entry for a key is treated fails here, not in a
 * user's browser.
 */

import { deepEqual, equal, ok, throws } from 'node:assert/strict'
import { test } from 'node:test'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { READ_IMAGE_PRIORITY, VIEWER_NS, contribute, turnTailJoinable } from '../src/client/registration.ts'
import { DISPLAY_TOOL, READ_IMAGE_TOOL } from '../src/contract.ts'

/** A fresh core with the tool-view slot declared the way `dsh-client-ui-tool` declares it. */
function coreWithToolView(): InstanceType<typeof SlotCore> {
  const core = new SlotCore()
  core.register({ name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } } as never, (() => null) as never)
  return core
}

/** The winning entry's component for one key, as an outlet would render it. */
function winner(core: InstanceType<typeof SlotCore>, key: string): unknown {
  return (core.entriesOfSlot('tool.call.toolview') as { options: { key?: string }; component: unknown }[])
    .find(entry => entry.options.key === key)?.component
}

const UPSTREAM = { name: 'upstream read-image view' }
const VIEWER = { name: 'viewer card' }

test('where the harness ships a read_image view, the viewer registers beside it and upstream renders', () => {
  const core = coreWithToolView()
  // 0.1.3-alpha.2+: `dsh-client-ui-tool` registers read_image at the default priority.
  core.register({ name: 'tool.call.toolview', key: READ_IMAGE_TOOL, registrant: 'read-image-toolview' } as never, UPSTREAM as never)
  // The collision v0.1.1 hit: the same key at the same priority is refused.
  throws(() => core.register({ name: 'tool.call.toolview', key: READ_IMAGE_TOOL } as never, VIEWER as never), /already has an entry for key "read_image"/)
  // One step behind the default is accepted, and loses to upstream.
  core.register({ name: 'tool.call.toolview', key: READ_IMAGE_TOOL, priority: READ_IMAGE_PRIORITY, locale: VIEWER_NS } as never, VIEWER as never)
  equal(winner(core, READ_IMAGE_TOOL), UPSTREAM)
})

test('where the harness has no read_image view, the viewer card is the one that renders', () => {
  const core = coreWithToolView()
  core.register({ name: 'tool.call.toolview', key: READ_IMAGE_TOOL, priority: READ_IMAGE_PRIORITY, locale: VIEWER_NS } as never, VIEWER as never)
  equal(winner(core, READ_IMAGE_TOOL), VIEWER)
})

test('display_file keeps the default priority and is nobody else’s key', () => {
  const core = coreWithToolView()
  core.register({ name: 'tool.call.toolview', key: READ_IMAGE_TOOL, registrant: 'read-image-toolview' } as never, UPSTREAM as never)
  core.register({ name: 'tool.call.toolview', key: DISPLAY_TOOL, locale: VIEWER_NS } as never, VIEWER as never)
  equal(winner(core, DISPLAY_TOOL), VIEWER)
})

/**
 * A registry double with the real `inject` contract: the callback runs
 * synchronously when the slot is declared, and whatever it throws is rethrown
 * to the caller — into the plugin's `apply`.
 */
function strictSlots() {
  const disposers: (() => void)[] = []
  return {
    disposers,
    inject: (_key: string, callback: () => () => void) => {
      disposers.push(callback())
      return () => {}
    },
  }
}

test('a registration that throws stays its own failure', () => {
  const slots = strictSlots()
  const warnings: string[] = []
  const registered: string[] = []
  // The first contribution fails the way the v0.1.1 read_image one did.
  contribute(slots, 'tool.call.toolview', () => { throw new Error('keyed slot collision') }, message => { warnings.push(message) })
  contribute(slots, 'tool.call.toolview', () => { registered.push(DISPLAY_TOOL); return () => {} }, message => { warnings.push(message) })
  deepEqual(registered, [DISPLAY_TOOL], 'the other registration still happened')
  equal(warnings.length, 1)
  ok(warnings[0]?.includes('tool.call.toolview'))
  equal(slots.disposers.length, 2, 'the failed one hands back a harmless disposer')
  for (const dispose of slots.disposers) dispose()
})

test('the turn tail is joined only in its list form', () => {
  equal(turnTailJoinable({ kind: 'list' }), true, '0.1.6+')
  equal(turnTailJoinable({ kind: 'chain' }), false, 'up to 0.1.5: one winner per turn, the delivery cards would lose')
  equal(turnTailJoinable(undefined), true, 'a registry that cannot say is trusted')
})
