// Regenerates src/generated/lines.ts (also done by the Vite plugin): node build/gen-lines.ts
import { fileURLToPath } from 'node:url';
import { generateLines } from './lines.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
generateLines(here('../../../content/lines'), here('../src/generated/lines.ts'));
