export const resourceFileTypes = [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "txt",
  "png",
  "jpeg",
] as const;

export const resourceCollections = ["peer-advisors"] as const;

export type ResourceFileType = (typeof resourceFileTypes)[number];
export type ResourceCollection = (typeof resourceCollections)[number];

export const resourceFileTypeLabels: Record<ResourceFileType, string> = {
  pdf: "PDF",
  docx: "Word (DOCX)",
  pptx: "PowerPoint (PPTX)",
  xlsx: "Excel (XLSX)",
  txt: "Text (TXT)",
  png: "PNG image",
  jpeg: "JPEG image",
};

export const resourceFileTypeMimeTypes: Record<ResourceFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  png: "image/png",
  jpeg: "image/jpeg",
};

export function isResourceFileType(value: unknown): value is ResourceFileType {
  return typeof value === "string" && resourceFileTypes.includes(value as ResourceFileType);
}

export function isResourceCollection(value: unknown): value is ResourceCollection {
  return typeof value === "string" && resourceCollections.includes(value as ResourceCollection);
}
