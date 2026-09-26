/**
 * Host-side settings schema over the shared contract. Only the Node half
 * imports this module, so the validator never reaches the browser bundle.
 */
import z from '@deepseek-ai/schemastery';
import { type ViewerSettings } from './contract.ts';
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
export declare const ViewerSettingsSchema: z<ViewerSettings>;
