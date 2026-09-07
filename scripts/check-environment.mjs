import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run locally only. No airline page, login session, or user profile is opened.
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('사용법: npm run doctor [-- --prerequisites]\n--prerequisites: Node.js와 Python만 확인합니다.');
  process.exit(0);
}
if (args.some(arg => arg !== '--prerequisites')) {
  console.error('지원하지 않는 옵션입니다. --help로 사용법을 확인하세요.');
  process.exit(1);
}

let failed = false;
function check(ok, message) {
  console.log(`${ok ? '[OK]' : '[확인 필요]'} ${message}`);
  if (!ok) failed = true;
}

check(Number(process.versions.node.split('.')[0]) >= 22, `Node.js ${process.versions.node} (22 이상 필요)`);
const candidates = process.platform === 'win32'
  ? [['python', []], ['py', ['-3']]] : [['python3', []], ['python', []]];
let pythonVersion;
for (const [command, flags] of candidates) {
  const result = spawnSync(command, [...flags, '-c',
    'import sys; print(".".join(map(str, sys.version_info[:3]))); sys.exit(0 if sys.version_info >= (3, 8) else 1)'],
  { encoding: 'utf8', timeout: 5_000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
  if (result.status === 0 && /^\d+\.\d+\.\d+$/.test(result.stdout.trim())) {
    pythonVersion = result.stdout.trim();
    break;
  }
}
check(Boolean(pythonVersion), pythonVersion ? `Python ${pythonVersion}` : 'Python 3.8 이상을 설치하고 터미널을 다시 열어 주세요.');

if (!args.includes('--prerequisites') && !failed) {
  const tsxExists = existsSync(fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)));
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { /* Report the installation step below. */ }
  check(Boolean(chromium) && tsxExists, chromium && tsxExists
    ? 'Playwright와 실행 도구가 설치되어 있습니다.' : '프로젝트 폴더에서 npm ci를 실행해 주세요.');
  if (chromium) {
    let browser;
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 });
      check(true, `Google Chrome ${browser.version()} 실행 확인`);
    } catch {
      check(false, 'Google Chrome을 실행하지 못했어요. Chrome 설치 여부와 회사 PC의 실행 제한을 확인해 주세요.');
      console.log('Chrome 설치: https://www.google.com/chrome/');
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
}

console.log(failed ? '\n위 항목을 확인한 뒤 다시 실행해 주세요.'
  : args.includes('--prerequisites') ? '\n기본 실행 환경이 준비되어 있습니다.'
    : '\n준비되었습니다. Windows에서는 start-windows.bat, macOS에서는 python3 local_app.py --open으로 실행하세요.');
process.exitCode = failed ? 1 : 0;
