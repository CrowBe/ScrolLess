// Frontend types

export interface FeedItemResponse {
  id: string;           // "source:source_id"
  source: string;       // "youtube" | "x" | "news" | custom
  title: string;
  author?: string;
  url: string;
  content_preview?: string;
  thumbnail_url?: string;
  tags: string[];
  is_discovery: boolean;
  published_at: string; // ISO 8601
  fetched_at: string;
  is_read: boolean;
  is_saved: boolean;
}

export interface FeedResponse {
  items: FeedItemResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface SourceStats {
  source: string;
  count: number;
  unread: number;
}

export interface Stats {
  total: number;
  unread: number;
  by_source: SourceStats[];
}

export interface SyncLogEntry {
  source: string;
  synced_at: string;
  items_added: number;
  items_duped: number;
  error?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  source: string;
  count: number;
  url: string;
}

export interface UserSource {
  name: string;
  enabled: boolean;
  urls: string[];
  max_items: number | null;
  created_at: string;
}
