# YouTube Scraping Instructions

## Target URL

Navigate to: `https://www.youtube.com/feed/subscriptions`

This page shows the user's subscription feed — videos from channels they subscribe to, in reverse chronological order. The user must be logged into YouTube in Chrome.

## What to Extract

For each video on the page, extract:

| Field | Where to find it | Notes |
|---|---|---|
| `source_id` | Video URL parameter `v=` | e.g. `dQw4w9WgXcQ` from `watch?v=dQw4w9WgXcQ` |
| `title` | Video title text | Full title, not truncated |
| `author` | Channel name below the title | |
| `url` | Full video URL | `https://www.youtube.com/watch?v={source_id}` |
| `published_at` | Relative timestamp (e.g. "2 hours ago") | Convert to ISO 8601. If only a relative time is shown, compute from current time. |
| `thumbnail_url` | Video thumbnail image `src` | Prefer `mqdefault.jpg` quality or whatever is displayed |
| `content_preview` | Not usually visible on sub feed | Leave empty if not available |
| `tags` | Not available on this page | Omit or leave empty |
| `is_discovery` | Always `false` | This is the subscription feed, not recommendations |

## What to Skip

- **YouTube Shorts**: URLs containing `/shorts/`. These are a different content format.
- **Ads / Promoted content**: Any items marked as "Ad" or "Sponsored".
- **Premieres**: Videos showing "Premieres on..." with a future date. They haven't aired yet.
- **Live streams currently airing**: Items showing "LIVE" badge. These have no fixed duration and may change content.
- **Section headers**: YouTube groups videos with headers like "Today", "This week". These are not content items.

## Pagination / Scrolling

The subscriptions page loads more videos as you scroll down. To get more items:

1. Start extracting from the top of the page
2. If you haven't reached `max_items_per_source` and haven't hit content older than `last_sync`:
   - Scroll down to trigger lazy loading
   - Wait for new content to appear
   - Continue extracting
3. Stop scrolling when either:
   - You've reached `max_items_per_source` items
   - All visible items are older than the last sync timestamp
   - Two consecutive scrolls yielded no new content

## Timestamp Handling

YouTube shows relative timestamps on the subscription feed:
- "3 minutes ago", "2 hours ago", "1 day ago", "3 weeks ago"
- Convert these to ISO 8601 by subtracting from the current time
- Be aware that "1 day ago" could mean anywhere from 24 to 47 hours ago — approximate is fine
- For items showing a specific date (older content), parse the date directly

## Edge Cases

- **Unavailable videos**: Some videos show as "[Deleted video]" or "[Private video]". Skip these.
- **Multi-language titles**: Extract the title as displayed. Don't translate.
- **Channel names with special characters**: Preserve as-is.
- **Mix/playlist links**: Some items link to `watch?v=X&list=Y`. Strip the `list` parameter — use only the video URL.
