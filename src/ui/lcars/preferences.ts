export type AnimationMode = 'on' | 'reduced' | 'off';
export interface ConsolePreferences {
  version: 1;
  animations: AnimationMode;
  sound: boolean;
  volume: number;
}
export const PREFERENCES_KEY = 'frontier.lcars.console.v1';
export function defaultPreferences(reduced = false): ConsolePreferences {
  return { version: 1, animations: reduced ? 'reduced' : 'on', sound: true, volume: 0.25 };
}
export function parsePreferences(raw: string | null, reduced = false): ConsolePreferences {
  const defaults = defaultPreferences(reduced);
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1)
      return defaults;
    const settings = value as Record<string, unknown>;
    return {
      ...defaults,
      animations: ['on', 'reduced', 'off'].includes(String(settings.animations))
        ? (settings.animations as AnimationMode)
        : defaults.animations,
      sound: typeof settings.sound === 'boolean' ? settings.sound : defaults.sound,
      volume:
        typeof settings.volume === 'number' && Number.isFinite(settings.volume)
          ? Math.max(0, Math.min(1, settings.volume))
          : defaults.volume,
    };
  } catch {
    return defaults;
  }
}
