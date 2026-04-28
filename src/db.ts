import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import type { BookMetadata, SearchResponse } from "./types";

mkdirSync("data", { recursive: true });

const db = new Database("data/worm.db", { create: true });
db.exec("PRAGMA journal_mode=WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    work_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cover_id INTEGER,
    subjects TEXT NOT NULL DEFAULT '[]',
    authors TEXT NOT NULL DEFAULT '[]',
    first_publish_year INTEGER,
    cached_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS authors (
    author_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL
  );
`);

// Migrate existing DBs that lack the column
try {
  db.exec(
    "ALTER TABLE books ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT 0",
  );
} catch {}
try {
  db.exec(
    "ALTER TABLE authors ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT 0",
  );
} catch {}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const searchCache = new Map<
  string,
  { response: SearchResponse; cachedAt: number }
>();

export function getCachedSearch(key: string): SearchResponse | null {
  const entry = searchCache.get(key);
  if (!entry || Date.now() - entry.cachedAt > SEARCH_TTL_MS) {
    if (entry) searchCache.delete(key);
    return null;
  }
  return entry.response;
}

export function setCachedSearch(key: string, response: SearchResponse): void {
  if (searchCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of searchCache) {
      if (now - v.cachedAt > SEARCH_TTL_MS) searchCache.delete(k);
    }
  }
  searchCache.set(key, { response, cachedAt: Date.now() });
}

const getBookStmt = db.prepare<
  {
    work_id: string;
    title: string;
    cover_id: number | null;
    subjects: string;
    authors: string;
    first_publish_year: number | null;
  },
  [string]
>(
  "SELECT work_id, title, cover_id, subjects, authors, first_publish_year FROM books WHERE work_id = ?",
);
const setBookStmt = db.prepare(
  "INSERT OR REPLACE INTO books (work_id, title, cover_id, subjects, authors, first_publish_year, cached_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);
const touchBookStmt = db.prepare(
  "UPDATE books SET last_accessed_at = ? WHERE work_id = ?",
);

export function getCachedBook(workId: string): BookMetadata | null {
  const row = getBookStmt.get(workId);
  if (!row) return null;
  touchBookStmt.run(now(), workId);
  return {
    work_id: row.work_id,
    title: row.title,
    cover_id: row.cover_id,
    subjects: JSON.parse(row.subjects),
    authors: JSON.parse(row.authors),
    first_publish_year: row.first_publish_year,
  };
}

export function setCachedBook(book: BookMetadata): void {
  const ts = now();
  setBookStmt.run(
    book.work_id,
    book.title,
    book.cover_id,
    JSON.stringify(book.subjects),
    JSON.stringify(book.authors),
    book.first_publish_year,
    ts,
    ts,
  );
}

const getAuthorStmt = db.prepare<{ name: string }, [string]>(
  "SELECT name FROM authors WHERE author_id = ?",
);
const setAuthorStmt = db.prepare(
  "INSERT OR REPLACE INTO authors (author_id, name, cached_at, last_accessed_at) VALUES (?, ?, ?, ?)",
);
const touchAuthorStmt = db.prepare(
  "UPDATE authors SET last_accessed_at = ? WHERE author_id = ?",
);

export function getCachedAuthor(authorId: string): string | null {
  const row = getAuthorStmt.get(authorId);
  if (!row) return null;
  touchAuthorStmt.run(now(), authorId);
  return row.name;
}

export function setCachedAuthor(authorId: string, name: string): void {
  const ts = now();
  setAuthorStmt.run(authorId, name, ts, ts);
}

const countBooksStmt = db.prepare<{ count: number }, []>(
  "SELECT COUNT(*) as count FROM books",
);
const countAuthorsStmt = db.prepare<{ count: number }, []>(
  "SELECT COUNT(*) as count FROM authors",
);

export function getCacheStats() {
  return {
    searches: searchCache.size,
    books: countBooksStmt.get()!.count,
    authors: countAuthorsStmt.get()!.count,
  };
}

const STALE_SECONDS = 30 * 24 * 60 * 60; // ~ 1 month

const evictBooksStmt = db.prepare(
  "DELETE FROM books WHERE last_accessed_at < ?",
);
const evictAuthorsStmt = db.prepare(
  "DELETE FROM authors WHERE last_accessed_at < ?",
);

export function evictStale(): { books: number; authors: number } {
  const cutoff = now() - STALE_SECONDS;
  const books = evictBooksStmt.run(cutoff).changes;
  const authors = evictAuthorsStmt.run(cutoff).changes;
  return { books, authors };
}
