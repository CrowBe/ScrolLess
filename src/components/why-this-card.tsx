import type { FeedItemResponse } from '../types';

const PART_LABEL: Record<string, string> = {
  source: 'Source',
  author: 'Author',
  type: 'Format',
  tag: 'Topic',
  freshness: 'Freshness',
};

const SLOT_TEXT = {
  ranked: 'Ranked by your taste: the points below add up to its score, and higher scores come first.',
  discovery: 'Discovery pick: drawn at random from outside your top-ranked cards, favouring things you have few swipes on.',
  recent: 'Newest first: ranking waits until you have swiped enough cards (Settings → Ranking shows how many).',
};

function fmt(value: number): string {
  return value.toFixed(2).replace(/^-0\.00$/, '0.00');
}

/** Full arithmetic behind a card's place in the session. */
export function WhyThisCard({ item }: { item: FeedItemResponse }) {
  if (!item.session_slot) return null;
  const parts = item.session_breakdown ?? [];

  return (
    <details class="why-card">
      <summary class="why-card__summary">Why this card?</summary>
      <p class="why-card__text">{SLOT_TEXT[item.session_slot]}</p>
      {parts.length > 0 && (
        <table class="why-card__table">
          <thead>
            <tr>
              <th scope="col">Signal</th>
              <th scope="col">Learned</th>
              <th scope="col">× Weight</th>
              <th scope="col">= Points</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.key ?? p.part}>
                <th scope="row">
                  {PART_LABEL[p.part]}
                  {p.part !== 'freshness' && <span class="why-card__label">{p.label}</span>}
                </th>
                <td>{fmt(p.value)}</td>
                <td>{fmt(p.weight)}</td>
                <td>{fmt(p.contribution)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>Score</th>
              <td>{fmt(item.session_score ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p class="why-card__text">Change weights, switch parts off or mute a signal in Settings → Ranking.</p>
    </details>
  );
}
