export type FilePreviewKind = "docx" | "pdf" | "text" | "image";

const mebibyte = 1024 * 1024;

export function getFilePreviewKind(mimeType: string, sizeBytes: number): FilePreviewKind | null {
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return sizeBytes <= 15 * mebibyte ? "docx" : null;
  }
  if (mimeType === "application/pdf") {
    return sizeBytes <= 25 * mebibyte ? "pdf" : null;
  }
  if (mimeType === "text/plain") {
    return sizeBytes <= 2 * mebibyte ? "text" : null;
  }
  if (["image/png", "image/jpeg"].includes(mimeType)) {
    return sizeBytes <= 25 * mebibyte ? "image" : null;
  }
  return null;
}
