import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { NightDigest, ReadNight } from '../src/digest/types.js';
import { registerDigestJson } from '../src/routes/digest-json.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'test-runs' };

function appWith(read: ReadNight) {
  const app = new Hono();
  registerDigestJson(app, config, read);
  return app;
}

describe('digest JSON', () => {
  it('returns the shared reader rows in their existing job order', async () => {
    const digest: NightDigest = {
      rows: ['A-job', 'a-job', 'z-job'].map((job) => ({
        job,
        owner: null,
        runs: 4,
        retries: 3,
        lastStatus: 'fail',
        lastError: 'still failing',
        firstAt: '2026-10-28T01:00:00+01:00',
        lastAt: '2026-10-28T02:00:00+01:00',
      })),
      badLineCount: 1,
    };
    const read = vi.fn<ReadNight>(() => digest);
    const res = await appWith(read).request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(digest);
    expect(read).toHaveBeenCalledExactlyOnceWith(config.runsDir, '2026-10-28');
  });

  it('returns 404 for a missing night', async () => {
    const res = await appWith(() => null).request('/api/digest/2026-10-28');
    expect(res.status).toBe(404);
  });

  it.each([0, 2])('returns empty rows with badLineCount %i as a success', async (badLineCount) => {
    const digest = { rows: [], badLineCount };
    const res = await appWith(() => digest).request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(digest);
  });

  it.each(['2026-1-28', '2026-10-28.jsonl', 'not-a-night', '2026-10-28%2Fsecret', '%2E%2E%2Fsecret'])(
    'rejects invalid night %s before reading',
    async (night) => {
      const read = vi.fn<ReadNight>(() => null);
      const res = await appWith(read).request(`/api/digest/${night}`);

      expect(res.status).toBe(404);
      expect(read).not.toHaveBeenCalled();
    },
  );
});
