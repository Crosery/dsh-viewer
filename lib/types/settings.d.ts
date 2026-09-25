/**
 * Host-side settings schema over the shared contract. Only the Node half
 * imports this module, so the validator never reaches the browser bundle.
 */
import z from '@deepseek-ai/schemastery';
import { type ViewerSettings } from './contract.ts';
/**
 * Durable schema for the viewer's settings: the `crosery-viewer` section up to
 * 0.1.5, and the plugin entry's own Config (entry id `viewer`) from 0.1.7.
 *
 * Every field defaults to the behavior the plugin exists to provide, so an
 * empty composition row is the intended configuration and each flag is a way to
 * give one piece back.
 *
 * The descriptions are what 0.1.7's generated settings form shows beside each
 * switch — without them the form lists bare field names. They are English
 * only: schemastery can carry a locale dictionary, but no first-party Config
 * uses one and nothing guarantees a generated form resolves it, so a dictionary
 * risks rendering as an unreadable object where a string always reads.
 */
export declare const ViewerSettingsSchema: z<ViewerSettings>;
