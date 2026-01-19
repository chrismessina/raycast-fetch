import { getPreferenceValues } from "@raycast/api";
import { homedir } from "os";
import { join } from "path";
import { logDebug, logWarn } from "./logger";

export interface Preferences {
  outputDirectory: string;
  followRedirects: boolean;
  defaultTimeout: number;
  overwriteExisting: boolean;
  enableDebugLogging: boolean;
}

let cachedPreferences: Preferences | null = null;

export function getPreferences(): Preferences {
  if (cachedPreferences) {
    return cachedPreferences;
  }

  const raw = getPreferenceValues<{
    outputDirectory?: string;
    followRedirects?: boolean;
    defaultTimeout?: string;
    overwriteExisting?: boolean;
    enableDebugLogging?: boolean;
  }>();

  // Resolve output directory with fallback
  let outputDirectory = raw.outputDirectory || join(homedir(), "Downloads");
  if (outputDirectory.startsWith("~")) {
    outputDirectory = outputDirectory.replace("~", homedir());
  }

  // Parse timeout with validation
  let defaultTimeout = 300;
  if (raw.defaultTimeout) {
    const parsed = parseInt(raw.defaultTimeout, 10);
    if (isNaN(parsed) || parsed <= 0) {
      logWarn("Invalid timeout value, using default", { provided: raw.defaultTimeout, default: 300 });
    } else {
      defaultTimeout = parsed;
    }
  }

  cachedPreferences = {
    outputDirectory,
    followRedirects: raw.followRedirects ?? true,
    defaultTimeout,
    overwriteExisting: raw.overwriteExisting ?? false,
    enableDebugLogging: raw.enableDebugLogging ?? false,
  };

  logDebug("Preferences loaded", cachedPreferences);

  return cachedPreferences;
}

export function clearPreferencesCache(): void {
  cachedPreferences = null;
}
