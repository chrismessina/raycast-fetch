import { showHUD, showToast, Toast, open } from "@raycast/api";
import { logDebug } from "./logger";
import { DownloadProgress } from "./downloader";

let lastUpdateTime = 0;
const UPDATE_THROTTLE_MS = 250;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return "";

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}

export async function showDownloadProgress(filename: string, progress: DownloadProgress): Promise<void> {
  const now = Date.now();

  // Throttle updates to avoid flickering
  if (now - lastUpdateTime < UPDATE_THROTTLE_MS) {
    return;
  }
  lastUpdateTime = now;

  const percent = Math.round(progress.percent);
  let message = `Downloading ${filename}... ${percent}%`;

  if (progress.speed > 0) {
    message += ` (${formatSpeed(progress.speed)})`;
  }

  if (progress.eta > 0) {
    const etaStr = formatEta(progress.eta);
    if (etaStr) {
      message += ` - ${etaStr} remaining`;
    }
  }

  logDebug("HUD progress update", { filename, percent });
  await showHUD(message);
}

export async function showDownloadStarted(filename: string): Promise<void> {
  logDebug("HUD download started", { filename });
  await showHUD(`Downloading ${filename}...`);
}

export async function showDownloadComplete(filename: string, path: string): Promise<void> {
  logDebug("HUD download complete", { filename, path });

  await showToast({
    style: Toast.Style.Success,
    title: "Download Complete",
    message: filename,
    primaryAction: {
      title: "Open File",
      onAction: () => {
        open(path);
      },
    },
    secondaryAction: {
      title: "Reveal in Finder",
      onAction: () => {
        open(path, "Finder");
      },
    },
  });
}

export async function showDownloadError(filename: string, error: string): Promise<void> {
  logDebug("HUD download error", { filename, error });

  await showToast({
    style: Toast.Style.Failure,
    title: "Download Failed",
    message: `${filename}: ${error}`,
  });
}

export async function showValidationError(message: string): Promise<void> {
  logDebug("HUD validation error", { message });

  await showToast({
    style: Toast.Style.Failure,
    title: "Invalid URL",
    message,
  });
}
