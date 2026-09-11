# 개인용 웹 배포

원본: https://github.com/we-insub/Korean_air
기준 커밋: 6db2baaff6e8d278b2eed1ad97843be3cff64f32

기존 로컬 조회 프로그램을 유지하고, Railway의 전용 컨테이너에서 Python·Chrome을 실행합니다.
사용자는 소유자 전용 Sites URL에서 접속합니다. Railway 공개 주소에서는 healthcheck를 제외한
모든 경로가 공유 비밀키로 보호되며, 이 키는 Sites 서버에서만 전송합니다.

## 구성

- `cloud/Dockerfile`: Chrome, Node, Python, Xvfb, noVNC, nginx
- `cloud/serve.py`: 프로세스 감독, loopback 서비스 연결, 토큰 인증 gateway
- `cloud/site-worker.mjs`: 소유자 전용 Sites에서 HTTP와 WebSocket 전달
- `local_web/cloud-ui.js`: 모바일 글자 크기, 항공사 로그인 창 연결
- Railway 서비스 설정: `site/railway` 브랜치, Dockerfile `cloud/Dockerfile`, healthcheck `/healthz`.
  새 서비스에서는 지원이 종료된 `railway.json` 대신 연결된 Railway 서비스 설정을 사용합니다.

Railway는 반드시 단일 replica로 실행합니다. 모든 로그인 세션은 사이트 소유자 1명의 세션입니다.
다중 사용자 서비스로 공개하지 마세요. noVNC, CDP, VNC, Python 포트를 별도로 외부에 노출하지 않습니다.
Chrome은 컨테이너 환경에서만 `CHROME_DISABLE_SANDBOX=1`을 적용합니다.
항공사 접속 제한과 보안 확인은 원본처럼 자동 처리를 멈추며 우회하지 않습니다.

## 런타임 값

Railway:
- `AWARD_GATEWAY_TOKEN`: 32자 이상의 무작위 URL-safe 비밀키
- `AWARD_SITE_ORIGIN`: 소유자 전용 Sites의 정확한 HTTPS origin
- `PORT`: 8080 (Railway가 지정할 수 있음)
- `AWARD_DATA_DIR`: `/data`

Sites:
- `AWARD_BACKEND_ORIGIN`: Railway 서비스의 HTTPS origin
- `AWARD_GATEWAY_TOKEN`: Railway와 같은 값, secret으로 저장
- `AWARD_SITE_ORIGIN`: Sites의 정확한 HTTPS origin

Railway 영구 volume을 `/data`에 연결하면 재배포 후 조회 결과와 로그인 프로필이 유지됩니다.
volume 없이 실행할 경우 재배포 때 결과와 로그인이 사라질 수 있습니다.
소스 저장소에는 로그인 프로필, 비밀번호, 조회 데이터와 공유 비밀키를 올리지 않습니다.

## 사용

1. 대한항공 공개 달력: 공항·월·등급 선택 후 마일리지 좌석 조회.
2. 로그인이 필요한 프로그램: 로그인·예약 열기를 누른 다음 상단의 항공사 로그인 창 보기.
3. 원격 Chrome에서 직접 로그인하고 조회 화면으로 돌아와 로그인 완료·확인.
4. 선택한 월 새로 조회. 접속 제한·미조회는 좌석 없음으로 표시하지 않습니다.

사이트 접속 인증과 항공사 계정 인증은 별개입니다. 서버에서 항공사 실조회 성공 여부는
해당 배포 환경에서 별도 확인해야 하며, 로컬 테스트 통과만으로 성공을 주장하지 않습니다.
