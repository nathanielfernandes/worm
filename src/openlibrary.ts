import type { OLSearchResponse, OLWork, OLAuthor } from "./types";

const BASE = "https://openlibrary.org";
const USER_AGENT =
  process.env.USER_AGENT ||
  (() => {
    throw new Error("Missing USER_AGENT env variable");
  })();

const MAX_REQUESTS = 3;
const WINDOW_MS = 1000;

const timestamps: number[] = [];

async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    const now = Date.now();
    // remove timestamps older than the window
    while (timestamps.length > 0 && timestamps[0] <= now - WINDOW_MS) {
      timestamps.shift();
    }
    if (timestamps.length < MAX_REQUESTS) {
      timestamps.push(now);
      return fn();
    }
    // wait until the oldest request is outside the window
    const waitMs = timestamps[0] + WINDOW_MS - now;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function fetchJSON<T>(url: string): Promise<T> {
  return rateLimited(async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`OpenLibrary ${res.status}: ${url}`);
    }
    return res.json() as Promise<T>;
  });
}

export async function searchBooks(
  query: string,
  page: number,
): Promise<OLSearchResponse> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  return fetchJSON<OLSearchResponse>(`${BASE}/search.json?${params}`);
}

export async function fetchWork(workId: string): Promise<OLWork> {
  return fetchJSON<OLWork>(`${BASE}/works/${workId}.json`);
}

export async function fetchAuthor(authorId: string): Promise<OLAuthor> {
  return fetchJSON<OLAuthor>(`${BASE}/authors/${authorId}.json`);
}

export function coverUrl(coverId: number, size: "S" | "M" | "L" = "M"): string {
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}
