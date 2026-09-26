/**
 * Host-side settings schema over the shared contract. Only the Node half
 * imports this module, so the validator never reaches the browser bundle.
 */

import z from '@deepseek-ai/schemastery'
import {
  FEED_MODEL_FIELD, REDIRECT_READ_FIELD, SUPERSEDE_READ_IMAGE_FIELD, TOOL_FIELD,
  type ViewerSettings,
} from './contract.ts'

/**
 * Durable schema for the viewer's settings: the `crosery-viewer` section up to
 * 0.1.6, and the plugin entry's own Config (entry id `viewer`) from 0.1.7.
 *
 * Every field defaults to the behavior the plugin exists to provide, so an
 * empty composition row is the intended configuration and each flag is a way to
 * give one piece back.
 *
 * The descriptions document each field wherever the schema is projected — on
 * 0.1.7, the JSON Schema `dsh --dump-config-schema` prints for profile entries.
 * They do not make a settings form: 0.1.7's Settings page builds forms only
 * from volatile fields, and none of these is. They are English only:
 * schemastery can carry a locale dictionary, but no first-party Config uses one
 * and nothing guarantees every consumer resolves it, so a dictionary risks
 * rendering as an unreadable object where a string always reads.
 */
export const ViewerSettingsSchema: z<ViewerSettings> = z.object({
  [TOOL_FIELD]: z.boolean().default(true)
    .description('Offer the display_file tool, which previews images, video, audio, PDF, Office documents and HTML inline in the conversation.'),
  [REDIRECT_READ_FIELD]: z.boolean().default(true)
    .description('When the model calls read on binary media, answer with a pointer to display_file instead of decoding the bytes as text.'),
  [FEED_MODEL_FIELD]: z.boolean().default(true)
    .description('On a model route that accepts images, also put a displayed PNG, JPEG, WebP or GIF into the model context.'),
  [SUPERSEDE_READ_IMAGE_FIELD]: z.boolean().default(true)
    .description('Hide the built-in read_image tool from agents, so each image enters the model context once, through display_file.'),
})
