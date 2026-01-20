import { existsSync } from "fs";
import { spawn } from "child_process";
import { basename, extname, join } from "path";
import { logDebug, logWarn, logInfo } from "./logger";

// URL extraction patterns
const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\(([^)]+)\)/g;
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

export interface ExtractedUrl {
  url: string;
  label?: string;
  source: "markdown" | "plain";
}

/**
 * Extract URLs from mixed text input.
 * Handles:
 * - Markdown link syntax [text](url)
 * - Plain URLs in text
 * - Deduplicates results
 */
export function extractUrlsFromText(text: string): ExtractedUrl[] {
  const results: ExtractedUrl[] = [];
  const seenUrls = new Set<string>();

  // First, extract markdown links and track their positions
  const markdownMatches: { start: number; end: number; url: string; label: string }[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  MARKDOWN_LINK_REGEX.lastIndex = 0;
  while ((match = MARKDOWN_LINK_REGEX.exec(text)) !== null) {
    const label = match[1];
    const url = match[2].trim();

    if (isValidUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ url, label: label || undefined, source: "markdown" });
      markdownMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        url,
        label,
      });
    }
  }

  // Extract plain URLs, excluding those already found in markdown links
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = match[0].trim();
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if this URL is inside a markdown link
    const isInsideMarkdown = markdownMatches.some((md) => matchStart >= md.start && matchEnd <= md.end);

    if (!isInsideMarkdown && isValidUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ url, source: "plain" });
    }
  }

  logDebug("Extracted URLs from text", {
    totalFound: results.length,
    markdownLinks: results.filter((r) => r.source === "markdown").length,
    plainUrls: results.filter((r) => r.source === "plain").length,
  });

  return results;
}

/**
 * Simple extraction that returns just the URL strings.
 */
export function extractUrlStringsFromText(text: string): string[] {
  return extractUrlsFromText(text).map((r) => r.url);
}

// Common MIME type to file extension mapping
const MIME_TO_EXTENSION: Record<string, string> = {
  // Text
  "text/html": ".html",
  "text/plain": ".txt",
  "text/css": ".css",
  "text/javascript": ".js",
  "text/csv": ".csv",
  "text/xml": ".xml",
  "text/markdown": ".md",

  // Application
  "application/json": ".json",
  "application/javascript": ".js",
  "application/xml": ".xml",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/gzip": ".gz",
  "application/x-tar": ".tar",
  "application/x-bzip2": ".bz2",
  "application/x-7z-compressed": ".7z",
  "application/x-rar-compressed": ".rar",
  "application/octet-stream": "", // Binary, no default extension
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",

  // Images
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/avif": ".avif",

  // Audio
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/aac": ".aac",
  "audio/webm": ".weba",

  // Video
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",

  // Fonts
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
};

export interface HeadResponse {
  contentType?: string;
  contentDisposition?: string;
  contentLength?: number;
}

export async function fetchHeadInfo(url: string, timeout = 10): Promise<HeadResponse> {
  return new Promise((resolve) => {
    const args = [
      "-s", // Silent
      "-I", // HEAD request
      "-L", // Follow redirects
      "--max-time",
      timeout.toString(),
      "-w",
      "\\n%{content_type}",
      url,
    ];

    logDebug("Fetching HEAD info", { url });

    const curl = spawn("curl", args);
    let output = "";

    curl.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    curl.on("close", (code: number) => {
      if (code !== 0) {
        logDebug("HEAD request failed, continuing without metadata", { url, code });
        resolve({});
        return;
      }

      const result: HeadResponse = {};

      // Parse Content-Disposition header
      const dispositionMatch = output.match(/content-disposition:\s*(.+)/i);
      if (dispositionMatch) {
        result.contentDisposition = dispositionMatch[1].trim();
      }

      // Parse Content-Length header
      const lengthMatch = output.match(/content-length:\s*(\d+)/i);
      if (lengthMatch) {
        result.contentLength = parseInt(lengthMatch[1], 10);
      }

      // Parse Content-Type from -w output (last line)
      const lines = output.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      if (lastLine && !lastLine.includes(":")) {
        // This is the content_type from -w output
        result.contentType = lastLine.split(";")[0].trim();
      } else {
        // Fallback to header parsing
        const typeMatch = output.match(/content-type:\s*([^;\r\n]+)/i);
        if (typeMatch) {
          result.contentType = typeMatch[1].trim();
        }
      }

      logDebug("HEAD response parsed", { url, ...result });
      resolve(result);
    });

    curl.on("error", () => {
      logDebug("HEAD request error, continuing without metadata", { url });
      resolve({});
    });
  });
}

export function getExtensionFromContentType(contentType: string): string {
  const mimeType = contentType.toLowerCase().split(";")[0].trim();
  return MIME_TO_EXTENSION[mimeType] || "";
}

export function ensureExtension(filename: string, contentType?: string): string {
  const currentExt = extname(filename);

  // If filename already has an extension, keep it
  if (currentExt && currentExt.length > 1) {
    return filename;
  }

  // Try to add extension from Content-Type
  if (contentType) {
    const ext = getExtensionFromContentType(contentType);
    if (ext) {
      logInfo("Appending extension from Content-Type", { filename, contentType, extension: ext });
      return filename + ext;
    }
  }

  return filename;
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      logWarn("Invalid URL protocol", { url, protocol: parsed.protocol });
      return false;
    }
    return true;
  } catch {
    logWarn("Invalid URL format", { url });
    return false;
  }
}

export function extractFilename(url: string, contentDisposition?: string): string {
  // Try Content-Disposition header first
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
    if (filenameMatch) {
      const filename = filenameMatch[1].replace(/['"]/g, "").trim();
      if (filename) {
        logDebug("Filename extracted from Content-Disposition", { filename });
        return sanitizeFilename(filename);
      }
    }
  }

  // Extract from URL path
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    let filename = basename(pathname);

    // Remove query string if it got included
    const queryIndex = filename.indexOf("?");
    if (queryIndex > -1) {
      filename = filename.substring(0, queryIndex);
    }

    // Decode URL-encoded characters
    filename = decodeURIComponent(filename);

    // If no filename or just a slash, generate a default
    if (!filename || filename === "/" || filename === "") {
      filename = generateDefaultFilename(url);
    }

    logDebug("Filename extracted from URL", { url, filename });
    return sanitizeFilename(filename);
  } catch {
    return sanitizeFilename(generateDefaultFilename(url));
  }
}

function generateDefaultFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/[^a-zA-Z0-9]/g, "_");
    const timestamp = Date.now();
    return `${hostname}_${timestamp}`;
  } catch {
    return `download_${Date.now()}`;
  }
}

export function sanitizeFilename(name: string): string {
  // Remove or replace characters that are problematic on most filesystems
  let sanitized = name
    // Replace path traversal attempts
    .replace(/\.\./g, "_")
    // Remove null bytes
    .replace(/\0/g, "")
    // Replace characters invalid on Windows/macOS
    .replace(/[<>:"/\\|?*]/g, "_")
    // Replace control characters (ASCII 0-31 and 128-159)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x80-\x9f]/g, "")
    // Trim whitespace and dots from ends
    .trim()
    .replace(/^\.+|\.+$/g, "");

  // Ensure filename isn't empty after sanitization
  if (!sanitized) {
    sanitized = `download_${Date.now()}`;
  }

  // Truncate if too long (keep extension if present)
  const maxLength = 255;
  if (sanitized.length > maxLength) {
    const ext = extname(sanitized);
    const nameWithoutExt = sanitized.substring(0, sanitized.length - ext.length);
    const maxNameLength = maxLength - ext.length;
    sanitized = nameWithoutExt.substring(0, maxNameLength) + ext;
  }

  return sanitized;
}

export function generateUniqueFilename(dir: string, name: string): string {
  const sanitized = sanitizeFilename(name);
  let candidate = join(dir, sanitized);

  if (!existsSync(candidate)) {
    return candidate;
  }

  // File exists, generate unique name
  const ext = extname(sanitized);
  const nameWithoutExt = sanitized.substring(0, sanitized.length - ext.length);

  let counter = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${nameWithoutExt} (${counter})${ext}`);
    counter++;

    // Safety limit
    if (counter > 1000) {
      const timestamp = Date.now();
      candidate = join(dir, `${nameWithoutExt}_${timestamp}${ext}`);
      break;
    }
  }

  logDebug("Generated unique filename", { original: name, unique: candidate });
  return candidate;
}
