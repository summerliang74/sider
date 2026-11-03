"use client";

import { useState } from "react";
import { canonicalTag, isPaTag, suggestedTags } from "@/src/lib/resource-tags";

export function TagPicker({ isAdmin = false, initialTags = [] }: { isAdmin?: boolean; initialTags?: string[] }) {
  const [tags, setTags] = useState(initialTags.map(canonicalTag).join(", "));
  const selected = tags.split(",").map((tag) => canonicalTag(tag.trim())).filter(Boolean);
  function addTag(value: string) {
    if (value && selected.length < 10 && !selected.some((tag) => tag.toLowerCase() === value.toLowerCase())) setTags([...selected, value].join(", "));
  }
  return <div className="field">
    <label><span>Tags</span><input name="tags" value={tags} onChange={(event) => setTags(event.target.value)} maxLength={309} placeholder="Add tags, separated by commas" /></label>
    <label><span className="sr-only">Choose a tag</span><select value="" onChange={(event) => addTag(event.target.value)}><option value="">Choose a tag…</option>{suggestedTags.map((tag) => <option key={tag} value={tag} disabled={(!isAdmin && isPaTag(tag)) || selected.includes(tag)}>{tag}{isPaTag(tag) && !isAdmin ? " (admin only)" : ""}</option>)}</select></label>
    <small>Up to 10 tags. PA requires an administrator.</small>
  </div>;
}
