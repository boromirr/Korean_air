# 대한항공 공개 보너스 좌석 조회 조사

조사일: 2026-09-07, 한국시간. 공식 URL: https://www.koreanair.com/booking/book-and-manage/award-seat-availability

## 실제 확인 결과

Playwright 1.63.0 + 설치된 Google Chrome, headed 모드, 새 비로그인 BrowserContext에서 ICN → JFK / 편도 / 2027년 4월 조회 성공. 로그인·기존 브라우저 프로필·쿠키 주입·비공식 API 직접 호출 없이 사이트의 UI만 조작했다. 사용자 확인형 CAPTCHA나 접근 차단 화면은 이 조회에서 나타나지 않았다.

4월 1~30일 모두 일반석 보너스 표시. 4·9·15·17·18일에는 프레스티지석 **좌석승급**도 표시된다. 프레스티지 보너스와 구별해야 한다. 페이지의 공개 현황 기준 시각은 `2026년 9월 6일 23:00`(한국시간), 즉 `2026-09-06T23:00:00+09:00`이다. 실시간 재고가 아니며, 일 1회 갱신·향후 360일 제공 안내를 직접 확인했다.

## 확인한 화면 흐름과 선택자

| 단계 | 실제 관찰된 선택자/역할 | 주의점 |
|---|---|---|
| 쿠키 안내 | button, 정확한 이름 `필수 쿠키만 허용` | 최초 방문 모달. 일반 DOM `innerText`만으로 shadow DOM 안내를 놓칠 수 있어 접근성 역할로 찾음 |
| 편도/왕복 | `#bonusTripTypeLabel_OW`, `#bonusTripTypeLabel_RT`; input `#bonusTripType_OW`, `#bonusTripType_RT` | 라디오 위에 label이 겹쳐 `check()`는 클릭 시간 초과. 확인한 label 클릭 후 input의 checked 검증 |
| 출발지 | button `From 출발지`, dialog/combobox `출발지 검색` | 자동 생성된 버튼 ID의 전체 문자열은 사용하지 않음 |
| 공항 검색 | combobox에 `pressSequentially('ICN')` | `fill('ICN')`만으로는 후보가 나타나지 않았고 실제 키 입력으로 나타남 |
| ICN 후보 | option `ICN 서울/인천, 대한민국` | 정확한 옵션을 클릭 |
| 도착지 | button `To 도착지`, dialog/combobox `도착지 검색` | 출발지 선택 전에는 비활성 |
| JFK 후보 | option `JFK 뉴욕/존 F. 케네디, NY, 미국` | 정확한 옵션을 클릭 |
| 월 선택 | `#seatCalendarBtn`, dialog `탑승월 선택` | 연도 group `2027` 내부 button `4월`, button `선택` |
| 조회 | button `조회` | 클릭 후 본문 내부가 아닌 별도의 dialog가 활성화됨 |
| 결과 모달 | `[role="dialog"][aria-labelledby="modals-travelCalendar-title"]` | 제목에 ICN → JFK 순서를 확인 |
| 노선 제목 | `#modals-travelCalendar-title` | 출발지/도착지 텍스트 포함 |
| 결과 월 | `#travelCalendarListBtn` | 실제 표시 월 검증 |
| 날짜 셀 | `#bonusCalendarTableWrapEl table.bonus-calendar__table tbody td[id^="day_"]` | `day_1`~`day_30`, 옆달 여백은 id 없는 aria-hidden td |
| 좌석 표식 | 날짜 셀 내부 `.bonus-calendar__icons li` | 색만 보지 않고 정확한 한국어 텍스트 매핑 |
| 날짜 상세 | `#day_4` 클릭 | `#seatScroll`, `.bonus-calendar__flight-item`, `.bonus-calendar__flight-num`, `.bonus-calendar__flight-time`, `.bonus-calendar__flight-class ._hidden` |
| 좌석 필터 | `#bonusFilterBtn`, dialog `보너스 좌석 필터` | 6개 체크박스 모두 기본 선택됨. 수집 전 필터 전체 상태 검증 필요 |
| 닫기 | `#travelCalendarCloseBtn` | 공식 예매 버튼은 클릭하지 않음 |

2027-04-04 상세에서 KE081 10:00은 일반석 보너스 + 프레스티지석 좌석승급, KE085 19:30은 일반석 보너스를 확인했다. 날짜 클릭 시 추가 좌석 요청은 관찰되지 않았다.

## 데이터 의미와 한계

관찰된 범례: 일반석 보너스, 프리미엄석 보너스, 프리미엄석 좌석승급, 프레스티지석 보너스, 프레스티지석 좌석승급, **일등석 보너스/좌석승급**, 좌석 없음, 운항편 없음.

일등석은 사이트 자체가 보너스/승급을 합쳐 표시한다. 실제 날짜에 이 합성 표식이 있으면 두 boolean을 임의로 확정할 수 없다. 이번 4월 결과에는 없었다. 수집기는 해당 표식이 나오면 명시적 오류로 중단하도록 설계한다. 일반석 승급 표식은 범례에서 확인되지 않았다. false는 해당 공개 표식의 부재이며 실시간 재고 부재를 뜻하지 않는다.

`좌석 없음`과 `운항편 없음`은 범례에서 구분되지만, 이번 노선·월에는 그 상태인 실제 날짜 셀이 없었다. 해당 셀 DOM은 미검증으로 기록하고 빈 셀이나 알 수 없는 상태를 임의로 좌석 없음으로 변환하지 않는다. 정확한 잔여 좌석 수·2인 동시 예약 가능 여부·실시간 재고는 추출 불가. `availableSeatCount`는 항상 null.

## 네트워크와 쿠키

UI 조회 시 브라우저에서 `POST /api/hmp/bonusSeatView/bonusSeatView` → HTTP 200, JSON 응답을 관찰했다. 초기 로드에는 `/api/et/route/c/a/getReservationAirport`, `/api/et/uiCommon/c/a/airportList`, `/api/et/route/getNewCabinRouteInfo`, 언어/코드 목록, 헤더/푸터 등의 요청이 있다. 쿼리 값·요청 본문·인증 헤더는 저장하지 않는다.

사용자 추가 요청에 따라 브라우저가 UI 조회로 받은 월간 응답을 수동으로 검사했다. 최상위 필드는 `departureAirport`, `arrivalAirport`, `departureAirportName`, `arrivalAirportName`, `flightList`. 30일의 `flightDetailList`에 총 240개 **상태 항목**이 있다. 각 항목에는 `departureTime`, `flightNumber`, `availableSeat`, `bookingClass`, `frontBookingClass`만 있고, `availableSeat`는 전부 boolean이다. 수량을 제공하는 숫자 필드는 없다. 240개를 좌석 240석으로 해석하면 안 된다. 예: KE081 / 10:00 / X / E / true. 화면과 대조해 X/E=일반석 보너스, Z/U=프레스티지석 승급임을 확인했다. O/P, A/F도 응답에 있지만 이 월에는 모두 false이며 별도 좌석 수는 없다. 공개 노선·편명·상태 필드만 있는 해당 응답을 `artifacts/research/observed-monthly-response.json`에 보존했다. 내부 요청을 재현하거나 쿠키를 복제해 직접 호출하지 않았다.

날짜마다 클릭할 필요가 없다. 한 번의 월 조회에 전체 월 DOM과 항공편별 상태 응답이 함께 온다. 구현은 전체 월 DOM을 한 번에 파싱하고 네트워크 응답의 필드·자료형 요약만 보조 관찰 자료로 남긴다.

새 비로그인 세션에도 지역/언어, 쿠키 동의, 분석, 보안 관련 쿠키가 생성된다. 예: `hcountry`, `hlang`, `AKA_A2`, `ak_bmsc`, `bm_*`, `_abck`, `dtCookie`. 필수 쿠키만 허용 버튼으로 진행했다. 이름/속성만 조사했으며 개별 쿠키를 제거하여 필요성을 검증하지는 않았다. 따라서 각 쿠키를 모두 필수라고 단정하지 않는다. 보안 쿠키의 값 복제나 브라우저 지문 변경을 구현하지 않는다.

## 수집 방식 선택 및 정책

DOM 방식은 사용자에게 공개된 의미와 대조 가능하고 내부 요청의 비공개 스키마에 의존하지 않는 장점이 있다. 단점은 DOM/번역 변경·모달·렌더링 대기·브라우저 운영 비용이다. 내부 JSON 직접 호출은 가볍지만 문서화된 외부 API 계약이 없고 세션/구조 변경 및 정책 위험이 있다. 이 단계에서는 **관찰된 DOM 기반 수집**을 선택한다. DOM 방식도 약관상 운영 허가를 뜻하지 않는다.

[정책 조사 상세](policy-research.md) 참조. 공식 robots.txt는 `/api` 등 경로를 제한하고, 공식 이용약관은 사전 동의 없는 영리 목적 정보 이용 등에 제한을 둔다. 기술 실증과 서비스 운영 허가는 별개다. 자동 정기 수집·재배포·상용 운영은 아직 구현하거나 시작하지 않는다.

## 오류 및 제한

- Playwright 라디오 `check()`의 클릭 가림 시간 초과: 실제 label 클릭으로 해결. 보안 차단 아님.
- 조회 후 `main` 역할로 결과를 찾으면 모달 때문에 실패: 실제 결과 dialog로 탐색.
- 구조 변경·알 수 없는 표식·다른 노선/월·불완전 날짜 수는 실패 처리. 기존 성공 JSON 보존.
- CAPTCHA, MFA, 접근 제한, HTTP 403/429가 있으면 중단. 보안 확인 우회·무한 재시도 없음.
- 정책 조사용 별도 HTTP robots.txt 읽기는 403이었고 우회하지 않았다. 이 사실을 공개 조회 브라우저의 성공과 혼동하지 않는다.

원시 관찰 자료는 Git에서 제외된 `artifacts/research/`에 저장했다.

## 왕복 월 선택 조사

`#bonusTripTypeLabel_RT` 클릭 후 `#seatCalendarBtn`에서 2027년 그룹의 4월, 5월을 차례로 클릭했다. 선택창에 `가는 달 2027년 4월`, `오는 달 2027년 5월`이 별도로 표시되고 `선택` 클릭 뒤 검색 조건에도 같은 두 달이 표시됨을 확인했다. 왕복 실제 좌석 재조회와 귀국편 결과 파싱은 이번 ICN→JFK 편도 수집 범위 밖이라 실행하지 않았다.
