// Server-side types

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
