# WSOP Web Automation 테스트 백로그

본 문서는 WSOP Web Automation과 크롤러 모듈의 잔여 과제 및 고도화 백로그 목록을 관리합니다.

---

## 1. Phase별 백로그 목록

### Phase 6 (데이터/API 정합성) 백로그
- [ ] **API DataSource 실시간 연동**
  - **우선순위**: High
  - **설명**: 고정된 Fixture 대신 실제 live API 응답 값을 직접 fetch하여 실시간 데이터 정합성을 점검합니다.
- [ ] **DB DataSource 연결 검증**
  - **우선순위**: Medium
  - **설명**: 로컬 혹은 스테이징 데이터베이스와의 직접 연결을 통해 가공 전 원천 데이터와 최종 UI 정합성을 보증합니다.
- [ ] **수계산 검증 공식 고도화**
  - **우선순위**: Medium
  - **설명**: 캐시 합산, 반지 및 팔찌 개수의 논리적 우승 공식이 입상 내역 로직과 어긋나지 않는지 종합 검증식을 보강합니다.

### Phase 7 (성능/안정성) 백로그
- [ ] **Lighthouse / Core Web Vitals 연동 검토**
  - **우선순위**: High
  - **설명**: Playwright 실행 시 구글 Lighthouse 모듈을 결합하여 LCP, FID, CLS 등 사용자 경험 지표를 함께 측정합니다.
- [ ] **CI 파이프라인 성능 이력 비교 (P95/P99 추적)**
  - **우선순위**: Medium
  - **설명**: 빌드 실행 시마다 이전 빌드의 P95/P99 지연 시간과 대조하여 성능 저하(Performance Regression)를 탐지합니다.
- [ ] **스테이징/운영(Stage/Prod) 환경별 임계치 동적 분리**
  - **우선순위**: Medium
  - **설명**: 일반적으로 느린 Stage 개발 환경의 특성을 반영하여 Base URL에 따라 Threshold를 유연하게 스위칭합니다.
- [ ] **검색어 자동완성 리다이렉트 타이밍 모니터링**
  - **우선순위**: High
  - **설명**: 검색창 입력 시 자동으로 프로필 상세로 이동하는 SPA 특성을 고려해, 레이싱(Promise.race) 대기 구조의 지연 임계치를 보정합니다.
- [ ] **모바일 뷰포트(mobile-chrome) 성능 측정 확장**
  - **우선순위**: Medium
  - **설명**: 데스크톱 환경 외에 모바일 Chrome 브라우저 환경에서의 주요 페이지 성능 지연 추이를 병렬 수집합니다.

### Phase 8 (화면 회귀) 백로그
- [ ] **Visual Baseline Review Checklist 구축**
  - **우선순위**: High
  - **설명**: 새로 업데이트된 시각적 베이스라인을 검토할 때 검수자가 체크해야 할 레이아웃 가이드라인 목록을 명세화합니다.
- [ ] **핵심 세부 요소에 대한 Strict Snapshot 검증 도입**
  - **우선순위**: Medium
  - **설명**: Player Card, Flag/Avatar 배지 영역 및 Schedule Card의 레이아웃 어긋남을 감지하기 위한 엄격한 임계치(1.5% 미만) 검증 케이스를 확대합니다.
- [ ] **모바일 뷰포트 레이아웃 Baseline 커버리지 확대**
  - **우선순위**: Medium
  - **설명**: 주요 페이지 외에 상세/검색 결과 페이지 등 모바일 브라우저 환경의 반응형 레이아웃 회귀 검증을 확대합니다.
- [ ] **Visual Diff 리포트 HTML 요약 개선**
  - **우선순위**: Low
  - **설명**: Playwright 기본 HTML 리포트에 시각적 차이점 요약을 한글로 주입하고, 통계 분석 파일을 확장합니다.
- [ ] **Multi-worker 병렬 실행 시 리포트 JSON 덮어쓰기 경쟁 상태 해결**
  - **우선순위**: High
  - **설명**: 여러 worker 프로세스가 동시에 `visual-summary.json`에 기록할 때 발생하는 레이스 컨디션을 방지하기 위해 globalTeardown 취합 구조를 적용합니다.
- [ ] **뉴스 목록 와이어프레임 구조 단위 스냅샷 대조 방안 도입**
  - **우선순위**: Medium
  - **설명**: 내용물 변경이 잦은 뉴스 본문/이미지를 모두 마스킹하더라도 레이아웃 정렬선(Flex/Grid)만 대조하여 깨짐을 감지하도록 설계합니다.


### Phase 9 (전체 회귀) 백로그
- [ ] **자동 알림 연동 (Slack / Discord)**
  - **우선순위**: Medium
  - **설명**: 테스트 실패나 심각한 지연 발견 시 웹훅(Webhook)을 통해 개발 그룹 채널로 HTML 결과 링크를 자동 전송합니다.
- [ ] **회귀 트렌드 히스토리 및 평균 실행 시간 모니터링**
  - **우선순위**: Medium
  - **설명**: 각 스위트 실행 시마다 걸린 시간을 축적하여 특정 커밋 이후 성능/지연 저하가 심각해지는 트렌드를 감지합니다.
- [ ] **CI Pipeline Matrix 및 Flaky Test 격리(Quarantine) 자동화**
  - **우선순위**: High
  - **설명**: Flaky한 테스트가 빌드를 임의 차단하지 못하도록 Release Gate 규칙에서 격리 상태로 동적 지정하는 격리 필터를 구현합니다.
- [ ] **릴리즈 증적 꾸러미(Release Evidence Pack) 자동 압축 및 보존**
  - **우선순위**: Low
  - **설명**: 회귀 스위트 완료 후 결과 JSON, 마크다운, Playwright HTML 리포트를 Zip 형태로 묶어 배포 증적으로 장기 보존합니다.


### Crawler 백로그
- [ ] **크롤링 카테고리 범위 확대**
  - **우선순위**: High
  - **설명**: TOP 50 플레이어를 넘어 full standing 데이터 및 상세 대회 입상 정보를 대량 수집할 수 있도록 배치 안정성을 보완합니다.
- [ ] **크롤러 리포트 한글 인덱싱 개선**
  - **우선순위**: Medium
  - **설명**: 상금 화폐 단위(₩, ₱) 계산 및 이중 파싱에 대한 수계산 롤백 규칙을 안정화하고 HTML 포맷을 개선합니다.

## 2026-05-28 Phase 9 Regression Review Follow-ups

- [x] Phase 9 suite command는 실제 `package.json` script를 참조해야 합니다. runner에서 `npm run ...` command를 실행 전에 검증하도록 보강했습니다.
- [x] regression suite에서는 `--update-snapshots`, `update:visual-baseline`, `update:phase8-baseline` 같은 visual baseline update 명령을 절대 실행하지 않도록 차단했습니다.
- [x] Phase 7 performance drift는 release blocker가 아니라 warning/review item으로 분류합니다.
- [x] Phase 8 visual baseline missing은 product bug가 아니라 `visual-baseline-missing` review item으로 분류하며, visual-regression step에만 적용합니다.
- [x] `release-with-crawl`의 crawler 실행과 crawler 기반 Phase 6 검증은 non-blocking으로 유지합니다. crawler output missing은 `crawler-output-missing` review item입니다.
- [x] Windows command 실행은 PowerShell script 호출 대신 `cmd.exe /d /s /c`와 process-tree timeout cleanup을 사용합니다.
- [ ] crawler fixture 생성이 실패하거나 output이 없을 때 crawler 기반 Phase 6를 명시적으로 skip 처리하는 dependency/skip 모델을 추가합니다.
- [ ] 반복 로그에서 timeout 또는 selector drift가 확인되는 public-site 테스트는 quarantine/observability suite로 분리합니다.
- [ ] `artifacts/full-regression/latest/release-gate-result.json`의 `ci.shouldFailBuild`만 기준으로 CI를 실패시키는 작은 샘플 workflow/script를 추가합니다.