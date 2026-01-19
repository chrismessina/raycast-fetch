import { useState, useCallback } from "react";
import { Form, ActionPanel, Action, List, Icon, Color, showToast, Toast, open } from "@raycast/api";
import { getPreferences } from "./lib/preferences";
import { isValidUrl, extractFilename, generateUniqueFilename, fetchHeadInfo, ensureExtension } from "./lib/url-utils";
import { downloadBatch, BatchDownloadItem, BatchProgress, BatchDownloadHandle, DownloadStatus } from "./lib/downloader";
import { formatBytes, formatSpeed } from "./lib/progress";
import { logInfo, logDebug } from "./lib/logger";

interface FormValues {
  urls: string;
  outputDirectory: string[];
}

interface PreparedItem {
  id: string;
  url: string;
  filename: string;
  outputPath: string;
}

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

function DownloadListView({
  items,
  batchHandle,
  onRetry,
}: {
  items: BatchDownloadItem[];
  batchHandle: BatchDownloadHandle | null;
  onRetry: (item: BatchDownloadItem) => void;
}) {
  const completedCount = items.filter((i) => i.status === "completed").length;
  const failedCount = items.filter((i) => i.status === "failed" || i.status === "cancelled").length;
  const totalCount = items.length;

  return (
    <List navigationTitle="Batch Download" searchBarPlaceholder="Filter downloads...">
      <List.Section
        title="Downloads"
        subtitle={`${completedCount} completed, ${failedCount} failed, ${totalCount} total`}
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
            actions={
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
                {item.status === "failed" && (
                  <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => onRetry(item)} />
                )}
                {item.status === "downloading" && batchHandle && (
                  <Action
                    title="Cancel"
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    onAction={() => batchHandle.cancelItem(item.id)}
                  />
                )}
                <Action.CopyToClipboard
                  title="Copy URL"
                  content={item.url}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
                {item.status === "failed" && item.error && (
                  <Action.CopyToClipboard
                    title="Copy Error"
                    content={item.error}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                  />
                )}
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

export default function Command() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadItems, setDownloadItems] = useState<BatchDownloadItem[]>([]);
  const [batchHandle, setBatchHandle] = useState<BatchDownloadHandle | null>(null);

  const preferences = getPreferences();

  const prepareItems = useCallback(
    async (urls: string[], outputDirectory: string): Promise<PreparedItem[]> => {
      const items: PreparedItem[] = [];

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const id = `download-${Date.now()}-${i}`;

        // Fetch HEAD info to get Content-Type
        const headInfo = await fetchHeadInfo(url);

        // Extract and enhance filename
        let filename = extractFilename(url, headInfo.contentDisposition);
        filename = ensureExtension(filename, headInfo.contentType);

        const outputPath = preferences.overwriteExisting
          ? `${outputDirectory}/${filename}`
          : generateUniqueFilename(outputDirectory, filename);

        items.push({ id, url, filename, outputPath });
      }

      return items;
    },
    [preferences],
  );

  const handleSubmit = useCallback(
    async (values: FormValues) => {
      const lines = values.urls
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // Validate URLs
      const validUrls: string[] = [];
      const invalidUrls: string[] = [];

      for (const line of lines) {
        if (isValidUrl(line)) {
          validUrls.push(line);
        } else {
          invalidUrls.push(line);
        }
      }

      if (invalidUrls.length > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Invalid URLs",
          message: `${invalidUrls.length} invalid URL(s) found`,
        });
        return;
      }

      if (validUrls.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "No URLs",
          message: "Please enter at least one valid URL",
        });
        return;
      }

      // Get output directory from form or fall back to preference
      const outputDirectory = values.outputDirectory?.[0] || preferences.outputDirectory;

      logInfo("Batch download initiated", { urlCount: validUrls.length, outputDirectory });

      setIsDownloading(true);

      // Prepare items with filenames
      const preparedItems = await prepareItems(validUrls, outputDirectory);

      // Initialize download items for display
      const initialItems: BatchDownloadItem[] = preparedItems.map((item) => ({
        id: item.id,
        url: item.url,
        filename: item.filename,
        outputPath: item.outputPath,
        status: "pending" as DownloadStatus,
        progress: { percent: 0, bytesDownloaded: 0, totalBytes: 0, speed: 0, eta: 0 },
      }));

      setDownloadItems(initialItems);

      // Start batch download
      const handle = downloadBatch(
        preparedItems.map((item) => ({
          id: item.id,
          url: item.url,
          filename: item.filename,
          outputPath: item.outputPath,
          options: {
            followRedirects: preferences.followRedirects,
            timeout: preferences.defaultTimeout,
          },
        })),
        preferences.maxParallelDownloads,
        (progress: BatchProgress) => {
          setDownloadItems([...progress.items]);
        },
      );

      setBatchHandle(handle);

      // Wait for completion
      await handle.promise;

      await showToast({
        style: Toast.Style.Success,
        title: "Batch Download Complete",
        message: `${initialItems.length} files processed`,
      });
    },
    [prepareItems, preferences],
  );

  const handleRetry = useCallback(
    async (item: BatchDownloadItem) => {
      logDebug("Retrying failed download", { url: item.url });

      // Update item status to pending
      setDownloadItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "pending" as DownloadStatus,
                error: undefined,
                progress: { percent: 0, bytesDownloaded: 0, totalBytes: 0, speed: 0, eta: 0 },
              }
            : i,
        ),
      );

      // Start single item download
      const handle = downloadBatch(
        [
          {
            id: item.id,
            url: item.url,
            filename: item.filename,
            outputPath: item.outputPath,
            options: {
              followRedirects: preferences.followRedirects,
              timeout: preferences.defaultTimeout,
            },
          },
        ],
        1,
        (progress: BatchProgress) => {
          const updatedItem = progress.items[0];
          if (updatedItem) {
            setDownloadItems((prev) => prev.map((i) => (i.id === item.id ? updatedItem : i)));
          }
        },
      );

      await handle.promise;
    },
    [preferences],
  );

  if (isDownloading) {
    return <DownloadListView items={downloadItems} batchHandle={batchHandle} onRetry={handleRetry} />;
  }

  return (
    <Form
      navigationTitle="Batch Download"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Download All" icon={Icon.Download} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="urls" title="URLs" placeholder="Enter URLs, one per line..." info="Enter one URL per line." />
      <Form.FilePicker
        id="outputDirectory"
        title="Output Directory"
        allowMultipleSelection={false}
        canChooseDirectories={true}
        canChooseFiles={false}
        defaultValue={[preferences.outputDirectory]}
      />
    </Form>
  );
}
