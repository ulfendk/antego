import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LINES } from '../generated/lines.js';

const dir = fileURLToPath(new URL('../../public/voice/', import.meta.url));

describe('voice lines', () => {
  it('has a rendered clip for every text the game shows (run `npm run voice` after editing content/lines)', () => {
    const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as Record<
      string,
      { file: string; text: string }
    >;
    const missing = Object.keys(LINES).filter((id) => !manifest[id]);
    expect(missing).toEqual([]);
    const stale = Object.entries(LINES).filter(
      ([id, text]) => manifest[id] && manifest[id].text !== text,
    );
    expect(stale.map(([id]) => id)).toEqual([]);
    const noFile = Object.values(manifest).filter((m) => !existsSync(`${dir}${m.file}`));
    expect(noFile).toEqual([]);
  });
});
