import { useCallback, useEffect, useState } from 'preact/hooks';
import { getRanking, resetRanking, updateRanking, type LearnedSignal, type RankingConfig, type RankingReview, type SignalKind } from '../api';

const SIGNALS: Array<{ kind: SignalKind; label: string; help: string }> = [
  { kind: 'source', label: 'Source', help: 'Where it came from (YouTube, news, …)' },
  { kind: 'author', label: 'Author', help: 'Channel, account or publication, per source' },
  { kind: 'type', label: 'Format', help: 'Video, article, post, …' },
  { kind: 'tag', label: 'Topics', help: "Tags; weight is split across an item's learned tags" },
];

const KIND_LABEL: Record<SignalKind, string> = { source: 'Source', author: 'Author', type: 'Format', tag: 'Topic' };

function statusText(s: LearnedSignal, minSignalSwipes: number): string | null {
  if (s.status === 'learning') return `learning ${s.swipes}/${minSignalSwipes}`;
  if (s.status === 'muted') return 'muted';
  if (s.status === 'off') return 'off';
  return null;
}
const SIGNALS_SHOWN = 25;

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function NumberField({ label, value, min, max, step, disabled, onChange }: NumberFieldProps) {
  return (
    <label class="ranking__number">
      <span>{label}</span>
      <input
        class="form-input settings__prefs-number"
        type="number"
        min={String(min)}
        max={String(max)}
        step={String(step)}
        value={String(value)}
        disabled={disabled}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="ranking__toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Review and edit how swipe sessions are ranked. Every weight the host uses is
 * shown here, any part can be switched off, and single learned signals can be
 * muted. docs/RANKING.md explains the algorithm.
 */
export function RankingSection() {
  const [review, setReview] = useState<RankingReview | null>(null);
  const [draft, setDraft] = useState<RankingConfig | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const apply = useCallback((next: RankingReview, keepDraft = false) => {
    setReview(next);
    // Muting saves at once; keep any unsaved weight edits in the form
    setDraft((current) => (keepDraft && current ? { ...current, muted_features: next.config.muted_features } : next.config));
  }, []);

  useEffect(() => {
    getRanking().then(apply).catch((err) => {
      console.error('Failed to load ranking:', err);
      setStatus({ text: 'Could not load ranking.', error: true });
    });
  }, [apply]);

  async function run(action: () => Promise<RankingReview>, done: string, keepDraft = false) {
    setBusy(true);
    setStatus(null);
    try {
      apply(await action(), keepDraft);
      setStatus({ text: done });
    } catch (err) {
      console.error('Ranking update failed:', err);
      setStatus({ text: 'Could not save. Check the values and try again.', error: true });
    } finally {
      setBusy(false);
    }
  }

  if (!review || !draft) {
    return (
      <section class="settings__section">
        <h2 class="settings__heading">Ranking</h2>
        <p class={`settings__help${status?.error ? ' settings__token-copy-state--error' : ''}`}>{status?.text ?? 'Loading ranking…'}</p>
      </section>
    );
  }

  const edit = (patch: Partial<RankingConfig>) => {
    setDraft({ ...draft, ...patch });
    setStatus(null);
  };
  const muted = new Set(review.config.muted_features);
  const toggleMute = (key: string) => {
    const next = muted.has(key) ? review.config.muted_features.filter((k) => k !== key) : [...review.config.muted_features, key];
    void run(() => updateRanking({ muted_features: next }), muted.has(key) ? 'Signal restored.' : 'Signal muted.', true);
  };
  const signals = showAll ? review.signals : review.signals.slice(0, SIGNALS_SHOWN);

  return (
    <section class="settings__section">
      <h2 class="settings__heading">Ranking</h2>
      <p class="settings__help">
        Each swipe teaches a score for the card's source, author, format and topics. A session's cards are ordered by
        adding up learned score × weight for each signal, plus a small boost for newer items. Open any card and tap
        "Why this card?" to see its arithmetic.
      </p>
      <p class="settings__help">{review.summary}</p>

      <form
        class="settings__prefs-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateRanking({ ...draft, muted_features: review.config.muted_features }), 'Ranking saved.');
        }}
      >
        <fieldset class="ranking__group">
          <legend class="settings__prefs-label">Evidence before anything changes</legend>
          <div class="ranking__row">
            <NumberField
              label="Swipes before ranking starts"
              value={draft.evidence.min_swipes}
              min={0}
              max={1000}
              step={5}
              onChange={(min_swipes) => edit({ evidence: { ...draft.evidence, min_swipes } })}
            />
            <span class="settings__help">
              {review.ranking_active
                ? `Ranking is on (${review.feedback.total} swipes).`
                : `Newest first for now: ${review.feedback.total} of ${review.config.evidence.min_swipes} swipes.`}
            </span>
          </div>
          <div class="ranking__row">
            <NumberField
              label="Swipes before a signal counts"
              value={draft.evidence.min_signal_swipes}
              min={1}
              max={100}
              step={1}
              onChange={(min_signal_swipes) => edit({ evidence: { ...draft.evidence, min_signal_swipes } })}
            />
            <span class="settings__help">An author, topic, format or source needs this many swipes of its own before it affects ranking.</span>
          </div>
        </fieldset>

        <fieldset class="ranking__group">
          <legend class="settings__prefs-label">Signals</legend>
          {SIGNALS.map(({ kind, label, help }) => (
            <div key={kind} class="ranking__row">
              <Toggle
                label={label}
                checked={draft.signals[kind].enabled}
                onChange={(enabled) => edit({ signals: { ...draft.signals, [kind]: { ...draft.signals[kind], enabled } } })}
              />
              <NumberField
                label="Weight"
                value={draft.signals[kind].weight}
                min={0}
                max={5}
                step={0.1}
                disabled={!draft.signals[kind].enabled}
                onChange={(weight) => edit({ signals: { ...draft.signals, [kind]: { ...draft.signals[kind], weight } } })}
              />
              <span class="settings__help">{help}</span>
            </div>
          ))}
        </fieldset>

        <fieldset class="ranking__group">
          <legend class="settings__prefs-label">What a swipe teaches</legend>
          <div class="ranking__row">
            <NumberField label="Like" value={draft.verdicts.like} min={-5} max={5} step={0.5} onChange={(like) => edit({ verdicts: { ...draft.verdicts, like } })} />
            <NumberField label="Save" value={draft.verdicts.save} min={-5} max={5} step={0.5} onChange={(save) => edit({ verdicts: { ...draft.verdicts, save } })} />
            <NumberField label="Pass" value={draft.verdicts.dislike} min={-5} max={5} step={0.5} onChange={(dislike) => edit({ verdicts: { ...draft.verdicts, dislike } })} />
          </div>
          <div class="ranking__row">
            <NumberField label="Caution (neutral swipes added)" value={draft.prior} min={0} max={50} step={1} onChange={(prior) => edit({ prior })} />
            <span class="settings__help">Higher means more swipes are needed before a signal counts fully.</span>
          </div>
          <div class="ranking__row">
            <Toggle label="Fade old swipes" checked={draft.memory.decay} onChange={(decay) => edit({ memory: { ...draft.memory, decay } })} />
            <NumberField
              label="Half-life (days)"
              value={draft.memory.half_life_days}
              min={1}
              max={3650}
              step={1}
              disabled={!draft.memory.decay}
              onChange={(half_life_days) => edit({ memory: { ...draft.memory, half_life_days } })}
            />
          </div>
        </fieldset>

        <fieldset class="ranking__group">
          <legend class="settings__prefs-label">Freshness and discovery</legend>
          <div class="ranking__row">
            <Toggle label="Boost newer items" checked={draft.freshness.enabled} onChange={(enabled) => edit({ freshness: { ...draft.freshness, enabled } })} />
            <NumberField
              label="Weight"
              value={draft.freshness.weight}
              min={0}
              max={5}
              step={0.1}
              disabled={!draft.freshness.enabled}
              onChange={(weight) => edit({ freshness: { ...draft.freshness, weight } })}
            />
            <NumberField
              label="Half-life (hours)"
              value={draft.freshness.half_life_hours}
              min={1}
              max={8760}
              step={1}
              disabled={!draft.freshness.enabled}
              onChange={(half_life_hours) => edit({ freshness: { ...draft.freshness, half_life_hours } })}
            />
          </div>
          <div class="ranking__row">
            <Toggle label="Discovery cards" checked={draft.discovery.enabled} onChange={(enabled) => edit({ discovery: { ...draft.discovery, enabled } })} />
            <NumberField
              label="Share of session (%)"
              value={Math.round(draft.discovery.share * 100)}
              min={0}
              max={50}
              step={5}
              disabled={!draft.discovery.enabled}
              onChange={(pct) => edit({ discovery: { ...draft.discovery, share: pct / 100 } })}
            />
          </div>
          <div class="ranking__row">
            <NumberField label="Items considered per session" value={draft.pool_size} min={20} max={2000} step={10} onChange={(pool_size) => edit({ pool_size })} />
            <span class="settings__help">The newest unread items the ranker picks from.</span>
          </div>
        </fieldset>

        <div class="settings__prefs-actions">
          <button class="btn btn--primary btn--sm" type="submit" disabled={busy}>Save ranking</button>
          <button
            class="btn btn--ghost btn--sm"
            type="button"
            disabled={busy}
            onClick={() => void run(resetRanking, 'Defaults restored. Your swipes are kept.')}
          >
            Reset to defaults
          </button>
          {status && (
            <span class={`settings__token-copy-state${status.error ? ' settings__token-copy-state--error' : ''}`}>{status.text}</span>
          )}
        </div>
      </form>

      <h3 class="settings__prefs-label ranking__subheading">
        Learned signals ({review.signals.length}) from {review.feedback.total} swipe{review.feedback.total === 1 ? '' : 's'}
      </h3>
      {review.signals.length === 0 ? (
        <p class="settings__help">Nothing learned yet. Swipe some cards.</p>
      ) : (
        <ul class="ranking__signals">
          {signals.map((s) => (
            <li key={s.key} class={`ranking__signal${s.status === 'active' ? '' : ' ranking__signal--inactive'}`}>
              <span class="ranking__signal-kind">{KIND_LABEL[s.kind]}</span>
              <span class="ranking__signal-label">
                {s.label}
                {s.source && s.kind === 'author' ? ` (${s.source})` : ''}
                {statusText(s, review.config.evidence.min_signal_swipes) && (
                  <span class="ranking__signal-status"> · {statusText(s, review.config.evidence.min_signal_swipes)}</span>
                )}
              </span>
              <span class="ranking__signal-score" title={`${s.likes} liked · ${s.saves} saved · ${s.dislikes} passed`}>
                {s.score >= 0 ? '+' : ''}{s.score.toFixed(2)}
              </span>
              <button class="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => toggleMute(s.key)}>
                {s.muted ? 'Unmute' : 'Mute'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {review.signals.length > SIGNALS_SHOWN && (
        <button class="btn btn--ghost btn--sm" type="button" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${review.signals.length}`}
        </button>
      )}
    </section>
  );
}
