import { describe, expect, it } from "vitest";

import { getFilePreviewKind } from "./file-preview";

describe("file preview support", () => {
  it("supports bounded DOCX, PDF, text, and image previews", () => {
    expect(getFilePreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024)).toBe("docx");
    expect(getFilePreviewKind("application/pdf", 1024)).toBe("pdf");
    expect(getFilePreviewKind("text/plain", 1024)).toBe("text");
    expect(getFilePreviewKind("image/png", 1024)).toBe("image");
  });

  it("rejects unsupported Office formats and oversized previews", () => {
    expect(getFilePreviewKind("application/vnd.openxmlformats-officedocument.presentationml.presentation", 1024)).toBeNull();
    expect(getFilePreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 16 * 1024 * 1024)).toBeNull();
    expect(getFilePreviewKind("text/plain", 3 * 1024 * 1024)).toBeNull();
  });
});
