import { useState } from 'preact/hooks';
import { addSource } from '../api';

interface Props {
  onAdded: () => void;
}

export function AddSourceForm({ onAdded }: Props) {
  const [name, setName] = useState('');
  const [urls, setUrls] = useState('');
  const [maxItems, setMaxItems] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setSubmitted(true);
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Source name is required');
      return;
    }

    const urlList = urls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (urlList.length === 0) {
      setError('At least one URL is required');
      return;
    }

    // Basic URL validation
    for (const u of urlList) {
      try {
        new URL(u);
      } catch {
        setError(`Invalid URL: ${u}`);
        return;
      }
    }

    setBusy(true);
    try {
      await addSource({
        name: trimmedName.toLowerCase(),
        urls: urlList,
        max_items: maxItems ? parseInt(maxItems, 10) : undefined,
      });
      setName('');
      setUrls('');
      setMaxItems('');
      setSubmitted(false);
      setError('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="settings__section add-source-form" onSubmit={handleSubmit}>
      <h2 class="settings__heading">Add Source</h2>

      <label class="form-label" for="source-name">Name</label>
      <input
        id="source-name"
        class="form-input"
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder="e.g. youtube, reddit, custom-blog"
      />

      <label class="form-label" for="source-urls">URLs (one per line)</label>
      <textarea
        id="source-urls"
        class="form-textarea"
        value={urls}
        onInput={(e) => setUrls((e.target as HTMLTextAreaElement).value)}
        rows={3}
        placeholder="https://example.com/feed"
      />

      <label class="form-label" for="source-max">Max items (optional)</label>
      <input
        id="source-max"
        class="form-input"
        type="number"
        value={maxItems}
        onInput={(e) => setMaxItems((e.target as HTMLInputElement).value)}
        min="1"
        placeholder="Default"
      />

      {submitted && error && <p class="form-error">{error}</p>}

      <button class="btn btn--primary" type="submit" disabled={busy}>
        {busy ? 'Adding...' : 'Add Source'}
      </button>
    </form>
  );
}
