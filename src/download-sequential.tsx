import { useState, useCallback, useMemo } from "react";
import { Form, ActionPanel, Action, Icon, showToast, Toast, launchCommand, LaunchType } from "@raycast/api";
import { getPreferences } from "./lib/preferences";
import { hasRangePattern, getRangeInfo, expandRangeUrl, isValidUrl } from "./lib/url-utils";
import { logInfo } from "./lib/logger";

interface FormValues {
  pattern: string;
  outputDirectory: string[];
}

const MAX_SEQUENTIAL_URLS = 500;

export default function Command() {
  const [pattern, setPattern] = useState("");
  const preferences = getPreferences();

  // Live validation and preview
  const validation = useMemo(() => {
    if (!pattern.trim()) {
      return { valid: false, error: undefined, count: 0 };
    }

    // Check if it has a range pattern
    if (!hasRangePattern(pattern)) {
      // Check if it's at least a valid URL without range
      if (isValidUrl(pattern)) {
        return { valid: true, count: 1, isPlainUrl: true };
      }
      return { valid: false, error: "Enter a URL with [start-end] range pattern" };
    }

    const rangeInfo = getRangeInfo(pattern);
    if (!rangeInfo) {
      return { valid: false, error: "Invalid range pattern" };
    }

    if (rangeInfo.count > MAX_SEQUENTIAL_URLS) {
      return {
        valid: false,
        error: `Range too large (${rangeInfo.count} URLs). Maximum is ${MAX_SEQUENTIAL_URLS}`,
      };
    }

    return {
      valid: true,
      count: rangeInfo.count,
      start: rangeInfo.start,
      end: rangeInfo.end,
      padding: rangeInfo.padding,
    };
  }, [pattern]);

  // Preview URLs (show first 5 and last 2 if more than 7)
  const previewUrls = useMemo(() => {
    if (!validation.valid || validation.count === 0) return [];

    const urls = expandRangeUrl(pattern, MAX_SEQUENTIAL_URLS);

    if (urls.length <= 7) {
      return urls;
    }

    return [...urls.slice(0, 5), "...", ...urls.slice(-2)];
  }, [pattern, validation.valid, validation.count]);

  const handleSubmit = useCallback(async (values: FormValues) => {
    const trimmedPattern = values.pattern.trim();

    if (!trimmedPattern) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No URL Provided",
        message: "Enter a URL with [start-end] range pattern",
      });
      return;
    }

    // Expand the range pattern
    const urls = expandRangeUrl(trimmedPattern, MAX_SEQUENTIAL_URLS);

    if (urls.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No URLs Generated",
        message: "Could not generate any URLs from the pattern.",
      });
      return;
    }

    logInfo("Sequential download initiated", {
      pattern: trimmedPattern,
      urlCount: urls.length,
    });

    // Launch batch download with the expanded URLs
    await launchCommand({
      name: "download-batch",
      type: LaunchType.UserInitiated,
      context: { urls },
    });
  }, []);

  const paddingHint = validation.valid && validation.padding ? ` (${validation.padding}-digit zero-padding)` : "";

  return (
    <Form
      navigationTitle="Sequential Download"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Download Sequence"
            icon={Icon.Download}
            onSubmit={handleSubmit}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="pattern"
        title="URL Pattern"
        placeholder="https://example.com/file[001-025].zip"
        info="Use [start-end] for ranges. Zero-padding is auto-detected from the start number."
        value={pattern}
        onChange={setPattern}
        error={pattern.trim() && !validation.valid ? validation.error : undefined}
      />

      <Form.FilePicker
        id="outputDirectory"
        title="Output Directory"
        allowMultipleSelection={false}
        canChooseDirectories={true}
        canChooseFiles={false}
        defaultValue={[preferences.outputDirectory]}
      />

      <Form.Description
        title="Syntax"
        text={`Incrementing
file[1-10].jpg → file1.jpg, file2.jpg, ...

Zero-padded
img[001-025].png → img001.png, img002.png, ...

Decrementing
page[10-1].pdf → page10.pdf, page9.pdf, ...`}
      />

      {validation.valid && validation.count > 1 && (
        <Form.Description
          title="Preview"
          text={`${validation.count} URLs will be downloaded${paddingHint}:\n\n${previewUrls.join("\n")}`}
        />
      )}
    </Form>
  );
}
