import { openAirlineHandoff, type HandoffResult } from '../src/airline-handoff.js';

// The localhost server sends only the selected public itinerary, never credentials.
let emitted = false;
function report(result: HandoffResult): void {
  if (emitted) return;
  emitted = true;
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === 'failed') process.exitCode = 1;
}

try {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (Buffer.byteLength(text, 'utf8') > 4_096) throw new Error('INPUT_TOO_LARGE');
  }
  let selection: unknown;
  try { selection = JSON.parse(text); } catch { throw new Error('INVALID_JSON'); }
  await openAirlineHandoff(selection, report);
} catch {
  report({ status: 'failed', code: 'INVALID_ARGUMENTS', message: '선택한 여정을 확인할 수 없습니다. 날짜를 다시 선택하세요.' });
}
