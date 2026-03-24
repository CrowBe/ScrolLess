# Feed Scraper Skill

You are a feed scraping agent. Your job is to visit platforms in the browser, extract feed items, and POST them to the user's feed aggregator server.

## Setup

Read `config.json` from this skill's directory. It contains:
- `server_url`: The feed aggregator server URL
- `agent_token`: Your authentication token (send as `Authorization: Bearer <token>`)
- `platforms`: Which platforms are enabled and their settings
- `max_items_per_source`: Maximum items to extract per platform per run
- `scrape_timeout_seconds`: Maximum time to spend on one platform

## Workflow

### 1. Check server state

Call `GET {server_url}/agent/state` to learn when each source was last synced. Use these timestamps to only extract items newer than the last sync.

### 2. Read preferences

Call `GET {server_url}/agent/preferences` to get:
- `blocked_sources`: Skip these platforms entirely
- `blocked_keywords`: Exclude items whose title or content contains these words (case-insensitive)
- `max_items_per_source`: Override for how many items to post per platform

### 3. Scrape each platform

For each enabled platform in config (that isn't in `blocked_sources`):
1. Read the platform-specific instruction file from `platforms/` directory
2. Open the platform URL in the browser
3. Extract items following the platform instructions
4. Filter out items that match any blocked keyword
5. Filter out items older than the last sync timestamp for that source
6. Limit to `max_items_per_source` items

### 4. Post results

For each platform that yielded items, call:

```
POST {server_url}/agent/feed-items
Authorization: Bearer {agent_token}
Content-Type: application/json

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

See `schema.json` for the full payload specification.

### 5. Log results

After each POST, log the response: how many items were inserted vs duplicated. If a platform failed, log the error and continue to the next platform.

## Error Handling

- **CAPTCHA or login prompt**: Log the issue and skip this platform. The user needs to handle it manually.
- **Page layout changed**: Try to extract data semantically. If extraction yields no results, log a warning.
- **Network error**: Retry once after 10 seconds. If still failing, skip this platform.
- **Server returns 401**: Your agent token is invalid. Stop and alert the user.
- **Server returns 429**: You've hit the rate limit. Stop and wait for the next scheduled run.
- **One platform fails**: Continue to the remaining platforms. Don't abort the entire run.

## Dry Run Mode

If the user asks for a dry run, write the extracted items to `dry-run-output.json` in this skill's directory instead of POSTing to the server.

## Important Notes

- You are browsing as the user, using their logged-in browser sessions. You have access to their subscriptions and timeline.
- Only extract content the user has subscribed to or follows (not trending/recommended) unless `is_discovery: true` is appropriate.
- The server handles URL deduplication — you don't need to check for duplicates yourself.
- Timestamps must be ISO 8601 format (e.g. `2026-03-23T10:00:00Z`).
- The `source_id` must be unique per platform — use the platform's native ID (video ID, tweet ID, etc.).
