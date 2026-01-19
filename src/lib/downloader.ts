import { spawn, ChildProcess } from "child_process";
import {
  logDebug,
  logInfo,
  logDownloadStart,
  logDownloadComplete,
  logDownloadError,
  logDownloadProgress,
} from "./logger";

export interface DownloadOptions {
  url: string;
  outputPath: string;
  headers?: Record<string, string>;
  followRedirects?: boolean;
  timeout?: number;
  overwrite?: boolean;
}

export interface DownloadProgress {
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number;
  eta: number;
}

export interface DownloadResult {
  success: boolean;
  url: string;
  outputPath?: string;
  error?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  duration?: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export interface DownloadHandle {
  promise: Promise<DownloadResult>;
  cancel: () => void;
}

export function downloadFile(options: DownloadOptions, onProgress?: ProgressCallback): DownloadHandle {
  const startTime = Date.now();
  let curlProcess: ChildProcess | null = null;
  let cancelled = false;

  const promise = new Promise<DownloadResult>((resolve) => {
    const { url, outputPath, headers = {}, followRedirects = true, timeout = 300 } = options;

    logDownloadStart(url, outputPath);

    // Build curl arguments
    const args: string[] = [
      "-L", // Follow redirects (we'll control this separately if needed)
      "-o",
      outputPath,
      "--progress-bar", // Show progress
      "--max-time",
      timeout.toString(),
      "-w",
      "\\n%{size_download}\\n%{speed_download}\\n%{http_code}\\n", // Write out stats at end
    ];

    // Conditionally add redirect following
    if (!followRedirects) {
      // Remove -L and add max-redirs 0
      const idx = args.indexOf("-L");
      if (idx > -1) args.splice(idx, 1);
      args.push("--max-redirs", "0");
    }

    // Add custom headers
    for (const [key, value] of Object.entries(headers)) {
      args.push("-H", `${key}: ${value}`);
    }

    // Add URL last
    args.push(url);

    logDebug("Executing curl", { command: "curl", args: args.join(" ") });

    curlProcess = spawn("curl", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrBuffer = "";
    let lastProgress: DownloadProgress = {
      percent: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      speed: 0,
      eta: 0,
    };
    let lastMilestone = 0;

    // Parse curl progress from stderr
    curlProcess.stderr?.on("data", (data: Buffer) => {
      stderrBuffer += data.toString();
      const progress = parseCurlProgress(stderrBuffer);
      if (progress && progress.percent !== lastProgress.percent) {
        lastProgress = progress;

        // Log at milestones
        const currentMilestone = Math.floor(progress.percent / 25) * 25;
        if (currentMilestone > lastMilestone && currentMilestone > 0) {
          lastMilestone = currentMilestone;
          logDownloadProgress(url, progress);
        }

        if (onProgress) {
          onProgress(progress);
        }
      }
    });

    let stdoutData = "";
    curlProcess.stdout?.on("data", (data: Buffer) => {
      stdoutData += data.toString();
    });

    curlProcess.on("close", (code) => {
      const duration = Date.now() - startTime;

      if (cancelled) {
        resolve({
          success: false,
          url,
          error: "Download cancelled",
          duration,
        });
        return;
      }

      // Parse the write-out data from stdout
      const lines = stdoutData.trim().split("\n").filter(Boolean);
      const bytesDownloaded = lines.length > 0 ? parseInt(lines[lines.length - 3] || "0", 10) : 0;
      const httpCode = lines.length > 0 ? parseInt(lines[lines.length - 1] || "0", 10) : 0;

      if (code === 0 && httpCode >= 200 && httpCode < 400) {
        const result: DownloadResult = {
          success: true,
          url,
          outputPath,
          bytesDownloaded: isNaN(bytesDownloaded) ? lastProgress.bytesDownloaded : bytesDownloaded,
          totalBytes: lastProgress.totalBytes,
          duration,
        };
        logDownloadComplete(url, result);
        resolve(result);
      } else {
        const errorMessage = getErrorMessage(code, httpCode, stderrBuffer);
        logDownloadError(url, errorMessage);
        resolve({
          success: false,
          url,
          error: errorMessage,
          duration,
        });
      }
    });

    curlProcess.on("error", (error) => {
      const duration = Date.now() - startTime;
      logDownloadError(url, error);
      resolve({
        success: false,
        url,
        error: error.message,
        duration,
      });
    });
  });

  const cancel = () => {
    cancelled = true;
    if (curlProcess && !curlProcess.killed) {
      curlProcess.kill("SIGTERM");
    }
  };

  return { promise, cancel };
}

function parseCurlProgress(data: string): DownloadProgress | null {
  // curl progress bar format varies, but typically shows something like:
  // ###                                                                       4.2%
  // or with --progress-bar:
  // #####                                                                     7.8%

  // Look for percentage in the data - use matchAll to get ALL matches, then take the last one
  const percentMatches = Array.from(data.matchAll(/(\d+(?:\.\d+)?)\s*%/g));
  if (percentMatches.length === 0) {
    return null;
  }

  // Take the LAST match (most recent progress)
  const lastMatch = percentMatches[percentMatches.length - 1];
  const percent = parseFloat(lastMatch[1]);

  // Try to extract bytes and speed from curl output
  // Format can be like: "  % Total    % Received % Xferd  Average Speed   Time"
  // Or simpler progress bar output

  // For now, we'll estimate based on percent
  // In a more complete implementation, we'd parse the full curl progress output

  return {
    percent,
    bytesDownloaded: 0, // Will be filled from write-out
    totalBytes: 0,
    speed: 0,
    eta: 0,
  };
}

function getErrorMessage(exitCode: number | null, httpCode: number, stderr: string): string {
  // HTTP error codes
  if (httpCode >= 400) {
    switch (httpCode) {
      case 400:
        return "Bad request (400)";
      case 401:
        return "Unauthorized (401)";
      case 403:
        return "Forbidden (403)";
      case 404:
        return "File not found (404)";
      case 429:
        return "Too many requests (429)";
      case 500:
        return "Server error (500)";
      case 502:
        return "Bad gateway (502)";
      case 503:
        return "Service unavailable (503)";
      default:
        return `HTTP error ${httpCode}`;
    }
  }

  // curl exit codes
  switch (exitCode) {
    case 6:
      return "Could not resolve host";
    case 7:
      return "Failed to connect to server";
    case 22:
      return "HTTP error";
    case 23:
      return "Write error (disk full or permission denied)";
    case 26:
      return "Read error";
    case 28:
      return "Operation timed out";
    case 35:
      return "SSL connection error";
    case 47:
      return "Too many redirects";
    case 52:
      return "Server returned nothing";
    case 56:
      return "Network error during transfer";
    default:
      // Check stderr for more info
      if (stderr.includes("Could not resolve host")) {
        return "Could not resolve host";
      }
      if (stderr.includes("Connection refused")) {
        return "Connection refused";
      }
      if (stderr.includes("SSL")) {
        return "SSL/TLS error";
      }
      return exitCode ? `Download failed (exit code ${exitCode})` : "Download failed";
  }
}

// Batch download types and functions

export type DownloadStatus = "pending" | "downloading" | "completed" | "failed" | "cancelled";

export interface BatchDownloadItem {
  id: string;
  url: string;
  filename: string;
  outputPath: string;
  status: DownloadStatus;
  progress: DownloadProgress;
  error?: string;
  result?: DownloadResult;
}

export interface BatchProgress {
  items: BatchDownloadItem[];
  completed: number;
  failed: number;
  total: number;
}

export type BatchProgressCallback = (progress: BatchProgress) => void;

export interface BatchDownloadHandle {
  promise: Promise<DownloadResult[]>;
  cancel: () => void;
  cancelItem: (id: string) => void;
}

export function downloadBatch(
  items: Array<{ id: string; url: string; filename: string; outputPath: string; options?: Partial<DownloadOptions> }>,
  maxConcurrent: number,
  onProgress?: BatchProgressCallback,
): BatchDownloadHandle {
  const batchItems: BatchDownloadItem[] = items.map((item) => ({
    id: item.id,
    url: item.url,
    filename: item.filename,
    outputPath: item.outputPath,
    status: "pending" as DownloadStatus,
    progress: { percent: 0, bytesDownloaded: 0, totalBytes: 0, speed: 0, eta: 0 },
  }));

  const activeHandles = new Map<string, DownloadHandle>();
  let cancelled = false;

  logInfo("Batch download started", { totalItems: items.length, maxConcurrent });

  const emitProgress = () => {
    if (onProgress) {
      const completed = batchItems.filter((i) => i.status === "completed").length;
      const failed = batchItems.filter((i) => i.status === "failed" || i.status === "cancelled").length;
      onProgress({
        items: [...batchItems],
        completed,
        failed,
        total: batchItems.length,
      });
    }
  };

  const results: DownloadResult[] = [];
  let currentIndex = 0;

  const startNext = async (): Promise<void> => {
    if (cancelled || currentIndex >= batchItems.length) {
      return;
    }

    const itemIndex = currentIndex++;
    const item = batchItems[itemIndex];
    const originalItem = items[itemIndex];

    item.status = "downloading";
    emitProgress();

    const handle = downloadFile(
      {
        url: item.url,
        outputPath: item.outputPath,
        ...originalItem.options,
      },
      (progress) => {
        item.progress = progress;
        emitProgress();
      },
    );

    activeHandles.set(item.id, handle);

    try {
      const result = await handle.promise;
      item.result = result;

      if (result.success) {
        item.status = "completed";
      } else if (result.error === "Download cancelled") {
        item.status = "cancelled";
        item.error = result.error;
      } else {
        item.status = "failed";
        item.error = result.error;
      }

      results.push(result);
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : "Unknown error";
      results.push({
        success: false,
        url: item.url,
        error: item.error,
      });
    } finally {
      activeHandles.delete(item.id);
      emitProgress();

      // Start next download if available
      if (!cancelled && currentIndex < batchItems.length) {
        await startNext();
      }
    }
  };

  const runBatch = async (): Promise<DownloadResult[]> => {
    const activePromises: Promise<void>[] = [];

    // Start initial batch of concurrent downloads
    const initialBatch = Math.min(maxConcurrent, batchItems.length);
    for (let i = 0; i < initialBatch; i++) {
      activePromises.push(startNext());
    }

    // Wait for all downloads to complete
    await Promise.all(activePromises);

    // Wait for any remaining active downloads
    while (activeHandles.size > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    logInfo("Batch download completed", {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });

    return results;
  };

  const promise = runBatch();

  const cancel = () => {
    cancelled = true;
    for (const [, handle] of activeHandles) {
      handle.cancel();
    }
    // Mark pending items as cancelled
    for (const item of batchItems) {
      if (item.status === "pending") {
        item.status = "cancelled";
        item.error = "Download cancelled";
      }
    }
    emitProgress();
  };

  const cancelItem = (id: string) => {
    const handle = activeHandles.get(id);
    if (handle) {
      handle.cancel();
    }
    const item = batchItems.find((i) => i.id === id);
    if (item && item.status === "pending") {
      item.status = "cancelled";
      item.error = "Download cancelled";
      emitProgress();
    }
  };

  return { promise, cancel, cancelItem };
}
