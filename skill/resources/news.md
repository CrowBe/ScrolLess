# News Site Scraping Instructions

## Target URLs

Navigate to each URL listed in `config.platforms.news.sites`. These are the front pages or feed pages of news sites the user wants to follow. No login is required for public news sites.

Example sites and their characteristics:
- `https://news.ycombinator.com` — Hacker News front page. Tech-focused link aggregator.
- `https://arstechnica.com` — Technology news. Editorial articles.
- `https://www.theverge.com` — Tech and culture news.

Each site has a different layout. Extract content semantically — look for article titles, links, and timestamps based on meaning, not specific CSS selectors.

## What to Extract

For each article/story on the page, extract:

| Field | Where to find it | Notes |
|---|---|---|
| `source_id` | Hash of the article URL | Use a stable hash so the device can deduplicate consistently |
| `title` | Article headline | The main title text |
| `author` | Publication name or article author | Use the site name if individual author isn't shown |
| `url` | Article link URL | The canonical URL of the article (not the site's internal redirect) |
| `published_at` | Article timestamp | Parse however the site displays it |
| `thumbnail_url` | Article thumbnail/hero image | If visible on the listing page |
| `content_preview` | Article subtitle or first paragraph | If visible on the listing page (often a deck/subhead) |
| `tags` | Not typically available on listings | Omit or use the site's section name if applicable |
| `is_discovery` | `false` | These are from sites the user explicitly configured |

## Site-Specific Guidance

### Hacker News (`news.ycombinator.com`)

- Articles are listed as numbered links with point scores and comment counts
- The `url` is the external link (the article being shared), not the HN discussion link
- Some items are "Show HN" or "Ask HN" — these link to the HN discussion itself. Use the HN discussion URL.
- `author` should be the HN submitter username
- Timestamps are relative ("2 hours ago")
- There are no thumbnails or previews
- Pagination: multiple pages accessible via "More" link at bottom. Usually the front page (first 30 items) is sufficient.

### Ars Technica (`arstechnica.com`)

- Articles are listed on the front page with headlines, author names, timestamps, and thumbnail images
- `url` is the article permalink
- `author` is the article author name (usually shown)
- Timestamps are shown as relative or absolute dates
- Thumbnails are usually present

### Generic News Site

For sites not specifically described here:
1. Look for a list of article links — these are usually the largest collection of links on the page
2. For each article: extract the headline text, the link URL, and any visible timestamp
3. If thumbnails are shown alongside articles, extract those
4. If author names are shown, extract those; otherwise use the site's domain as the author
5. Skip navigation links, footer links, and sidebar widgets — focus on the main content area

## What to Skip

- **Ads and sponsored content**: Articles marked as "Sponsored", "Advertisement", or "Promoted"
- **Navigation and UI elements**: Links in headers, footers, sidebars that aren't articles
- **Duplicate links**: The same article might appear in multiple sections (featured + latest). Extract it once.
- **Non-article pages**: Links to "About", "Contact", "Subscribe" pages

## Pagination

For most news sites, the front page is sufficient. Don't navigate to page 2 unless you haven't reached `max_items_per_source` items from page 1.

Exception: Hacker News shows 30 items per page. If `max_items_per_source` is higher than 30, follow the "More" link for additional pages.

## Timestamp Handling

News sites vary widely in timestamp format:
- Relative: "2 hours ago", "Yesterday"
- Absolute: "March 22, 2026", "2026-03-22T14:30:00Z"
- Mixed: "Mar 22" (date only, no time)

Convert all to ISO 8601. If only a date is available (no time), use midnight UTC: `2026-03-22T00:00:00Z`.

## Error Handling per Site

If a configured site is unreachable, shows an error page, or has a layout you can't parse:
- Log a warning with the site URL and the issue
- Skip to the next site
- Don't fail the entire news scraping run because one site is down
