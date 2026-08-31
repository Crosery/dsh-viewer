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
 * Durable schema for the `crosery-viewer` section.
 *
 * Every field defaults to the behavior the plugin exists to provide, so an
 * empty composition row is the intended configuration and each flag is a way to
 * give one piece back.
 */
export const ViewerSettingsSchema: z<ViewerSettings> = z.object({
  [TOOL_FIELD]: z.boolean().default(true),
  [REDIRECT_READ_FIELD]: z.boolean().default(true),
  [FEED_MODEL_FIELD]: z.boolean().default(true),
  [SUPERSEDE_READ_IMAGE_FIELD]: z.boolean().default(true),
})
