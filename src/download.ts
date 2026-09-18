import { randomUUID } from "crypto";
import { releaseReservation } from "@chrismessina/raycast-downloader/paths";
import { Clipboard, launchCommand, LaunchProps, LaunchType } from "@raycast/api";
import { downloadFile } from "./lib/downloader";
import { addToHistory } from "./lib/history";
import { logDebug, logInfo } from "./lib/logger";
import { getPreferences } from "./lib/preferences";
import {
  showDownloadComplete,
  showDownloadError,
  showDownloadProgress,
  showDownloadStarted,
  showValidationError,
} from "./lib/progress";
import {
  cleanUrl,
  expandRangeUrl,
  getRangeInfo,
  hasRangePattern,
  isValidUrl,
  resolveOutputPath,
} from "./lib/url-utils";

export default async function Command(props: LaunchProps<{ arguments: Arguments.Download }>) {
  const preferences = getPreferences();

  // Get URL from argument or clipboard. The argument is declared optional in the
  // manifest, so it can be absent at runtime despite the generated type.
  let url: string | undefined = props.arguments.url?.trim();
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
      context: { urls: expandedUrls, outputDirectory: preferences.outputDirectory },
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

  // Show the progress toast before any work starts, so the command is never silent.
  const toast = await showDownloadStarted(filename);

  // Start download
  const handle = downloadFile(
    {
      url,
      outputPath,
      followRedirects: preferences.followRedirects,
      timeout: preferences.defaultTimeout,
    },
    async (progress) => {
      await showDownloadProgress(toast, filename, progress);
    },
  );

  // Wait for completion
  const result = await handle.promise;

  // Startup failed before the runner took ownership of the reserved `.part`
  // (missing runner, missing curl, bad path) — release it so the name stays free.
  if (!result.success && result.bytesDownloaded === undefined && !result.id) {
    releaseReservation(outputPath);
  }

  if (result.success) {
    await showDownloadComplete(toast, filename, result.outputPath ?? outputPath);
    await addToHistory({
      id: result.id ?? randomUUID(),
      url,
      filename,
      outputPath,
      status: "completed",
      bytesDownloaded: result.bytesDownloaded,
    });
  } else {
    await showDownloadError(toast, filename, result.error || "Unknown error", url);
    await addToHistory({
      id: result.id ?? randomUUID(),
      url,
      filename,
      outputPath,
      status: "failed",
      error: { code: result.errorCode ?? "unknown", message: result.error ?? "Unknown error" },
    });
  }
}
