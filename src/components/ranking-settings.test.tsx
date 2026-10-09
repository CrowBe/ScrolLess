import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

const api = { getRanking: vi.fn(), updateRanking: vi.fn(), resetRanking: vi.fn() };
vi.mock('../api', () => ({
  getRanking: (...a: unknown[]) => api.getRanking(...a),
  updateRanking: (...a: unknown[]) => api.updateRanking(...a),
  resetRanking: (...a: unknown[]) => api.resetRanking(...a),
}));

import { RankingSection } from './ranking-settings';

const config = {
  signals: {
    source: { enabled: true, weight: 1 },
    author: { enabled: true, weight: 1.5 },
    type: { enabled: true, weight: 0.5 },
    tag: { enabled: true, weight: 1 },
  },
  verdicts: { like: 1, save: 2, dislike: -1 },
  memory: { decay: true, half_life_days: 45 },
  prior: 2,
  freshness: { enabled: true, weight: 0.3, half_life_hours: 48 },
  discovery: { enabled: true, share: 0.2 },
  pool_size: 500,
  muted_features: [] as string[],
};

function review(overrides: Partial<typeof config> = {}) {
  const c = { ...config, ...overrides };
  return {
    ranking_version: 'rank2',
    config: c,
    feedback: { total: 3, likes: 2, saves: 1, dislikes: 0, latest_at: null },
    summary: 'Based on 3 swipes. Leans toward: authors Ada (news).',
    signals: [{
      key: 'author:news/ada', kind: 'author', label: 'Ada', source: 'news', likes: 2, saves: 1, dislikes: 0,
      evidence: 3, score: 0.8, muted: c.muted_features.includes('author:news/ada'), active: !c.muted_features.includes('author:news/ada'),
    }],
  };
}

describe('RankingSection', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getRanking.mockResolvedValue(review());
  });

  it('shows the config, the summary and every learned signal', async () => {
    render(<RankingSection />);
    expect(await screen.findByText(/Leans toward: authors Ada/)).toBeInTheDocument();
    expect(screen.getByText('Ada (news)')).toBeInTheDocument();
    expect(screen.getByText('+0.80')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Author' })).toBeChecked();
  });

  it('saves edited weights and switched-off parts', async () => {
    api.updateRanking.mockImplementation(async (patch) => review(patch));
    render(<RankingSection />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Topics' }));
    fireEvent.input(screen.getByDisplayValue('1.5'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Discovery cards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save ranking' }));
    await waitFor(() => expect(api.updateRanking).toHaveBeenCalled());
    const patch = api.updateRanking.mock.calls[0][0];
    expect(patch.signals.tag.enabled).toBe(false);
    expect(patch.signals.author).toEqual({ enabled: true, weight: 3 });
    expect(patch.discovery.enabled).toBe(false);
    expect(await screen.findByText('Ranking saved.')).toBeInTheDocument();
  });

  it('mutes a signal without discarding unsaved edits, and resets', async () => {
    api.updateRanking.mockResolvedValue(review({ muted_features: ['author:news/ada'] }));
    api.resetRanking.mockResolvedValue(review());
    render(<RankingSection />);
    fireEvent.input(await screen.findByDisplayValue('45'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(api.updateRanking).toHaveBeenCalledWith({ muted_features: ['author:news/ada'] }));
    expect(await screen.findByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(await screen.findByText(/Defaults restored/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('45')).toBeInTheDocument();
  });
});
