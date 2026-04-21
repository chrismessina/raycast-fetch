import { useState, useCallback, useEffect, useRef } from "react";
import { Form, ActionPanel, Action, Icon, showToast, Toast, LaunchProps } from "@raycast/api";
import { getPreferences } from "./lib/preferences";
import {
  extractUrlStringsFromText,
  extractFilename,
  generateUniqueFilename,
  fetchHeadInfo,
  ensureExtension,
  expandAllRangeUrls,
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

interface LaunchContext {
  urls?: string[];
  outputDirectory?: string;
}

export default function Command(props: LaunchProps<{ launchContext?: LaunchContext }>) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadItems, setDownloadItems] = useState<BatchDownloadItem[]>([]);
  const [batchHandle, setBatchHandle] = useState<BatchDownloadHandle | null>(null);

  // Ref mirror of downloadItems so handleRetry can inspect current state
  // without abusing setState's updater callback for side effects.
  const downloadItemsRef = useRef<BatchDownloadItem[]>([]);
  useEffect(() => {
    downloadItemsRef.current = downloadItems;
  }, [downloadItems]);

  const preferences = getPreferences();
  const launchContext = props.launchContext;

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

  // Shared function to start downloads from a list of URLs
  const startDownloads = useCallback(
    async (urls: string[], outputDirectory: string) => {
      if (urls.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "No URLs Found",
          message: "No valid URLs found in input.",
        });
        return;
      }

      logInfo("Batch download initiated", { urlCount: urls.length, outputDirectory });

      setIsDownloading(true);

      // Prepare items with filenames
      const preparedItems = await prepareItems(urls, outputDirectory);

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

      const completedCount = finalResult.items.filter((i) => i.status === "completed").length;
      const failedCount = finalResult.items.filter((i) => i.status === "failed").length;

      await showToast({
        style: failedCount > 0 ? Toast.Style.Failure : Toast.Style.Success,
        title: "Batch Download Complete",
        message:
          failedCount > 0 ? `${completedCount} succeeded, ${failedCount} failed` : `${completedCount} files downloaded`,
      });
    },
    [prepareItems, preferences],
  );

  // Handle launch context (URLs passed from another command)
  useEffect(() => {
    if (launchContext?.urls && launchContext.urls.length > 0) {
      const outputDir = launchContext.outputDirectory || preferences.outputDirectory;
      logInfo("Batch download launched with context", {
        urlCount: launchContext.urls.length,
        outputDirectory: outputDir,
      });
      startDownloads(launchContext.urls, outputDir);
    }
  }, [launchContext, preferences.outputDirectory, startDownloads]);

  const handleSubmit = useCallback(
    async (values: FormValues) => {
      // Extract URLs from mixed input (handles markdown links, plain URLs, and range patterns)
      const extractedUrls = extractUrlStringsFromText(values.urls);

      // Expand any range patterns (e.g., file[001-025].zip)
      const expandedUrls = expandAllRangeUrls(extractedUrls);

      // Get output directory from form or fall back to preference
      const outputDirectory = values.outputDirectory?.[0] || preferences.outputDirectory;

      await startDownloads(expandedUrls, outputDirectory);
    },
    [startDownloads, preferences.outputDirectory],
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

      // Avoid overwriting the original batch handle while other items are still active.
      const hasActiveDownloads = downloadItemsRef.current.some((i) => i.id !== item.id && i.status === "downloading");
      if (!hasActiveDownloads) {
        setBatchHandle(handle);
      }

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
        info="Supports plain URLs, markdown links, and range patterns like file[001-025].zip"
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
