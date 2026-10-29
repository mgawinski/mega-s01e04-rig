import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { DigestRow, NightDigest } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';
import { Layout } from '../src/views/layout.js';

const row: DigestRow = {
  job: 'alpha',
  owner: null,
  runs: 4,
  retries: 3,
  lastStatus: 'fail',
  lastError: null,
  firstAt: '2026-10-28T21:00:00+02:00',
  lastAt: '2026-10-29T01:00:00+02:00',
};

// Exercise the view without importing the reader, which is supplied by issue #2.
async function render(digest: NightDigest) {
  const app = new Hono();
  app.get('/', (c) => c.html(
    <Layout title="digest" lane={{ id: 'test-lane', marker: 'TEST-MARKER' }}>
      <DigestPage night="2026-10-28" digest={digest} />
    </Layout>,
  ));
  return (await app.request('/')).text();
}

describe('digest page view', () => {
  it('renders every field in job order without mutating reader rows', async () => {
    const rows = [{ ...row, job: 'zebra', owner: 'rook', lastError: 'failed to run' }, row];
    const html = await render({ rows, badLineCount: 1 });

    expect(html.indexOf('>alpha<')).toBeLessThan(html.indexOf('>zebra<'));
    expect(rows[0].job).toBe('zebra');
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.match(/<th scope="row">/g)).toHaveLength(2);
    expect(html).toContain('<td>rook</td>');
    expect(html).toContain('<td>4</td>');
    expect(html).toContain('<td>failed to run</td>');
    expect(html.match(/<td>—<\/td>/g)).toHaveLength(2);
    expect(html).toContain(row.firstAt);
    expect(html).toContain(row.lastAt);
    expect(html).toContain('<p class="warn">bad lines: 1</p>');
    expect(html).toContain('test-lane');
    expect(html).toContain('TEST-MARKER');
  });

  it('marks three or more retries and final failures independently', async () => {
    const html = await render({
      rows: [
        { ...row, job: 'recovered', lastStatus: 'ok' },
        { ...row, job: 'failed', retries: 2 },
      ],
      badLineCount: 0,
    });

    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">fail</td>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<td>ok</td>');
    expect(html).not.toContain('<td class="warn">2</td>');
    expect(html).not.toContain('<td class="warn">ok</td>');
  });

  it('shows nothing ran and the bad-line count for empty results', async () => {
    for (const badLineCount of [0, 2]) {
      const html = await render({ rows: [], badLineCount });
      expect(html).toContain('nothing ran');
      expect(html).toContain(`bad lines: ${badLineCount}`);
      expect(html).not.toContain('<table>');
    }
  });

  it('escapes log content and renders no client scripts', async () => {
    const unsafe = '<script>alert("log")</script>';
    const html = await render({
      rows: [{ ...row, job: unsafe, owner: unsafe, lastError: unsafe }],
      badLineCount: 0,
    });

    expect(html).not.toContain('<script');
    expect(html.match(/&lt;script&gt;/g)).toHaveLength(3);
    expect(html).not.toContain(unsafe);
  });
});
