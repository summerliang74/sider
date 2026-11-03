"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import type { ResourceListItem } from "@/src/lib/resources";
import {
  resourceFileTypeLabels,
  resourceFileTypes,
  type ResourceFileType,
} from "@/src/lib/resource-search";
import { BotChallenge } from "./bot-challenge";
import { ResourceList } from "./resource-list";

export type SerializedResourceListItem = Omit<ResourceListItem, "publishedAt"> & { publishedAt: string };
type PendingSearch = { query: string; fileType?: ResourceFileType; tag?: string; cursor?: string };

export function SearchHub({
  initialQuery,
  initialFileType,
  initialTag,
  initialItems,
  tagOptions,
  initialNextCursor,
}: {
  initialQuery: string;
  initialFileType?: ResourceFileType;
  initialTag?: string;
  tagOptions: string[];
  initialItems?: SerializedResourceListItem[];
  initialNextCursor?: string | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [fileType, setFileType] = useState<ResourceFileType | undefined>(initialFileType);
  const [tag, setTag] = useState(initialTag);
  const availableTags = tag && !tagOptions.includes(tag) ? [...tagOptions, tag] : tagOptions;
  const [items, setItems] = useState<ResourceListItem[]>(() => (initialItems ?? []).map((item) => ({
    ...item,
    publishedAt: new Date(item.publishedAt),
  })));
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor ?? null);
  const [loading, setLoading] = useState(initialItems === undefined);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingSearch | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (
    targetQuery: string,
    targetFileType?: ResourceFileType,
    targetTag?: string,
    cursor?: string,
    botToken?: string,
  ) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setPending(null);
    if (!cursor) {
      setItems([]);
      setNextCursor(null);
    }
    const params = new URLSearchParams();
    if (targetQuery) params.set("q", targetQuery);
    if (targetFileType) params.set("type", targetFileType);
    if (targetTag) params.set("tag", targetTag);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/resources?${params.toString()}`, {
        headers: botToken ? { "x-bot-token": botToken } : undefined,
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json() as { items?: SerializedResourceListItem[]; nextCursor?: string | null; error?: string };
      if (controller.signal.aborted) return;
      if (result.error === "bot_challenge_required") {
        setPending({ query: targetQuery, fileType: targetFileType, tag: targetTag, cursor });
        setError("Please complete the traffic check to continue searching.");
        return;
      }
      if (!response.ok || !result.items) {
        setError(result.error === "rate_limited" ? "Too many searches. Please wait and try again." : "Search is temporarily unavailable.");
        return;
      }
      const normalized = result.items.map((item) => ({ ...item, publishedAt: new Date(item.publishedAt) }));
      setItems(cursor ? (current) => [...current, ...normalized] : normalized);
      setNextCursor(result.nextCursor ?? null);
    } catch {
      if (!controller.signal.aborted) setError("Search is temporarily unavailable. Please try again.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (initialItems !== undefined) return;
    const timer = window.setTimeout(() => void load(initialQuery, initialFileType, initialTag), 0);
    return () => window.clearTimeout(timer);
  }, [initialTag, initialFileType, initialItems, initialQuery, load]);

  function replaceSearchUrl(targetQuery: string, targetFileType?: ResourceFileType, targetTag?: string) {
    const params = new URLSearchParams();
    if (targetQuery) params.set("q", targetQuery);
    if (targetFileType) params.set("type", targetFileType);
    if (targetTag) params.set("tag", targetTag);
    const search = params.toString();
    window.history.replaceState(null, "", search ? `/resources?${search}` : "/resources");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextQuery = String(form.get("q") ?? "").trim().slice(0, 120);
    setQuery(nextQuery);
    setDraftQuery(nextQuery);
    replaceSearchUrl(nextQuery, fileType, tag);
    void load(nextQuery, fileType, tag);
  }

  function changeFileType(nextFileType: ResourceFileType | undefined) {
    setFileType(nextFileType);
    replaceSearchUrl(query, nextFileType, tag);
    void load(query, nextFileType, tag);
  }

  function clearSearch() {
    setQuery("");
    setDraftQuery("");
    setFileType(undefined);
    setTag(undefined);
    replaceSearchUrl("", undefined, undefined);
    void load("", undefined, undefined);
  }

  function changeTag(nextTag?: string) {
    setTag(nextTag);
    replaceSearchUrl(query, fileType, nextTag);
    void load(query, fileType, nextTag);
  }

  const emptyTitle = query || fileType || tag ? "No matching resources" : "No resources yet";
  const emptyMessage = query || fileType || tag ? "Try another search, tag, or file type." : "The first scanned resource will appear here after it is published.";

  return <>
    <form className="searchbox" onSubmit={submit} role="search" aria-label="Search the resource library">
      <Image src="/figma/search.svg" alt="" width={20} height={20} aria-hidden="true" />
      <label className="sr-only" htmlFor="resource-search">Search resources</label>
      <input id="resource-search" name="q" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} maxLength={120} placeholder="Search resources…" autoComplete="off" />
      <button className="button search-submit" type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</button>
    </form>
    <div className="library-controls">
      <label className="file-type-filter"><span>Tag</span><select value={tag ?? ""} onChange={(event) => changeTag(event.target.value || undefined)}><option value="">All tags</option>{availableTags.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <div className={`library-filters${filtersOpen ? " expanded" : ""}`}>
        <button className="button filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="file-type-options" onClick={() => setFiltersOpen((open) => !open)}>File type{fileType ? " · 1" : ""}<span aria-hidden="true">⌄</span></button>
        <label className="file-type-filter" id="file-type-options"><span>File type</span><select value={fileType ?? ""} onChange={(event) => changeFileType(event.target.value ? event.target.value as ResourceFileType : undefined)}><option value="">All file types</option>{resourceFileTypes.map((type) => <option key={type} value={type}>{resourceFileTypeLabels[type]}</option>)}</select></label>
      </div>
    </div>
    {query || fileType || tag ? <div className="active-filters" aria-label="Applied search filters">
      {tag ? <button className="filter-chip" type="button" onClick={() => changeTag(undefined)}>{tag} ×</button> : null}
      {query ? <span className="filter-chip">Search · {query}</span> : null}
      {fileType ? <button className="filter-chip" type="button" onClick={() => changeFileType(undefined)} aria-label={`Remove ${resourceFileTypeLabels[fileType]} filter`}>{resourceFileTypeLabels[fileType]} <span aria-hidden="true">×</span></button> : null}
      <button className="clear-filters" type="button" onClick={clearSearch}>Clear all</button>
    </div> : null}
    <div className="results-heading">
      <h2>{query ? "Search results" : "Latest resources"}</h2>
      <span className="results-summary" role="status">{loading ? "Updating…" : error ? "Search unavailable" : `${items.length}${nextCursor ? "+" : ""} ${items.length === 1 ? "resource" : "resources"}`}<span aria-hidden="true"> · </span>{query ? "By relevance" : "Newest first"}</span>
    </div>
    {pending ? <div className="challenge"><p>{error}</p><BotChallenge action="search" onToken={(token) => { if (token) void load(pending.query, pending.fileType, pending.tag, pending.cursor, token); }} /></div> : null}
    {!pending && error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="search-results" aria-busy={loading}>
      {items.length > 0 ? (
        <ResourceList items={items} />
      ) : loading ? (
        <div className="empty"><p>Loading resources…</p></div>
      ) : pending ? (
        <div className="empty"><p>Complete the traffic check above to view resources.</p></div>
      ) : error ? (
        <div className="empty"><h2>Couldn’t load resources</h2><p>Try your search again in a moment.</p></div>
      ) : (
        <ResourceList items={items} emptyTitle={emptyTitle} emptyMessage={emptyMessage} />
      )}
    </div>
    {!pending && error ? <button className="button" type="button" disabled={loading} onClick={() => void load(query, fileType, tag)}>Try again</button> : null}
    {nextCursor && !error ? <div className="pagination"><button className="button" type="button" disabled={loading} onClick={() => void load(query, fileType, tag, nextCursor)}>{loading ? "Loading…" : "Load more resources"}</button></div> : null}
  </>;
}
