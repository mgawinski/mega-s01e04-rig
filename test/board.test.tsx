import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { countStatuses } from '../src/digest/count-statuses.js';
import { nightsOnDisk, readStatus } from '../src/status.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };
const event = { at: '2026-10-28T23:00:02+01:00', job: 'sync', status: 'ok', owner: 'rook' };

describe('board night links and event counts', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync('/tmp/opencode/rig-board-');
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(night: string, entries: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n'));
  }

  it('counts all valid events, including retries before success and null owners', () => {
    writeNight('2026-10-28', [
      { ...event, status: 'retry' },
      { ...event, status: 'retry' },
      event,
      { ...event, job: 'ownerless', owner: null, status: 'fail' },
    ]);
    expect(countStatuses(runsDir, '2026-10-28')).toEqual({ ok: 1, retry: 2, fail: 1, badLineCount: 0 });
  });

  it('counts malformed and invalid entries without crashing or treating blanks as bad', () => {
    const { owner: _owner, ...missingOwner } = event;
    const invalid = [
      null, [], 12, {}, missingOwner,
      { ...event, owner: 42 },
      { ...event, job: null },
      { ...event, status: 'unknown' },
      { ...event, error: null },
      { ...event, at: 'not a time' },
      { ...event, at: '2026-10-28T23:00:02' },
    ];
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      '', '  ', '{broken', ...invalid.map((entry) => JSON.stringify(entry)), JSON.stringify(event), '',
    ].join('\r\n'));
    expect(countStatuses(runsDir, '2026-10-28')).toEqual({ ok: 1, retry: 0, fail: 0, badLineCount: 12 });
  });

  it('returns zero counts for an empty night and null for a missing or unsafe night', () => {
    writeNight('2026-10-28', []);
    expect(countStatuses(runsDir, '2026-10-28')).toEqual({ ok: 0, retry: 0, fail: 0, badLineCount: 0 });
    expect(countStatuses(runsDir, '2026-10-27')).toBeNull();
    expect(countStatuses(runsDir, '../2026-10-28')).toBeNull();
  });

  it('links each night newest first with clearly labeled counts, including an empty night', async () => {
    writeNight('2026-10-27', []);
    writeNight('2026-10-28', [event, { ...event, status: 'retry', owner: null }, { ...event, status: 'fail' }, null]);
    writeFileSync(join(runsDir, 'notes.txt'), 'not a night');
    mkdirSync(join(runsDir, '2026-10-29.jsonl'));

    const res = await createApp({ ...config, runsDir }).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('valid log events: ok 1 · retry 1 · fail 1 · invalid lines: 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('valid log events: ok 0 · retry 0 · fail 0 · invalid lines: 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toContain('/digest/2026-10-29');
    expect(html).not.toContain('<script');
    expect(nightsOnDisk(runsDir)).toEqual(['2026-10-28', '2026-10-27']);
    expect(readStatus({ ...config, runsDir }).nights).toEqual(['2026-10-28', '2026-10-27']);
  });

  it('keeps the empty-board message for an empty or missing runs directory', async () => {
    for (const directory of [runsDir, join(runsDir, 'missing')]) {
      const res = await createApp({ ...config, runsDir: directory }).request('/');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('nothing in runs/');
    }
  });

  it('shows both read-only fixture nights with event counts', async () => {
    const res = await createApp({ ...config, runsDir: 'runs' }).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const night of nightsOnDisk('runs')) {
      expect(html).toContain(`<a href="/digest/${night}">${night}</a>`);
    }
    expect(countStatuses('runs', '2026-10-27')).toEqual({ ok: 7, retry: 0, fail: 0, badLineCount: 0 });
    expect(countStatuses('runs', '2026-10-28')).toEqual({ ok: 10, retry: 4, fail: 1, badLineCount: 1 });
  });
});
