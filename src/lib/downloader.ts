import { spawn, ChildProcess } from "child_process";
import { logDebug, logDownloadStart, logDownloadComplete, logDownloadError, logDownloadProgress } from "./logger";

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

  // Look for percentage in the data
  const percentMatch = data.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!percentMatch) {
    return null;
  }

  const percent = parseFloat(percentMatch[1]);

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
