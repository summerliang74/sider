import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SearchHub } from "./search-hub";

describe("search first render", () => {
  it("includes server-provided search results before the browser runs JavaScript", () => {
    const html = renderToStaticMarkup(<SearchHub initialQuery="guide" tagOptions={[]} initialItems={[{
      id: "123e4567-e89b-42d3-a456-426614174000",
      title: "Physics study guide",
      description: "A revision resource",
      tags: ["Physics"],
      originalFilename: "guide.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      publishedAt: "2026-11-01T00:00:00.000Z",
      authorName: "Student",
    }]} />);
    expect(html).toContain("Physics study guide");
    expect(html).not.toContain("Loading resources…");
    expect(html).toContain('aria-busy="false"');
  });

  it("renders a required challenge on the first response instead of a loading placeholder", () => {
    const html = renderToStaticMarkup(<SearchHub initialQuery="guide" tagOptions={[]} initialItems={[]} initialError="bot_challenge_required" />);
    expect(html).toContain("Please complete the traffic check to continue searching.");
    expect(html).toContain("Automated traffic check");
    expect(html).not.toContain("Loading resources…");
  });

  it("renders the rate-limit error and an explicit retry control", () => {
    const html = renderToStaticMarkup(<SearchHub initialQuery="guide" tagOptions={[]} initialItems={[]} initialError="rate_limited" />);
    expect(html).toContain("Too many searches. Please wait and try again.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Loading resources…");
  });
});
