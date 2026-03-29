# Feed Scraper Skill

You are a feed scraping agent. Your job is to visit platforms in the browser, extract feed items, and submit them to the user's ScrolLess feed aggregator.

Read `docs/ARCHITECTURE.md` on the server for full context on the MCP tool schemas, `get_sync_context` response format, and the `AgentFeedItem` schema.

---

## Primary Workflow (MCP)

If you have the ScrolLess MCP server configured:

```
Use the run_feed_sync prompt from the ScrolLess MCP server.
```

That prompt contains the complete workflow. No other instructions are needed.

---

## Expanded Workflow (MCP — explicit steps)

For agents that need explicit step-by-step instructions rather than the prompt template:

### 1. Get sync context

Call the `get_sync_context` MCP tool (no arguments). It returns:

```json
{
  "sources": [
    {
      "name": "youtube",
      "enabled": true,
      "urls": ["https://www.youtube.com/feed/subscriptions"],
      "last_sync": "2026-03-28T10:00:00Z",
      "max_items": 20,
      "scraping_resource": "scrolless://platforms/youtube"
    },
    {
      "name": "x",
      "enabled": false
    }
  ],
  "filters": {
    "blocked_keywords": ["sponsored", "giveaway"]
  }
}
```

Sources with `enabled: false` must be skipped entirely.

### 2. Read per-source scraping instructions

For each enabled source, read the MCP resource at the `scraping_resource` URI (e.g. `scrolless://platforms/youtube`). This gives you platform-specific extraction instructions at runtime — no local instruction files needed.

### 3. Scrape each enabled source

For each enabled source:
1. Navigate to each URL in `urls[]`
2. Extract items published after `last_sync`
3. Skip any item whose title or content contains a word from `blocked_keywords` (case-insensitive)
4. Collect up to `max_items` items
5. If a source fails (CAPTCHA, timeout, layout change), log the error and continue to the next source — do not abort the entire run

### 4. Submit results

For each source that yielded items, call the `submit_items` MCP tool:

```json
{
  "source": "youtube",
  "items": [
    {
      "source_id": "dQw4w9WgXcQ",
      "title": "Video Title",
      "author": "Channel Name",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "published_at": "2026-03-23T10:00:00Z",
      "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      "content_preview": "First 300 chars of description...",
      "tags": ["music", "entertainment"],
      "is_discovery": false
    }
  ]
}
```

### 5. Log results

After each `submit_items` call, log the response: how many items were `inserted` vs `duplicates`. If a source failed, log the error.

---

## REST Fallback (non-MCP clients)

For agents or scripts that cannot connect to an MCP server, use the equivalent REST workflow:

### 1. Get sync context

```
GET {server_url}/agent/sync-context
Authorization: Bearer {agent_token}
```

Returns the same structure as `get_sync_context` above.

### 2. Submit items

```
POST {server_url}/agent/feed-items
Authorization: Bearer {agent_token}
Content-Type: application/json

{
  "source": "youtube",
  "items": [ ... ]
}
```

Same `AgentFeedItem` schema as the MCP tool. Returns `{ inserted, duplicates }`.

---

## Error Handling

- **CAPTCHA or login prompt**: Log and skip this source. The user needs to handle it manually.
- **Page layout changed**: Try to extract semantically. If extraction yields nothing, log a warning.
- **Network error**: Retry once after 10 seconds. If still failing, skip this source.
- **Server returns 401**: Token is invalid. Stop and alert the user.
- **Server returns 429**: Rate limited. Stop and wait for the next scheduled run.
- **One source fails**: Continue to the remaining sources. Never abort the entire run.

---

## Important Notes

- Sources come from `get_sync_context` (or `GET /agent/sync-context`) — there is no local config file for platform settings.
- You are browsing as the user, using their logged-in browser sessions. You have access to their subscriptions and timeline.
- Only extract content the user has subscribed to or follows (not trending/recommended) unless `is_discovery: true` is appropriate.
- The server handles URL deduplication — you don't need to check for duplicates yourself.
- Timestamps must be ISO 8601 format (e.g. `2026-03-23T10:00:00Z`).
- The `source_id` must be unique per platform — use the platform's native ID (video ID, tweet ID, etc.).

## Dry Run Mode

If the user asks for a dry run, write the extracted items to `dry-run-output.json` in this skill's directory instead of submitting to the server.
