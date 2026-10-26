import { describe, expect, it } from "vitest";

import { normalizeTags, sanitizeFilename, uploadedObjectMatches, validateDeclaredFile, validateDetectedFile } from "./files";

describe("file policy", () => {
  it("accepts only matching allow-listed extensions and declared MIME types", () => {
    expect(validateDeclaredFile("notes.pdf", "application/pdf")).toBe(true);
    expect(validateDeclaredFile("notes.exe", "application/pdf")).toBe(false);
    expect(validateDeclaredFile("notes.pdf", "application/x-msdownload")).toBe(false);
    expect(validateDeclaredFile("macro.docm", "application/vnd.ms-word.document.macroEnabled.12")).toBe(false);
    expect(validateDeclaredFile("archive.zip", "application/zip")).toBe(false);
  });

  it("fails closed when scan-detected MIME conflicts with the filename", () => {
    expect(validateDetectedFile("image.jpg", "image/jpeg")).toBe(true);
    expect(validateDetectedFile("image.jpg", "application/pdf")).toBe(false);
    expect(validateDetectedFile("notes.pdf", "application/x-executable")).toBe(false);
  });

  it("removes paths/control characters and de-duplicates tags", () => {
    expect(sanitizeFilename("../../unsafe\u0000 name.pdf")).toBe("unsafe name.pdf");
    expect(normalizeTags(["Math", " math ", "Revision"])).toEqual(["Math", "Revision"]);
  });

  it("rejects forged completion metadata", () => {
    const expected = { id: "resource-id", sizeBytes: 1024, mimeType: "application/pdf" };
    expect(uploadedObjectMatches(expected, { resourceId: "resource-id", contentLength: 1024, contentType: "application/pdf" })).toBe(true);
    expect(uploadedObjectMatches(expected, { resourceId: "other", contentLength: 1024, contentType: "application/pdf" })).toBe(false);
    expect(uploadedObjectMatches(expected, { resourceId: "resource-id", contentLength: 2048, contentType: "application/pdf" })).toBe(false);
    expect(uploadedObjectMatches(expected, { resourceId: "resource-id", contentLength: 1024, contentType: "text/plain" })).toBe(false);
  });
});
