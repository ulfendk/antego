import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Plugin } from 'vite';

interface LineFile {
  id: string;
  lines: { id: string; speaker: string; text: string; say?: string }[];
}

/**
 * Generates src/generated/lines.ts from content/lines/*.yaml: every text the game shows,
 * keyed as "<file>.<line>", so a missing line is a type error (and every line can be voiced).
 */
export function linesPlugin(contentDir: string, outFile: string): Plugin {
  const generate = () => {
    const entries: string[] = [];
    for (const f of readdirSync(contentDir)
      .filter((n) => n.endsWith('.yaml'))
      .sort()) {
      const doc = parse(readFileSync(join(contentDir, f), 'utf8')) as LineFile;
      for (const line of doc.lines) {
        const text = line.text.replace(/\s+/g, ' ').trim();
        entries.push(`  ${JSON.stringify(`${doc.id}.${line.id}`)}: ${JSON.stringify(text)},`);
      }
    }
    const src = `// Generated from content/lines/*.yaml by build/lines.ts – do not edit.\nexport const LINES = {\n${entries.join('\n')}\n} as const;\n\nexport type LineId = keyof typeof LINES;\n`;
    if (!existsSync(outFile) || readFileSync(outFile, 'utf8') !== src) writeFileSync(outFile, src);
  };
  return {
    name: 'antego-lines',
    buildStart() {
      generate();
      this.addWatchFile(contentDir);
    },
    configureServer(server) {
      server.watcher.add(contentDir);
      server.watcher.on('change', (file) => {
        if (file.startsWith(contentDir)) generate();
      });
    },
  };
}
