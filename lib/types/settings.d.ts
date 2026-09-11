/**
 * Host-side settings schema over the shared contract. Only the Node half
 * imports this module, so the validator never reaches the browser bundle.
 */
import z from '@deepseek-ai/schemastery';
import { type ViewerSettings } from './contract.ts';
/**
 * Durable schema for the `crosery-viewer` section.
 *
 * Every field defaults to the behavior the plugin exists to provide, so an
 * empty composition row is the intended configuration and each flag is a way to
 * give one piece back.
 */
export declare const ViewerSettingsSchema: z<ViewerSettings>;
