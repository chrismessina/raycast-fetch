import { LaunchProps, Clipboard, launchCommand, LaunchType } from "@raycast/api";
import { getPreferences } from "./lib/preferences";
import {
  isValidUrl,
  extractFilename,
  generateUniqueFilename,
  fetchHeadInfo,
  ensureExtension,
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
import { logInfo, logDebug } from "./lib/logger";

interface Arguments {
  url?: string;
}

export default async function Command(props: LaunchProps<{ arguments: Arguments }>) {
  const preferences = getPreferences();

  // Get URL from argument or clipboard
  let url = props.arguments.url?.trim();

  if (!url) {
    logDebug("No URL argument, checking clipboard");
    const clipboardText = await Clipboard.readText();
    url = clipboardText?.trim();
  }

  if (!url) {
    await showValidationError("No URL provided. Pass a URL or copy one to clipboard.");
    return;
  }

  logInfo("Download command invoked", { url, source: props.arguments.url ? "argument" : "clipboard" });

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

  // Fetch HEAD info to get Content-Type and Content-Disposition
  const headInfo = await fetchHeadInfo(url);

  // Extract filename (prefer Content-Disposition, then URL)
  let filename = extractFilename(url, headInfo.contentDisposition);

  // Ensure filename has an extension based on Content-Type
  filename = ensureExtension(filename, headInfo.contentType);

  const outputPath = preferences.overwriteExisting
    ? `${preferences.outputDirectory}/${filename}`
    : generateUniqueFilename(preferences.outputDirectory, filename);

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
      overwrite: preferences.overwriteExisting,
    },
    async (progress) => {
      await showDownloadProgress(filename, progress);
    },
  );

  // Wait for completion
  const result = await handle.promise;

  if (result.success) {
    await showDownloadComplete(filename, result.outputPath!);
  } else {
    await showDownloadError(filename, result.error || "Unknown error");
  }
}
