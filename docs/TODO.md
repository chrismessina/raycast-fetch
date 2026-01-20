# Fetch Extension – Implementation TODO

Phased implementation plan for the Raycast Fetch extension. Each phase builds on the previous and results in a working, testable state.

---

## Phase 1: Foundation & Single Download ✅

**Goal:** Working single-URL download command with HUD feedback.

### 1.1 Project Setup

- [x] Install `@chrismessina/raycast-logger` dependency
- [x] Add extension preferences to `package.json`:
  - `outputDirectory` (directory picker, default `~/Downloads`)
  - `followRedirects` (checkbox, default true)
  - `defaultTimeout` (textfield, default 300)
  - `overwriteExisting` (checkbox, default false)
  - `enableDebugLogging` (checkbox, default false)

### 1.2 Core Utilities

- [x] Create `src/lib/logger.ts`
  - Wrap `@chrismessina/raycast-logger`
  - `LogLevel` enum and `LogContext` interface
  - `logDebug()`, `logInfo()`, `logWarn()`, `logError()` functions
  - `logDownloadStart()`, `logDownloadProgress()`, `logDownloadComplete()`, `logDownloadError()` helpers
  - Respect `enableDebugLogging` preference
- [x] Create `src/lib/preferences.ts`
  - `getPreferences()` function with typed return
  - Log preference access and validation
- [x] Create `src/lib/url-utils.ts`
  - `isValidUrl(url: string): boolean`
  - `extractFilename(url: string): string`
  - `sanitizeFilename(name: string): string`
  - `generateUniqueFilename(dir: string, name: string): string`
  - Log validation failures and filename conflicts

### 1.3 Downloader Core

- [x] Create `src/lib/downloader.ts`
  - `DownloadOptions`, `DownloadProgress`, and `DownloadResult` interfaces
  - `DownloadHandle` interface with pause/resume/cancel methods
  - `downloadFile(options, onProgress?)` using curl spawn
  - Handle redirects via `-L` flag
  - Parse progress from curl stderr (percent, bytes, speed)
  - Calculate ETA from speed and remaining bytes
  - Return structured result with duration and total bytes
  - Log download start/completion/failure, curl commands, progress milestones (25%, 50%, 75%)

### 1.4 Progress Utilities

- [x] Create `src/lib/progress.ts`
  - `showDownloadProgress(title, progress)` – throttled HUD updates with speed
  - `showDownloadComplete(filename, path)` – success HUD with actions
  - `showDownloadError(filename, error)` – error HUD
  - `formatBytes(bytes)` – human-readable file sizes (KB, MB, GB)
  - `formatSpeed(bytesPerSec)` – human-readable speed (KB/s, MB/s)
  - `formatEta(seconds)` – human-readable time remaining
  - Log HUD state transitions and completion/error events

### 1.5 Download Command

- [x] Implement `src/download.ts`
  - Read URL from argument or clipboard
  - Validate URL
  - Resolve output path (preference dir + extracted filename)
  - Execute download with progress HUD
  - Show completion/error HUD

### 1.6 Testing & Polish

- [ ] Manual test: download from direct URL
- [ ] Manual test: download with redirect
- [ ] Manual test: clipboard fallback
- [ ] Manual test: file exists handling

---

## Phase 2: Batch Downloads ✅

**Goal:** Download multiple URLs with list view progress.

### 2.1 Package Updates

- [x] Add `download-batch` command to `package.json` (mode: view)
- [x] Add `maxParallelDownloads` preference (default 3)

### 2.2 Batch Downloader

- [x] Extend `src/lib/downloader.ts`
  - `BatchProgressCallback` type with per-item progress
  - `downloadBatch(items, onProgress)` with concurrency control
  - Track per-item progress, speed, and ETA
  - Track overall progress across all items
  - Support cancel per item (pause/resume deferred to Phase 7)

### 2.3 Batch Command

- [x] Create `src/download-batch.tsx`
  - Form view: textarea for URLs (one per line)
  - Parse and validate URLs on submit
  - List view showing download items with:
    - Status icon (⏳/⬇️/⏸️/✅/❌)
    - Progress percentage or bytes ("2.3 MB / 5.1 MB")
    - Download speed ("1.2 MB/s") while active
    - ETA while downloading
  - Actions: Cancel, Retry failed, Open file, Reveal in Finder (Pause/Resume deferred to Phase 7)

### 2.4 Testing

- [ ] Manual test: batch of 5 URLs
- [ ] Manual test: mixed success/failure batch
- [ ] Manual test: retry failed downloads

---

## Phase 3: URL Extraction ✅

**Goal:** Smart URL extraction integrated into batch download command.

### 3.1 URL Extraction Utility

- [x] Add to `src/lib/url-utils.ts`
  - `extractUrlsFromText(text: string): ExtractedUrl[]` - with source tracking
  - `extractUrlStringsFromText(text: string): string[]` - simple string extraction
  - Markdown link syntax `[text](url)` detection
  - Plain URL detection in mixed text
  - Regex-based extraction with deduplication

### 3.2 Batch Download Integration

- [x] Update `src/download-batch.tsx`
  - Use `extractUrlStringsFromText()` for smart input parsing
  - Handle mixed input (plain URLs, markdown links, arbitrary text)
  - Updated form placeholder and info text

### 3.3 Code Organization

- [x] Extract `DownloadListView` to `src/views/download-list-view.tsx`
- [x] Create `src/actions/download-item-actions.tsx` for centralized actions

### 3.4 Testing

- [ ] Manual test: paste markdown with links
- [ ] Manual test: paste plain text with URLs
- [ ] Manual test: mixed input (URLs + markdown + text)

---

## Phase 4: Sequential Downloads

**Goal:** Download numbered sequences from URL patterns.

### 4.1 Package Updates

- [ ] Add `download-sequential` command to `package.json` (mode: view)

### 4.2 Sequential Utilities

- [ ] Add to `src/lib/url-utils.ts`
  - `parseSequentialPattern(pattern: string)` – extract placeholder info
  - `generateSequentialUrls(pattern, start, end)` – generate URL list

### 4.3 Sequential Command

- [ ] Create `src/download-sequential.tsx`
  - Form view:
    - Pattern URL with `{n}` placeholder
    - Start number
    - End number
    - Preview of generated URLs
  - Validation: ensure pattern contains placeholder
  - Submit → batch download flow

### 4.4 Testing

- [ ] Manual test: `image_{n}.jpg` pattern 1-10
- [ ] Manual test: zero-padded `img_{n:3}.png` pattern
- [ ] Manual test: large sequence (50+ files)

---

## Phase 5: Advanced Features

**Goal:** Custom headers, alternative backends, polish.

### 5.1 Custom Headers Support

- [ ] Add `headers` field to download commands (optional)
- [ ] Update `downloadFile()` to pass headers to curl via `-H`
- [ ] Add header input to batch/extract forms (advanced section)

### 5.2 Error Handling Improvements

- [ ] Detect curl not found → show installation guidance
- [ ] Improve timeout handling with user feedback
- [ ] Add retry with exponential backoff option

### 5.3 Windows Compatibility

- [ ] Detect platform and adjust curl path
- [ ] Handle Windows path separators
- [ ] Test on Raycast for Windows (if available)

### 5.4 Documentation

- [ ] Update README.md with feature overview
- [ ] Add usage examples
- [ ] Document preferences
- [ ] Add screenshots

---

## Phase 6: Download History & Persistence ✅

**Goal:** Persistent download history with full lifecycle management.

### 6.1 History Module

- [x] Create `src/lib/history.ts`
  - `DownloadHistoryItem` interface with status, bytes, timestamps
  - `getDownloadHistory()` – load all entries from LocalStorage
  - `addToHistory()` – create new entry
  - `addBatchToHistory()` – add multiple entries at once
  - `removeFromHistory()` – delete single entry
  - `clearHistory()` – delete all entries
  - Max 100 items with automatic pruning

### 6.2 History Command

- [x] Add `download-history` command to `package.json` (mode: view)
- [x] Create `src/download-history.tsx`
  - List view sorted by most recent
  - Per-item display: filename, URL, status icon, size, relative timestamp
  - Actions:
    - Completed: Open, Reveal in Finder, Copy URL, Copy Path, Remove
    - Failed: Copy URL, Remove
  - Clear All History action
  - Keyboard shortcuts: ⌘⏎ (reveal), ⌘C (copy URL), ⌘⇧C (copy path)

### 6.3 History Integration

- [x] Update `download-batch.tsx` to record history entries
- [ ] Update `download.ts` to record history entries
- [ ] Update `download-sequential.tsx` to record history entries (when implemented)

### 6.4 Future Enhancements

- [ ] Add `enableHistory` preference (default: true)
- [ ] Add `historyMaxItems` preference (default: 100)
- [ ] Add re-download action for completed items
- [ ] Add retry action for failed items from history

### 6.5 Testing

- [ ] Manual test: history persists across extension reloads
- [ ] Manual test: remove single item from history
- [ ] Manual test: clear all history

---

## Phase 7: Pause/Resume Support

**Goal:** Reliable pause and resume for downloads.

### 7.1 Pause/Resume in Downloader

- [ ] Implement `DownloadHandle.pause()` – send SIGSTOP to curl process
- [ ] Implement `DownloadHandle.resume()` – send SIGCONT to curl process
- [ ] Implement `DownloadHandle.cancel()` – kill curl process
- [ ] Track paused state in handle
- [ ] Update history entry status on pause/resume/cancel

### 7.2 Resume Partial Downloads

- [ ] Add `resume` option to `DownloadOptions` (default: true)
- [ ] Use `curl -C -` to continue from existing partial file
- [ ] Detect server support for Range requests
- [ ] Fall back to restart if server doesn't support resume
- [ ] Add `autoResume` preference

### 7.3 Testing

- [ ] Manual test: pause active download
- [ ] Manual test: resume paused download
- [ ] Manual test: cancel download
- [ ] Manual test: resume partial file after extension restart

---

## Phase 8: Optional Enhancements

**Goal:** Nice-to-have features if time permits.

### 8.1 Alternative Download Backend

- [ ] Add preference for download backend (curl / aria2c)
- [ ] Implement aria2c adapter for parallel chunk downloads
- [ ] Auto-detect available backends

### 8.2 Clipboard Integration

- [ ] Auto-detect URL in clipboard on command open
- [ ] "Download from Clipboard" quick action

### 8.3 Chunked/Parallel Downloads

- [ ] Implement multi-connection downloads for large files
- [ ] Split file into chunks and download in parallel
- [ ] Merge chunks on completion
- [ ] Requires aria2c or custom implementation

### 8.4 Cloud Storage URL Handling

- [ ] Google Drive: Convert share URLs to direct download URLs (`/uc?export=download&id=FILE_ID`)
- [ ] Dropbox: Convert share URLs to direct download (`?dl=1` parameter)
- [ ] OneDrive: Handle share links and convert to direct download
- [ ] iCloud: Handle public share links
- [ ] Box: Handle shared link format
- [ ] Detect cloud storage URLs and apply appropriate transformations

---

## Implementation Order Summary

| Phase | Deliverable                    | Estimated Effort |
| ----- | ------------------------------ | ---------------- |
| 1     | Single download with HUD       | Core foundation  |
| 2     | Batch downloads with list view | Medium           |
| 3     | URL extraction from text       | Small            |
| 4     | Sequential/pattern downloads   | Small            |
| 5     | Headers, errors, Windows       | Medium           |
| 6     | Download history & persistence | Medium           |
| 7     | Pause/resume support           | Medium           |
| 8     | aria2c, chunked, polish        | Optional         |

---

## Current Status

**Phase:** Phase 3 & 6 complete
**Next Step:** Phase 4 – Sequential downloads, or Phase 5 – Advanced features
