import { useState, useCallback } from "react";
import { Form, ActionPanel, Action, Icon, showToast, Toast } from "@raycast/api";
import { getPreferences } from "./lib/preferences";
import {
  extractUrlStringsFromText,
  extractFilename,
  generateUniqueFilename,
  fetchHeadInfo,
  ensureExtension,
} from "./lib/url-utils";
import { downloadBatch, BatchDownloadItem, BatchProgress, BatchDownloadHandle, DownloadStatus } from "./lib/downloader";
import { logInfo, logDebug } from "./lib/logger";
import { DownloadListView } from "./views/download-list-view";
import { addBatchToHistory } from "./lib/history";

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
      // Extract URLs from mixed input (handles markdown links and plain URLs)
      const validUrls = extractUrlStringsFromText(values.urls);

      if (validUrls.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "No URLs Found",
          message: "No valid URLs found in input. Supports plain URLs and markdown links.",
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

      // Wait for completion and get final results
      const finalResult = await handle.promise;

      // Save completed/failed items to history
      const historyItems = finalResult.items
        .filter((item) => item.status === "completed" || item.status === "failed")
        .map((item) => ({
          id: item.id,
          url: item.url,
          filename: item.filename,
          outputPath: item.outputPath,
          status: item.status as "completed" | "failed",
          bytesDownloaded: item.result?.bytesDownloaded,
          error: item.error,
        }));

      if (historyItems.length > 0) {
        await addBatchToHistory(historyItems);
      }

      await showToast({
        style: Toast.Style.Success,
        title: "Batch Download Complete",
        message: `${finalResult.items.length} files processed`,
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

      // Only set the batch handle if no other downloads are still in progress
      // This prevents overwriting the original batch handle during active downloads
      setDownloadItems((current) => {
        const hasActiveDownloads = current.some((i) => i.id !== item.id && i.status === "downloading");
        if (!hasActiveDownloads) {
          setBatchHandle(handle);
        }
        return current;
      });

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
      <Form.TextArea
        id="urls"
        title="URLs"
        placeholder="Enter URLs, one per line, or paste text containing URLs..."
        info="Supports plain URLs and markdown links [text](url). URLs are automatically extracted from mixed text."
      />
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
