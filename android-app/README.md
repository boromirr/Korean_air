# 마일리지 달력 — Android 직접 조회 실험판

Android 8.0 이상에서 사용하는 개인용 대한항공 공개 좌석 현황 앱입니다. 휴대폰의 `HttpsURLConnection`으로 대한항공에 한 달 조회 POST를 한 번 보냅니다. PC, Railway, Sites 서버, Python, Chrome 자동화가 필요하지 않습니다. 공식 대한항공 앱은 아닙니다.

**APK 빌드와 오프라인 검사는 완료했습니다. 실제 휴대폰 실행과 휴대폰에서 대한항공 데이터 수신은 아직 확인하지 않았습니다.** 네이티브 앱으로 직접 호출할 수 있다는 사실이 대한항공의 요청 승인을 보장하지는 않습니다. 401·403·429 응답은 오류로 보여주고 자동 재시도하지 않습니다.

## 사용

1. 서명된 `KoreanAirPersonal.apk`를 Android 휴대폰에서 열어 설치합니다.
2. **마일리지 달력**을 열고 출발·도착 공항, 월, 좌석 등급을 선택합니다.
3. **휴대폰에서 좌석 조회**를 누릅니다. 성공하면 달력이 표시됩니다. 실패하면 **오류 정보 복사**로 상태를 확인할 수 있습니다.
4. 날짜를 누르고 **이 날짜로 대한항공 예매 열기**를 선택합니다. 로그인과 예약은 대한항공에서 진행합니다.

가능 표시는 좌석 개수가 아닙니다. 승급 표시와 보너스 표시를 구분합니다. 일등석 `A`는 보너스·승급이 합쳐진 표시라 분리할 수 없습니다. 제공되지 않은 날짜나 등급은 ‘자료 없음’으로 남깁니다. 화면에 표시되는 확인 시각은 응답을 받은 시각이며 항공사의 원본 갱신 시각은 아닙니다.

예매 링크는 공식 프런트엔드에서 사용하는 편도 마일리지 검색 조건을 담습니다. 실제 로그인 후 조건 유지 및 최종 예약 가능 여부는 검증하지 않았으므로 대한항공에서 날짜, 탑승객, 등급을 확인해야 합니다. 앱에서 자동으로 예약하거나 결제하지 않습니다.

## 직접 호출

```text
POST https://www.koreanair.com/api/hmp/bonusSeatView/bonusSeatView
Content-Type: application/json; charset=utf-8
Accept: application/json
User-Agent: KoreanAirPersonal/0.1 (Android)
```

```json
{"departureAirport":"ICN","arrivalAirport":"JFK","departureDate":"20261101"}
```

이 주소는 대한항공 웹사이트에서 사용하는 내부 엔드포인트이며 안정성이 보장된 제3자용 공식 API 계약이 아닙니다. 앱에는 인증 정보, 쿠키, 브라우저 위장 헤더, 프록시, CAPTCHA 처리, 자동 재시도, 분석 SDK가 없습니다. 필요한 권한은 `INTERNET` 하나입니다. 검색 조건은 대한항공으로 전송되며 마지막 선택 조건은 휴대폰에만 저장됩니다. 예약 버튼은 외부 대한항공 페이지를 엽니다.

접속 및 읽기 제한은 각각 15초·25초, 전체 요청 중단 타이머는 40초입니다. 리다이렉트와 HTML 응답은 좌석 결과로 처리하지 않습니다. 응답 노선, 날짜, 중복 자료, Boolean 형식, 항공편과 등급을 검사합니다.

## 빌드

별도 라이브러리가 없는 Java 앱입니다. JDK 17, Python 3, 공식 Android SDK Platform 35 / Build Tools 35.0.0이 필요합니다. **앱 사용자는 이 개발 도구를 설치할 필요가 없습니다.**

```bash
export ANDROID_JAR=/your/android-sdk/platforms/android-35/android.jar
export ANDROID_BUILD_TOOLS=/your/android-sdk/build-tools/35.0.0
python3 build.py
python3 test.py
```

설치 파일은 `build/KoreanAirPersonal.apk`에 생깁니다. `build.py`는 aapt2 → javac → D8 → zipalign → apksigner 순서로 빌드하고 서명·정렬을 검사합니다. 여기서 전달한 APK도 이 스크립트로 만들었습니다. APK는 개인 설치용 서명이며 Play Store 배포물이 아닙니다.

처음 빌드하면 `.signing/personal-test.jks`를 생성합니다. 테스트 서명 암호의 기본값은 `android`, 별칭은 `personal-test`입니다. `APK_KEYSTORE`와 `APK_STORE_PASSWORD`로 기존 키를 지정할 수 있습니다. 업데이트는 기존 APK와 같은 키를 사용해야 하며, 개인 키는 저장소에 커밋하지 마세요. 테스트 키는 공개 배포에 재사용하지 마세요.

## 검증 기록 — 2026-09-11

- 공식 SDK로 APK 빌드 완료, v2·v3 서명 및 zip 정렬 검증 완료.
- 런처 Activity, Android 8.0 최소 버전, 인터넷 권한만 포함됨을 APK에서 확인.
- JVM 검사 41개 통과: 실제 저장 응답 해석, 누락·중복·잘못된 날짜·노선·형식 거절, 승급 구분, 예약 URL, 단일 POST, HTTP 401·403·429·302·500 처리, HTML 거절, 타임아웃.
- 검사에서는 대한항공에 새 요청을 보내지 않음. `tests/icn-jfk-202611.json`은 2026-09-11 개발 환경에서 받은 ICN→JFK 2026년 11월 공개 응답이며 **현재 좌석 정보로 사용하면 안 됩니다**. 앱에는 이 테스트 응답을 넣지 않음.
- 실기기 또는 에뮬레이터 UI 실행 검사, 휴대폰의 실제 네트워크 조회, 로그인 후 예매 연결은 미검증.

개발 환경 HTTP 200 및 Sites 운영 환경 HTTP 403 기록만으로 휴대폰 결과를 예측할 수 없습니다. 실기기에서 오류가 발생하면 코드·노선·월·시각을 복사해 확인해야 합니다. 이 앱은 실패한 조회를 빈 좌석 결과로 표시하지 않습니다.
