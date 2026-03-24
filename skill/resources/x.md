# X (Twitter) Scraping Instructions

## Target URL

Navigate to: `https://x.com/home`

Then switch to the **"Following"** tab (not "For you"). The "Following" tab shows only tweets from accounts the user follows, in reverse chronological order. The user must be logged into X in Chrome.

## What to Extract

For each tweet on the page, extract:

| Field | Where to find it | Notes |
|---|---|---|
| `source_id` | Tweet ID from the URL | The numeric ID in `x.com/{user}/status/{id}` |
| `title` | Tweet text | First 200 characters. For longer tweets, this is the preview. |
| `author` | `@handle` of the author | Include the `@` prefix |
| `url` | Full tweet URL | `https://x.com/{handle}/status/{source_id}` |
| `published_at` | Tweet timestamp | Hover over relative time to get exact timestamp, or convert relative time |
| `thumbnail_url` | First image in the tweet, if any | Omit if no image |
| `content_preview` | Full tweet text (up to 300 chars) | |
| `tags` | Not available | Omit |
| `is_discovery` | Always `false` | This is the Following timeline |

## What to Skip

- **Ads / Promoted tweets**: Tweets marked with "Ad" or "Promoted" label. These are not from followed accounts.
- **Retweets (plain retweets)**: Items showing "Username reposted". These are just reshares with no added content. **Exception**: Quote tweets (retweets with added commentary) should be extracted — use the quote tweeter as the author.
- **Twitter Spaces**: Items promoting a live or upcoming Space audio session.
- **Community notes / context labels**: These are metadata, not content items.
- **"Show more" engagement bait**: X sometimes inserts "See what's happening" or trending topic cards in the timeline. Skip these.

## Pagination / Scrolling

The timeline loads more tweets as you scroll:

1. Extract from the top of the timeline
2. Scroll to load more if needed
3. Stop when:
   - You've reached `max_items_per_source` items
   - Tweets are older than the last sync timestamp
   - Two scrolls yielded no new content

## Timestamp Handling

X shows relative timestamps:
- "2m", "1h", "3h" — minutes/hours ago
- "Mar 22" — date without year (current year implied)
- Hovering over the timestamp reveals the exact datetime

Convert all timestamps to ISO 8601. Hovering to get exact time is preferred if accessible; otherwise, convert the relative time.

## Edge Cases

- **Threads**: A multi-tweet thread appears as one tweet with a "Show this thread" link. Extract only the first tweet (the one visible in the timeline). Don't follow the thread link.
- **Tweets with media only**: Some tweets have no text, just images/video. Set `title` to `"[Media]"` and `content_preview` to empty.
- **Tweets with polls**: Extract the tweet text. Ignore the poll options.
- **Deleted/unavailable tweets**: If a tweet shows as "This post is unavailable", skip it.
- **Sensitive content warnings**: If a tweet is behind a "This content may be sensitive" screen, skip it (don't click through).
