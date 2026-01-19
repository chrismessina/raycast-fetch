# Fetch Extension – Technical Specification

## Overview

A Raycast extension providing multiple download commands for fetching files from URLs. Supports single downloads, batch operations, URL extraction from text, and sequential masked downloads with progress feedback.

---

## Commands

| Command               | Mode    | Description                                                       |
| --------------------- | ------- | ----------------------------------------------------------------- |
| `download`            | no-view | Download a single file from URL (clipboard or argument)           |
| `download-batch`      | view    | Download multiple URLs from a list input                          |
| `download-extract`    | view    | Extract URLs from pasted text and download selected               |
| `download-sequential` | view    | Download numbered sequences (e.g., `img_001.jpg` → `img_100.jpg`) |
| `download-history`    | view    | View and manage download history with retry/resume actions        |

---

## Architecture

### File Structure

```text
src/
├── download.ts              # Single URL download command
├── download-batch.tsx       # Batch download command
├── download-extract.tsx     # Extract URLs from text command
├── download-sequential.tsx  # Sequential/masked download command
├── download-history.tsx     # Download history command
└── lib/
    ├── downloader.ts        # Core download execution (curl wrapper)
    ├── url-utils.ts         # URL parsing, filename extraction, validation
    ├── progress.ts          # Progress tracking and HUD updates
    ├── preferences.ts       # Preference access helpers
    ├── history.ts           # Download history persistence (LocalStorage)
    └── logger.ts            # Logging utility wrapper
```

### Core Module: `lib/downloader.ts`

**Responsibilities:**

- Execute downloads via `curl` CLI
- Handle redirects (follow by default, `-L` flag)
- Support custom headers
- Report progress via callback
- Return download result (success/failure, path, error)

**Interface:**

```typescript
interface DownloadOptions {
  url: string;
  outputPath: string;
  headers?: Record<string, string>;
  followRedirects?: boolean; // default: true
  timeout?: number; // seconds, default: 300
  overwrite?: boolean; // default: false
  resume?: boolean; // default: true, attempt resume if partial file exists
}

interface DownloadProgress {
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
}

interface DownloadResult {
  success: boolean;
  url: string;
  outputPath?: string;
  error?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  duration?: number; // milliseconds
}

type ProgressCallback = (progress: DownloadProgress) => void;

interface DownloadHandle {
  promise: Promise<DownloadResult>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  isPaused: () => boolean;
}

function downloadFile(options: DownloadOptions, onProgress?: ProgressCallback): DownloadHandle;
function downloadBatch(items: DownloadOptions[], onProgress?: BatchProgressCallback): Promise<DownloadResult[]>;
```

**Implementation Notes:**

- Use `curl` as primary backend (pre-installed on macOS, available on Windows via WSL/Git Bash)
- Progress parsing: `curl --progress-bar` or `--write-out` for structured output
- Spawn via Node.js `child_process.spawn` for streaming output
- Resume support: `curl -C -` to continue partial downloads (requires server support for Range requests)
- Pause: send SIGSTOP to curl process; Resume: send SIGCONT
- Speed calculation: track bytes over sliding 1-second window
- Consider `aria2c` as optional alternative for parallel/chunked downloads (user preference)
- **Logging:** Log download start/completion/failure, curl command, progress milestones (25%, 50%, 75%), errors with stack traces

### Core Module: `lib/url-utils.ts`

**Responsibilities:**

- Validate URL format
- Extract filename from URL path or Content-Disposition header
- Generate unique filenames to avoid overwrites
- Parse URL patterns for sequential downloads

**Interface:**

```typescript
function isValidUrl(url: string): boolean;
function extractFilename(url: string, contentDisposition?: string): string;
function generateUniqueFilename(basePath: string, filename: string): string;
function parseSequentialPattern(
  pattern: string,
): { prefix: string; start: number; end: number; suffix: string; padding: number } | null;
function generateSequentialUrls(pattern: string, start: number, end: number): string[];
function extractUrlsFromText(text: string): string[];
```

**Logging:**

- Log URL validation failures with invalid URL
- Log filename extraction and sanitization
- Log unique filename generation when conflicts occur
- Log sequential pattern parsing results

### Core Module: `lib/progress.ts`

**Responsibilities:**

- Manage HUD toast updates for single downloads
- Manage list view state for batch downloads
- Throttle UI updates to avoid flickering

**Interface:**

```typescript
function showDownloadProgress(title: string, percent: number): Promise<void>;
function showDownloadComplete(filename: string, path: string): Promise<void>;
function showDownloadError(filename: string, error: string): Promise<void>;
```

**Logging:**

- Log HUD state transitions
- Log throttled progress updates (avoid spam)
- Log completion/error events with context

### Core Module: `lib/preferences.ts`

**Responsibilities:**

- Type-safe access to extension preferences
- Default value handling

**Interface:**

```typescript
interface Preferences {
  outputDirectory: string; // default: ~/Downloads
  followRedirects: boolean; // default: true
  defaultTimeout: number; // default: 300
  overwriteExisting: boolean; // default: false
  maxParallelDownloads: number; // default: 3
}

function getPreferences(): Preferences;
```

**Logging:**

- Log preference access on first load
- Log preference validation errors
- Log default value fallbacks

### Core Module: `lib/logger.ts`

**Responsibilities:**

- Wrap `@chrismessina/raycast-logger` for consistent logging
- Provide typed log methods for different severity levels
- Include context (command, URL, filename) in log entries
- Support structured logging for debugging

**Interface:**

```typescript
import { Logger } from "@chrismessina/raycast-logger";

enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

interface LogContext {
  command?: string;
  url?: string;
  filename?: string;
  [key: string]: any;
}

function getLogger(context?: LogContext): Logger;
function logDebug(message: string, context?: LogContext): void;
function logInfo(message: string, context?: LogContext): void;
function logWarn(message: string, context?: LogContext): void;
function logError(message: string, error?: Error, context?: LogContext): void;
function logDownloadStart(url: string, outputPath: string): void;
function logDownloadProgress(url: string, progress: DownloadProgress): void;
function logDownloadComplete(url: string, result: DownloadResult): void;
function logDownloadError(url: string, error: string | Error): void;
```

**Usage Pattern:**

```typescript
import { logDownloadStart, logDownloadComplete, logError } from "./lib/logger";

// In downloader.ts
logDownloadStart(options.url, options.outputPath);
try {
  const result = await executeCurl(options);
  logDownloadComplete(options.url, result);
} catch (error) {
  logError("Download failed", error, { url: options.url });
}
```

### Core Module: `lib/history.ts`

**Responsibilities:**

- Persist download history to Raycast LocalStorage
- CRUD operations on history entries
- Enforce retention limits (max items, age)
- Provide filtered/sorted queries

**Interface:**

```typescript
type DownloadStatus = "pending" | "downloading" | "paused" | "completed" | "failed";

interface HistoryEntry {
  id: string; // UUID
  url: string;
  filename: string;
  outputPath: string;
  status: DownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number; // last known speed
  error?: string;
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  completedAt?: number; // timestamp
}

interface HistoryOptions {
  maxItems?: number; // default: 100
  maxAgeDays?: number; // default: 30
}

function getHistory(): Promise<HistoryEntry[]>;
function getHistoryEntry(id: string): Promise<HistoryEntry | null>;
function addHistoryEntry(entry: Omit<HistoryEntry, "id" | "createdAt" | "updatedAt">): Promise<HistoryEntry>;
function updateHistoryEntry(id: string, updates: Partial<HistoryEntry>): Promise<HistoryEntry>;
function removeHistoryEntry(id: string): Promise<void>;
function clearHistory(): Promise<void>;
function pruneHistory(options?: HistoryOptions): Promise<number>; // returns removed count
```

**Storage Key:** `fetch-download-history`

**Retention Policy:**

- Default max 100 entries
- Auto-prune entries older than 30 days on extension load
- User can clear all history via command action

**Logging:**

- Log history CRUD operations (add, update, remove)
- Log pruning operations with count removed
- Log LocalStorage read/write errors
- Log history size and oldest entry on load

---

## Command Specifications

### 1. `download` (Single URL)

**Mode:** `no-view`

**Flow:**

1. Check for URL argument, else read from clipboard
2. Validate URL
3. Resolve output filename (from URL or HEAD request for Content-Disposition)
4. Show HUD: "Downloading {filename}..."
5. Execute download with progress updates to HUD
6. On success: HUD "Downloaded {filename}" with "Open" and "Reveal in Finder" actions
7. On failure: HUD error message

**Arguments:**

- `url` (optional): URL to download; falls back to clipboard

### 2. `download-batch` (Batch List)

**Mode:** `view` (Form → List)

**Flow:**

1. Show form with textarea for URLs (one per line)
2. Parse and validate URLs
3. Show list view with download items (pending/downloading/complete/failed)
4. Start downloads (respecting `maxParallelDownloads`)
5. Update list item status and progress in real-time
6. Provide actions: Retry failed, Open file, Reveal in Finder, Copy path

**Form Fields:**

- `urls`: Textarea for URL list
- `outputDirectory`: Directory picker (optional, uses preference default)

### 3. `download-extract` (Extract from Text)

**Mode:** `view` (Form → List)

**Flow:**

1. Show form with textarea for arbitrary text
2. Extract all URLs using regex
3. Show list of found URLs with checkboxes for selection
4. User selects URLs to download
5. Proceed as batch download

**URL Extraction Regex:**

```regex
https?://[^\s<>"{}|\\^`\[\]]+
```

### 4. `download-sequential` (Masked/Sequential)

**Mode:** `view` (Form → List)

**Flow:**

1. Show form with:
   - Pattern URL (e.g., `https://example.com/img_{n}.jpg`)
   - Start number
   - End number
   - Padding (auto-detect or manual)
2. Generate URL list from pattern
3. Preview generated URLs
4. Confirm and proceed as batch download

**Pattern Syntax:**

- `{n}` or `{N}` – replaced with sequence number
- `{n:3}` – zero-padded to 3 digits
- Auto-detect padding from start number (e.g., `001` → 3 digits)

### 5. `download-history` (History View)

**Mode:** `view` (List)

**Flow:**

1. Load history from LocalStorage
2. Display list sorted by most recent first
3. Show per-item: filename, status icon, progress %, speed (if active), file size
4. Provide actions based on status

**List Item Display:**

- **Title:** Filename
- **Subtitle:** URL (truncated)
- **Accessories:**
  - Status icon (⏳ pending, ⬇️ downloading, ⏸️ paused, ✅ completed, ❌ failed)
  - Progress: "45%" or "2.3 MB / 5.1 MB"
  - Speed: "1.2 MB/s" (only while downloading)
  - Time: relative timestamp ("2 min ago")

**Actions by Status:**

| Status      | Available Actions                                          |
| ----------- | ---------------------------------------------------------- |
| pending     | Start, Remove, Copy URL                                    |
| downloading | Pause, Cancel, Copy URL                                    |
| paused      | Resume, Cancel, Remove, Copy URL                           |
| completed   | Open File, Reveal in Finder, Re-download, Remove, Copy URL |
| failed      | Retry, Remove, Copy URL, Copy Error                        |

**Keyboard Shortcuts:**

- `Enter` – Primary action (Open for completed, Resume for paused, Retry for failed)
- `⌘⏎` – Reveal in Finder
- `⌘C` – Copy URL
- `⌘⌫` – Remove from history

---

## Preferences (Extension-Level)

Defined in `package.json` under `preferences`:

| Name                   | Type        | Default       | Description                        |
| ---------------------- | ----------- | ------------- | ---------------------------------- |
| `outputDirectory`      | `directory` | `~/Downloads` | Default save location              |
| `followRedirects`      | `checkbox`  | `true`        | Follow HTTP redirects              |
| `defaultTimeout`       | `textfield` | `300`         | Download timeout in seconds        |
| `overwriteExisting`    | `checkbox`  | `false`       | Overwrite existing files           |
| `maxParallelDownloads` | `textfield` | `3`           | Max concurrent downloads for batch |
| `enableHistory`        | `checkbox`  | `true`        | Track downloads in history         |
| `historyMaxItems`      | `textfield` | `100`         | Maximum history entries to keep    |
| `autoResume`           | `checkbox`  | `true`        | Auto-resume partial downloads      |
| `enableDebugLogging`   | `checkbox`  | `false`       | Enable verbose debug logging       |

---

## Error Handling

| Scenario          | Behavior                                           |
| ----------------- | -------------------------------------------------- |
| Invalid URL       | Show error HUD/toast, do not attempt download      |
| Network error     | Show error with retry option                       |
| File exists       | Skip (or overwrite per preference), show warning   |
| Timeout           | Show timeout error with retry option               |
| Permission denied | Show error, suggest checking directory permissions |
| curl not found    | Show error with installation instructions          |

---

## Platform Considerations

### macOS

- `curl` is pre-installed
- Use `~/Downloads` as default
- Native directory picker via Raycast API

### Windows (Raycast for Windows)

- `curl` available via Windows 10+ built-in, Git Bash, or WSL
- Detect available curl path
- Use `%USERPROFILE%\Downloads` as default
- Path handling: normalize to forward slashes for curl

---

## Security Considerations

- Sanitize filenames to prevent path traversal
- Validate URLs before execution
- Do not auto-execute downloaded files
- Respect system proxy settings (curl does this by default)

---

## Non-Goals

- **No auto-fetching page assets**: This extension downloads explicit URLs only, not embedded resources from HTML pages
- **No browser integration**: No intercepting browser downloads
- **No torrent/magnet support**: HTTP(S) URLs only

---

## Dependencies

**Runtime:**

- `@raycast/api` – Raycast extension API
- `@raycast/utils` – Utility hooks and helpers
- `@chrismessina/raycast-logger` – Logger utility
- System `curl` – Download execution

**Logging Strategy:**

- Use `@chrismessina/raycast-logger` for all logging
- Log levels: DEBUG (verbose), INFO (key events), WARN (recoverable issues), ERROR (failures)
- Include context in all logs (command, URL, filename)
- Log download lifecycle: start, progress milestones, completion/failure
- Log curl commands and exit codes for debugging
- Log LocalStorage operations and errors
- Respect `enableDebugLogging` preference for verbose output

**Log Examples:**

```typescript
// INFO: Download started
logInfo("Download started", { url: "https://example.com/file.zip", outputPath: "/Users/user/Downloads/file.zip" });

// DEBUG: Progress milestone
logDebug("Download progress: 50%", {
  url: "https://example.com/file.zip",
  bytesDownloaded: 5242880,
  totalBytes: 10485760,
});

// INFO: Download completed
logInfo("Download completed", { url: "https://example.com/file.zip", duration: 5432, bytesDownloaded: 10485760 });

// ERROR: Download failed
logError("Download failed: Network timeout", error, { url: "https://example.com/file.zip", curlExitCode: 28 });

// WARN: Resume not supported
logWarn("Server does not support resume, restarting download", { url: "https://example.com/file.zip" });
```
