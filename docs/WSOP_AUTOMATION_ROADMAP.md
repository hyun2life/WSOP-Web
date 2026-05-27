# WSOP Web Automation 테스트 로드맵

본 문서는 WSOP Web Automation 프로젝트의 전체 단계별(Phase 1 ~ Phase 9) 테스트 아키텍처 및 구현 로드맵을 정의합니다.

---

## 1. 전체 Phase 목록 및 구현 상태

| 단계 (Phase) | 목적 | 현재 상태 | 관련 npm 스크립트 | 완료 기준 |
| :--- | :--- | :---: | :--- | :--- |
| **Phase 1** | 공개 페이지 Smoke 테스트 | **완료 (Done)** | `npm run test:smoke` | 주요 공개 페이지 응답(200) 및 핵심 요소 표시 여부 확인 |
| **Phase 2** | 핵심 탐색 기능 흐름 검증 | **완료 (Done)** | `npm run test:functional` | Schedule, Search, Standings, News 상세 진입 흐름 정상 작동 |
| **Phase 3** | 플레이어 표현 및 식별 UI | **완료 (Done)** | `npm run test:phase3` | 플레이어 이름, 국기, 아바타 및 Legend 10인 특수 표식 확인 |
| **Phase 4** | 검색, 필터, 정렬 심화 조작 | **완료 (Done)** | `npm run test:phase4` | 검색 edge case, 정렬 토글, 페이징 안정성 UI 깨짐 감지 |
| **Phase 5** | 결과 상세 양방향 연결 무결성 | **완료 (Done)** | `npm run test:phase5` | 프로필 결과 row 클릭 시 대회 결과 이동 및 프로필 백링크 복귀 |
| **Phase 6** | 데이터 및 API 정합성 검증 | **완료 (Done)** | `npm run test:phase6` | Fixture/스냅샷 데이터와 실제 UI 수치 데이터 1:1 비교 검증 |
| **Phase 7** | 성능 및 구동 안정성 모니터링 | **완료 (Done)** | `npm run test:phase7` | 페이지 로딩 속도, 병목 자산 및 반복 실행 시 Flaky 여부 판독 |
| **Phase 8** | 화면 레이아웃 회귀 검증 | **초기 완료 (Initial Done)** | `npm run test:phase8` | Viewport별 스크린샷 baseline 기반 픽셀/레이아웃 겹침 탐지 |
| **Phase 9** | 릴리즈 전용 전체 회귀 스위트 | **초기 완료 (Initial Done)** | `npm run test:phase9` | 배포 게이트로 동작하기 위한 핵심 시나리오 선별 실행 |

---

## 2. 다음 단계 및 확장 후보

### Phase 8 (화면 회귀 검증) 확장 계획
- **목적**: 디바이스 뷰포트(데스크톱 및 모바일) 기준 UI의 시각적 결함(레이아웃 깨짐, 디자인 변경) 자동 감색.
- **주요 내용**: Playwright `toHaveScreenshot` 기능 연동, 동적 텍스트 영역(상금 수치, 날짜) ignore 설정 가이드라인 수립.

### Phase 9 (전체 회귀 검증) 패키징 계획
- **목적**: 빌드/배포 파이프라인(CI) 최종 승인용 통합 검증 패키지.
- **주요 내용**: 실행 속도를 극대화한 Quick, 디폴트 릴리즈 검증용 Standard, 시각적 검사가 결합된 Extended 및 Release(with Visual/Crawl) 게이트웨이를 구성하여 목적별 배포 승인 증적 확보.

