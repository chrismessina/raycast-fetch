# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Raycast Fetch is a Raycast extension for downloading files from the web. It provides multiple download commands: single URL downloads, batch operations, URL extraction from text, and sequential/numbered downloads with progress feedback.

## Commands

```bash
npm run dev     # Start development mode (ray develop)
npm run build   # Build the extension (ray build)
npm run lint    # Run ESLint
npm run fix-lint # Run ESLint with auto-fix
npm run publish # Publish to Raycast Store
```

## Architecture

This extension uses curl as the download backend (pre-installed on macOS, available on Windows). Downloads are executed via Node.js `child_process.spawn` with progress parsing from curl output.

### Planned Structure (see docs/SPEC.md for full specification)

```text
src/
├── download.ts              # Single URL download (no-view mode)
├── download-batch.tsx       # Batch download with list view
├── download-extract.tsx     # Extract URLs from pasted text
├── download-sequential.tsx  # Sequential/numbered downloads
├── download-history.tsx     # View and manage download history
└── lib/
    ├── downloader.ts        # Core curl wrapper for download execution
    ├── url-utils.ts         # URL validation, filename extraction, patterns
    ├── progress.ts          # HUD toast and progress tracking
    ├── preferences.ts       # Type-safe preference access
    ├── history.ts           # LocalStorage-backed download history
    └── logger.ts            # @chrismessina/raycast-logger wrapper
```

### Key Dependencies

- `@raycast/api` and `@raycast/utils` - Raycast extension APIs
- `@chrismessina/raycast-logger` - Logging utility for debugging

## Implementation Notes

- The `download` command uses `no-view` mode with HUD feedback
- Batch commands use React views with list-based progress
- Progress is parsed from curl stderr output
- History persists to Raycast LocalStorage
- Pause/resume uses SIGSTOP/SIGCONT signals to curl process
- Resume partial downloads via `curl -C -` (requires server Range request support)

## Current Status

Implementation is in early stages. See `docs/TODO.md` for the phased implementation plan and `docs/SPEC.md` for complete technical specifications including interfaces, command flows, and preference definitions.
