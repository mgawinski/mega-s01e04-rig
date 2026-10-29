import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow, DigestStatus, NightDigest } from '../src/digest/types.js';

const night = '2026-10-27';
const firstAt = '2026-10-27T01:10:00+02:00';
const lastAt = '2026-10-27T01:20:00+02:00';
const endpoints = ['/digest', '/api/digest'];

function entry(job: string, overrides: {
  at?: string;
  status?: DigestStatus;
  owner?: string | null;
  error?: string;
} = {}) {
  return { at: firstAt, job, status: 'ok', owner: 'reader', ...overrides };
}

function row(job: string, overrides: Partial<DigestRow> = {}): DigestRow {
  return {
    job, owner: 'reader', runs: 1, retries: 0, lastStatus: 'ok',
    lastError: null, firstAt, lastAt: firstAt, ...overrides,
  };
}

function cellText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity: string, name: string) => {
      if (name.startsWith('#')) {
        const hex = name[1].toLowerCase() === 'x';
        return String.fromCodePoint(Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      return named[name.toLowerCase()] ?? entity;
    },
  ).trim();
}

// Inspect actual data rows, not header wording, column positions or surrounding layout.
function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].flatMap(([markup]) => {
    // Data rows may label jobs with a row-header th; skip only header-only rows.
    if (!/<td\b/i.test(markup)) return [];
    const cells = [...markup.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((match) => cellText(match[2]));
    return cells.length ? [{ markup, cells }] : [];
  });
}

function jobRow(html: string, job: string) {
  const matches = tableRows(html).filter(({ cells }) => cells.includes(job));
  expect(matches, `one table row for ${job}`).toHaveLength(1);
  return matches[0];
}

function isWarn(markup: string): boolean {
  return [...markup.matchAll(/\bclass=["']([^"']*)["']/gi)]
    .some((match) => match[1].split(/\s+/).includes('warn'));
}

describe('digest routes', () => {
  let tempDir: string;
  let config: RigConfig;

  beforeEach(() => {
    tempDir = mkdtempSync('/tmp/opencode/rig-digest-');
    const runsDir = join(tempDir, 'runs');
    mkdirSync(runsDir);
    config = { adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir };
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function writeNight(lines: Array<ReturnType<typeof entry> | string>) {
    writeFileSync(join(config.runsDir, `${night}.jsonl`),
      lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
  }

  it('serves HTML and JSON with the same sorted jobs and aggregated data', async () => {
    writeNight([
      entry('zulu'),
      entry('alpha', { status: 'retry', error: 'try again' }),
      entry('middle', { owner: 'night-reader' }),
      entry('alpha', { at: lastAt }),
    ]);
    const app = createApp(config);
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');

    const digest: NightDigest = await jsonResponse.json();
    expect(digest).toEqual({
      rows: [
        row('alpha', { runs: 2, retries: 1, lastAt }),
        row('middle', { owner: 'night-reader' }),
        row('zulu'),
      ],
      badLineCount: 0,
    });
    const html = await htmlResponse.text();
    const jobs = digest.rows.map(({ job }) => job);
    expect(tableRows(html).map(({ cells }) => cells.find((cell) => jobs.includes(cell))))
      .toEqual(jobs);
    expect(jobRow(html, 'middle').cells).toContain('night-reader');
  });

  it.each(endpoints)('%s returns 404 for a missing night', async (endpoint) => {
    const response = await createApp(config).request(`${endpoint}/${night}`);
    expect(response.status).toBe(404);
  });

  it('renders an empty night as nothing ran and returns an empty JSON digest', async () => {
    writeNight([]);
    const app = createApp(config);
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toMatch(/nothing ran/i);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({ rows: [], badLineCount: 0 });
  });

  it('counts malformed lines without losing valid jobs or treating blank lines as bad', async () => {
    writeNight([entry('before'), '{broken JSON', '', '   ', entry('after')]);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [row('after'), row('before')], badLineCount: 1,
    });
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(jobRow(html, 'before')).toBeDefined();
    expect(jobRow(html, 'after')).toBeDefined();
  });

  it('keeps a null owner in JSON and displays an em dash in its job row', async () => {
    writeNight([entry('unowned', { owner: null })]);
    const app = createApp(config);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jobRow(await htmlResponse.text(), 'unowned').cells).toContain('—');
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({ rows: [row('unowned', { owner: null })], badLineCount: 0 });
  });

  it('marks three-or-more retries and final failures, but not two retries', async () => {
    writeNight([
      ...Array.from({ length: 3 }, () => entry('retry-warning', { status: 'retry' })),
      entry('retry-warning', { at: lastAt }),
      ...Array.from({ length: 2 }, () => entry('below-threshold', { status: 'retry' })),
      entry('below-threshold', { at: lastAt }),
      entry('failed', { at: lastAt, status: 'fail', error: 'disk full' }),
    ]);
    const response = await createApp(config).request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(isWarn(jobRow(html, 'retry-warning').markup)).toBe(true);
    expect(isWarn(jobRow(html, 'failed').markup)).toBe(true);
    expect(isWarn(jobRow(html, 'below-threshold').markup)).toBe(false);
    expect(jobRow(html, 'failed').cells).toContain('disk full');
  });

  it('preserves first and last timestamps, including their original offsets', async () => {
    // Later on the clock, but earlier in absolute time than the last entry.
    const earliest = '2026-10-27T02:10:00+03:00';
    const latest = '2026-10-27T01:20:00+01:00';
    writeNight([
      entry('offsets', { at: latest }),
      entry('offsets', { at: earliest, status: 'retry' }),
    ]);
    const app = createApp(config);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const cells = jobRow(await htmlResponse.text(), 'offsets').cells;
    expect(cells.join(' ')).toContain(earliest);
    expect(cells.join(' ')).toContain(latest);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [row('offsets', { runs: 2, retries: 1, firstAt: earliest, lastAt: latest })],
      badLineCount: 0,
    });
  });

  it('escapes hostile job and error text in HTML while preserving JSON values', async () => {
    const job = '<script>alert(1)</script>&job';
    const error = '<img src=x onerror=alert(2)>&error';
    writeNight([entry(job, { status: 'fail', error })]);
    const app = createApp(config);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).not.toContain(job);
    expect(html).not.toContain(error);
    expect(jobRow(html, job).cells).toContain(error);
    expect(html).not.toMatch(/<script\b|<img\b/i);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [row(job, { lastStatus: 'fail', lastError: error })], badLineCount: 0,
    });
  });

  it.each(endpoints)('%s does not read outside the runs directory for an invalid night', async (endpoint) => {
    const sentinel = 'outside-runs-secret-job';
    writeFileSync(join(tempDir, 'outside.jsonl'), JSON.stringify(entry(sentinel)));
    const app = createApp(config);
    for (const invalidNight of ['not-a-night', '..%2Foutside', '2026-02-31', '2026-13-01']) {
      const response = await app.request(`${endpoint}/${invalidNight}`);
      expect([400, 404]).toContain(response.status);
      expect(await response.text()).not.toContain(sentinel);
    }
  });
});
