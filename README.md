# Fetch

<div align="center">
  <a href="https://github.com/chrismessina">
    <img src="https://img.shields.io/github/followers/chrismessina?label=Follow%20chrismessina&style=social" alt="Follow @chrismessina">
  </a>
  <a href="https://github.com/chrismessina/raycast-fetch/stargazers">
    <img src="https://img.shields.io/github/stars/chrismessina/raycast-fetch?style=social" alt="Stars">
  </a>
  <a href="https://www.raycast.com/chrismessina/fetch">
    <img src="https://img.shields.io/badge/Raycast-Store-red.svg" alt="Fetch on Raycast store.">
  </a>
</div>

Download files from the web without leaving Raycast. Paste a URL, a wall of text full of URLs, or a numbered range pattern — Fetch works out the filenames and pulls everything down with `curl`.

## Commands

### Download

Downloads a single file. Pass a URL as an argument, or leave it empty and Fetch uses whatever URL is on your clipboard.

The filename comes from the server's `Content-Disposition` header when it sends one, and from the URL path otherwise. If the server reports a content type but the name has no extension, Fetch appends the right one — so `…/download?id=42` serving a PDF still lands as a `.pdf`.

If the URL contains a range pattern, this command hands off to **Download Batch** automatically.

### Download Batch

Downloads many files at once, with a live list showing per-file progress, speed, and status.

The URL field accepts more or less anything:

- One URL per line
- Prose with URLs embedded in it — Fetch extracts them
- Markdown links (`[label](https://…)`)
- Range patterns (see below)

Duplicates are removed automatically, including any introduced by expanding a range. **Import URLs from Browser Tabs** (⌘⇧B) pulls every open tab in as a starting list — this one needs the [Raycast Browser Extension](https://raycast.com/browser-extension) installed.

Downloads run concurrently, up to the **Max Parallel Downloads** preference. You can cancel a single file, cancel the whole batch, or retry any file that failed.

### Download History

The last 100 downloads, completed and failed. Open the file, reveal it in Finder, copy the URL or path, or re-run the download. Failed entries keep their error message so you can copy it into a bug report.

Entries can be deleted one at a time, in bulk by age (last 5 / 15 / 30 minutes), or all at once.

## Range patterns

A curl-style `[start-end]` range in a URL expands into one download per number:

```
https://example.com/photos/img[001-025].jpg
```

...becomes 25 downloads, `img001.jpg` through `img025.jpg`.

- **Zero-padding is inferred from the start number.** `[001-025]` produces `001`, `002`, …; `[1-25]` produces `1`, `2`, ….
- **Descending ranges work.** `[025-001]` counts down.
- **Ranges are capped at 500 URLs** so a typo can't queue thousands of requests.

The batch form shows a live preview of what a range will expand to before you submit it.

## Preferences

| Preference | Default | What it does |
| --- | --- | --- |
| Output Directory | `~/Downloads` | Where files are saved. The batch form can override this per-batch. |
| Follow Redirects | On | Follow HTTP redirects to the final destination. |
| Timeout | 300 | Seconds to wait before giving up on a download. |
| Overwrite Existing | Off | When off, a colliding filename gets a ` (1)` suffix instead of replacing the existing file. |
| Max Parallel Downloads | 3 | Concurrent downloads in a batch. Capped at 10. |
| Debug Logging | Off | Verbose logging for troubleshooting. |

## Requirements

Fetch shells out to `curl`, which ships with macOS — there is nothing to install. If `curl` is missing from your `PATH`, downloads fail with a message saying so.

## Notes

Failed downloads never leave a file behind. Without this, a 404 would write the server's error page to disk under the name you expected, and you wouldn't find out until you opened it.
