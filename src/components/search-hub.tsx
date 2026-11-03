"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

import type { ResourceListItem } from "@/src/lib/resources";
import {
  resourceFileTypeLabels,
  resourceFileTypes,
  type ResourceCollection,
  type ResourceFileType,
} from "@/src/lib/resource-search";
import { BotChallenge } from "./bot-challenge";
import { ResourceList } from "./resource-list";

export type SerializedResourceListItem = Omit<ResourceListItem, "publishedAt"> & { publishedAt: string };
type PendingSearch = { query: string; fileType?: ResourceFileType; collection?: ResourceCollection; cursor?: string };

export function SearchHub({
  initialQuery,
  initialFileType,
  initialCollection,
  initialItems,
  initialNextCursor,
}: {
  initialQuery: string;
  initialFileType?: ResourceFileType;
  initialCollection?: ResourceCollection;
  initialItems?: SerializedResourceListItem[];
  initialNextCursor?: string | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [fileType, setFileType] = useState<ResourceFileType | undefined>(initialFileType);
  const collection = initialCollection;
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
    targetCollection?: ResourceCollection,
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
    if (targetCollection) params.set("collection", targetCollection);
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
        setPending({ query: targetQuery, fileType: targetFileType, collection: targetCollection, cursor });
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
    const timer = window.setTimeout(() => void load(initialQuery, initialFileType, initialCollection), 0);
    return () => window.clearTimeout(timer);
  }, [initialCollection, initialFileType, initialItems, initialQuery, load]);

  function replaceSearchUrl(targetQuery: string, targetFileType?: ResourceFileType, targetCollection?: ResourceCollection) {
    const params = new URLSearchParams();
    if (targetQuery) params.set("q", targetQuery);
    if (targetFileType) params.set("type", targetFileType);
    if (targetCollection) params.set("collection", targetCollection);
    const search = params.toString();
    window.history.replaceState(null, "", search ? `/resources?${search}` : "/resources");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextQuery = String(form.get("q") ?? "").trim().slice(0, 120);
    setQuery(nextQuery);
    setDraftQuery(nextQuery);
    replaceSearchUrl(nextQuery, fileType, collection);
    void load(nextQuery, fileType, collection);
  }

  function changeFileType(nextFileType: ResourceFileType | undefined) {
    setFileType(nextFileType);
    replaceSearchUrl(query, nextFileType, collection);
    void load(query, nextFileType, collection);
  }

  function clearSearch() {
    setQuery("");
    setDraftQuery("");
    setFileType(undefined);
    replaceSearchUrl("", undefined, collection);
    void load("", undefined, collection);
  }

  function collectionHref(targetCollection?: ResourceCollection) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (fileType) params.set("type", fileType);
    if (targetCollection) params.set("collection", targetCollection);
    return params.size ? `/resources?${params}` : "/resources";
  }

  const emptyTitle = query || fileType
    ? "No matching resources"
    : collection === "peer-advisors"
      ? "No Peer Advisor resources yet"
      : "No resources yet";
  const emptyMessage = query || fileType
    ? "Try a shorter search, another file type, or different wording."
    : collection === "peer-advisors"
      ? "Resources tagged for Peer Advisors will appear in this view."
      : "The first scanned resource will appear here after it is published.";

  return <>
    <form className="searchbox" onSubmit={submit} role="search" aria-label="Search the resource library">
      <Image src="/figma/search.svg" alt="" width={20} height={20} aria-hidden="true" />
      <label className="sr-only" htmlFor="resource-search">Search resources</label>
      <input id="resource-search" name="q" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} maxLength={120} placeholder={collection === "peer-advisors" ? "Search Peer Advisor resources…" : "Search notes, guides, and more…"} autoComplete="off" />
      <button className="button search-submit" type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</button>
    </form>
    <div className="library-controls">
      <nav className="collection-tabs" aria-label="Resource collections">
        <Link href={collectionHref()} aria-current={!collection ? "page" : undefined} prefetch={false}>All resources</Link>
        <Link href={collectionHref("peer-advisors")} aria-current={collection === "peer-advisors" ? "page" : undefined} prefetch={false}>Peer Advisor</Link>
      </nav>
      <div className={`library-filters${filtersOpen ? " expanded" : ""}`}>
        <button className="button filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="file-type-options" onClick={() => setFiltersOpen((open) => !open)}>File type{fileType ? " · 1" : ""}<span aria-hidden="true">⌄</span></button>
        <label className="file-type-filter" id="file-type-options"><span>File type</span><select value={fileType ?? ""} onChange={(event) => changeFileType(event.target.value ? event.target.value as ResourceFileType : undefined)}><option value="">All file types</option>{resourceFileTypes.map((type) => <option key={type} value={type}>{resourceFileTypeLabels[type]}</option>)}</select></label>
      </div>
    </div>
    {query || fileType ? <div className="active-filters" aria-label="Applied search filters">
      {query ? <span className="filter-chip">Search · {query}</span> : null}
      {fileType ? <button className="filter-chip" type="button" onClick={() => changeFileType(undefined)} aria-label={`Remove ${resourceFileTypeLabels[fileType]} filter`}>{resourceFileTypeLabels[fileType]} <span aria-hidden="true">×</span></button> : null}
      <button className="clear-filters" type="button" onClick={clearSearch}>Clear all</button>
    </div> : null}
    <div className="results-heading">
      <h2>{query ? "Search results" : "Latest resources"}</h2>
      <span className="results-summary" role="status">{loading ? "Updating…" : error ? "Search unavailable" : `${items.length}${nextCursor ? "+" : ""} ${items.length === 1 ? "resource" : "resources"}`}<span aria-hidden="true"> · </span>{query ? "By relevance" : "Newest first"}</span>
    </div>
    {pending ? <div className="challenge"><p>{error}</p><BotChallenge action="search" onToken={(token) => { if (token) void load(pending.query, pending.fileType, pending.collection, pending.cursor, token); }} /></div> : null}
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
    {!pending && error ? <button className="button" type="button" disabled={loading} onClick={() => void load(query, fileType, collection)}>Try again</button> : null}
    {nextCursor && !error ? <div className="pagination"><button className="button" type="button" disabled={loading} onClick={() => void load(query, fileType, collection, nextCursor)}>{loading ? "Loading…" : "Load more resources"}</button></div> : null}
  </>;
}
