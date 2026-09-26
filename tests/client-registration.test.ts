/**
 * How the browser half joins the slot registry, and the pure decisions its
 * components make. The slot cases drive the harness's REAL slot core — the one
 * the pinned train publishes, and the one each train in the sweep publishes —
 * so a change in how a second entry for a key is treated fails here, not in a
 * user's browser.
 */

import { deepEqual, equal, ok, throws } from 'node:assert/strict'
import { test } from 'node:test'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { READ_IMAGE_PRIORITY, VIEWER_NS, contribute, turnTailJoinable } from '../src/client/registration.ts'
import { isDesktopShell, mediaSourceFor } from '../src/client/host.ts'
import { imageLoaderFor } from '../src/client/sources.ts'
import { DISPLAY_TOOL, READ_IMAGE_TOOL, type ModelImage } from '../src/contract.ts'

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

test('the desktop window is recognised by capability, not by user agent', () => {
  equal(isDesktopShell({ location: { protocol: 'dsh-app:' } }), true)
  equal(isDesktopShell({ __DSH_HOST_PATHS__: { pathFor: () => '' }, location: { protocol: 'http:' } }), true)
  equal(isDesktopShell({ location: { protocol: 'http:' } }), false)
  equal(isDesktopShell({ location: { protocol: 'https:' } }), false)
  equal(isDesktopShell({}), false)
})

const IMAGE: ModelImage = { attachmentId: 'att-9', mediaType: 'image/png', bytes: 10, width: 2, height: 3, name: 'a.png' }

test('the chat’s own image loader is preferred where the owner supplies one', async () => {
  const seen: unknown[] = []
  const owner = ((attachment: unknown) => { seen.push(attachment); return Promise.resolve('blob:owner') }) as (attachment: never) => Promise<string>
  const fallback = (): Promise<string> => Promise.reject(new Error('must not be used'))
  equal(await imageLoaderFor(owner, fallback)(IMAGE), 'blob:owner')
  deepEqual(seen, [IMAGE], 'the whole reference is handed over, not just the id')
})

test('without an owner loader the plugin reads the attachment itself', async () => {
  const ids: string[] = []
  equal(await imageLoaderFor(undefined, (id) => { ids.push(id); return Promise.resolve('blob:plugin') })(IMAGE), 'blob:plugin')
  deepEqual(ids, ['att-9'])
})

test('desktop media loads from the Host loopback base so its first load is seekable', () => {
  const asset = '/crosery/dsh-viewer/asset?p=abc&s=def'
  const desktop = { location: { protocol: 'dsh-app:' }, __DSH_TRANSPORT__: { streamBaseUrl: 'http://127.0.0.1:19387' } }
  equal(mediaSourceFor(asset, desktop), 'http://127.0.0.1:19387/crosery/dsh-viewer/asset?p=abc&s=def')
  equal(mediaSourceFor(asset, { location: { protocol: 'http:' }, __DSH_TRANSPORT__: { streamBaseUrl: 'http://127.0.0.1:3080' } }), asset, 'plain web keeps the same-origin path')
  equal(mediaSourceFor(asset, { location: { protocol: 'dsh-app:' } }), asset, 'no transport facts')
  equal(mediaSourceFor(asset, { location: { protocol: 'dsh-app:' }, __DSH_TRANSPORT__: { streamBaseUrl: 'http://evil.example:80' } }), asset, 'never off loopback')
  equal(mediaSourceFor(asset, { location: { protocol: 'dsh-app:' }, __DSH_TRANSPORT__: { streamBaseUrl: 'javascript:alert(1)' } }), asset)
  equal(mediaSourceFor(asset, { location: { protocol: 'dsh-app:' }, __DSH_TRANSPORT__: { streamBaseUrl: 'not a url' } }), asset)
  equal(mediaSourceFor('https://elsewhere/x.mp4', desktop), 'https://elsewhere/x.mp4', 'only same-origin paths are rebased')
})
