import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestStatus } from './types.js';

export type NightStatusCounts = Record<DigestStatus, number> & {
  badLineCount: number;
};

// Count events, not final job statuses: a retry followed by ok contributes to both.
export function countStatuses(runsDir: string, night: string): NightStatusCounts | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const counts: NightStatusCounts = { ok: 0, retry: 0, fail: 0, badLineCount: 0 };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      counts.badLineCount++;
      continue;
    }

    if (
      typeof entry !== 'object' || entry === null || Array.isArray(entry) ||
      !('at' in entry) || typeof entry.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.at) ||
      !Number.isFinite(Date.parse(entry.at)) ||
      !('job' in entry) || typeof entry.job !== 'string' ||
      !('owner' in entry) || (entry.owner !== null && typeof entry.owner !== 'string') ||
      !('status' in entry) ||
      (entry.status !== 'ok' && entry.status !== 'retry' && entry.status !== 'fail') ||
      ('error' in entry && typeof entry.error !== 'string')
    ) {
      counts.badLineCount++;
      continue;
    }
    counts[entry.status]++;
  }
  return counts;
}
