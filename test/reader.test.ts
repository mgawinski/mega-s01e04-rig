import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';
import type { ReadNight } from '../src/digest/types.js';

const night = '2026-10-28';
const base = { at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
const temporaryDirs: string[] = [];

function runsDir(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  temporaryDirs.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, `${night}.jsonl`), contents);
  return dir;
}

function jsonLines(entries: unknown[]): string {
  return entries.map(entry => JSON.stringify(entry)).join('\n');
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('implements the shared synchronous reader contract on the read-only fixture', () => {
    const reader: ReadNight = readNight;
    const result = reader('runs', night);
    expect(result?.badLineCount).toBe(1);
    expect(result?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(result?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: null });
    expect(result?.rows[2]).toMatchObject({
      runs: 8, retries: 1, lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(result?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('reads the other existing night without modifying the fixture', () => {
    const result = readNight('runs', '2026-10-27');
    expect(result?.badLineCount).toBe(0);
    expect(result?.rows.map(row => row.job)).toEqual([
      'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result?.rows.reduce((total, row) => total + row.runs, 0)).toBe(7);
    expect(result?.rows.every(row => row.lastStatus === 'ok' && row.retries === 0)).toBe(true);
  });

  it('distinguishes missing, empty, blank and entirely invalid nights', () => {
    expect(readNight(runsDir(), night)).toBeNull();
    expect(readNight(runsDir(''), night)).toEqual({ rows: [], badLineCount: 0 });
    expect(readNight(runsDir('\n \t\r\n\n'), night)).toEqual({ rows: [], badLineCount: 0 });
    expect(readNight(runsDir('bad\n\nnull\r\n'), night)).toEqual({ rows: [], badLineCount: 2 });
  });

  it('selects chronological endpoints across offsets rather than file or string order', () => {
    const first = '2026-10-29T01:30:00+02:00';
    const last = '2026-10-28T23:45:00Z';
    const result = readNight(runsDir(jsonLines([
      { ...base, at: last, status: 'fail', owner: null, error: 'latest failure' },
      { ...base, at: first, status: 'retry', error: 'earliest retry' },
      { ...base, at: '2026-10-29T00:40:00+01:00', error: 'middle error' },
    ])), night);
    expect(result).toEqual({ badLineCount: 0, rows: [{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'fail',
      lastError: 'latest failure', firstAt: first, lastAt: last,
    }] });
  });

  it('breaks timestamp ties in file order and clears errors on the last entry', () => {
    const result = readNight(runsDir(jsonLines([
      { ...base, status: 'fail', error: 'old error' },
      { ...base, at: '2026-10-29T00:00:00Z', owner: null },
    ])), night);
    expect(result?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: null,
      firstAt: base.at, lastAt: '2026-10-29T00:00:00Z',
    });
  });

  it('orders fractional seconds without dropping precision', () => {
    const result = readNight(runsDir(jsonLines([
      { ...base, at: '2026-10-29T00:00:00.0002Z', status: 'fail', error: '' },
      { ...base, at: '2026-10-29T00:00:00.0001Z' },
    ])), night);
    expect(result?.rows[0]).toMatchObject({
      firstAt: '2026-10-29T00:00:00.0001Z', lastAt: '2026-10-29T00:00:00.0002Z',
      lastStatus: 'fail', lastError: '',
    });
  });

  it('sorts jobs case-sensitively and safely accepts object-property-like job names', () => {
    const names = ['z', '__proto__', 'a', 'A', 'constructor'];
    const dir = runsDir(jsonLines(names.map(job => ({ ...base, job }))));
    const expected = ['A', '__proto__', 'a', 'constructor', 'z'];
    expect(readNight(dir, night)?.rows.map(row => row.job)).toEqual(expected);
    expect(readNight(dir, night)?.rows.map(row => row.job)).toEqual(expected);
  });

  it('counts each nonblank malformed or schema-invalid line without losing good rows', () => {
    const invalid: unknown[] = [
      null, [], true, 1, 'text', {},
      { ...base, at: null }, { ...base, at: 'not a date' },
      { ...base, at: '2026-10-29T01:00:00' },
      { ...base, at: '2026-02-30T01:00:00Z' },
      { ...base, at: '2026-10-29T24:00:00Z' },
      { ...base, at: '2026-10-29T01:60:00Z' },
      { ...base, at: '2026-10-29T01:00:60Z' },
      { ...base, at: '2026-10-29T01:00:00+24:00' },
      { ...base, at: '2026-10-29T01:00:00+01:60' },
      { ...base, job: 1 }, { ...base, status: 'unknown' },
      { ...base, owner: false }, { at: base.at, job: 'job', status: 'ok' },
      { ...base, error: null }, { ...base, error: 1 },
    ];
    const contents = `\n${JSON.stringify(base)}\r\n{bad json\n \t\n${jsonLines(invalid)}\n${JSON.stringify(base)}\n`;
    const result = readNight(runsDir(contents), night);
    expect(result?.badLineCount).toBe(invalid.length + 1);
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].runs).toBe(2);
  });

  it.each([
    '../2026-10-28', '/2026-10-28', '..\\2026-10-28', '2026-10-28/../2026-10-28',
    '2026-10-28.jsonl', '%2e%2e%2f2026-10-28', '2026-10-28\0',
    '', '2026-1-28', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01',
  ])('rejects invalid night %j before attempting filesystem access', value => {
    expect(() => readNight('/nonexistent/rig-reader', value)).toThrow(RangeError);
  });

  it('accepts a leap-day night', () => {
    const dir = runsDir();
    writeFileSync(join(dir, '2024-02-29.jsonl'), JSON.stringify({ ...base, at: '2024-02-29T12:00:00Z' }));
    expect(readNight(dir, '2024-02-29')?.rows).toHaveLength(1);
  });

  it('propagates filesystem errors other than a missing file', () => {
    const dir = runsDir();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
