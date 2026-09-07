# 로컬 개발

설치 후 화면을 사용하는 방법은 [사용법](usage.md)을 참고하세요. 이 문서는 개발 환경과 코드 구조를 설명합니다.

## 준비와 실행

- Python 3.8 이상: 표준 라이브러리만 사용하므로 별도 `pip` 설치가 필요 없습니다.
- Node.js 22 이상과 npm: 공개 좌석 조회와 자동 입력에 사용합니다.
- Google Chrome: 설치된 Chrome을 새 창으로 실행합니다.

Windows 11 이상과 macOS 14 이상을 대상으로 합니다. 실제 항공사 조회까지 확인한 개발 환경은 macOS, Python 3.8.10, Node.js 24.13.0입니다. Windows용 실행·통신 코드는 구현했으며 GitHub Actions에서 Windows와 macOS를 검사하도록 구성했습니다. Windows 실기기에서의 항공사 조회와 Linux 실행은 아직 검증하지 않았습니다.

Windows에서는 `setup-windows.bat`로 설치한 뒤 `start-windows.bat`로 실행합니다. PowerShell에서 직접 실행하려면 프로젝트 폴더에서 다음 명령을 사용합니다.

```powershell
npm.cmd ci
npm.cmd run doctor
python local_app.py --open
```

`python` 대신 Python 런처의 `py -3`도 사용할 수 있습니다. macOS에서는 다음 명령을 실행합니다.

```sh
npm ci
npm run doctor
python3 local_app.py --open
```

로컬 화면은 `http://127.0.0.1:8765/`에서 열립니다. 실행한 터미널을 유지하고, 종료할 때 `Ctrl+C`를 누르세요. 포트가 사용 중이면 `python3 local_app.py --port 8766 --open`으로 다른 포트를 선택할 수 있습니다. macOS의 `마일리지 조회.command`도 같은 Python 서버를 실행합니다.

서버 실행 전 빌드는 필요 없습니다. Python 서버가 필요한 시점에 `tsx`로 TypeScript 코드를 실행합니다. `npm run dev` 명령은 없습니다.

Playwright는 `npm ci`에 포함된 Node.js 패키지이며 Python용 패키지는 사용하지 않습니다. 브라우저는 설치된 Google Chrome을 `channel: 'chrome'`으로 실행하므로 Chrome이 준비되어 있다면 별도 Playwright 브라우저 다운로드도 필요 없습니다. `npm run doctor`는 실행 환경과 빈 Chrome 창의 실행 여부만 확인하며 항공사에 접속하지 않습니다.

대한항공 로그인, API 키, `.env` 파일, 카카오 토큰, DB는 필요 없습니다. 처음 내려받은 프로젝트에는 조회 결과가 없으므로 화면의 **마일리지 좌석 조회** 버튼으로 조회를 시작하세요. 화면을 열거나 검색 조건을 바꾸는 것만으로 항공사에 새 조회를 보내지는 않습니다.

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `local_app.py` | 로컬 HTTP 서버, 입력 검증, 파일 캐시, 조회·자동 입력 작업 관리 |
| `local_web/index.html` | 검색 조건, 날짜 결과, 왕복 날짜 선택, 대한항공 자동 입력 버튼 |
| `src/collector.ts` | 새 비로그인 Chrome에서 공개 월별 달력을 조회 |
| `src/parser.ts`, `src/types.ts` | 달력 표시 검증과 날짜별 데이터 형식 |
| `src/airline-handoff.ts` | 선택한 노선·월·좌석 등급·날짜를 새 Chrome에 입력하고 창을 유지 |
| `scripts/local-collect.ts` | Python 서버가 호출하는 월별 조회용 내부 CLI |
| `scripts/open-airline.ts` | Python 서버가 선택 조건을 전달하는 자동 입력용 내부 CLI |
| `scripts/check-environment.mjs` | Python·Node.js·Playwright·Chrome 설치와 실행 점검 |
| `setup-windows.bat`, `start-windows.bat` | Windows 설치·실행 도우미 |
| `scripts/collect.ts` | 초기 검증용 ICN → JFK 편도 수집 CLI |

내부 CLI를 직접 실행하기보다 웹 화면의 버튼을 사용하세요. 웹 서버가 입력 검증, 캐시 재사용, 동시 실행 방지, 접근 제한 상태를 함께 관리합니다.

## 운영체제별 프로세스 처리

Python 서버는 셸 명령 문자열 대신 인수 목록으로 Node.js와 `tsx/dist/cli.mjs`를 실행합니다. 작업마다 별도 프로세스 그룹을 만들며, 실패·시간 초과 시 Windows는 해당 PID에 대한 `taskkill /T /F`, macOS는 해당 프로세스 그룹에 대한 종료 신호로 정리합니다. 프로세스 이름을 기준으로 기존 Chrome 창을 일괄 종료하지 않습니다.

자동 입력 상태는 UTF-8 JSON 한 줄로 전달합니다. 파이프 읽기는 Windows에서도 동작하는 스레드·큐를 사용하며 대기 시간과 메시지 크기를 제한합니다. 자동 입력에 성공한 Chrome 창은 사용자가 닫을 때까지 유지합니다.

## 캐시와 조회 범위

조회 결과는 `data/local/`에 저장합니다. 기존 `data/`의 유효한 결과도 읽을 수 있습니다. 같은 방향·월의 결과를 좌석 등급별로 함께 사용하며, 조회한 지 12시간이 지나지 않았으면 **마일리지 좌석 조회** 버튼을 눌러도 저장된 결과를 재사용합니다. 오래된 결과는 화면에 표시할 수 있지만 새 조회는 버튼을 눌러야 시작합니다.

**선택한 날짜로 대한항공 열기**는 매번 새 비로그인 Chrome에서 공개 조회 화면을 열어 조건을 입력합니다. 이 동작은 로컬 캐시를 갱신하지 않습니다. 기존 Chrome의 로그인 상태를 가져오거나 예매·결제를 자동 진행하지 않습니다.

조회는 한국 날짜 기준으로 다음 달부터, 오늘을 포함한 향후 360일 안에 마지막 날까지 포함되는 달까지만 지원합니다. 이번 달과 마지막 날짜가 범위를 벗어나는 달은 제외합니다. 예를 들어 2026년 9월 7일에는 2026년 10월부터 2027년 8월까지 조회할 수 있습니다. 왕복은 가는 방향과 오는 방향을 각각 한 달씩 조회합니다.

## 변경 검증

```sh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run typecheck
npm run build
```

Windows에서는 `python3`를 `python` 또는 `py -3`로, PowerShell에서는 `npm`을 `npm.cmd`로 바꾸면 됩니다.

자동 테스트는 저장된 예제·모의 응답·로컬 Python 자식 프로세스를 사용하며 항공사에는 접속하지 않습니다. Windows 전용 검사는 한국어·공백 경로의 실제 `.bat` 실행과 하위 프로세스 종료를 확인하며, macOS에서는 생략됩니다. `.github/workflows/test.yml`은 두 운영체제에서 설치·테스트·타입 검사·빌드를 실행하도록 구성되어 있습니다. 워크플로 설정 자체가 Windows 검사 통과를 의미하지는 않으므로 GitHub에 올린 뒤 실행 결과를 확인하세요.

실사이트 조회는 테스트 명령과 별개이며, 공식 화면이 바뀐 부분을 확인할 필요가 있을 때만 범위를 정해 수행합니다. 결과와 실제 확인 범위는 [실행 검증 기록](verification-results.md)에 남깁니다.

## 초기 검증용 CLI

`npm run collect`는 웹 서버를 띄우는 명령이 아닙니다. **ICN → JFK 편도**로 고정된 초기 검증용 도구입니다. 조회할 달을 `YYYY-MM` 형식으로 지정합니다.

```sh
npm run collect -- 2027-04
```

위 날짜는 2026년 9월 7일 기준 예시입니다. 실행하는 날의 조회 가능 범위에 맞는 달로 바꾸세요. 결과 JSON은 `data/`에, 달력 HTML·이미지와 검증 자료는 `artifacts/`에 저장합니다. 같은 달의 12시간 이내 결과는 `CACHED`로 반환합니다. 실패 기록인 `data/<노선·월>.last-error.json`도 이 CLI에 해당하며, 웹 앱의 일반 오류 로그 경로는 아닙니다.

## 오류를 확인할 때

`data/`와 `artifacts/`, `.env`, 브라우저 세션 관련 파일은 Git에서 제외됩니다. 웹 조회는 실패를 좌석 없음으로 바꾸지 않으며, 이전에 성공한 결과를 유지합니다. 자동 입력의 일부 일반 오류는 `artifacts/airline-handoff/last-failure.json`과 이미지에 공개 화면의 제한된 진단 정보를 남길 수 있습니다.

접근 제한이나 보안 확인이 감지되면 새 자동 처리를 중단합니다. 웹 앱은 이 상태를 `data/local/access-restricted.json`에 보관하므로 서버를 단순히 재시작해도 해제되지 않습니다. 제한 상태 파일을 지우거나 다른 CLI로 바꿔 재시도하지 말고, 저장된 결과 또는 대한항공 홈페이지에서 직접 확인하세요. 화면 구조가 바뀐 오류는 해당 화면과 선택 항목을 확인한 뒤 코드를 수정합니다.
