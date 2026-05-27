# WSOP Release Regression 실행 및 검증 가이드 (Phase 9)

본 문서는 WSOP Web Automation 프로젝트의 전체 회귀 테스트 스위트(Phase 9)를 구동하고, 결과 리포트를 검수하여 릴리즈 배포 적합성을 판단하는 QA 매뉴얼입니다.

---

## 1. 회귀 테스트 스위트 유형 및 실행 명령

상황에 맞추어 적절한 스위트 명령을 사용하십시오.

| 상황 | 실행 스위트 | CLI 명령 | 실행 대상 범위 | 비고 |
| :--- | :--- | :--- | :--- | :--- |
| **로컬 신속 검증** | Quick Regression | `npm run test:regression:quick` | Phase 1 (Smoke), Phase 2 (Functional) | pre-commit 또는 병합 전 가벼운 정합성 확인 |
| **기본 전체 회귀** | Standard Regression | `npm run test:regression:standard` | Phase 1 ~ Phase 6 (API), Phase 7 (Performance - Optional) | 디폴트 회귀 검증 스위트 |
| **야간 정기 빌드** | Extended Regression | `npm run test:regression:extended` | Phase 1 ~ Phase 8 (Visual - Optional) | 비주얼 및 성능을 포함한 전체 시나리오 실행 |
| **배포 최종 승인** | Release Regression | `npm run test:release` | Phase 1 ~ 3, Phase 5 ~ 6 (Required 지정) | 결함 차단용 엄격한 릴리즈 게이트 |
| **비주얼 최종 승인** | Release with Visual | `npm run test:release:with-visual` | Release Suite + Phase 8 (Visual - Optional) | 베이스라인 검토 완료 후 시각 회귀 포함 승인 |
| **크롤러 최종 승인** | Release with Crawler | `npm run test:release:with-crawl` | Release Suite + Crawling + Crawler Phase 6 검증 | 데이터 적재 정합성 포함 배포 승인 |

---

## 2. 결과 산출물 위치 및 읽는 법

회귀 테스트 실행 후 산출물은 다음 디렉토리에 저장됩니다:
`WSOP-Web-Automation/artifacts/full-regression/latest/` (보안 및 노이즈 방지를 위해 Git 트래킹에서 제외됨)

### 주요 파일 목록
*   **[regression-summary.md](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/artifacts/full-regression/latest/regression-summary.md)**: 사람이 즉시 판독할 수 있는 한글 가독성 요약 리포트 (Phase별 실행 시간, 상태 테이블, 결함 설명 포함).
*   **[regression-summary.json](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/artifacts/full-regression/latest/regression-summary.json)**: 전체 실행 정보 구조체.
*   **[release-gate-result.json](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/artifacts/full-regression/latest/release-gate-result.json)**: 릴리즈 게이트 적격 여부 판정 데이터 (`PASSED`, `FAILED`, `REQUIRES_REVIEW`).
*   **[regression-failures.json](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/artifacts/full-regression/latest/regression-failures.json)**: 실패한 단계들의 exit code 및 에러 로그 목록.
*   **[regression-warnings.json](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/artifacts/full-regression/latest/regression-warnings.json)**: 허용된 예외성 Warning 정보 목록.

---

## 3. Release Gate 적격 여부 판단 기준

러너 프로세스는 `release-gate-result.json` 결과에 따라 종료 코드(exit code)를 결정합니다.

1.  **🟢 PASSED (Exit Code: 0)**
    *   **기준**: 필수(Required) 단계가 모두 100% 성공하고, 경고(Warning) 및 선택적 실패가 전혀 없는 완벽한 빌드 상태.
    *   **액션**: 추가 검토 없이 배포 파이프라인을 최종 통과시킵니다.
2.  **🟡 REQUIRES_REVIEW (Exit Code: 0)**
    *   **기준**: 필수 단계는 통과했으나, 비주얼 베이스라인 미등록, 서드파티 스크립트 통신 에러 등 허용된 Warning이 검출된 상태.
    *   **액션**: `regression-summary.md`에 명시된 경고 사유를 분석하고, 제품 버그가 아니라고 판단되면 배포를 수동 승인합니다.
3.  **🔴 FAILED (Exit Code: 1)**
    *   **기준**: 필수(Required) 단계(예: Phase 1, 2, 5, 6 등) 중 하나라도 실패한 경우.
    *   **액션**: CI/CD 파이프라인이 자동 중단되며 배포가 차단됩니다. 즉시 4단계 Triage 매뉴얼에 따라 원인을 파악하십시오.

---

## 4. 실패 분석 및 Triage 가이드라인 (Triage Manual)

실패 발생 시 다음 순서에 따라 문제를 분류하십시오.

1.  **Visual Baseline Missing**
    *   **현상**: `A snapshot doesn't exist` 및 `visual-baseline-missing` 분류 감지.
    *   **해결**: 기획된 UI 개편 건이라면 `npm run update:phase8-baseline`을 기동하여 베이스라인을 새로 쓰고 검수한 뒤 커밋하십시오.
2.  **Selector 불안정 (Selector Issue)**
    *   **현상**: 요소 렌더링 지연 및 `selector-issue` 감지.
    *   **해결**: 대상 페이지의 locator가 변경되었거나 로딩 시간이 부족한 상태이므로 지연(wait)을 보강하거나 `preferredSelectors`를 보완하십시오.
3.  **Third-Party Performance Warning**
    *   **현상**: `doubleclick`, `googletag` 등 광고망 로딩 실패로 인한 성능 지연 발생.
    *   **해결**: 회귀 스위트에서는 자동으로 무시 처리되나, 모니터링 경보가 빈번하면 `known-regression-exceptions.fixture.json` 정규식을 조정하십시오.
4.  **Actual Product Issue (기능 리그레션)**
    *   **현상**: Phase 1, 2, 5, 6 등 핵심 경로 테스트의 단언문(Assertion) 실패.
    *   **해결**: 실제 소스 코드 상의 결함이 발생한 상태이므로 릴리즈를 차단하고 담당 개발 그룹에 핫픽스 요청을 티켓팅해야 합니다.
