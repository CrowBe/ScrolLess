import { useState } from 'preact/hooks';
import type { UserSource } from '../types';
import { updateSource, deleteSource } from '../api';
import { displayName } from '../source-labels';

interface Props {
  sources: UserSource[];
  onRefresh: () => void;
}

export function SourceList({ sources, onRefresh }: Props) {
  if (sources.length === 0) {
    return (
      <div class="settings__section">
        <p class="settings__help">No sources configured yet. Add one below.</p>
      </div>
    );
  }

  return (
    <div class="source-cards">
      {sources.map((s) => (
        <SourceCard key={s.name} source={s} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function SourceCard({ source, onRefresh }: { source: UserSource; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [urls, setUrls] = useState(source.urls.join('\n'));
  const [maxItems, setMaxItems] = useState(source.max_items?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleToggle() {
    setBusy(true);
    try {
      await updateSource(source.name, { enabled: source.enabled ? 0 : 1 });
      onRefresh();
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const urlList = urls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (urlList.length === 0) return;
    setBusy(true);
    try {
      await updateSource(source.name, {
        urls: urlList,
        max_items: maxItems ? parseInt(maxItems, 10) : null,
      });
      setEditing(false);
      onRefresh();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteSource(source.name);
      onRefresh();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div class={`settings__section source-card${source.enabled ? '' : ' source-card--disabled'}`}>
      <div class="source-card__header">
        <span class="source-card__name">{displayName(source.name)}</span>
        <button
          class={`toggle${source.enabled ? ' toggle--on' : ''}`}
          onClick={handleToggle}
          disabled={busy}
          aria-label={source.enabled ? 'Disable source' : 'Enable source'}
        >
          <span class="toggle__knob" />
        </button>
      </div>

      {!editing ? (
        <>
          <div class="source-card__urls">
            {source.urls.map((u) => (
              <span key={u} class="source-card__url">{u}</span>
            ))}
          </div>
          {source.max_items != null && (
            <span class="source-card__max">Max items: {source.max_items}</span>
          )}
          <div class="source-card__actions">
            <button class="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
              <span class="material-symbols-outlined" style="font-size:1rem">edit</span>
              Edit
            </button>
            {!confirmDelete ? (
              <button class="btn btn--ghost btn--sm source-card__delete" onClick={() => setConfirmDelete(true)}>
                <span class="material-symbols-outlined" style="font-size:1rem">delete</span>
                Delete
              </button>
            ) : (
              <div class="source-card__confirm">
                <span class="source-card__confirm-text">Delete?</span>
                <button class="btn btn--primary btn--sm" onClick={handleDelete} disabled={busy}>Yes</button>
                <button class="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(false)}>No</button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div class="source-card__edit">
          <label class="form-label">URLs (one per line)</label>
          <textarea
            class="form-textarea"
            value={urls}
            onInput={(e) => setUrls((e.target as HTMLTextAreaElement).value)}
            rows={3}
          />
          <label class="form-label">Max items (optional)</label>
          <input
            class="form-input"
            type="number"
            value={maxItems}
            onInput={(e) => setMaxItems((e.target as HTMLInputElement).value)}
            min="1"
            placeholder="Default"
          />
          <div class="source-card__actions">
            <button class="btn btn--primary btn--sm" onClick={handleSave} disabled={busy}>Save</button>
            <button class="btn btn--ghost btn--sm" onClick={() => { setEditing(false); setUrls(source.urls.join('\n')); setMaxItems(source.max_items?.toString() ?? ''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
