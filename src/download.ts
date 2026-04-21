import { LaunchProps, Clipboard, launchCommand, LaunchType } from "@raycast/api";
import { randomUUID } from "crypto";
import { getPreferences } from "./lib/preferences";
import {
  isValidUrl,
  cleanUrl,
  resolveOutputPath,
  hasRangePattern,
  expandRangeUrl,
  getRangeInfo,
} from "./lib/url-utils";
import { downloadFile } from "./lib/downloader";
import {
  showDownloadStarted,
  showDownloadProgress,
  showDownloadComplete,
  showDownloadError,
  showValidationError,
} from "./lib/progress";
import { addToHistory } from "./lib/history";
import { logInfo, logDebug } from "./lib/logger";

interface Arguments {
  url?: string;
}

export default async function Command(props: LaunchProps<{ arguments: Arguments }>) {
  const preferences = getPreferences();

  // Get URL from argument or clipboard
  let url = props.arguments.url?.trim();
  let source: "argument" | "clipboard" = "argument";

  if (!url) {
    logDebug("No URL argument, checking clipboard");
    const clipboardText = await Clipboard.readText();
    url = clipboardText?.trim();
    source = "clipboard";
  }

  if (!url) {
    await showValidationError("No URL provided. Pass a URL or copy one to clipboard.");
    return;
  }

  // Strip trailing prose punctuation that often comes along from copy-paste.
  url = cleanUrl(url);

  logInfo("Download command invoked", { url, source });

  // Check for range pattern (e.g., https://example.com/file[001-025].zip)
  if (hasRangePattern(url)) {
    const rangeInfo = getRangeInfo(url);
    logInfo("Range pattern detected, launching batch download", {
      url,
      count: rangeInfo?.count,
      start: rangeInfo?.start,
      end: rangeInfo?.end,
    });

    // Expand the range and pass to batch download
    const expandedUrls = expandRangeUrl(url);

    await launchCommand({
      name: "download-batch",
      type: LaunchType.UserInitiated,
      context: { urls: expandedUrls },
    });
    return;
  }

  // Validate URL (single URL, no range pattern)
  if (!isValidUrl(url)) {
    await showValidationError(`Invalid URL: ${url}`);
    return;
  }

  const { filename, outputPath } = await resolveOutputPath(
    url,
    preferences.outputDirectory,
    preferences.overwriteExisting,
  );

  logDebug("Output path resolved", { filename, outputPath });

  // Show initial HUD
  await showDownloadStarted(filename);

  // Start download
  const handle = downloadFile(
    {
      url,
      outputPath,
      followRedirects: preferences.followRedirects,
      timeout: preferences.defaultTimeout,
    },
    async (progress) => {
      await showDownloadProgress(filename, progress);
    },
  );

  // Wait for completion
  const result = await handle.promise;

  if (result.success) {
    await showDownloadComplete(filename, result.outputPath!);
    await addToHistory({
      id: randomUUID(),
      url,
      filename,
      outputPath,
      status: "completed",
      bytesDownloaded: result.bytesDownloaded,
    });
  } else {
    await showDownloadError(filename, result.error || "Unknown error");
    await addToHistory({
      id: randomUUID(),
      url,
      filename,
      outputPath,
      status: "failed",
      error: result.error,
    });
  }
}
