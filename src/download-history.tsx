import { useCallback, useEffect, useState } from "react";
import { Alert, Color, confirmAlert, Icon, List, showToast, Toast } from "@raycast/api";
import { HistoryItemActions } from "./actions/history-item-actions";
import {
  clearHistory,
  clearHistoryByAge,
  DownloadHistoryItem,
  getDownloadHistory,
  removeFromHistory,
} from "./lib/history";
import { formatBytes } from "./lib/progress";

function getStatusIcon(status: "completed" | "failed"): { source: Icon; tintColor: Color } {
  return status === "completed"
    ? { source: Icon.CheckCircle, tintColor: Color.Green }
    : { source: Icon.XMarkCircle, tintColor: Color.Red };
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "long" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

export default function Command() {
  const [history, setHistory] = useState<DownloadHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    const items = await getDownloadHistory();
    setHistory(items);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleClearHistory = useCallback(async () => {
    const confirmed = await confirmAlert({
      title: "Clear Download History",
      message: "Are you sure you want to clear all download history? This cannot be undone.",
      primaryAction: {
        title: "Clear",
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (confirmed) {
      await clearHistory();
      setHistory([]);
      await showToast({ style: Toast.Style.Success, title: "History Cleared" });
    }
  }, []);

  const handleRemoveItem = useCallback(async (item: DownloadHistoryItem) => {
    await removeFromHistory(item.id);
    setHistory((prev) => prev.filter((i) => i.id !== item.id));
    await showToast({ style: Toast.Style.Success, title: "Removed from History" });
  }, []);

  const handleClearByAge = useCallback(
    async (minutes: number) => {
      const removedCount = await clearHistoryByAge(minutes);
      await loadHistory();

      if (removedCount === 0) {
        await showToast({
          style: Toast.Style.Success,
          title: "No Downloads to Remove",
          message: `No downloads found from the last ${minutes} minutes`,
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: "Downloads Deleted",
          message: `Removed ${removedCount} ${removedCount === 1 ? "download" : "downloads"} from the last ${minutes} minutes`,
        });
      }
    },
    [loadHistory],
  );

  const completedCount = history.filter((item) => item.status === "completed").length;
  const failedCount = history.length - completedCount;

  return (
    <List isLoading={isLoading} navigationTitle="Download History" searchBarPlaceholder="Search history...">
      {history.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.Clock} title="No Download History" description="Downloads will appear here" />
      ) : (
        <List.Section title="History" subtitle={`${completedCount} completed, ${failedCount} failed`}>
          {history.map((item) => (
            <List.Item
              key={item.id}
              title={item.filename}
              subtitle={item.url}
              icon={getStatusIcon(item.status)}
              accessories={[
                ...(item.bytesDownloaded ? [{ text: formatBytes(item.bytesDownloaded) }] : []),
                { text: formatDate(item.timestamp), tooltip: new Date(item.timestamp).toLocaleString() },
              ]}
              actions={
                <HistoryItemActions
                  item={item}
                  onRemove={handleRemoveItem}
                  onClearByAge={handleClearByAge}
                  onClearAll={handleClearHistory}
                />
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
