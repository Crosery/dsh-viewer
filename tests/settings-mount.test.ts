/**
 * The settings mount over both published settings APIs.
 *
 * 0.1.2 moved the mount from a package export (`installSettingsSection`) to a
 * service method (`ctx.settings.installSection`) and deleted the
 * `settingsNamespace` brand constructor with it. The plugin must work on both
 * trains from one build, so the adapter is what these cases pin: an unrecognized
 * API must degrade to the composition entry, never throw during activation.
 *
 * The service doubles below model only what the adapter touches — the real
 * methods are exercised against the published packages by the harness
 * compatibility job, which installs a train's actual `dsh-settings`.
 */

import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { mountSettingsSection, VIEWER_NAMESPACE, type SettingsHooks } from '../src/index.ts'
import { ViewerSettingsSchema } from '../src/settings.ts'
import type { ViewerSettings } from '../src/contract.ts'

const ENTRY: ViewerSettings = { tool: true, redirectRead: true, feedModel: true, supersedeReadImage: true }

/** Hooks that record what the adapter did, standing in for the plugin body. */
function recorder(): { hooks: SettingsHooks; changes: () => number; value: () => ViewerSettings } {
  let current = (): ViewerSettings => ENTRY
  let changes = 0
  return {
    hooks: {
      setSource: (next) => { current = next },
      onChange: () => { changes += 1 },
    },
    changes: () => changes,
    value: () => current(),
  }
}

/**
 * A context that injects a settings service shaped like one train's.
 * @param service - the `settings` value the injection scope exposes.
 */
function ctxWith(service: unknown): { ctx: never; cleanups: (() => void)[]; fiber: { state: number } } {
  const cleanups: (() => void)[] = []
  const fiber = { state: 2 }
  const scoped = {
    settings: service,
    effect: (body: () => () => void) => { cleanups.push(body()) },
  }
  const ctx = {
    fiber,
    inject: (_names: string[], callback: (scope: unknown) => void) => { callback(scoped) },
  } as never
  return { ctx, cleanups, fiber }
}

test('the settings mount names the namespace it owns', () => {
  equal(VIEWER_NAMESPACE, 'crosery-viewer')
})

test('on the 0.1.2 API the mount hands the service the schema, the entry config and the hooks', () => {
  const calls: unknown[][] = []
  const { ctx } = ctxWith({
    installSection: (...args: unknown[]) => { calls.push(args) },
  })
  const { hooks } = recorder()
  mountSettingsSection(ctx, ENTRY, hooks)
  equal(calls.length, 1, 'installSection must be called exactly once')
  const [owner, ns, schema, entry, passed] = calls[0] as unknown[]
  equal(ns, VIEWER_NAMESPACE)
  equal(schema, ViewerSettingsSchema)
  equal(entry, ENTRY)
  equal(passed, hooks, 'the caller owns the hooks; the service must not receive a copy')
  ok(owner !== undefined, 'the owner context rides along, so unload can suppress fallback work')
})

test('on the pre-0.1.2 API the mount still reaches the resolved section and follows writes', () => {
  let scopeValue: ViewerSettings = { ...ENTRY, tool: false }
  let watched: (() => void) | undefined
  let registeredNs: string | undefined
  const { ctx } = ctxWith({
    register: (ns: string) => {
      registeredNs = ns
      return {
        get: () => scopeValue,
        watch: (callback: () => void) => { watched = callback; return () => { watched = undefined } },
      }
    },
  })
  const r = recorder()
  mountSettingsSection(ctx, ENTRY, r.hooks)

  equal(registeredNs, VIEWER_NAMESPACE)
  equal(r.value().tool, false, 'the live section, not the entry config, is the source')
  equal(r.changes(), 1, 'activation reconciles once')

  scopeValue = { ...ENTRY, tool: false, feedModel: false }
  watched?.()
  equal(r.changes(), 2, 'a committed write re-reconciles')
})

test('detaching the settings service returns the source to the composition entry', () => {
  let scopeValue: ViewerSettings = { ...ENTRY, tool: false }
  const { ctx, cleanups } = ctxWith({
    register: () => ({
      get: () => scopeValue,
      watch: () => () => {},
    }),
  })
  const r = recorder()
  mountSettingsSection(ctx, ENTRY, r.hooks)
  equal(r.value().tool, false)

  for (const cleanup of cleanups) cleanup()
  deepEqual(r.value(), ENTRY, 'with no provider the entry config is authoritative again')
  equal(r.changes(), 2, 'the fallback is announced, so derived state is re-judged')
})

test('a settings service offering neither API leaves the composition entry in charge', () => {
  const { ctx } = ctxWith({})
  const r = recorder()
  mountSettingsSection(ctx, ENTRY, r.hooks)
  deepEqual(r.value(), ENTRY)
  equal(r.changes(), 0, 'the plugin body reconciles on its own; the mount adds no second pass')
})

test('unloading the owner does not fall back, and does not re-reconcile', () => {
  // The distinction the cleanup has to make: losing the settings service means
  // hand the still-running plugin back its entry config, while the plugin's own
  // fiber going down means there is nothing to fall back to — re-judging derived
  // state there would re-register the display tool on a fiber already disposing it.
  let scopeValue: ViewerSettings = { ...ENTRY, tool: false }
  const { ctx, cleanups, fiber } = ctxWith({
    register: () => ({ get: () => scopeValue, watch: () => () => {} }),
  })
  const r = recorder()
  mountSettingsSection(ctx, ENTRY, r.hooks)
  equal(r.changes(), 1, 'activation reconciles once')

  fiber.state = 5 // FiberState.UNLOADING
  for (const cleanup of cleanups) cleanup()
  equal(r.changes(), 1, 'no fallback pass during unload')
  equal(r.value().tool, false, 'and the source is left as it was')

  fiber.state = 4 // FiberState.DISPOSED
  for (const cleanup of cleanups) cleanup()
  equal(r.changes(), 1, 'a second teardown pass changes nothing either')
})

test('a committed write during unload is not re-judged', () => {
  let watched: (() => void) | undefined
  const { ctx, fiber } = ctxWith({
    register: () => ({ get: () => ENTRY, watch: (cb: () => void) => { watched = cb; return () => {} } }),
  })
  const r = recorder()
  mountSettingsSection(ctx, ENTRY, r.hooks)
  equal(r.changes(), 1)

  watched?.()
  equal(r.changes(), 2, 'while active, a write re-reconciles')

  fiber.state = 5 // UNLOADING
  watched?.()
  equal(r.changes(), 2, 'once unloading, a queued write is skipped')
})
