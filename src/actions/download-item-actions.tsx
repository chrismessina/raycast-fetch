import { Action, ActionPanel, Icon, open } from "@raycast/api";
import { BatchDownloadItem, BatchDownloadHandle } from "../lib/downloader";

interface DownloadItemActionsProps {
  item: BatchDownloadItem;
  batchHandle: BatchDownloadHandle | null;
  onRetry: (item: BatchDownloadItem) => void;
}

export function DownloadItemActions({ item, batchHandle, onRetry }: DownloadItemActionsProps) {
  return (
    <ActionPanel>
      {item.status === "completed" && item.outputPath && (
        <>
          <Action title="Open File" icon={Icon.Document} onAction={() => open(item.outputPath)} />
          <Action
            title="Reveal in Finder"
            icon={Icon.Finder}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            onAction={() => open(item.outputPath, "Finder")}
          />
        </>
      )}
      {item.status === "failed" && <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => onRetry(item)} />}
      {item.status === "downloading" && batchHandle && (
        <Action
          title="Cancel"
          icon={Icon.XMarkCircle}
          style={Action.Style.Destructive}
          onAction={() => batchHandle.cancelItem(item.id)}
        />
      )}
      <Action.CopyToClipboard title="Copy URL" content={item.url} shortcut={{ modifiers: ["cmd"], key: "c" }} />
      {item.status === "failed" && item.error && (
        <Action.CopyToClipboard
          title="Copy Error"
          content={item.error}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
      )}
    </ActionPanel>
  );
}
