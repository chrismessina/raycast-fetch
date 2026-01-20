import { LocalStorage } from "@raycast/api";
import { logDebug, logInfo } from "./logger";

export interface DownloadHistoryItem {
  id: string;
  url: string;
  filename: string;
  outputPath: string;
  status: "completed" | "failed";
  bytesDownloaded?: number;
  error?: string;
  timestamp: number;
}

const HISTORY_KEY = "download-history";
const MAX_HISTORY_ITEMS = 100;

export async function getDownloadHistory(): Promise<DownloadHistoryItem[]> {
  try {
    const stored = await LocalStorage.getItem<string>(HISTORY_KEY);
    if (!stored) {
      return [];
    }
    const history = JSON.parse(stored) as DownloadHistoryItem[];
    logDebug("Retrieved download history", { count: history.length });
    return history;
  } catch (error) {
    logDebug("Failed to retrieve download history", { error });
    return [];
  }
}

export async function addToHistory(item: Omit<DownloadHistoryItem, "timestamp">): Promise<void> {
  try {
    const history = await getDownloadHistory();

    const newItem: DownloadHistoryItem = {
      ...item,
      timestamp: Date.now(),
    };

    // Add to beginning (most recent first)
    history.unshift(newItem);

    // Trim to max size
    const trimmed = history.slice(0, MAX_HISTORY_ITEMS);

    await LocalStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    logDebug("Added item to download history", { url: item.url, filename: item.filename });
  } catch (error) {
    logDebug("Failed to add to download history", { error });
  }
}

export async function addBatchToHistory(items: Omit<DownloadHistoryItem, "timestamp">[]): Promise<void> {
  try {
    const history = await getDownloadHistory();
    const timestamp = Date.now();

    const newItems: DownloadHistoryItem[] = items.map((item, index) => ({
      ...item,
      timestamp: timestamp - index, // Slight offset to maintain order
    }));

    // Add to beginning (most recent first)
    history.unshift(...newItems);

    // Trim to max size
    const trimmed = history.slice(0, MAX_HISTORY_ITEMS);

    await LocalStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    logInfo("Added batch to download history", { count: items.length });
  } catch (error) {
    logDebug("Failed to add batch to download history", { error });
  }
}

export async function clearHistory(): Promise<void> {
  await LocalStorage.removeItem(HISTORY_KEY);
  logInfo("Cleared download history");
}

export async function removeFromHistory(id: string): Promise<void> {
  try {
    const history = await getDownloadHistory();
    const filtered = history.filter((item) => item.id !== id);
    await LocalStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
    logDebug("Removed item from download history", { id });
  } catch (error) {
    logDebug("Failed to remove from download history", { error });
  }
}

export async function clearHistoryByAge(minutes: number): Promise<number> {
  try {
    const history = await getDownloadHistory();
    const cutoff = Date.now() - minutes * 60 * 1000;
    // Keep items older than the cutoff (remove recent items within the time window)
    const filtered = history.filter((item) => item.timestamp <= cutoff);
    const removedCount = history.length - filtered.length;
    await LocalStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
    logInfo("Cleared history by age", { minutes, removedCount });
    return removedCount;
  } catch (error) {
    logDebug("Failed to clear history by age", { error });
    return 0;
  }
}
