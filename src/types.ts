export interface BookMetadata {
  work_id: string;
  title: string;
  cover_id: number | null;
  subjects: string[];
  authors: string[];
  first_publish_year: number | null;
}

export interface SearchDoc {
  work_id: string;
  title: string;
  cover_id: number | null;
  first_publish_year: number | null;
  authors: string[];
}

export interface SearchResponse {
  total: number;
  docs: SearchDoc[];
}

export interface OLSearchDoc {
  key: string; // e.g. "/works/OL5735363W"
  title: string;
  cover_i?: number;
  author_key?: string[];
  author_name?: string[];
  first_publish_year?: number;
}

export interface OLSearchResponse {
  numFound: number;
  docs: OLSearchDoc[];
}

export interface OLWork {
  title: string;
  covers?: number[];
  subjects?: string[];
  authors?: { author: { key: string } }[];
}

export interface OLAuthor {
  name: string;
}
