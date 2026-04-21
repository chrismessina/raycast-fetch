import { Action, ActionPanel, Icon, open, Keyboard, launchCommand, LaunchType } from "@raycast/api";
import { DownloadHistoryItem } from "../lib/history";

interface HistoryItemActionsProps {
  item: DownloadHistoryItem;
  onRemove: (item: DownloadHistoryItem) => void;
  onClearByAge: (minutes: number) => void;
  onClearAll: () => void;
}

export function HistoryItemActions({ item, onRemove, onClearByAge, onClearAll }: HistoryItemActionsProps) {
  const redownload = () =>
    launchCommand({
      name: "download",
      type: LaunchType.UserInitiated,
      arguments: { url: item.url },
    });

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
      <Action
        title={item.status === "failed" ? "Retry Download" : "Download Again"}
        icon={item.status === "failed" ? Icon.ArrowClockwise : Icon.Download}
        shortcut={{ modifiers: ["cmd"], key: "r" }}
        onAction={redownload}
      />
      <Action.CopyToClipboard title="Copy URL" content={item.url} shortcut={Keyboard.Shortcut.Common.Copy} />
      {item.outputPath && (
        <Action.CopyToClipboard
          title="Copy File Path"
          content={item.outputPath}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
      )}
      {item.status === "failed" && item.error && (
        <Action.CopyToClipboard
          title="Copy Error"
          content={item.error}
          shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
        />
      )}
      <Action
        title="Delete Entry"
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={Keyboard.Shortcut.Common.Remove}
        onAction={() => onRemove(item)}
      />
      <ActionPanel.Submenu
        title="Delete Downloads…"
        icon={Icon.Trash}
        shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
      >
        <Action title="Last 5 Minutes" icon={Icon.Clock} onAction={() => onClearByAge(5)} />
        <Action title="Last 15 Minutes" icon={Icon.Clock} onAction={() => onClearByAge(15)} />
        <Action title="Last 30 Minutes" icon={Icon.Clock} onAction={() => onClearByAge(30)} />
      </ActionPanel.Submenu>
      <Action
        title="Delete All Downloads"
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
        onAction={onClearAll}
      />
    </ActionPanel>
  );
}
