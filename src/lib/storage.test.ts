import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mocks.getSignedUrl,
}));
vi.mock("@/src/lib/env", () => ({
  getServerEnv: () => ({
    S3_ENDPOINT: "https://oss-cn-beijing.aliyuncs.com",
    S3_REGION: "cn-beijing",
    S3_BUCKET: "sider-prod-upload",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    s3ForcePathStyle: false,
  }),
}));

import { createDownloadUrl } from "./storage";

describe("download URLs", () => {
  beforeEach(() => {
    mocks.getSignedUrl.mockReset();
    mocks.getSignedUrl.mockResolvedValue("https://example.test/signed-download");
  });

  it("does not request the Content-Type override rejected by Aliyun OSS", async () => {
    const result = await createDownloadUrl({
      objectKey: "active/resource/document.docx",
      filename: "AP CSP.docx",
    });

    const command = mocks.getSignedUrl.mock.calls[0]?.[1];
    expect(command.input).toMatchObject({
      Bucket: "sider-prod-upload",
      Key: "active/resource/document.docx",
      ResponseContentDisposition: expect.stringContaining("AP CSP.docx"),
    });
    expect(command.input).not.toHaveProperty("ResponseContentType");
    expect(result).toEqual({ url: "https://example.test/signed-download", expiresIn: 120 });
  });
});
