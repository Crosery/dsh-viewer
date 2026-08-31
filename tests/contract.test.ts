/** Classification and the defensive narrowing every replayed card goes through. */

import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSET_ROUTE, classifyPath, displayValueFrom, extensionOf, formatBytes,
  isOpaqueMediaPath, modelImageFrom, modelImageMediaTypeForPath,
} from '../src/contract.ts'

const IMAGE = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 100, width: 8, height: 6 }

test('a dotfile has no extension, so it never classifies as media', () => {
  equal(extensionOf('.gitignore'), undefined)
  equal(classifyPath('.gitignore').kind, 'file')
})

test('classification is case-insensitive and follows both separators', () => {
  equal(classifyPath('C:\\Users\\me\\Clip.MP4').kind, 'video')
  equal(classifyPath('/tmp/a.PNG').mediaType, 'image/png')
})

test('an extension colliding with an Object.prototype key falls back instead of resolving the inherited member', () => {
  equal(classifyPath('logo.constructor').kind, 'file')
  equal(classifyPath('logo.__proto__').kind, 'file')
  equal(modelImageMediaTypeForPath('logo.constructor'), undefined)
})

test('every playable family classifies to the element that plays it', () => {
  equal(classifyPath('a.svg').kind, 'image')
  equal(classifyPath('a.webm').kind, 'video')
  equal(classifyPath('a.flac').kind, 'audio')
  equal(classifyPath('a.pdf').kind, 'pdf')
  equal(classifyPath('a.html').kind, 'html')
  equal(classifyPath('a.zip').kind, 'file')
})

test('only the four attachment-admissible rasters can reach model context', () => {
  equal(modelImageMediaTypeForPath('a.jpeg'), 'image/jpeg')
  // Displayable, but the attachment service would refuse the bytes.
  equal(classifyPath('a.svg').kind, 'image')
  equal(modelImageMediaTypeForPath('a.svg'), undefined)
  equal(modelImageMediaTypeForPath('a.avif'), undefined)
})

test('html is not redirected away from read, because reading its source is a real text read', () => {
  equal(isOpaqueMediaPath('a.png'), true)
  equal(isOpaqueMediaPath('a.mp3'), true)
  equal(isOpaqueMediaPath('a.pdf'), true)
  equal(isOpaqueMediaPath('a.html'), false)
  equal(isOpaqueMediaPath('a.ts'), false)
})

test('an image with a zero or fractional dimension is refused, so no card divides by zero', () => {
  equal(modelImageFrom({ ...IMAGE, width: 0 }), undefined)
  equal(modelImageFrom({ ...IMAGE, height: 1.5 }), undefined)
  equal(modelImageFrom({ ...IMAGE, bytes: -1 }), undefined)
})

test('an image whose media type the attachment service never mints is refused', () => {
  equal(modelImageFrom({ ...IMAGE, mediaType: 'image/svg+xml' }), undefined)
  equal(modelImageFrom({ ...IMAGE, attachmentId: '' }), undefined)
})

test('a well-formed image narrows and drops nothing it carried', () => {
  deepEqual(modelImageFrom({ ...IMAGE, name: 'logo.png' }), { ...IMAGE, name: 'logo.png' })
})

test('replayed metadata narrows to the card payload', () => {
  const meta = { path: '/tmp/a.png', kind: 'image', mediaType: 'image/png', bytes: 100, inContext: true, image: IMAGE }
  deepEqual(displayValueFrom(meta), meta)
})

test('an asset URL that is not this plugin route is refused rather than handed to an img src', () => {
  const base = { path: '/tmp/a.mp4', kind: 'video', mediaType: 'video/mp4', bytes: 9, inContext: false }
  equal(displayValueFrom({ ...base, assetUrl: 'https://evil.example/x' }), undefined)
  equal(displayValueFrom({ ...base, assetUrl: '//evil.example/x' }), undefined)
  equal(displayValueFrom({ ...base, assetUrl: 'javascript:alert(1)' }), undefined)
  equal(displayValueFrom({ ...base, assetUrl: `${ASSET_ROUTE}?p=x&s=y` })?.assetUrl, `${ASSET_ROUTE}?p=x&s=y`)
})

test('metadata missing a required field declines instead of producing a half-built card', () => {
  equal(displayValueFrom(undefined), undefined)
  equal(displayValueFrom({ path: '/a', kind: 'image', mediaType: 'image/png', bytes: 1 }), undefined)
  equal(displayValueFrom({ path: '', kind: 'image', mediaType: 'image/png', bytes: 1, inContext: false }), undefined)
  equal(displayValueFrom({ path: '/a', kind: 'hologram', mediaType: 'x/y', bytes: 1, inContext: false }), undefined)
})

test('a present but malformed image field declines the whole payload, not just the image', () => {
  const meta = { path: '/a.png', kind: 'image', mediaType: 'image/png', bytes: 1, inContext: false, image: { attachmentId: 'x' } }
  equal(displayValueFrom(meta), undefined)
})

test('sizes read the way a file manager writes them, and an unknown size renders as nothing', () => {
  equal(formatBytes(0), '')
  equal(formatBytes(512), '512 B')
  equal(formatBytes(2048), '2.0 KB')
  equal(formatBytes(15 * 1024 * 1024), '15 MB')
})
