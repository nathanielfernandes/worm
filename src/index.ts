import { Elysia, t } from "elysia";
import {
  getCachedSearch,
  setCachedSearch,
  getCachedBook,
  setCachedBook,
  getCachedAuthor,
  setCachedAuthor,
  getCacheStats,
  evictStale,
} from "./db";
import { searchBooks, fetchWork, fetchAuthor, coverUrl } from "./openlibrary";
import type { BookMetadata, SearchResponse, SearchDoc } from "./types";

const EVICTION_SECRET =
  process.env.EVICTION_SECRET ||
  (() => {
    throw new Error("Missing EVICTION_SECRET env variable");
  })();

const WORK_ID_RE = /^OL\d+W$/;

const extractWorkId = (key: string) => key.replace("/works/", "");
const extractAuthorId = (key: string) => key.replace("/authors/", "");

async function search(query: string, page: number) {
  const cacheKey = `q=${query.toLowerCase()}&page=${page}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  const raw = await searchBooks(query, page);
  for (const doc of raw.docs) {
    if (doc.author_key && doc.author_name) {
      for (let i = 0; i < doc.author_key.length; i++) {
        if (doc.author_name[i]) {
          setCachedAuthor(doc.author_key[i], doc.author_name[i]);
        }
      }
    }
  }

  const docs: SearchDoc[] = raw.docs.map((doc) => ({
    work_id: extractWorkId(doc.key),
    title: doc.title,
    cover_id: doc.cover_i ?? null,
    first_publish_year: doc.first_publish_year ?? null,
    authors: doc.author_name ?? [],
  }));

  const response: SearchResponse = { total: raw.numFound, docs };
  setCachedSearch(cacheKey, response);

  for (const doc of docs) {
    const existing = getCachedBook(doc.work_id);
    if (!existing) {
      setCachedBook({
        work_id: doc.work_id,
        title: doc.title,
        cover_id: doc.cover_id,
        subjects: [], // not available from search
        authors: doc.authors,
        first_publish_year: doc.first_publish_year,
      });
    }
  }

  return response;
}

async function books(id: string) {
  const cached = getCachedBook(id);
  if (cached && cached.subjects.length > 0) return cached;

  const work = await fetchWork(id);

  const authorKeys = (work.authors ?? []).map((a) =>
    extractAuthorId(a.author.key),
  );
  const authorNames: string[] = [];
  for (const authorId of authorKeys) {
    let name = getCachedAuthor(authorId);
    if (!name) {
      const author = await fetchAuthor(authorId);
      name = author.name;
      setCachedAuthor(authorId, name);
    }
    authorNames.push(name);
  }

  const book: BookMetadata = {
    work_id: id,
    title: work.title,
    cover_id: work.covers?.[0] ?? null,
    subjects: (work.subjects ?? []).slice(0, 20),
    authors: authorNames,
    first_publish_year: cached?.first_publish_year ?? null,
  };

  setCachedBook(book);
  return book;
}

const app = new Elysia()
  .get(
    "/search",
    async ({ query, set }) => {
      const q = query.q?.trim();
      if (!q) {
        set.status = 400;
        return { error: "Missing required query parameter: q" };
      }

      const page = Math.max(1, Number(query.page) || 1);

      return search(q, page);
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        page: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/books/:workId",
    async ({ params, set }) => {
      const { workId } = params;
      if (!WORK_ID_RE.test(workId)) {
        set.status = 400;
        return { error: "Invalid workId format. Expected OL<number>W" };
      }

      return books(workId);
    },
    {
      params: t.Object({
        workId: t.String(),
      }),
    },
  )
  .get(
    "/cover/:coverId",
    ({ params, query, set }) => {
      const { coverId } = params;
      const size = query.size || "L";
      const url = coverUrl(coverId, size);
      set.headers["Cache-Control"] = "public, max-age=31536000, immutable";
      return Response.redirect(url, 302);
    },
    {
      params: t.Object({
        coverId: t.Number(),
      }),
      query: t.Object({
        size: t.Optional(t.Enum({ S: "S", M: "M", L: "L" })),
      }),
    },
  )
  .get("/stats", () => getCacheStats())
  .get(
    "/evict",
    ({ query }) => {
      const t = query.t;
      if (t !== EVICTION_SECRET) {
        return { error: "Unauthorized" };
      }

      const before = getCacheStats();
      evictStale();
      const after = getCacheStats();
      return {
        evictedBooks: before.books - after.books,
        evictedAuthors: before.authors - after.authors,
      };
    },
    {
      query: t.Object({
        t: t.String(),
      }),
    },
  )
  .listen(3000);

console.log(
  `🪱  worm is running at http://${app.server?.hostname}:${app.server?.port}`,
);
