import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  BrowserExtension,
  Clipboard,
  Form,
  Icon,
  LaunchProps,
  showToast,
  Toast,
} from "@raycast/api";
import { BatchDownloadHandle, BatchDownloadItem, BatchProgress, downloadBatch, DownloadStatus } from "./lib/downloader";
import { addBatchToHistory } from "./lib/history";
import { logDebug, logInfo, logWarn } from "./lib/logger";
import { getPreferences } from "./lib/preferences";
import {
  expandAllRangeUrls,
  extractUrlStringsFromText,
  getRangeInfo,
  hasRangePattern,
  resolveOutputPath,
} from "./lib/url-utils";
import { DownloadListView } from "./views/download-list-view";

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
  const [urlsInput, setUrlsInput] = useState("");

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
        const { filename, outputPath } = await resolveOutputPath(url, outputDirectory, preferences.overwriteExisting);
        items.push({ id, url, filename, outputPath });
      }

      return items;
    },
    [preferences.overwriteExisting],
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

  // Pre-fill the URLs textarea from the clipboard when opened directly.
  useEffect(() => {
    if (launchContext?.urls) return;
    let cancelled = false;
    (async () => {
      const text = (await Clipboard.readText())?.trim();
      if (!cancelled && text && extractUrlStringsFromText(text).length > 0) {
        setUrlsInput(text);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [launchContext]);

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

  const handleImportBrowserTabs = useCallback(async () => {
    try {
      const tabs = await BrowserExtension.getTabs();
      const urls = tabs.map((t) => t.url).filter((u): u is string => typeof u === "string" && u.length > 0);
      if (urls.length === 0) {
        await showToast({ style: Toast.Style.Failure, title: "No Browser Tabs", message: "No open tabs found." });
        return;
      }
      const existing = urlsInput.trim();
      setUrlsInput(existing ? `${existing}\n${urls.join("\n")}` : urls.join("\n"));
      await showToast({
        style: Toast.Style.Success,
        title: "Imported Browser Tabs",
        message: `Added ${urls.length} ${urls.length === 1 ? "URL" : "URLs"}`,
      });
    } catch (error) {
      logWarn("Browser tab import failed", { error: error instanceof Error ? error.message : String(error) });
      await showToast({
        style: Toast.Style.Failure,
        title: "Browser Extension Unavailable",
        message: "Install the Raycast browser extension to use this feature.",
      });
    }
  }, [urlsInput]);

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

  // Live range preview: if the current input contains a range pattern and nothing else complicated,
  // show the user what URLs will be generated so they can sanity-check before submitting.
  const rangePreview = useMemo(() => {
    const trimmed = urlsInput.trim();
    if (!trimmed || !hasRangePattern(trimmed) || trimmed.includes("\n")) return null;
    const info = getRangeInfo(trimmed);
    if (!info) return null;
    const padHint = info.padding > 0 ? ` (${info.padding}-digit padding)` : "";
    const expanded = expandAllRangeUrls([trimmed], 500);
    const preview = expanded.length <= 7 ? expanded : [...expanded.slice(0, 5), "…", ...expanded.slice(-2)];
    return { count: info.count, padHint, preview };
  }, [urlsInput]);

  if (isDownloading) {
    return <DownloadListView items={downloadItems} batchHandle={batchHandle} onRetry={handleRetry} />;
  }

  return (
    <Form
      navigationTitle="Batch Download"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Download All" icon={Icon.Download} onSubmit={handleSubmit} />
          <Action
            title="Import URLs from Browser Tabs"
            icon={Icon.Globe}
            shortcut={{ modifiers: ["cmd", "shift"], key: "b" }}
            onAction={handleImportBrowserTabs}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="urls"
        title="URLs"
        placeholder="Enter URLs, one per line, or paste text containing URLs..."
        info="Supports plain URLs, markdown links, and range patterns like file[001-025].zip"
        value={urlsInput}
        onChange={setUrlsInput}
      />
      <Form.FilePicker
        id="outputDirectory"
        title="Output Directory"
        allowMultipleSelection={false}
        canChooseDirectories={true}
        canChooseFiles={false}
        defaultValue={[preferences.outputDirectory]}
      />
      {rangePreview && (
        <Form.Description
          title="Range Preview"
          text={`${rangePreview.count} URLs will be generated${rangePreview.padHint}:\n\n${rangePreview.preview.join("\n")}`}
        />
      )}
    </Form>
  );
}
