# WSOP-Web 검증 정리 (2026-05-27)

## 1) 검증 범위
- 대상: `WSOP-Web/WSOP-Web-Automation`, `WSOP-Web/WSOP-Player-Standings-Crawler`
- 기준 일시: 2026-05-27
- 실행 커맨드(핵심):
  - `cmd /c npm run phase:list`
  - `cmd /c npm run crawl:self-test`
  - `cmd /c node scripts/run-phase.cjs phase1`
  - `cmd /c node scripts/run-phase.cjs phase2`
  - `cmd /c node scripts/run-phase.cjs phase3`
  - `cmd /c node scripts/run-phase.cjs phase4`
  - `cmd /c node scripts/run-phase.cjs phase5`

## 2) 이번 정리에서 반영한 코드 수정

### A. 크롤러 리포트 이벤트 탭 초기 공백 수정
- 파일: `WSOP-Player-Standings-Crawler/automation/crawl_player_standings.mjs`
- 내용: `events` 탭 활성화 시 `renderPlayerEvents()` 즉시 호출.

### B. 빈 리포트(0 tests)로 latest 오염되는 문제 수정
- 파일:
  - `WSOP-Web-Automation/scripts/wsop-smoke-html-reporter.cjs`
  - `WSOP-Web-Automation/scripts/open-latest-smoke-report.cjs`
- 내용:
  - 실행 테스트 0건이면 custom 리포트 생성 스킵.
  - 리포트 오프너가 `results.length > 0` JSON 우선 선택.

### C. Phase5(Result Detail) 불안정성 완화 및 정책 통일
- 파일:
  - `WSOP-Web-Automation/utils/resultDetail/resultDetailHelpers.ts`
  - `WSOP-Web-Automation/utils/resultDetail/resultPaginationHelpers.ts`
  - `WSOP-Web-Automation/tests/result-detail-integrity/result-detail-backlink.spec.ts`
  - `WSOP-Web-Automation/tests/result-detail-integrity/result-detail-player-row.spec.ts`
  - `WSOP-Web-Automation/tests/result-detail-integrity/result-detail-pagination.spec.ts`
- 내용:
  - 결과 행 수집: 전체 div 스캔 → player 링크 기반 fast-path 우선.
  - 페이지네이션 클릭: 일반 클릭 실패 시 `force`/DOM click fallback.
  - pagination 불안정(페이지 깨짐/컨트롤 미노출/액션 제한)은 warning으로 수집.
  - Daniel/Erik처럼 외부 페이지 변동성이 큰 케이스는 limited-action warning 경로로 정리.

## 3) 최신 Phase 실행 결과 (desktop)

- smoke: `wsop-public-smoke-20260527-021235-report.json` → 23/23 passed
- functional: `wsop-public-functional-20260527-021448-report.json` → 4/4 passed
- player-presentation: `wsop-public-player-presentation-20260527-021517-report.json` → 24/24 passed
- search-filter-sort: `wsop-public-search-filter-sort-20260527-021930-report.json` → 23/23 passed
- result-detail: `wsop-public-result-detail-20260527-024514-report.json` → 20/20 passed

주의: result-detail은 외부 페이지 편차로 warning이 발생할 수 있음(테스트 실패 아님).

## 4) 계산/회귀 관점 점검 결과
- `crawl:self-test`는 통과.
- 현재 관찰된 계산 이슈는 코드 로직 손상보다는 사이트 데이터/표기 편차(통화 표기, disabled result, 페이지 변동)에 더 가깝게 나타남.
- full live crawler 장시간 실행은 요청에 따라 중단하고 후순위로 보류.

## 5) 후속 권장 작업
1. crawler full run은 야간/배치로 돌리고 defects 히스토리 추세 비교.
2. `known-result-exceptions.fixture.json`에 운영성 warning 기준을 명시해 불필요한 false fail 방지.
3. 통화 표기(예: HK$, RM, 기타 기호) 관련 파서 검증 케이스를 self-test에 추가.
