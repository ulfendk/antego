import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');

export const config = {
  port: Number(process.env.PORT ?? 2567),
  appVersion: process.env.APP_VERSION ?? 'dev',
  /** Built client (Vite output, including the pre-rendered voice lines and models). */
  clientDir: resolve(process.env.CLIENT_DIR ?? resolve(repoRoot, 'packages/client/dist')),
};
