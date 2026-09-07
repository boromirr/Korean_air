import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectMonth, CollectionError, validateFutureMonth } from '../src/collector.js';

const args = process.argv.slice(2);
const month = args[0] ?? '2027-04';
if (args.slice(1).some((arg) => arg !== '--headless')) {
  console.error('사용법: npm run collect -- YYYY-MM [--headless]');
  process.exit(1);
}
validateFutureMonth(month);
const directory = path.resolve('data');
const key = `ICN-JFK-ONE_WAY-${month}`;
const output = path.join(directory, `${key}.json`);
const lockPath = path.join(directory, `${key}.lock`);
await mkdir(directory, { recursive: true, mode: 0o700 });

let lock;
try {
  lock = await open(lockPath, 'wx', 0o600);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  console.error('동일 노선·월의 작업이 이미 실행 중입니다.');
  process.exit(1);
}
try {
  // Repeated local invocations share recent successful results without reopening the airline.
  const cached = await readFile(output, 'utf8').then(JSON.parse).catch(() => null);
  const age = cached ? Date.now() - Date.parse(cached.collectedAt) : Number.NaN;
  if (cached?.source === 'KOREAN_AIR_PUBLIC_AWARD_CALENDAR' && cached?.month === month && age >= 0 && age < 12 * 3_600_000) {
    console.log(JSON.stringify({ status: 'CACHED', output, collectedAt: cached.collectedAt, dayCount: cached.dates.length }, null, 2));
  } else {
    const result = await collectMonth(month, args.includes('--headless'));
    const evidenceDirectory = path.resolve('artifacts', key);
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(evidenceDirectory, 'calendar.html'), result.html, { mode: 0o600 });
    await writeFile(path.join(evidenceDirectory, 'calendar.png'), result.screenshot, { mode: 0o600 });
    await writeFile(path.join(evidenceDirectory, 'evidence.json'), JSON.stringify(result.evidence, null, 2) + '\n', { mode: 0o600 });
    const temporary = `${output}.tmp`;
    await writeFile(temporary, JSON.stringify(result.data, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, output);
    console.log(JSON.stringify({ status: 'SUCCESS', output, evidenceDirectory,
      dayCount: result.data.dates.length, sourceUpdatedAt: result.data.sourceUpdatedAt,
      collectedAt: result.data.collectedAt, availableSeatCount: null }, null, 2));
  }
} catch (error) {
  const code = error instanceof CollectionError ? error.code
    : error instanceof Error && 'code' in error ? String(error.code) : 'COLLECTION_FAILED';
  // Do not emit raw browser errors/HTML/URLs, which might contain session details.
  const failure = { status: 'FAILED', code, month, at: new Date().toISOString(), previousSuccessPreserved: true };
  await writeFile(path.join(directory, `${key}.last-error.json`), JSON.stringify(failure, null, 2) + '\n', { mode: 0o600 });
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  await lock.close();
  await unlink(lockPath);
}
