# How sessions are ranked

Ranking version `rank3`. Code: [taste.ts](../server/taste.ts) (algorithm) and [ranking-config.ts](../server/ranking-config.ts) (every tunable and its limits). Everything below runs on your host, with no model calls. Any number here can be changed, and any part switched off, in **Settings → Ranking**. To see why a card was placed where it was, open it and tap **Why this card?**.

## What ranking can and cannot do

- It reorders the unread, eligible items you already have. It never hides an item. Only blocked keywords hide content.
- Passing on a card lowers similar cards' scores. It does not block an author or topic.
- It is slow on purpose. Nothing changes until enough swipes have built up, both overall and for each signal (see [evidence gates](#evidence-gates)). A changed setting applies to the next session drawn, not the deck in front of you.
- Your agent can read the config and a summary of your tastes (`get_taste_profile`). It cannot change them. Only you can, through Settings or the `/api/ranking` routes with a reader session.

## Evidence gates

Two thresholds decide when swipes start to matter. Both are in Settings → Ranking under *Evidence before anything changes*.

| Setting | Default | Effect |
|---|---|---|
| Swipes before ranking starts | 30 | Below this many swipes in total, sessions stay newest first (`recent`), there are no discovery cards, and the agent summary only says to collect broadly. 0 starts ranking from the first swipe |
| Swipes before a signal counts | 5 | A source, author, format or topic needs this many swipes of its own (likes, saves and passes, not faded) before it adds points to any card or appears in the agent summary. Until then Settings lists it as *learning n/5* |

A learning signal still counts toward a card's familiarity for discovery (step 5 of [building a session](#3-building-a-session)), because you have seen things like it.

## 1. Learning from swipes

Every swipe records a snapshot of the card's **signals**:

| Signal | Key example | Notes |
|---|---|---|
| Source | `source:youtube` | |
| Author | `author:youtube/some channel` | Per source, case-insensitive, so two people with the same name on different platforms stay separate |
| Format | `type:video` | Card `content_type`, case-insensitive |
| Topic | `tag:rust` | Each tag, case-insensitive; duplicates on one card count once |

Each swipe adds its **verdict weight** to every signal on the card:

| Verdict | Default weight |
|---|---|
| Like (swipe right) | +1 |
| Save (swipe up) | +2 |
| Pass (swipe left) | −1 |

With **Fade old swipes** on, a swipe's weight halves every **half-life** (default 45 days): a swipe one half-life old counts 0.5, two half-lives old 0.25. Undoing a swipe deletes it, so it stops counting.

Each signal's learned **score** is:

```
score = sum(verdict weight × fade) / (sum(fade) + caution)
```

**Caution** (default 2) adds that many neutral swipes to every signal, so a single like gives a score of 1 / (1 + 2) = 0.33, not 1. Set it to 0 to trust every swipe fully.

Muted signals, learning signals and signals whose kind is switched off are still listed in Settings, with their status, but they play no part in ranking or the agent summary.

## 2. Scoring a card

For each signal on the card that is enabled, not muted and has enough swipes of its own:

```
points = learned score × signal weight
```

| Signal | Default weight |
|---|---|
| Source | 1 |
| Author | 1.5 |
| Format | 0.5 |
| Topics | 1, split evenly across the card's learned tags so cards are not favoured for having many tags |

With **Boost newer items** on, the card also gets freshness points:

```
freshness points = freshness weight × 0.5 ^ (age in hours / freshness half-life)
```

Defaults: weight 0.3, half-life 48 hours. Age uses the publication time, or when the host first saw the item if that is unknown.

The card's **score** is the sum of all points. "Why this card?" shows each line of this sum.

## 3. Building a session

1. Take the newest **items considered per session** (default 500) unread, eligible items for the view (Feed or Discover) and source filter.
2. If you have fewer swipes than *Swipes before ranking starts*, show them newest first, labelled `recent`, and stop here.
3. Otherwise sort by score, highest first. Ties go to the newer item.
4. With **Discovery cards** on, hold back **share of session** (default 20%) of the session's slots, rounded, always leaving at least one ranked card. Fill the rest with the top-scoring cards (`ranked`).
5. Fill the held-back slots by drawing at random from the cards ranking left out. Each card's chance is proportional to `1 / (1 + evidence)`, where evidence is the faded swipe count behind its enabled, unmuted signals (learning ones included), so cards unlike anything you've swiped are likelier. These cards are labelled **Discovery**.
6. Spread discovery cards evenly through the deck rather than leaving them at the end.

Session length is the **Cards per session** preference.

## 4. What the agent sees

`get_collection_context` includes a one-paragraph `taste_summary`. `get_taste_profile` returns the full picture: swipe counts, up to 8 liked and 8 passed signals per kind (score of at least ±0.2), the paragraph, and a read-only copy of the config. Only signals that count for ranking are included, and the paragraph says which kinds you switched off. Below *Swipes before ranking starts* the lists are empty and the paragraph says how many swipes are still needed. Names come from earlier pushed content, so they are flattened to one line and cut to 80 characters. The push guide tells the agent to use this to choose what to collect and to keep variety, never as a block list.

## Changing it

| Where | What |
|---|---|
| Settings → Ranking | Every weight and switch above, muting single signals, reset to defaults |
| `GET /api/ranking` | Current config, swipe counts, summary and every learned signal |
| `PATCH /api/ranking` | Any subset of the config; omitted fields keep their value |
| `POST /api/ranking/reset` | Default config. Swipe history is kept |
| [ranking-config.ts](../server/ranking-config.ts) | Defaults and allowed ranges |
| [taste.ts](../server/taste.ts) | The algorithm itself; bump `RANKING_VERSION` when changing it |
