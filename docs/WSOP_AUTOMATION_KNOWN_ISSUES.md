# WSOP Web Automation 알려진 이슈 및 예외 정책

본 문서는 WSOP Web Automation 테스트 수행 및 분석 과정에서 발견된 환경별 차이점, 알려진 버그(Known Issues), 예외 상황 및 경고(Warning) 정책을 기술합니다.

---

## 1. 환경별 주요 편차 및 지연 현상

### 개발/스테이징(Stage) 환경의 자산 로드 지연
- **이슈 설명**: 스테이징 환경(`wsop-stage.ggnweb.com`)은 운영 환경(Production)에 비해 CDN 설정이 미비하거나 스토리지 지연으로 인해 아바타 이미지나 스타일시트 로드 시 타임아웃 경고가 자주 발생합니다.
- **예외 정책**:
  - `ENVIRONMENT=stage` 환경변수가 감지되는 경우, Phase 3의 이미지 미노출 실패와 Phase 7의 느린 자산 경고는 빌드를 중단시키는 **Hard Fail**이 아닌 **Warning(경고)**으로 분류합니다.

---

## 2. 외부 스크립트 및 통신 장애 (Third-Party Issues)

### 광고 및 분석 트래커(Analytics/Ads) 로드 차단
- **이슈 설명**: `doubleclick.net`, `facebook.net`, `google-analytics.com` 등 외부 마케팅/추적용 서드파티 스크립트들은 브라우저 차단 정책이나 테스트망의 프록시/방화벽 설정에 따라 요청 실패(Request Failed)가 상시 발생합니다.
- **예외 정책**:
  - `fixtures/performance-stability/performance-thresholds.fixture.json`의 `allowedThirdPartyFailurePatterns`에 등록된 키워드가 포함된 요청은 로딩 실패나 지연이 발생하더라도 경고(Warning) 수준으로 처리하며 단언문 실패(Assertion Fail)를 통과시킵니다.

### SSE (Server-Sent Events) 연결 유실 콘솔 오류
- **이슈 설명**: `/schedule/` 또는 `/player-standings/` 페이지 등에서 실시간 정보 동기화를 위해 SSE 연결을 맺으나, 유지보수 메시지와 함께 브라우저 콘솔에 `[SSE] EventSource failed...` 에러가 출력되는 현상이 있습니다.
- **예외 정책**:
  - 테스트 구동 및 비즈니스 핵심 로직에는 영향이 없는 단순 시각적 로그이므로, 콘솔 수집기(`console-error.spec.ts` 등)에서 해당 메시지는 ignore 처리하여 노이즈를 제거했습니다.

---

## 3. 대표적인 인물 데이터/UI 특이사항

### Daniel Negreanu 및 Johnny Moss 프로필 매핑 예외
- **이슈 설명**: Daniel Negreanu의 경우, 과거 레거시 DB 식별 정보와 현재 URL이 `/players/daniel-negreanu/`와 같이 특수한 형태로 이관되어 다른 일반 검색 대상자와 매핑 규칙이 상이합니다.
- **예외 정책**:
  - `fixtures/player-presentation/known-exceptions.fixture.json`에 관련 선수 ID를 고정 등록하여 자동완성 및 검색 검증 시 예외 매칭을 우선 적용합니다.

### ₩ / ₱ (원화/페소) 등 다국어 상금 화폐 미인식
- **이슈 설명**: 미국 외 지역(아시아 APPT 등)에서 개최된 토너먼트 기록의 경우 상금 수치가 `₩9,000,000` 혹은 `₱175,000` 등으로 노출되며, 기존 크롤러가 `$` 중심의 화폐 기호만 검증하여 금액 불일치 오류가 났었습니다.
- **예외 정책**:
  - 크롤러 화폐 파싱 정규식에 ₩, ₱ 및 4글자 통화 코드를 포함하도록 보완하였으나, 새로운 화폐 기호가 추가되는 경우 `parseMoneyFromText` 정규식을 지속적으로 유지보수해야 합니다.
