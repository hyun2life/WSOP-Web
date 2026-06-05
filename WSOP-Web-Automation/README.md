# WSOP Web Automation

`wsop.com` 공개 웹사이트의 smoke, functional flow, player presentation UI, search/filter/sort depth 자동화 프로젝트입니다.

> [!TIP]
> **[테스트 상세 가이드라인 (TEST-GUIDE.md)](../TEST-GUIDE.md)**에서 각 테스트 단계(Phase 1 ~ Phase 9)와 크롤러의 구체적인 시나리오, 검증 항목, 명령어들을 통합 가이드로 제공합니다.

목표는 단계별로 다릅니다. Phase 1은 배포 후 주요 공개 페이지가 정상적으로 열리는지 빠르게 확인하고, Phase 2는 사용자의 핵심 탐색 흐름을 검증하며, Phase 3은 플레이어가 공개 웹 화면에서 올바르게 식별되고 표현되는지 확인합니다.

## 주요 기능

- Playwright 기반 공개 페이지 smoke test
- Chromium desktop 및 Pixel 7 mobile 프로젝트 지원
- 공개 페이지 HTTP status 및 핵심 문구 확인
- 상단 네비게이션 라벨/목적지 도달성 확인
- 콘솔 에러 수집 및 known noisy third-party/SSE 에러 제외
- wsop.com 내부 링크 샘플 상태 확인
- Playwright 기본 HTML Report 생성
- 별도 한글/영문 최종 smoke 리포트 생성
- Phase 3 Player Presentation & Identity UI 검증
- Phase 4 Search / Filter / Sort Depth 검증
- Phase 5 Result Detail Integrity 검증
- Phase 6 Data/API Integrity 검증
- Phase 7 Performance/Stability 검증
- Phase 8 Visual Regression 검증
- Phase 9 Regression Runner 및 Release Gate 산출물 생성
- 실패 시 screenshot, trace, video 저장

## 폴더 구조

```text
WSOP-Web/
  Run.bat                         # 통합 대시보드 실행
  Setup.bat                       # 전체 의존성 설치
  WSOP-Web-Automation/
    automation/
      output/                       # custom smoke report output
    data/
      public-pages.ts               # smoke 대상 공개 페이지 목록
    scripts/
      wsop-smoke-html-reporter.cjs  # 한글/영문 최종 리포트 reporter
    tests/
      smoke/
        public-pages.spec.ts
        navigation.spec.ts
        console-error.spec.ts
        links.spec.ts
      functional/
      player-presentation/
      search-filter-sort/
    fixtures/
      player-presentation/
      search-filter-sort/
    utils/
      playerPresentation/
      searchFilterSort/
    playwright.config.ts
    package.json
```

## 배포 및 초기 설치 (팀원 배포 시)

프로젝트 폴더를 배포하기 전에, 용량이 거대하고 로컬 환경 종속성이 있는 **`node_modules` 폴더는 반드시 삭제하고 압축**하여 전달해 주세요.

팀원들은 압축을 푼 뒤 최초 1회 아래 절차에 따라 초기 설정을 완료해야 대시보드와 테스트가 정상 작동합니다.

### 1. 전제 조건

- 각 팀원의 PC에 **Node.js (LTS 버전)**가 설치되어 있어야 합니다. (다운로드: [https://nodejs.org/](https://nodejs.org/))

### 2. 폴더 배치 요건 (크롤러 연동 필수)

크롤러 테스트 구동 및 리포트 팝업 연동이 정상 작동하려면 아래와 같이 `WSOP-Web` 상위 폴더 아래에 두 하위 프로젝트가 형제(Sibling)로 나란히 배치되어야 합니다.

```text
WSOP-Web/
  ├─ Run.bat
  ├─ Setup.bat
  ├─ WSOP-Web-Automation/ (본 프로젝트)
  └─ WSOP-Player-Standings-Crawler/ (크롤러 프로젝트)
```

### 3. 원클릭 초기 셋업 (Setup.bat)

상위 `WSOP-Web` 폴더에 있는 **`Setup.bat`** 파일을 실행합니다. 스크립트가 로컬 Node.js/npm 유무를 검사한 후, Web Automation과 Player Standings Crawler의 npm 의존성 및 Playwright Chromium을 함께 설치합니다.

## 실행 방법

### Windows BAT (통합 웹 대시보드 실행 및 종료)

- **대시보드 실행 (`..\Run.bat`)**: 상위 `WSOP-Web` 폴더의 `Run.bat`을 더블클릭하면 백그라운드(콘솔 창 숨김 모드)에서 웹 서버가 기동되며, 브라우저 새 탭에서 **Web UI 테스팅 대시보드**가 자동으로 열립니다.
- **대시보드 실행 로그**: 연결 거부나 브라우저 자동 열림 실패가 발생하면 `automation/output/web-runner-server.out.log`와 `automation/output/web-runner-server.err.log`를 확인합니다.
- **대시보드 강제 종료 (`..\Stop-Dashboard.bat`)**: 서버가 남아 있거나 브라우저 연결이 꼬였을 때만 수동 실행합니다. 실행 중인 대시보드 테스트까지 종료될 수 있으므로 라이브 테스트 중에는 사용하지 않습니다.
- **대시보드 종료**: 대시보드 웹 화면 좌측 사이드바 하단에 있는 **`Shutdown Dashboard`** 버튼을 클릭하면, 실행 중인 백그라운드 서버 프로세스가 스스로 안전하게 종료되고 연결을 해제합니다.

### npm scripts

```bat
npm run test:smoke
npm run test:smoke:headed
npm run test:smoke:ui
npm run test:smoke:mobile
npm run test:smoke:all
npm run test:functional
npm run test:player-presentation
npm run test:phase3
npm run test:search-filter-sort
npm run test:phase4
npm run test:result-detail
npm run test:phase5
npm run test:data-integrity
npm run test:phase6
npm run test:performance-stability
npm run test:phase7
npm run test:visual-regression
npm run test:phase8
npm run test:phase9
npm run test:regression:quick
npm run test:regression:standard
npm run test:regression:extended
npm run test:release
npm run test:release:with-visual
npm run test:release:with-crawl
```

## 리포트

Playwright 기본 리포트:

```bat
npm run report
```

custom 한글 최종 리포트:

```bat
npm run report:smoke:ko
```

custom 영문 최종 리포트:

```bat
npm run report:smoke:en
```

생성 위치:

```text
automation/output/wsop-public-smoke-*-report-ko.html
automation/output/wsop-public-smoke-*-report.html
automation/output/wsop-public-smoke-*-report.json
automation/output/wsop-public-smoke-*-playwright-report/index.html
automation/output/wsop-public-functional-*-report-ko.html
automation/output/wsop-public-functional-*-report.html
automation/output/wsop-public-functional-*-report.json
automation/output/wsop-public-functional-*-playwright-report/index.html
automation/output/wsop-public-player-presentation-*-report-ko.html
automation/output/wsop-public-player-presentation-*-report.html
automation/output/wsop-public-player-presentation-*-report.json
automation/output/wsop-public-player-presentation-*-playwright-report/index.html
automation/output/wsop-public-search-filter-sort-*-report-ko.html
automation/output/wsop-public-search-filter-sort-*-report.html
automation/output/wsop-public-search-filter-sort-*-report.json
automation/output/wsop-public-search-filter-sort-*-playwright-report/index.html
automation/output/wsop-public-result-detail-*-report-ko.html
automation/output/wsop-public-result-detail-*-report.html
automation/output/wsop-public-result-detail-*-report.json
automation/output/wsop-public-result-detail-*-playwright-report/index.html
automation/output/wsop-public-data-integrity-*-report-ko.html
automation/output/wsop-public-data-integrity-*-report.html
automation/output/wsop-public-data-integrity-*-report.json
automation/output/wsop-public-data-integrity-*-playwright-report/index.html
automation/output/wsop-public-performance-stability-*-report-ko.html
automation/output/wsop-public-performance-stability-*-report.html
automation/output/wsop-public-performance-stability-*-report.json
automation/output/wsop-public-performance-stability-*-playwright-report/index.html
automation/output/wsop-public-visual-regression-*-report-ko.html
automation/output/wsop-public-visual-regression-*-report.html
automation/output/wsop-public-visual-regression-*-report.json
automation/output/wsop-public-visual-regression-*-playwright-report/index.html
automation/output/wsop-public-regression-*-report-ko.html
automation/output/wsop-public-regression-*-report.html
automation/output/wsop-public-regression-*-report.json
artifacts/full-regression/latest/regression-summary.md
artifacts/full-regression/latest/regression-summary.html
artifacts/full-regression/latest/regression-summary-ko.html
artifacts/full-regression/latest/release-gate-result.json
automation/output/wsop-public-*-attachments/
test-results/
```

Smoke 리포트는 `WSOP-Player-Standings-Crawler`와 동일하게 실행 timestamp가 포함된 파일명으로 누적 저장합니다. 예:

```text
automation/output/wsop-public-smoke-20260525-015233-report.json
automation/output/wsop-public-smoke-20260525-015233-report.html
automation/output/wsop-public-smoke-20260525-015233-report-ko.html
automation/output/wsop-public-smoke-20260525-015233-playwright-report/index.html
```

`wsop-public-smoke-latest-report*.html` 같은 덮어쓰기 파일은 더 이상 생성하지 않습니다. `npm run report:smoke:ko`, `npm run report:smoke:en`, `npm run report`는 `automation/output`에서 가장 최근 날짜별 리포트를 찾아 엽니다.

Functional 리포트는 smoke와 분리해서 `wsop-public-functional-{timestamp}-...` prefix로 저장합니다. 예:

```text
automation/output/wsop-public-functional-20260525-021500-report.json
automation/output/wsop-public-functional-20260525-021500-report.html
automation/output/wsop-public-functional-20260525-021500-report-ko.html
automation/output/wsop-public-functional-20260525-021500-playwright-report/index.html
```

Functional 리포트 열기:

```bat
npm run report:functional:ko
npm run report:functional:en
npm run report:functional
```

한글 리포트가 기본 검토 대상입니다. 영문 리포트는 동일 데이터를 영어 UI로 보여줍니다.

## 대상 공개 페이지

대상 목록은 [data/public-pages.ts](./data/public-pages.ts)에 있습니다.

- Home: `/`
- Tournament Schedule: `/schedule/`
- Player Standings: `/player-standings/`
- Player Search: `/player-search/`
- Hall of Fame: `/hall-of-fame/`
- News: `/news/`

문구 검증은 brittle하지 않도록 최소 핵심 문구만 사용합니다. 실제 wsop.com 문구가 바뀌면 `expectedTexts`를 먼저 조정하세요.

## 설정

### 1. 테스트 대상 URL 변경 (Live / Stage / Custom)

기본 테스트 대상 URL은 `https://www.wsop.com` (Live) 입니다.

#### A. 통합 웹 대시보드 및 GUI 러너에서 스위칭 (권장)

- **웹 대시보드**: 우측 **`Execution Settings`** 패널의 **`Target Environment`** 드롭다운에서 `Live`, `Stage`, `Custom`을 선택할 수 있으며, 선택 즉시 환경변수가 동적으로 적용됩니다.
- **Forms GUI 러너**: 상단의 **`Target Environment`** 드롭다운에서 선택할 수 있으며, Custom URL의 경우 직접 텍스트박스에 타이핑하여 주입할 수 있습니다.

#### B. CLI 환경변수 수동 설정

CLI에서 특정 환경을 직접 테스트하려면 `BASE_URL` 환경변수를 설정하고 실행합니다.

```bat
:: Stage 환경 테스트 시
set BASE_URL=https://wsop-stage.ggnweb.com
set ENVIRONMENT=stage
npm run test:smoke
```

`ENVIRONMENT`는 Phase 3에서 avatar/image 미노출을 hard fail로 볼지 warning으로 볼지 판단할 때 사용합니다. 값은 `production` 또는 `stage`를 사용하며, 지정하지 않으면 `production`으로 간주합니다.

### 2. 웹 대시보드 서버 환경설정 (원격 / 회사 서버 배포 시)

본 웹 테스팅 대시보드는 로컬뿐 아니라 **회사 공용 서버나 원격 VM**에서도 구동할 수 있도록 설계되었습니다. 아래의 환경 변수들을 통해 배포 환경에 맞춰 설정을 제어할 수 있습니다.

- **`PORT`**: 대시보드가 통신을 수신할 포트 (기본값: `3000`)
- **`HOST`**: 바인딩할 네트워크 어댑터 IP (기본값: `0.0.0.0` - 모든 네트워크 인터페이스를 통한 접근 허용)
- **`AUTO_LAUNCH`**: 서버 기동 시 브라우저 창 자동 팝업 여부 (기본값: `true`, 원격 헤드리스 서버 등에서 자동 열기를 생략할 때는 `false` 주입)

**회사/원격 서버 기동 예시:**

```bat
:: 포트를 8080으로 스위칭하고, 서버 자체 브라우저 자동 팝업은 비활성화
set PORT=8080
set AUTO_LAUNCH=false
node scripts/web-runner-server.js
```

서버를 기동한 뒤, 같은 사무실 망 내의 팀원들은 각자 브라우저 주소창에 `http://(서버_IP_주소):8080`을 입력하여 공용 테스팅 채널로 원격 제어 및 모니터링이 가능합니다.

## 유지보수 포인트

- wsop.com 상단 메뉴는 현재 desktop에서 `header nav li` 라벨 중심으로 렌더링됩니다.
- mobile에서는 햄버거 메뉴와 slide-out nav 구조 때문에 hover/click이 불안정할 수 있어 라벨 존재와 목적지 도달성을 분리해서 확인합니다.
- `Play Online`은 현재 안정적인 wsop.com 내부 anchor가 노출되지 않아 label-only smoke로 처리합니다.
- Schedule/Standings 등 일부 페이지에서 `[SSE] EventSource failed for maintenance` 콘솔 에러가 발생할 수 있습니다. 페이지 핵심 로딩과 무관한 noisy error로 ignore 처리했습니다.
- 링크 체크는 사이트 부하 방지를 위해 페이지당 최대 30개만 검사합니다.
- 일부 보안/봇 차단 정책으로 내부 링크 request가 `403` 또는 `405`를 반환할 수 있어 smoke 기준에서는 reachable-but-blocked로 허용합니다.
- 더 엄격한 릴리즈 게이트가 필요하면 `tests/smoke/links.spec.ts`의 허용 status code 정책을 조정하세요.

## 산출물 제외

아래 생성물은 `.gitignore` 대상입니다.

```text
node_modules/
test-results/
playwright-report/
blob-report/
automation/output/
```

## Phase 2 functional flow tests

2차 자동화는 단순 접근 smoke를 넘어 public web 사용자가 실제로 정보를 탐색하는 핵심 흐름을 검증합니다.

## Phase 3 player presentation tests

3차 자동화는 Data/API Integrity가 아니라, WSOP.com 공개 웹 화면에서 플레이어가 올바르게 식별되고 표현되는지 확인합니다.

검증 범위:

- Player Profile의 브랜드 및 시즌년도 필터 적용 및 필터링된 요약 수치(Cashes 등)와 이벤트 목록 정합성 검증
- Player Standings 상위 플레이어 노출 및 profile 연결
- Player Standings UI는 기존 크롤러의 `--standings-only` 모드로 빠르게 추출한 최신 standings 대상자를 기준으로 이름, profile link, 국가/국기 후보로 보이는지 확인
- Player Search에서 모든 플레이어를 전수 입력하지 않고, fixture에 정의한 대표 탑랭커 중심으로 이름 입력 시 검색창 하단 자동완성 row와 검색 결과에 해당 인물이 노출되는지 확인
- Player Profile의 이름, 국가/국기, avatar/profile image 후보 확인
- Player Profile 요약 영역의 `badge_WSOPBracelet.webp`, `badge_WSOPRing.webp` 표시 개수와 Bracelets/Rings 요약값 일치 여부 확인
- Player Standings의 `All-Time Earnings - Men/Women`, `All-Time Bracelets`, `All-Time Rings` row 값과 Player Profile 요약값(`Total Earnings`, `Bracelets`, `Rings`) 일치 여부 확인
- Hall of Fame, Player of the Year, Legend 10인 특수 프로필 페이지 표현 확인
- stage 환경의 avatar/image 미노출, optional badge/mark 미노출은 warning으로 수집

의도적으로 제외한 항목:

- earnings, bracelets, rings, cashes 등 수치 정확성
- API 응답과 UI 값 비교
- DB 조회
- 전체 플레이어 전수 크롤링
- visual snapshot baseline 비교

실행 명령:

```bat
npm run test:player-presentation
npm run test:phase3
```

`npm run test:phase3`와 `npm run test:player-presentation`은 먼저 sibling 프로젝트 `WSOP-Player-Standings-Crawler`의 standings-only 수집을 실행한 뒤 Playwright Phase 3 테스트를 실행합니다. 기본 수집량은 standings 카테고리별 50명(View full list 첫 페이지 기준)이며, 필요하면 `PHASE3_STANDINGS_LIMIT` 환경변수로 조정할 수 있습니다.
최신 HOF 명단(50인 이상) 전체 E2E 테스트가 최적화되어 포함되어 있으며, `/hall-of-fame/` 본문 1차 필터링 및 리로드 없는 검색 방식을 도입하여 수행 속도를 대폭 개선하였습니다. 또한 비플레이어 기여자(Non-player contributor)는 `knownExceptionKey: "non-player"` 및 `warningOnly: true` 정책에 따라 프로필 로드 실패를 warning으로 안전하게 예외처리 합니다.

주요 파일:

```text
tests/player-presentation/player-profile-filter.spec.ts  # 신규 필터 검증 스펙
fixtures/player-presentation/filter-players.fixture.json   # 필터 검증용 픽스처
utils/playerPresentation/playerPresentationChecks.ts       # 필터 적용 공통 헬퍼 포함
```

Standings UI 검증은 full crawler 산출물에 의존하지 않습니다. Phase 3 runner가 먼저 `WSOP-Player-Standings-Crawler`의 `--standings-only` 모드를 실행해 standings 카테고리별 선수 이름, rank, profile URL, source URL만 빠르게 추출하고, 이 최신 대상자 기준으로 이름, 프로필 링크, 국가/국기, 이미지 후보를 확인합니다. Profile/Result 상세 크롤링은 수행하지 않습니다.

Phase 3 custom 리포트는 standings-only crawler가 추출한 선수 대상자와 Legend 10 특수 프로필 대상자를 기준으로 **플레이어 UI 커버리지 카드**를 포함합니다. Standings 카드에는 category/rank/name/profile/source와 함께 `행`, `이름`, `링크`, `국가/국기`, `이미지` 상태가 표시됩니다. Legend 특수 프로필 카드에는 profile/source와 함께 `프로필 접근`, `특수 페이지`, `특수 신호` 상태와 실제 확인된 legend 신호가 표시됩니다. `국가/국기` 및 특수 페이지 신호는 hard fail 기준이고, `이미지`는 stage/prod asset 차이를 고려해 warning으로 남길 수 있습니다. `All Player Stats` 카테고리는 목록 row 이미지 대신 실제 프로필 페이지 진입 후 이미지 노출을 기준으로 `정상/주의`를 판정합니다.

Legend 검증 기준은 Johnny Moss, David Reese, Stu Ungar, Phil Hellmuth, Erik Seidel, Daniel Negreanu, Christopher Moneymaker, Phil Ivey, Johnny Chan, Doyle Brunson 10명입니다. 각 선수는 `/players/{slug}/` 특수 프로필 페이지에서 이름, 국가/국기, avatar/profile image 후보와 함께 `Hall of Famer`, `Poker Hall of Fame Inductee`, 별칭 또는 `Story` 탭 등 legend 전용 신호가 노출되는지 확인합니다.

## Phase 4 search / filter / sort depth tests

4차 자동화는 Data/API Integrity가 아니라 공개 목록 UI의 조작성을 검증합니다. Player Search, Player Standings, POY 페이지에서 검색어 입력, 검색 결과 링크, 탭/섹션 전환, 카테고리 이동, 정렬 UI, pagination/load more가 깨지지 않는지 확인합니다.

Phase 4 standings category depth에는 `All Player Stats` 필터 진입 후 필터 전환 및 정렬 동작 검증과, 숫자형 pagination에서 마지막 페이지 클릭 시 최대 페이지 번호가 비정상적으로 증가하지 않는지 확인하는 안정성 검증이 포함됩니다.

검증 범위:

- Player Search 대표 탑랭커 검색어 입력 후 결과와 `/players/` 프로필 링크 확인
- 대소문자, 부분 검색어, 앞뒤 공백, 결과 없음, 비영문 검색어 edge case 확인
- Trending, Winners, Player of the Year, Hall of Fame 영역 또는 탭 전환 확인
- Player Standings 주요 카테고리와 View full list 이동 확인
- 정렬 UI나 pagination/load more가 있으면 클릭 후 리스트가 깨지지 않는지 확인
- POY 현재 리더보드와 Previous WSOP Player of the Year Winners 영역 표시 확인

의도적으로 제외하는 항목:

- earnings, bracelets, rings, cashes, POY points 수치 정확성
- API 응답과 UI 값 비교
- DB 조회
- 전체 플레이어/전체 standings 전수 검증
- visual snapshot baseline 비교
- 성능 측정

실행 명령:

```bat
npm run test:search-filter-sort
npm run test:phase4
```

주요 파일:

```text
tests/search-filter-sort/
fixtures/search-filter-sort/
utils/searchFilterSort/
```

Phase 4 warning 기준은 비영문 검색 인덱싱 차이, 클릭 가능한 탭이 아니라 섹션 heading 구조인 경우, sort/pagination/load more UI 부재, 일부 standings full list URL 변경 가능성입니다. 대표 플레이어 검색 결과에서 프로필 링크를 찾을 수 없거나, standings/POY 핵심 영역이 접근 가능한데도 미노출이면 hard fail로 처리합니다.

## Phase registry

장기 자동화 단계는 [automation/phases.json](./automation/phases.json)에서 중앙 관리합니다. 새 단계가 추가될 때는 먼저 이 파일에 phase id, report suite, test folder, Playwright project, 구현 여부를 등록합니다.

현재 등록 구조:

```text
phase1  smoke                  tests/smoke
phase2  functional             tests/functional
phase3  player-presentation    tests/player-presentation
phase4  search-filter-sort     tests/search-filter-sort
phase5  result-detail          tests/result-detail-integrity  implemented
phase6  data-integrity         tests/data-integrity           implemented
phase7  performance-stability  tests/performance-stability    implemented
phase8  visual-regression      tests/visual-regression        implemented
phase9  regression             tests/regression               implemented
crawler crawler                ../WSOP-Player-Standings-Crawler implemented
phase10 notification           tests/notification             planned
phase11 api-db-integration     tests/api-db-integration       planned
phase12 lighthouse             tests/lighthouse               planned
```

공통 실행기:

```bat
npm run phase:list
npm run test:phase1
npm run test:phase2
npm run test:phase3
npm run test:phase4
npm run test:phase5
npm run test:phase6
npm run test:phase7
npm run test:phase8
npm run test:phase9
```

또는 상위 통합 GUI 실행기(`..\Run.bat`)를 통해 각 Phase를 선택해 실행할 수 있습니다.

추가 Playwright 옵션은 `--` 뒤에 전달합니다.

```bat
npm run test:phase2 -- --headed
```

각 phase는 `reportSuite` 기준으로 별도 prefix의 리포트를 남깁니다.

```text
automation/output/wsop-public-smoke-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-functional-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-player-presentation-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-search-filter-sort-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-result-detail-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-data-integrity-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-performance-stability-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-visual-regression-YYYYMMDD-HHMMSS-...
automation/output/wsop-public-regression-YYYYMMDD-HHMMSS-...
```

유지보수 원칙:

- phase별 테스트는 `tests/<phase-area>/` 아래에 둡니다.
- phase별 공통 helper는 해당 폴더의 `support.ts` 또는 `fixtures.ts`에서 시작하고, 여러 phase가 공유할 때만 `tests/support/`로 승격합니다.
- 새 phase를 실제 실행 가능하게 만들 때는 `automation/phases.json`의 `implemented`를 `true`로 바꾸고 README 실행/산출물 설명을 갱신합니다.
- `reportSuite`는 파일명 prefix에 들어가므로 짧고 안정적인 kebab-case를 사용합니다.

대상 흐름:

- Tournament Schedule: `/schedule/` 진입, schedule tab/filter 클릭 가능 여부, tournament detail 진입, list/detail 이벤트명 연계 확인
- Player Search: `/player-search/` 진입, 검색 입력이 있으면 `Phil Hellmuth` 검색, 없거나 결과가 불안정하면 현재 player list 첫 항목으로 profile 진입
- Player Standings: `/player-standings/` 진입, All-Time Earnings/Bracelets/Rings 랭킹 영역 확인, ranking player profile 진입
- News: `/news/` 진입, 첫 news article 제목 저장, detail 진입, 제목/date/image/body 영역 확인

추가 파일:

```text
tests/functional/
  support.ts
  tournament-schedule.spec.ts
  player-search.spec.ts
  player-standings.spec.ts
  news.spec.ts
```

실행 명령:

```bat
npm run test:functional
npm run test:phase2
```

두 script 모두 아래 Playwright 명령을 실행합니다.

```bat
playwright test tests/functional --project=chromium-desktop
```

Windows BAT (통합 웹 대시보드):

```bat
cd ..
Run.bat
```

상위 `Run.bat`은 이 프로젝트의 로컬 웹 서버를 구동시켜 브라우저에서 웹 대시보드를 띄웁니다. 대시보드는 `automation/phases.json`을 읽기 때문에 새로운 phase가 추가되면 자동으로 사이드바 목록에 연동됩니다. 웹 대시보드에서 할 수 있는 작업은 다음과 같습니다.
실행 배치는 `Get-NetTCPConnection`으로 `localhost:3000` 리스닝 상태를 확인하며, 서버 시작 stdout/stderr 로그를 `automation/output/web-runner-server.*.log`에 남깁니다.

- **대상 환경 실시간 스위칭**: `Target Environment` 선택 드롭다운을 통해 별도의 콘솔 타이핑이나 환경변수 수동 세팅 없이, 마우스 클릭만으로 `Live (https://www.wsop.com)` / `Stage (https://wsop-stage.ggnweb.com)` / `Custom URL` 환경을 즉각 오버라이딩하여 테스트 및 크롤러 구동 가능
- **페이즈 카드 선택 및 실행**: 좌측 카드 목록에서 대상을 원클릭으로 선택 및 실행
- **한글 Phase 안내**: 좌측 카드에는 한글 Phase 이름과 짧은 요약을 표시하고, 상세 패널에는 목적 설명과 검증 스텝을 한글로 표시합니다. Phase 3은 standings-only crawler로 추출한 플레이어 UI 검증 흐름을 단계별로 확인할 수 있습니다.
- **실행 옵션 및 모드 튜닝**: Normal / Headed / UI 모드 선택 및 체크박스 기반 추가 매개변수(Limit, Concurrency, Grep, Timeout 등) 실시간 토글링 및 텍스트박스 입력. 크롤링 대시보드에서는 플레이어 크롤러의 `Limit Players`/`Result Limit`, 토너먼트 크롤러의 `Limit Tournaments`/`Limit Events`를 구분해 전달합니다. 토너먼트 구조는 `대회 > 이벤트 > Result` 계층이며, `Limit Events`는 대회별 이벤트 수를 제한하고 미선택 또는 `0`은 전체 이벤트 수집을 의미합니다. 브랜드 필터(WSOP, GGPoker 등)는 체크박스 컨테이너를 통해 다중 선택할 수 있으며, 선택된 브랜드들은 쉼표(`,`) 구분되어 크롤러에 `--brand "WSOP,GGPoker"` 형태로 전달되어 순차 누적 수집됩니다. 수집된 결과인 CSV 및 HTML 리포트에는 brand 필터가 정상적으로 노출되며 헤더 맨 앞 컬럼에 `brand` 구분이 추가됩니다.
- **실시간 터미널 로그 스트리밍**: SSE 채널을 활용해 백그라운드 테스트 실행 콘솔 로그를 컬러풀하게 스트리밍 및 자동 스크롤
- **원클릭 프로세스 제어**: 실행 도중 언제든지 즉시 중단 가능한 **Stop Test** 및 로그 복사/비우기 기능 제공
- **리포트 보기**: 검은색 cmd 깜빡임이나 잔재 창 없이, 새 브라우저 탭으로 즉시 열리는 KO / EN / Playwright Trace 리포트 연동

2차 범위에서 의도적으로 제외한 항목:

- DB/API 정합성 검증
- 토너먼트/플레이어/뉴스 데이터의 원천 값 비교
- 로그인, 결제, 온라인 플레이 기능 검증

유지보수 포인트:

- public site의 접근성 role/name이 바뀔 수 있어 role 기반 selector를 우선 사용하되, 필요 시 `a[href*="..."]` 및 `filter({ hasText })` 기반 selector를 함께 사용합니다.
- News와 Schedule은 live content가 계속 바뀌므로 fixed title 검증 대신 list에서 읽은 제목/이벤트명을 detail에서 다시 확인합니다.
- Phase 2 functional의 Player Search 결과는 동적 검색으로 즉시 필터링되지 않을 수 있어 `Phil Hellmuth` link 우선, 현재 노출된 첫 player link fallback 순서로 검증합니다.
- Phase 3의 Player Search identity 검증은 모든 사용자를 전수 검색하지 않고 `fixtures/player-presentation/top-players.fixture.json`의 대표 탑랭커 샘플을 기준으로 합니다. 이름 입력 후 검색창 하단 `.autocomplete-container`의 suggestion row에 해당 인물과 기대 국가/국기 후보가 보이지 않거나, 검색 결과에 해당 인물이 보이지 않으면 hard fail로 처리합니다. 동일 이름이 여러 profile target으로 보이는 문제는 현재 Phase 3의 검색 UI 기준에서는 hard fail로 삼지 않고, 수치/DB/API 정합성은 Phase 6에서 다룹니다.
- Phase 4의 Player Search 검증도 모든 사용자를 입력하지 않고 `fixtures/search-filter-sort/player-search-cases.fixture.json`의 탑랭커 대표 샘플을 기준으로 합니다. 검색 input이 없는 구조이거나 비영문 검색 인덱싱이 불안정한 경우는 warning으로 남기되, 대표 플레이어 검색에서 `/players/` 링크를 전혀 찾지 못하면 hard fail로 처리합니다.

## 검증 범위에서 제외한 것

이 자동화는 공개 웹 기반 품질 검증(Phase 1~9) 중심입니다. 아래 항목은 현재 범위에 포함하지 않습니다.

- 토너먼트 필터 정확성
- 플레이어 데이터 정합성
- 뉴스 상세 데이터 정합성
- 로그인/결제/온라인 플레이 기능 검증
- 모든 내부 링크 전수 검사

## Phase 9 Regression Runner Notes

Phase 9 회귀 suite는 `fixtures/full-regression/regression-suites.fixture.json`에서 관리하고, 실행기는 `tools/regression/runRegressionSuite.ts`입니다.

주요 명령:

```bat
npm run test:regression:quick
npm run test:regression:standard
npm run test:regression:extended
npm run test:release
npm run test:release:with-visual
npm run test:release:with-crawl
```

정책 메모:

- `quick`은 Phase 1, Phase 2만 required로 실행합니다.
- `standard`는 crawler, visual, performance 없이 Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6를 실행합니다.
- `release`는 Phase 1, Phase 2를 required로 유지하고 Phase 3, Phase 5, Phase 6를 required release 후보로 유지합니다.
- Phase 7과 Phase 8은 기본 release gate에 포함하지 않고 `extended` 또는 명시적 release variant에서 non-blocking으로 실행합니다.
- 기본 release suite는 crawler를 실행하지 않습니다.
- visual baseline update 명령은 regression runner에서 차단하며 자동 실행하지 않습니다.
- optional failure와 warning은 artifact에 남기지만 release gate fail로 만들지 않습니다.

주요 산출물 위치는 `artifacts/full-regression/latest/`입니다.

```text
regression-summary.md
regression-summary.json
regression-failures.json
regression-warnings.json
release-gate-result.json
```

CI는 `release-gate-result.json`의 `ci.shouldFailBuild`가 `true`이거나 `ci.exitCode`가 `1`일 때만 실패 처리하는 것을 권장합니다.

## 대시보드 리포트 선택 (페이즈별)

- Web Dashboard의 `KO / EN / PW Report` 버튼은 선택한 페이즈의 `reportSuite` 기준으로 전체 이력(타임스탬프 리포트)을 불러옵니다.
- 목록에서 어제/오늘 포함 원하는 시점의 리포트를 직접 선택해서 열 수 있습니다.
- 각 HTML 리포트 상단의 `이전 리포트 기록` 드롭다운도 최신 실행 시점 기준으로 전체 이력이 갱신됩니다.
- 따라서 과거 리포트를 열어도 최신 리포트를 같은 드롭다운에서 선택해 이동할 수 있습니다.
- 페이즈 매핑은 고정입니다. (`phase1 -> smoke`, `phase2 -> functional`, `phase3 -> player-presentation`, ...)
- 따라서 다른 페이즈 리포트가 섞여 열리지 않습니다.
- `ALL`은 실행 전용이며, 단일 통합 리포트를 직접 여는 버튼은 제공하지 않습니다.
- 리포트 경로는 기존과 동일합니다.
  - `automation/output/wsop-public-<suite>-YYYYMMDD-HHMMSS-...`
  - `../WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-live-YYYYMMDD-HHMMSS-...` (crawler)

## Brand Integration Comparison

Live/Stage standings-only crawler data(JSON) two files can be compared with canonical-brand aggregation.

Command:

```bat
npm run crawl:brand-compare -- ^
  --live "..\WSOP-Player-Standings-Crawler\automation\output\wsop-player-crawler-live-YYYYMMDD-HHMMSS-data.json" ^
  --stage "automation\output\wsop-public-player-presentation-YYYYMMDD-HHMMSS-standings-targets-data.json"
```

Output:

- `automation/output/wsop-brand-coverage-compare-YYYYMMDD-HHMMSS.csv`
- `automation/output/wsop-brand-coverage-compare-YYYYMMDD-HHMMSS.json`

## 2차 확인 완료

- 크롤러 모드를 `standings-only` / `profile-only` / `full`로 확인했습니다.
- `npm run crawl:brand-compare` 실행으로 Live/Stage 브랜드 비교 리포트와 CSV/JSON을 생성할 수 있습니다.

## Dashboard Brand Options

Crawler 실행 결과 JSON에 `brandOptions`가 저장되면 대시보드는 `/api/brand-options`를 통해 최근 크롤러 JSON의 실제 브랜드 옵션 목록을 읽고 Brand Filter 체크박스를 자동 구성합니다.

- 최신 크롤러 JSON에 `brandOptions.options`가 있으면 Live/Stage 화면에서 수집된 실제 옵션 수와 이름을 우선 사용합니다.
- 최신 데이터가 없으면 기존 기본 브랜드 목록으로 fallback합니다.
- 새 Live/Stage 크롤링을 완료한 뒤 대시보드를 새로고침하면 최근 수집 기준의 브랜드 수가 표시됩니다.

### Brand Compare BAT

루트 폴더의 `RUN_BRAND_COMPARE_LATEST.bat`으로 Live/Stage 브랜드 커버리지 비교를 바로 실행할 수 있습니다.

```bat
RUN_BRAND_COMPARE_LATEST.bat
```

- 인자 없이 실행하면 최신 Live/Stage 후보 JSON을 자동 탐색합니다.
- Stage 후보를 자동으로 찾지 못하면 콘솔에 Stage JSON 경로를 붙여넣어 실행합니다.
- 명시 실행도 가능합니다.

```bat
RUN_BRAND_COMPARE_LATEST.bat "LIVE_DATA_JSON" "STAGE_DATA_JSON"
```

산출물은 `WSOP-Web-Automation/automation/output/wsop-brand-coverage-compare-YYYYMMDD-HHMMSS.*`로 생성됩니다.

## Result 5xx 처리 기준

크롤러가 Result 상세 페이지를 열었을 때 페이지 본문 또는 HTTP 상태가 `502`, `503`, `504` 계열 서버 오류로 판단되면 실제 선수 row 불일치로 판정하지 않습니다.

- `Result page unavailable` 경고로 분리합니다.
- 해당 이벤트의 `resultPage.status`는 `warn`으로 저장됩니다.
- 리포트의 검토/경고 목록에는 남기지만 `Result search incomplete` 또는 `Result page mismatch` 결함으로 집계하지 않습니다.
- 이 케이스는 Stage/Live 서버가 Result 상세 페이지를 정상 응답한 뒤 재실행해서 검증해야 합니다.

## 필터 사용 목적 및 조합 가이드 (Filter Usage Guide)

플레이어 크롤러는 용도에 따라 브랜드 및 시즌 필터를 다음과 같이 조합하여 사용해야 합니다.

### 1. 용도별 필터 조합
* **전체 데이터 정합성 검증 (필터 해제)**:
  * **설정**: `Brand Filter` 및 `Season Filter` 모두 **체크 해제**
  * **용도**: 특정 브랜드나 연도 제한 없이, 전체 역대 랭킹 및 선수 프로필을 기준값(All Seasons / All Brands)으로 검증하고자 할 때 사용합니다.
* **특정 브랜드 중심의 검증**:
  * **설정**: `Brand Filter` **체크 후 특정 브랜드 선택** (예: GGPoker) / `Season Filter` **체크 해제**
  * **용도**: 지정된 브랜드의 스탠딩 데이터를 수집하고, 해당 브랜드 내 모든 시즌에 걸친 프로필 데이터를 일관되게 검증하고자 할 때 사용합니다.
* **특정 시즌(연도) 중심의 검증**:
  * **설정**: `Brand Filter` **체크 해제** / `Season Filter` **체크 후 특정 연도 입력** (예: 2024)
  * **용도**: 전체 브랜드의 스탠딩을 수집하지만, 개별 선수의 프로필로 들어갔을 때는 오직 `2024` 시즌으로 필터링을 변경해 Cashes 개수와 요약 정합성을 맞출 때 사용합니다.
* **특정 브랜드의 특정 시즌 교차 검증**:
  * **설정**: `Brand Filter` 및 `Season Filter` **둘 다 체크 후 설정**
  * **용도**: 특정 브랜드(예: WSOP)의 특정 시즌(예: 2026) 데이터만 정밀 교차 검증하고자 할 때 사용합니다.

### 2. 필터 적용 시 주의사항
* **이중 필터 적용**: 크롤러에 전달된 `--brand` 및 `--season` 옵션은 **(1) 스탠딩 리스트 수집 시점**과 **(2) 개별 선수 프로필 상세 검증 시점** 모두에 동일하게 적용됩니다.
* **Standings Only 모드와의 연계**: `--standings-only` 모드로 실행 시 프로필 상세 페이지에 접근하지 않으므로, `Season Filter`는 무시되고 오직 스탠딩 리스트에서의 `Brand Filter`만 동작합니다.

## Crawler mode selection note

- `standings-only` and `profile-only` are mutually exclusive crawler modes.
- `standings-only` collects standings target URLs only and skips player profile/result validation.
- `profile-only` collects standings targets, then validates profile summary/tabs/events while skipping Result detail pages.
- In the web dashboard, selecting `Standings Only` disables and clears profile-side filters (`Profile Brand Filter`, `Profile Season Filter`) and `Result Limit`.
- Selecting `Profile Only` disables and clears standings-side filters (`Standings Brand Filter`, `Standings Season Filter`) and `Result Limit`.
- Phase 3 forces `Standings Only`; all profile-side options stay disabled in that phase.
- When Brand Filter is enabled with `profile-only`, the crawler reviews the first-page target set from the three brand-filtered standings categories: `All-Time Earnings - Men`, `All-Time Earnings - Women`, and `All Player Stats`.
- Keep the crawler's Playwright `__name` init helper in place when running through `tsx`; esbuild can wrap `page.evaluate` functions with `__name(...)`, and profile summary/tab extraction will fail before DOM collection if the helper is missing.

## Country flag validation

- The crawler treats country/flag consistency as a validation item, not just display metadata.
- `standings-only` collects and validates only the country flag code exposed by standings rows.
- `profile-only` compares standings country flag codes against the profile flag code.
- Full crawler mode compares country flag codes across Standings, Profile, and Result rows when Result rows are collected.
- The normalized storage key is `countryCode`; missing or unparsable flags are stored as `UNKNOWN` and shown as `Unknown Country`. Country name text is intentionally not collected or validated because each category can expose different display data.
- Country code mismatch or missing country code is reported as `minor`, not `fail`, because some pages can legitimately omit flag metadata.
- JSON/HTML reports include player-level `countryChecks`, a country summary, an `Unknown Country` list, country minor issue list, and a country filter in the player directory.
- Defect CSV rows include `countryCode` for context; country minor issues remain in the HTML/JSON review notes rather than defect candidates.

## Stage/Live crawler output tag

Dashboard 또는 배치 실행에서 `BASE_URL`/`baseUrl`이 stage 도메인을 가리키면 크롤러 산출물 파일명은 `wsop-player-crawler-stage-YYYYMMDD-HHMMSS-*` 형식으로 생성됩니다. 기본 Live 실행은 기존처럼 `wsop-player-crawler-live-YYYYMMDD-HHMMSS-*` 형식을 유지합니다.
