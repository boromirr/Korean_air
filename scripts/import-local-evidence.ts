/** Import only already-observed public calendars. This script never opens a browser. */
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parseCalendarHtml } from '../src/parser.js';
import { parseSourceUpdatedAt } from '../src/collector.js';

const root = process.cwd();
const destination = path.join(root, 'data', 'local');
await mkdir(destination, { recursive: true, mode: 0o700 });
let imported = 0;

async function importCalendar(origin: string, airport: string, month: string, htmlPath: string, sourceText: string, collectedAt: string) {
  const output = path.join(destination, `${origin}-${airport}-ONE_WAY-${month}.json`);
  try { await access(output); return; } catch { /* Preserve any existing result. */ }
  const html = await readFile(path.join(root, htmlPath), 'utf8');
  const calendar = parseCalendarHtml(html, { origin, destination: airport, month,
    sourceUpdatedAt: parseSourceUpdatedAt(sourceText), collectedAt });
  await writeFile(output, JSON.stringify(calendar, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  imported++;
}

try {
  const singapore = JSON.parse(await readFile(path.join(root, 'artifacts/asia-search/ICN-SIN-2026-11.json'), 'utf8'));
  if (!singapore.filters.every((filter: {checked: boolean}) => filter.checked) || singapore.filters.length !== 6) throw new Error('Unverified Singapore filters');
  await importCalendar(singapore.origin, singapore.destination, singapore.month,
    'artifacts/asia-search/ICN-SIN-2026-11-calendar.html', singapore.sourceUpdatedText.join('\n'), singapore.collectedAt);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

// Other old search artifacts do not carry the same complete filter evidence.
// Do not turn a class-specific historical search into an all-class calendar.
console.log(JSON.stringify({ status: 'IMPORTED_LOCAL_EVIDENCE', imported, contactedAirline: false }));
