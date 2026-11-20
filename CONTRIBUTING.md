# Contributing to Fetch

Thanks for helping. This guide covers running Fetch locally and sending a change.

## Where changes go

Fetch is published in the [Raycast Store](https://www.raycast.com/chrismessina/fetch).
Open pull requests against [`raycast/extensions`](https://github.com/raycast/extensions/tree/main/extensions/fetch),
not this repository: Raycast reviews every change there, and merged changes sync back here
automatically. Open [issues](https://github.com/chrismessina/raycast-fetch/issues) here or in
`raycast/extensions`, whichever you prefer.

## Run it locally

You need [Raycast](https://www.raycast.com/) and Node.js 22 or later.

1. In Raycast, find Fetch in the Store and choose **Fork Extension** from the action panel.
   Raycast checks out only this extension's folder from `raycast/extensions`.
2. In that folder, run `npm ci`, then `npm run dev`. Raycast opens the development version, and
   saving a file reloads it.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Copy the download runner, then run the extension in Raycast and reload on save |
| `npm run build` | Copy the download runner, then build the distribution bundle |
| `npm run lint` | Run Raycast's ESLint and Prettier checks |
| `npm run fix-lint` | Fix what the linter can fix |
| `npm run sync-runner` | Copy the runner from `@chrismessina/raycast-downloader` into `assets/raycast-downloader-runner.js` |

`ray build` bundles with esbuild and does **not** typecheck — run `npx tsc --noEmit` separately.

## How it works

```
raycast-fetch/
├── src/
│   ├── download.ts              # Single download (no-view)
│   ├── download-batch.tsx       # Batch form + progress list
│   ├── download-history.tsx     # History list
│   ├── lib/                     # Downloader adapter, URLs, history, toasts, prefs
│   ├── views/                   # List views
│   └── actions/                 # Action panels
├── scripts/sync-runner.mjs      # Copies the downloader runner into assets/
├── assets/                      # Extension icon + runner bundle (runtime)
├── media/                       # README images
└── package.json
```

The transfer itself is detached. `src/lib/downloader.ts` is an adapter over
`@chrismessina/raycast-downloader`: `startDownload` spawns a runner that outlives the command and
owns curl, resume by HTTP Range, stall detection and failure classification. A Store build ships no
`node_modules`, so the runner must be in `assets/`; the copy is committed, because the Store build
never runs `sync-runner`. Run `npm run sync-runner` and commit the result after updating the
package.

## Before you open a pull request

- `npm run build`, `npx tsc --noEmit` and `npm run lint` all pass.
- You tried the change in Raycast, including its error and empty states.
- `CHANGELOG.md` has a new entry at the top, dated `{PR_MERGE_DATE}`. Raycast fills in the date
  when the pull request merges.
- New or changed screenshots go in `metadata/`, taken with Raycast's Window Capture.
