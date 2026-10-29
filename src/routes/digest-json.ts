import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from '../digest/read-night.js';
import type { ReadNight } from '../digest/types.js';

export function registerDigestJson(app: Hono, config: RigConfig, read: ReadNight = readNight) {
  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return c.notFound();

    const digest = read(config.runsDir, night);
    if (digest === null) return c.notFound();

    return c.json(digest);
  });
}
