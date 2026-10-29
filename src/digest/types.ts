export type DigestStatus = 'ok' | 'retry' | 'fail';

// One row per job, aggregated from valid log entries.
export type DigestRow = {
  job: string;
  // Owner on the last entry; null is displayed as —, not dropped.
  owner: string | null;
  // Total entries, including retries and failures.
  runs: number;
  // Number of entries whose status is retry.
  retries: number;
  lastStatus: DigestStatus;
  // Error on the last entry, or null when that entry has no error.
  lastError: string | null;
  // Earliest/latest instants, retaining the original timestamp and offset.
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  // Sorted by job (ascending, case-sensitive) for both HTML and JSON consumers.
  rows: DigestRow[];
  // Non-blank lines that fail JSON parsing or entry validation; never fatal.
  badLineCount: number;
};

/**
 * Contract for the reader implementation; this module exports types only.
 * Reads runsDir/<night>.jsonl synchronously (night is YYYY-MM-DD).
 * Returns null only for a missing file; other filesystem errors propagate.
 * An empty/blank file returns { rows: [], badLineCount: 0 }; a file with only
 * bad lines returns empty rows with a positive badLineCount, not null.
 * Entries require at (a timestamp with offset), job (string), status
 * (DigestStatus), owner (string or null), and optionally error (string).
 * Blank lines are ignored. Invalid entries are counted and skipped.
 * First/last refer to chronological order, with file order breaking ties;
 * owner, lastStatus and lastError all come from the same last entry.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
