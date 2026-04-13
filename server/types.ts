// Server-side types

export interface AgentFeedResponse {
  relayed?: number;
  queued?: number;
  queue_ttl_minutes?: number;
}

export interface AgentEncryptedFeedItem {
  source_id: string;
  url: string;
  published_at: string;
  is_discovery?: boolean;
  encrypted_fields: string;
}

export interface AgentEncryptedFeedPayload {
  source: string;
  ephemeral_public_key: string;
  items: AgentEncryptedFeedItem[];
}

export interface AgentStateSource {
  last_sync: string | null;
  item_count: number;
}

export interface AgentState {
  sources: Record<string, AgentStateSource>;
}

export interface AgentPreferences {
  blocked_keywords: string[];
  max_items_per_source: number;
}

export interface AgentSyncSource {
  name: string;
  enabled: boolean;
  urls?: string[];
  last_sync?: string | null;
  max_items?: number;
  scraping_resource?: string;
}

export interface AgentSyncContext {
  encryption?: {
    public_key: string;
    algorithm: 'ECIES-P256-AES256GCM';
  };
  sources: AgentSyncSource[];
  filters: {
    blocked_keywords: string[];
  };
}

export interface OAuthClientConfig {
  client_id: string;
  redirect_uris: string[];
  is_public?: boolean;
}

export interface AppConfig {
  agent_token_hash: string;
  db_path?: string;
  base_url?: string;        // Public-facing backend URL for OAuth issuer (e.g. "https://scrolless.example.com")
  cors_origins?: string[];  // Browser origins allowed to call the API in split-hosting deployments
  admin_password?: string;  // If set, required to approve OAuth consent screen
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
  oauth?: {
    clients?: OAuthClientConfig[];
    token_expires_in?: number;
    refresh_token_expires_in?: number;
  };
  device?: {
    enrollment_token?: string;
  };
}
