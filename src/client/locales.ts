/**
 * Card copy. Two dictionaries with identical key sets — the locale service
 * fails a namespace whose dictionaries disagree, so a key added here has to be
 * added to both.
 */

/** Dictionary key domain of this plugin's namespace. */
export type ViewerKey =
  | 'title.image' | 'title.video' | 'title.audio' | 'title.pdf' | 'title.document' | 'title.html' | 'title.file'
  | 'title.readImage'
  | 'state.running' | 'state.loading' | 'state.loadFailed' | 'state.retry'
  | 'state.unavailable' | 'state.unsupported'
  | 'badge.inContext' | 'badge.screenOnly'
  | 'action.open' | 'action.openNew' | 'action.close' | 'action.expand' | 'action.collapse'
  | 'media.noVideo' | 'media.noAudio'

/** Simplified Chinese copy. */
export const zh: Record<ViewerKey, string> = {
  'title.image': '图片',
  'title.video': '视频',
  'title.audio': '音频',
  'title.pdf': 'PDF',
  'title.document': '文档',
  'title.html': '网页',
  'title.file': '文件',
  'title.readImage': '读入图片',
  'state.running': '读取中',
  'state.loading': '加载中',
  'state.loadFailed': '加载失败，点击重试',
  'state.retry': '重试',
  'state.unavailable': '此文件系统后端不提供可预览的本地路径',
  'state.unsupported': '没有可用的预览内容',
  'badge.inContext': '已进入模型上下文',
  'badge.screenOnly': '仅在页面显示',
  'action.open': '查看原图',
  'action.openNew': '在新标签打开',
  'action.close': '关闭',
  'action.expand': '展开',
  'action.collapse': '收起',
  'media.noVideo': '当前浏览器无法播放该视频格式',
  'media.noAudio': '当前浏览器无法播放该音频格式',
}

/** English copy. */
export const en: Record<ViewerKey, string> = {
  'title.image': 'Image',
  'title.video': 'Video',
  'title.audio': 'Audio',
  'title.pdf': 'PDF',
  'title.document': 'Document',
  'title.html': 'Page',
  'title.file': 'File',
  'title.readImage': 'Image read',
  'state.running': 'Reading',
  'state.loading': 'Loading',
  'state.loadFailed': 'Failed to load — click to retry',
  'state.retry': 'Retry',
  'state.unavailable': 'This filesystem backend exposes no previewable local path',
  'state.unsupported': 'Nothing to preview',
  'badge.inContext': 'in model context',
  'badge.screenOnly': 'shown to you only',
  'action.open': 'View full size',
  'action.openNew': 'Open in a new tab',
  'action.close': 'Close',
  'action.expand': 'Expand',
  'action.collapse': 'Collapse',
  'media.noVideo': 'This browser cannot play that video format',
  'media.noAudio': 'This browser cannot play that audio format',
}
