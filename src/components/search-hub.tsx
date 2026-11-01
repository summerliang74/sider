"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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
  const [fileType, setFileType] = useState<ResourceFileType | undefined>(initialFileType);
  const [collection, setCollection] = useState<ResourceCollection | undefined>(initialCollection);
  const [items, setItems] = useState<ResourceListItem[]>(() => (initialItems ?? []).map((item) => ({
    ...item,
    publishedAt: new Date(item.publishedAt),
  })));
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor ?? null);
  const [loading, setLoading] = useState(initialItems === undefined);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingSearch | null>(null);

  const load = useCallback(async (
    targetQuery: string,
    targetFileType?: ResourceFileType,
    targetCollection?: ResourceCollection,
    cursor?: string,
    botToken?: string,
  ) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (targetQuery) params.set("q", targetQuery);
    if (targetFileType) params.set("type", targetFileType);
    if (targetCollection) params.set("collection", targetCollection);
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/resources?${params.toString()}`, {
      headers: botToken ? { "x-bot-token": botToken } : undefined,
      cache: "no-store",
    });
    const result = await response.json() as { items?: SerializedResourceListItem[]; nextCursor?: string | null; error?: string };
    if (result.error === "bot_challenge_required") {
      setPending({ query: targetQuery, fileType: targetFileType, collection: targetCollection, cursor });
      setError("Please complete the traffic check to continue searching.");
      setLoading(false);
      return;
    }
    if (!response.ok || !result.items) {
      setError(result.error === "rate_limited" ? "Too many searches. Please wait and try again." : "Search is temporarily unavailable.");
      setLoading(false);
      return;
    }
    const normalized = result.items.map((item) => ({ ...item, publishedAt: new Date(item.publishedAt) }));
    setItems(cursor ? (current) => [...current, ...normalized] : normalized);
    setNextCursor(result.nextCursor ?? null);
    setPending(null);
    setLoading(false);
  }, []);

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
    replaceSearchUrl(nextQuery, fileType, collection);
    void load(nextQuery, fileType, collection);
  }

  function changeFileType(nextFileType: ResourceFileType | undefined) {
    setFileType(nextFileType);
    replaceSearchUrl(query, nextFileType, collection);
    void load(query, nextFileType, collection);
  }

  function changeCollection(nextCollection: ResourceCollection | undefined) {
    if (nextCollection === collection) return;
    setCollection(nextCollection);
    setItems([]);
    setNextCursor(null);
    setPending(null);
    replaceSearchUrl(query, fileType, nextCollection);
    void load(query, fileType, nextCollection);
  }

  return <>
    <nav className="resource-tabs" aria-label="Resource collections">
      <button type="button" className="resource-tab" aria-pressed={!collection} onClick={() => changeCollection(undefined)}>All resources</button>
      <button type="button" className="resource-tab" aria-pressed={collection === "peer-advisors"} onClick={() => changeCollection("peer-advisors")}>Peer Advisors</button>
    </nav>
    <form className="searchbox" onSubmit={submit} role="search">
      <Image src="/figma/search.svg" alt="" width={20} height={20} aria-hidden="true" />
      <label className="sr-only" htmlFor="resource-search">Search resources</label>
      <input id="resource-search" name="q" defaultValue={initialQuery} maxLength={120} placeholder={collection === "peer-advisors" ? "Search Peer Advisor resources" : "Search notes, guides, worksheets, and references"} autoComplete="off" />
      <button className="sr-only" type="submit" disabled={loading}>Search</button>
    </form>
    <p className="search-caption"><span>{query ? `Results for “${query}”` : collection === "peer-advisors" ? "Resources curated for Peer Advisors" : "Recently published resources"}</span><span>Only scanned, active files appear here</span></p>
    <div className="toolbar"><h2>{query ? "Search results" : collection === "peer-advisors" ? "Peer Advisor resources" : "Latest resources"}</h2><div className="toolbar-actions"><span>{query ? "Relevant first" : "Most recent"}</span><label className="file-type-filter"><span className="sr-only">Filter by file type</span><select value={fileType ?? ""} onChange={(event) => changeFileType(event.target.value ? event.target.value as ResourceFileType : undefined)}><option value="">All file types</option>{resourceFileTypes.map((type) => <option key={type} value={type}>{resourceFileTypeLabels[type]}</option>)}</select></label><Link className="button primary" href="/resources/new" prefetch={false}>Upload resource</Link></div></div>
    <div className="resource-table-head" aria-hidden="true"><span /><span /><span>Name</span><span>Author</span><span>Date</span><span>Tags</span><span>Size</span><span /></div>
    {pending ? <div className="challenge"><p>{error}</p><BotChallenge action="search" onToken={(token) => { if (token) void load(pending.query, pending.fileType, pending.collection, pending.cursor, token); }} /></div> : null}
    {!pending && error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading && items.length === 0 ? <div className="empty"><p>Loading resources…</p></div> : <ResourceList items={items} />}
    {nextCursor ? <div className="pagination"><button className="button" type="button" disabled={loading} onClick={() => void load(query, fileType, collection, nextCursor)}>{loading ? "Loading…" : "Load more"}</button></div> : null}
  </>;
}
