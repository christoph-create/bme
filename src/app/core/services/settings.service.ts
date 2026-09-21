import { Injectable, Signal, computed, inject, signal } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import {
  AppSettings,
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  decodeSettings,
  encodeSetting,
  normalizeSetting,
} from "../settings/app-settings";
import { LoggerService } from "./logger.service";

/**
 * The app-level settings, app-wide.
 *
 * Same shape as `VariablesService`: a signal read model over the backend's
 * key/value store, loaded once at startup. Consumers read `settings()`
 * synchronously and get the defaults until the load lands - the constructor
 * deliberately does no IPC, so a component under test can inject the real
 * service without mocking anything.
 *
 * Writes are optimistic: the signal changes first, then the row is written.
 * Consumers seed their local state from the signal (`linkedSignal`), and a
 * settings-page toggle should be visible everywhere the moment it's flipped,
 * not after an IPC round trip.
 *
 * Consumers that seed a `linkedSignal` should do it from `value(key)`, not
 * from `settings()`: a linkedSignal re-seeds whenever anything it read
 * changes, so reading the whole object would reset a session override of
 * *every* setting the moment *any* setting is changed. `value()` puts a
 * memoised `computed` in between, which only notifies on a real change to
 * that one key.
 */
@Injectable({ providedIn: "root" })
export class SettingsService {
  private readonly logger = inject(LoggerService);
  private readonly settingsSignal = signal<AppSettings>(DEFAULT_SETTINGS);
  private loading: Promise<void> | null = null;

  readonly settings = this.settingsSignal.asReadonly();
  private readonly values = new Map<keyof AppSettings, Signal<unknown>>();

  /** One memoised signal per key, shared by every caller. */
  value<K extends keyof AppSettings>(key: K): Signal<AppSettings[K]> {
    let cached = this.values.get(key);
    if (cached === undefined) {
      cached = computed(() => this.settingsSignal()[key]);
      this.values.set(key, cached);
    }
    return cached as Signal<AppSettings[K]>;
  }

  /** Loads once per app run unless `force`d; concurrent callers share the
   * in-flight promise. A rejected load is not cached, so a later call can
   * retry rather than inherit the failure. */
  load(force = false): Promise<void> {
    if (force) {
      this.loading = null;
    }
    this.loading ??= this.refresh().catch((err: unknown) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  async set<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): Promise<void> {
    // Normalised before it's shown, so the UI never holds a value the next
    // startup would silently clamp to something else.
    const normalized = normalizeSetting(key, value);
    this.settingsSignal.update((current) => ({
      ...current,
      [key]: normalized,
    }));
    await invoke("set_app_setting", {
      key: SETTING_KEYS[key],
      value: encodeSetting(key, normalized),
    });
  }

  /** Back to the defaults by *removing* the rows rather than writing the
   * default values: an absent key is what "never changed" looks like, and it
   * keeps a future change of default from being shadowed by a stale row. */
  async resetAll(): Promise<void> {
    this.settingsSignal.set(DEFAULT_SETTINGS);
    await Promise.all(
      Object.values(SETTING_KEYS).map((key) =>
        invoke("remove_app_setting", { key }),
      ),
    );
  }

  private async refresh(): Promise<void> {
    const rows = await invoke<Record<string, string>>("list_app_settings");
    this.settingsSignal.set(decodeSettings(rows));
    this.logger.debug(
      `settings: loaded ${Object.keys(rows).length} row(s) from app_settings`,
    );
  }
}
