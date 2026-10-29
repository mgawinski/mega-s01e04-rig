import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type Entry = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}

function validTimestamp(at: string): boolean {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(at);
  return parts !== null
    && validDate(parts[1])
    && Number(parts[2]) < 24
    && Number(parts[3]) < 60
    && Number(parts[4]) < 60
    && (parts[5] === undefined || (Number(parts[6]) < 24 && Number(parts[7]) < 60))
    && Number.isFinite(Date.parse(at));
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.at === 'string' && validTimestamp(entry.at)
    && typeof entry.job === 'string'
    && (entry.status === 'ok' || entry.status === 'retry' || entry.status === 'fail')
    && (entry.owner === null || typeof entry.owner === 'string')
    && (!Object.hasOwn(entry, 'error') || typeof entry.error === 'string');
}

function compareTimes(left: string, right: string): number {
  const difference = Date.parse(left) - Date.parse(right);
  if (difference !== 0) return difference;
  // Date.parse truncates fractions beyond milliseconds; retain their ordering too.
  const fraction = (at: string) => (/\.(\d+)/.exec(at)?.[1] ?? '').replace(/0+$/, '');
  const a = fraction(left);
  const b = fraction(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export const readNight: ReadNight = (runsDir, night) => {
  // Only a calendar date can become a filename, never an arbitrary path.
  if (!validDate(night)) throw new RangeError('night must be a valid YYYY-MM-DD date');

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, DigestRow>();
  let badLineCount = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      badLineCount++;
      continue;
    }
    if (!isEntry(entry)) {
      badLineCount++;
      continue;
    }

    const row = jobs.get(entry.job);
    if (!row) {
      jobs.set(entry.job, {
        job: entry.job,
        owner: entry.owner,
        runs: 1,
        retries: entry.status === 'retry' ? 1 : 0,
        lastStatus: entry.status,
        lastError: entry.error ?? null,
        firstAt: entry.at,
        lastAt: entry.at,
      });
      continue;
    }

    row.runs++;
    if (entry.status === 'retry') row.retries++;
    if (compareTimes(entry.at, row.firstAt) < 0) row.firstAt = entry.at;
    // Later file entries win ties, keeping all last-entry fields together.
    if (compareTimes(entry.at, row.lastAt) >= 0) {
      row.lastAt = entry.at;
      row.owner = entry.owner;
      row.lastStatus = entry.status;
      row.lastError = entry.error ?? null;
    }
  }

  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { rows, badLineCount };
};
