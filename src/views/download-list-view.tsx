import { Color, Icon, List } from "@raycast/api";
import { DownloadItemActions } from "../actions/download-item-actions";
import { BatchDownloadHandle, BatchDownloadItem, DownloadStatus } from "../lib/downloader";
import { formatBytes, formatSpeed } from "../lib/progress";

function getStatusIcon(status: DownloadStatus): { source: Icon; tintColor: Color } {
  switch (status) {
    case "pending":
      return { source: Icon.Clock, tintColor: Color.SecondaryText };
    case "downloading":
      return { source: Icon.Download, tintColor: Color.Blue };
    case "completed":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    case "failed":
      return { source: Icon.XMarkCircle, tintColor: Color.Red };
    case "cancelled":
      return { source: Icon.MinusCircle, tintColor: Color.Orange };
  }
}

function getStatusText(item: BatchDownloadItem): string {
  switch (item.status) {
    case "pending":
      return "Pending";
    case "downloading":
      if (item.progress.percent > 0) {
        return `${Math.round(item.progress.percent)}%`;
      }
      return "Starting...";
    case "completed":
      return item.result?.bytesDownloaded ? formatBytes(item.result.bytesDownloaded) : "Completed";
    case "failed":
      return item.error || "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

interface DownloadListViewProps {
  items: BatchDownloadItem[];
  batchHandle: BatchDownloadHandle | null;
  onRetry: (item: BatchDownloadItem) => void;
  navigationTitle?: string;
}

export function DownloadListView({
  items,
  batchHandle,
  onRetry,
  navigationTitle = "Batch Download",
}: DownloadListViewProps) {
  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed" || item.status === "cancelled").length;

  return (
    <List navigationTitle={navigationTitle} searchBarPlaceholder="Filter downloads...">
      <List.Section
        title="Downloads"
        subtitle={`${completedCount} completed, ${failedCount} failed, ${items.length} total`}
      >
        {items.map((item) => (
          <List.Item
            key={item.id}
            title={item.filename}
            subtitle={item.url}
            icon={getStatusIcon(item.status)}
            accessories={[
              ...(item.status === "downloading" && item.progress.speed > 0
                ? [{ text: formatSpeed(item.progress.speed) }]
                : []),
              { text: getStatusText(item) },
            ]}
            actions={<DownloadItemActions item={item} batchHandle={batchHandle} onRetry={onRetry} />}
          />
        ))}
      </List.Section>
    </List>
  );
}
