# Fetch Changelog

## [Initial Version] - {PR_MERGE_DATE}

- **Download** — download a single file from a URL argument or the clipboard, with progress in the HUD. Filenames resolve from `Content-Disposition` when the server sends it, and gain the correct extension from the content type when the URL doesn't have one.
- **Download Batch** — download many files at once with a live progress list showing per-file status and percentage. Accepts one URL per line, URLs embedded in prose, and markdown links, removing duplicates. Import every open browser tab with ⌘⇧B. Cancel a single download or the whole batch, and retry any that failed.
- **Download History** — the last 100 downloads with open, reveal, copy URL, copy path, and re-download actions. Failed entries keep their error message. Delete entries individually, by age, or all at once.
- **Range patterns** — a curl-style `file[001-025].zip` expands into one download per number, with zero-padding inferred from the start value and descending ranges supported. Capped at 500 URLs, with a live preview before submitting.
- **Preferences** — output directory, redirect following, timeout, overwrite behavior, parallel download limit, and debug logging.
