# WSOP Web Automation

`wsop.com` 공개 웹사이트의 smoke, functional flow, player presentation UI 자동화 프로젝트입니다.

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
    fixtures/
      player-presentation/
    utils/
      playerPresentation/
    playwright.config.ts
    package.json
```

## 배포 및 초기 설치 (팀원 배포 시)

프로젝트 폴더를 배포하기 전에, 용량이 거대하고 로컬 환경 종속성이 있는 **`node_modules` 폴더는 반드시 삭제하고 압축**하여 전달해 주세요.

팀원들은 압축을 푼 뒤 최초 1회 아래 절차에 따라 초기 설정을 완료해야 대시보드와 테스트가 정상 작동합니다.

### 1. 전제 조건
* 각 팀원의 PC에 **Node.js (LTS 버전)**가 설치되어 있어야 합니다. (다운로드: [https://nodejs.org/](https://nodejs.org/))

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

* **`PORT`**: 대시보드가 통신을 수신할 포트 (기본값: `3000`)
* **`HOST`**: 바인딩할 네트워크 어댑터 IP (기본값: `0.0.0.0` - 모든 네트워크 인터페이스를 통한 접근 허용)
* **`AUTO_LAUNCH`**: 서버 기동 시 브라우저 창 자동 팝업 여부 (기본값: `true`, 원격 헤드리스 서버 등에서 자동 열기를 생략할 때는 `false` 주입)

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

- Player Standings 상위 플레이어 노출 및 profile 연결
- Player Standings UI는 최신 `WSOP-Player-Standings-Crawler/automation/output/*-data.json`의 `players[].standingsSources[]`를 기준으로, 크롤러가 수집한 standings target들이 각 source category에서 이름, profile link, 국가/국기 후보로 보이는지 확인
- Player Search에서 모든 플레이어를 전수 입력하지 않고, fixture에 정의한 대표 탑랭커 중심으로 이름 입력 시 검색창 하단 자동완성 row와 검색 결과에 해당 인물이 노출되는지 확인
- Player Profile의 이름, 국가/국기, avatar/profile image 후보 확인
- Hall of Fame, Player of the Year, 내부 Legend 그룹의 주요 플레이어 표현 확인
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

주요 파일:

```text
tests/player-presentation/
fixtures/player-presentation/
utils/playerPresentation/
```

Standings UI 검증은 크롤러 산출물이 있으면 해당 산출물 중 충분한 standings target을 포함한 최신 `*-data.json`을 사용합니다. 이 기준은 크롤러가 실제 Result 상세 검증 대상으로 삼은 스탠딩 TOP 인원과 Phase 3 UI 검증 대상을 맞추기 위한 것입니다. 단, Phase 3 자체는 Result 상세 크롤링을 필요로 하지 않으므로 매번 full crawler를 오래 돌릴 필요는 없습니다. 중간에 중단된 부분 output처럼 target 수가 너무 적은 파일은 Phase 3 기준에서 제외합니다.

Phase 3 custom 리포트는 크롤러 리포트와 같은 판단 흐름을 따르도록, 최신 크롤러 대상자 기준의 **플레이어 UI 커버리지 카드**를 포함합니다. 각 카드에는 category/rank/name/profile/source와 함께 `행`, `이름`, `링크`, `국가/국기`, `이미지` 상태가 표시됩니다. `국가/국기`까지는 hard fail 기준이고, `이미지`는 stage/prod asset 차이를 고려해 warning으로 남길 수 있습니다.

## Phase registry

장기 자동화 단계는 [automation/phases.json](./automation/phases.json)에서 중앙 관리합니다. 새 단계가 추가될 때는 먼저 이 파일에 phase id, report suite, test folder, Playwright project, 구현 여부를 등록합니다.

현재 등록 구조:

```text
phase1  smoke                  tests/smoke
phase2  functional             tests/functional
phase3  player-presentation    tests/player-presentation
phase4  search-filter-sort     tests/search-filter-sort      planned
phase5  result-detail          tests/result-detail           planned
phase6  data-integrity         tests/data-integrity          planned
phase7  performance-stability  tests/performance-stability   planned
phase8  visual-regression      tests/visual-regression       planned
phase9  regression             tests/regression              planned
```

공통 실행기:

```bat
npm run phase:list
npm run test:phase1
npm run test:phase2
npm run test:phase3
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
automation/output/wsop-public-data-integrity-YYYYMMDD-HHMMSS-...
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

- **대상 환경 실시간 스위칭**: `Target Environment` 선택 드롭다운을 통해 별도의 콘솔 타이핑이나 환경변수 수동 세팅 없이, 마우스 클릭만으로 `Live (https://www.wsop.com)` / `Stage (https://wsop-stage.ggnweb.com)` / `Custom URL` 환경을 즉각 오버라이딩하여 테스트 및 크롤러 구동 가능
- **페이즈 카드 선택 및 실행**: 좌측 카드 목록에서 대상을 원클릭으로 선택 및 실행
- **한글 Phase 안내**: 좌측 카드에는 한글 Phase 이름과 짧은 요약을 표시하고, 상세 패널에는 목적 설명과 검증 스텝을 한글로 표시합니다. Phase 3은 크롤러 대상 TOP 플레이어 UI 검증 흐름을 단계별로 확인할 수 있습니다.
- **실행 옵션 및 모드 튜닝**: Normal / Headed / UI 모드 선택 및 체크박스 기반 추가 매개변수(Limit, Concurrency, Grep, Timeout 등) 실시간 토글링 및 텍스트박스 입력
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
- Player Search 결과가 동적 검색으로 즉시 필터링되지 않을 수 있어 `Phil Hellmuth` link 우선, 현재 노출된 첫 player link fallback 순서로 검증합니다.
- Phase 3의 Player Search identity 검증은 모든 사용자를 전수 검색하지 않고 `fixtures/player-presentation/top-players.fixture.json`의 대표 탑랭커 샘플을 기준으로 합니다. 이름 입력 후 검색창 하단 `.autocomplete-container`의 suggestion row에 해당 인물과 기대 국가/국기 후보가 보이지 않거나, 검색 결과에 해당 인물이 보이지 않으면 hard fail로 처리합니다. 동일 이름이 여러 profile target으로 보이는 문제는 현재 Phase 3의 검색 UI 기준에서는 hard fail로 삼지 않고, 수치/DB/API 정합성은 Phase 6에서 다룹니다.

## 검증 범위에서 제외한 것

이번 자동화는 1차 smoke test입니다. 아래 항목은 범위에 포함하지 않습니다.

- 토너먼트 필터 정확성
- 플레이어 데이터 정합성
- 뉴스 상세 데이터 정합성
- 로그인/결제/온라인 플레이 기능 검증
- 모든 내부 링크 전수 검사
