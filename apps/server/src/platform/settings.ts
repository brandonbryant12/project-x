import { Context } from 'effect';
import type { AppConfig } from './config.ts';

/** Decoded, validated configuration as a service. */
export class Settings extends Context.Service<Settings, AppConfig>()('@repo/server/Settings') {}
