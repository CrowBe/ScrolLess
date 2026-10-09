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
| `published_at` | Tweet timestamp | The `datetime` attribute of the tweet's `<time>` element |
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

Prefer an exact timestamp from the page: a `<time datetime="…">` attribute or the tooltip on the time link. If only relative text is visible ("2 hours ago", "3h"), push that text unchanged as `published_at` — the host keeps it raw and orders the item by when it was first seen. Do not compute a time from relative text. Date-only values may be pushed as `YYYY-MM-DD`.

## Edge Cases

- **Threads**: A multi-tweet thread appears as one tweet with a "Show this thread" link. Extract only the first tweet (the one visible in the timeline). Don't follow the thread link.
- **Tweets with media only**: Some tweets have no text, just images/video. Set `title` to `"[Media]"` and `content_preview` to empty.
- **Tweets with polls**: Extract the tweet text. Ignore the poll options.
- **Deleted/unavailable tweets**: If a tweet shows as "This post is unavailable", skip it.
- **Sensitive content warnings**: If a tweet is behind a "This content may be sensitive" screen, skip it (don't click through).
