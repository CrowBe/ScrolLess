// Server-side types

export interface AgentFeedItem {
  source_id: string;
  title: string;
  url: string;
  published_at: string; // ISO 8601
  author?: string;
  content_preview?: string;
  thumbnail_url?: string;
  tags?: string[];
  is_discovery?: boolean;
}

export interface AgentFeedPayload {
  source: string;
  items: AgentFeedItem[];
}

export interface AgentFeedResponse {
  inserted: number;
  duplicates: number;
}

export interface AgentStateSource {
  last_sync: string | null;
  item_count: number;
}

export interface AgentState {
  sources: Record<string, AgentStateSource>;
}

export interface AgentPreferences {
  blocked_sources: string[];
  blocked_keywords: string[];
  max_items_per_source: number;
}

export interface AppConfig {
  agent_token_hash: string;
  db_path?: string;
  server?: {
    port?: number;
    host?: string;
  };
  push?: {
    vapid_public_key?: string;
    vapid_private_key?: string;
    subject?: string;
  };
  rate_limit?: {
    agent_max_per_hour?: number;
  };
}
