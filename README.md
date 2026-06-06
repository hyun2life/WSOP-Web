# WSOP Web

WSOP 공개 웹사이트를 자동으로 확인하고, 플레이어 데이터 크롤링 결과를 리포트로 남기는 통합 작업 공간입니다.

이 문서 하나만 보고 설치, 실행, 리포트 확인, Badge/Crown 검증 방향까지 따라올 수 있도록 모든 설명을 한곳에 모았습니다.

## 빠른 시작

처음 실행하는 사람은 아래 순서만 따라오면 됩니다.

1. `Setup.bat`을 실행해서 필요한 패키지를 설치합니다.
2. `Run.bat`을 실행해서 통합 대시보드를 엽니다.
3. 대시보드에서 필요한 Phase나 Crawler를 선택해 실행합니다.
4. 생성된 한글 리포트에서 Pass, Warning, Fail을 확인합니다.

```bat
cd WSOP-Web
Setup.bat
Run.bat
```

## 프로젝트 구성

```text
WSOP-Web/
  README.md
  Setup.bat
  Run.bat
  Stop-Dashboard.bat
  WSOP-Web-Automation/
  WSOP-Player-Standings-Crawler/
```

| 위치 | 역할 |
| --- | --- |
| `WSOP-Web-Automation/` | Playwright 기반 웹 테스트와 통합 대시보드 |
| `WSOP-Player-Standings-Crawler/` | Player Standings/Profile 크롤러 |
| `Setup.bat` | 두 하위 프로젝트의 npm 패키지와 Playwright Chromium 설치 |
| `Run.bat` | 통합 대시보드 실행 |
| `Stop-Dashboard.bat` | 대시보드 서버 강제 종료 |

두 하위 프로젝트는 반드시 같은 상위 폴더 아래에 나란히 있어야 합니다. 이 구조가 깨지면 대시보드에서 크롤러를 찾지 못할 수 있습니다.

## 설치

최초 1회 또는 패키지가 바뀐 뒤에는 상위 폴더에서 실행합니다.

```bat
cd WSOP-Web
Setup.bat
```

`Setup.bat`이 준비하는 항목입니다.

- `WSOP-Web-Automation` npm 패키지
- `WSOP-Player-Standings-Crawler` npm 패키지
- Playwright Chromium

Node.js가 없으면 먼저 Node.js LTS 버전을 설치해야 합니다.

## 통합 대시보드 실행

평소에는 `Run.bat` 하나로 시작합니다.

```bat
cd WSOP-Web
Run.bat
```

대시보드에서 할 수 있는 일입니다.

- 실행 환경 선택
- Phase 1~9 실행
- Player Crawler 실행
- 실행 로그 확인
- 최신 한글/영문/Playwright 리포트 열기

대시보드가 열리지 않으면 아래 로그를 확인합니다.

```text
WSOP-Web-Automation/automation/output/web-runner-server.out.log
WSOP-Web-Automation/automation/output/web-runner-server.err.log
```

대시보드 서버를 강제로 멈춰야 할 때만 `Stop-Dashboard.bat`을 사용합니다. 테스트 실행 중에는 사용하지 않습니다.

## 테스트 Phase

| Phase | 이름 | 확인하는 것 | 대표 명령 |
| --- | --- | --- | --- |
| Phase 1 | 공개 페이지 기본 확인 | 주요 페이지 접근, 핵심 문구, 링크 샘플, 콘솔 오류 | `npm run test:phase1` |
| Phase 2 | 기능 흐름 확인 | Schedule, Search, Standings, News 탐색 흐름 | `npm run test:phase2` |
| Phase 3 | 플레이어 표시 확인 | 이름, 국가/국기, 이미지, Legend/POY/Badge UI | `npm run test:phase3` |
| Phase 4 | 검색/필터/정렬 확인 | 검색, 필터, 정렬, pagination, Load More 안정성 | `npm run test:phase4` |
| Phase 5 | Result 상세 연결 확인 | 프로필 결과 row와 Result 상세 페이지 연결 | `npm run test:phase5` |
| Phase 6 | 데이터 정합성 확인 | 기준 데이터와 화면 숫자 비교 | `npm run test:phase6` |
| Phase 7 | 성능/안정성 확인 | 느린 요청, 로딩 안정성, 반복 실행 | `npm run test:phase7` |
| Phase 8 | 화면 회귀 확인 | screenshot baseline 기반 화면 깨짐 확인 | `npm run test:phase8` |
| Phase 9 | 회귀 테스트 | 여러 Phase를 묶은 배포 전 검증 | `npm run test:release` |

명령은 `WSOP-Web-Automation` 폴더에서 실행합니다.

```bat
cd WSOP-Web\WSOP-Web-Automation
npm run phase:list
npm run test:phase1
npm run test:phase2
npm run test:phase3
npm run test:phase4
npm run test:phase5
npm run test:phase6
npm run test:phase7
npm run test:phase8
```

PowerShell에서 npm 실행이 막히면 아래처럼 실행합니다.

```bat
cmd.exe /d /s /c npm run test:phase1
```

## 회귀 테스트와 배포 판단

배포 전에는 상황에 맞는 회귀 스위트를 실행합니다.

```bat
cd WSOP-Web\WSOP-Web-Automation
npm run test:regression:quick
npm run test:regression:standard
npm run test:regression:extended
npm run test:regression:total
npm run test:release
npm run test:release:with-visual
npm run test:release:with-crawl
```

| 명령 | 사용 시점 |
| --- | --- |
| `test:regression:quick` | 로컬에서 빠르게 확인 |
| `test:regression:standard` | 기본 회귀 확인 |
| `test:regression:extended` | 성능/화면 회귀까지 넓게 확인 |
| `test:regression:total` | 전체 범위 확인 |
| `test:release` | 배포 전 최종 확인 |
| `test:release:with-visual` | 화면 baseline 검수까지 포함 |
| `test:release:with-crawl` | 크롤러 데이터 검증까지 포함 |

회귀 테스트 결과는 아래 위치에 저장됩니다.

```text
WSOP-Web-Automation/artifacts/full-regression/latest/
```

배포 판단은 `release-gate-result.json`을 기준으로 봅니다.

| 상태 | 의미 | 행동 |
| --- | --- | --- |
| `PASSED` | 필수 단계가 모두 통과하고 Warning도 없음 | 배포 가능 |
| `REQUIRES_REVIEW` | 필수 단계는 통과했지만 Warning 있음 | 사람이 리포트 확인 |
| `FAILED` | 필수 단계가 실패함 | 배포 중단 |

CI에서는 `release-gate-result.json`의 `ci.shouldFailBuild` 값을 기준으로 배포 차단 여부를 판단하는 것이 가장 단순합니다.

## Player Crawler 실행

크롤러는 Player Standings와 Player Profile 데이터를 수집하고, 프로필 요약값과 탭 row 계산값을 비교합니다.

대시보드에서 실행하는 것을 권장하지만, 단독 실행도 가능합니다.

```bat
cd WSOP-Web\WSOP-Player-Standings-Crawler
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

개발자가 직접 실행할 때 사용하는 npm 명령입니다.

```bat
npm run crawl
npm run crawl:headed
npm run crawl:self-test
npm run crawl:tournament
npm run crawl:tournament:self-test
```

## Crawler 실행 범위

`RUN_WSOP_PLAYER_CRAWLER_LIVE.bat` 상단 값으로 실행량을 조절합니다.

```bat
set "PLAYER_LIMIT=10"
set "RESULT_LIMIT=0"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=100"
set "RESULT_PAGE_LIMIT=0"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=8"
```

| 값 | 의미 |
| --- | --- |
| `PLAYER_LIMIT` | 카테고리별로 확인할 선수 수 |
| `RESULT_LIMIT` | 선수 1명당 확인할 Result 수, `0`이면 가능한 범위 전체 |
| `RESULT_RANK_LIMIT` | 특정 순위보다 낮은 Result를 건너뛸 때 사용 |
| `MAX_LOAD_MORE` | 프로필 ALL 탭에서 Load More를 누를 최대 횟수 |
| `RESULT_PAGE_LIMIT` | Result 상세 페이지에서 확인할 페이지 수, `0`이면 제한 없음 |
| `DISABLED_RESULT_MODE` | 비활성 Result를 `skip`, `fail`, `check` 중 어떻게 볼지 |
| `CONCURRENCY` | 동시에 확인할 선수 수 |

빠른 확인만 할 때는 값을 작게 줄입니다. 실제 정합성 확인은 `RESULT_LIMIT=0`, `RESULT_PAGE_LIMIT=0`, `MAX_LOAD_MORE=100`처럼 충분히 넓게 둡니다.

## Crawler 모드

| 모드 | 의미 | 사용 상황 |
| --- | --- | --- |
| 기본 모드 | 프로필 요약, 탭, Result 상세까지 확인 | 깊은 정합성 검증 |
| `standings-only` | 스탠딩 목록만 빠르게 수집 | Phase 3 대상자 확보 |
| `profile-only` | 프로필 요약과 탭만 확인 | Badge/Profile count 검증 |

`standings-only`와 `profile-only`는 목적이 다르므로 동시에 사용하지 않습니다.

특정 선수만 다시 확인할 때는 `--player-url`을 사용합니다.

```bat
node automation\crawl_player_standings.mjs --player-url https://www.wsop.com/players/example-player/ --result-limit 0 --result-page-limit 0 --max-load-more 50
```

## Badge/Crown 검증

Badge/Crown 숫자 정합성은 Player Crawler에서 확인합니다. 새 Badge 전용 크롤러는 만들지 않습니다.

기본 원칙입니다.

- Bracelet/Ring은 이미 프로필 Badge로 제공되므로 기존 프로필 요약/탭 검증을 유지합니다.
- 새 Badge 정보는 `WSOP-Player-Standings-Crawler/automation/config/badge-definitions.json`에 정의합니다.
- 프로필에 Badge가 없으면 해당 Badge 검증은 건너뜁니다.
- 프로필에 Badge가 있으면 같은 브랜드/Profile Brand 필터를 적용합니다.
- ALL 탭에서 1위 row 수를 계산하고 프로필 Badge count와 비교합니다.
- Crown은 Badge 개수로 결정되므로 숫자 문제는 Badge 검증에서 먼저 잡습니다.
- Crown 화면 표시만 확인해야 할 때는 Phase 3에서 다룹니다.

새 Badge 정의 예시입니다.

```json
{
  "additionalBadges": [
    {
      "key": "ggpoker-tournament",
      "label": "GGPoker Tournament",
      "detailType": "GGPoker Tournament",
      "brand": "GGPoker",
      "fileName": "badge_GGPokerTournament.webp",
      "altPattern": "ggpoker\\s+tournament",
      "dataKey": "ggpoker-tournament"
    }
  ]
}
```

Profile Only로 빠르게 확인할 때 예시입니다.

```bat
set "PROFILE_ONLY=true"
set "BRAND=WSOP"
set "PROFILE_BRAND=WSOP"
set "PLAYER_LIMIT=5"
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

Badge 리포트에서 봐야 할 흐름입니다.

1. 프로필에 Badge가 있는지 확인합니다.
2. Badge가 없으면 skip이 맞습니다.
3. Badge가 있으면 브랜드 필터 결과와 비교합니다.
4. count가 다르면 mismatch로 봅니다.
5. `rendered duplicates`가 있으면 화면에 같은 row가 중복으로 렌더링된 것입니다. 숨기지 말고 실제 오류 후보로 확인합니다.

## 리포트 위치

| 종류 | 위치 |
| --- | --- |
| Web Automation 한글/영문 리포트 | `WSOP-Web-Automation/automation/output/` |
| Playwright 기본 리포트 | `WSOP-Web-Automation/playwright-report/` 또는 phase별 output 폴더 |
| 회귀 테스트 요약 | `WSOP-Web-Automation/artifacts/full-regression/latest/` |
| Player Crawler 리포트/데이터 | `WSOP-Player-Standings-Crawler/automation/output/` |
| 크롤러 인증 상태 | `WSOP-Player-Standings-Crawler/automation/.auth/` |

Crawler 리포트 파일 예시입니다.

```text
WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-live-*-data.json
WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-live-*-report-ko.html
WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-live-*-report.html
WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-live-*-defects.csv
```

한글 HTML 리포트를 기본 검토 대상으로 봅니다. 영문 리포트는 필요할 때만 함께 확인합니다.

## 리포트 읽는 법

| 표시 | 의미 |
| --- | --- |
| `Pass` | 기대한 검증이 통과함 |
| `Warning` | 확인은 필요하지만 항상 제품 버그는 아님 |
| `Fail` | 필수 검증 실패 |
| `missing` | 화면에서 기대한 값을 찾지 못함 |
| `mismatch` | 프로필 요약값과 계산값이 다름 |
| `skipped` | 설정상 확인하지 않고 건너뜀 |
| `rendered duplicates` | 화면에 같은 row가 중복으로 렌더링됨 |

리포트는 보통 아래 순서로 봅니다.

1. Summary에서 전체 상태를 봅니다.
2. `Playwright가 실행한 테스트 스텝` 또는 `Playwright 크롤러 실행 스텝`에서 실제 행동 순서를 봅니다.
3. Fail이 있으면 실패 상세를 봅니다.
4. Warning은 알려진 이슈인지 확인합니다.
5. Crawler 리포트는 mismatch, missing, rendered duplicates를 확인합니다.
6. 같은 실행 시간의 HTML, JSON, CSV를 함께 봅니다.

## 자주 보이는 이슈와 판단 기준

| 현상 | 판단 기준 |
| --- | --- |
| Stage 이미지 지연 또는 누락 | `ENVIRONMENT=stage`이면 Warning으로 볼 수 있음 |
| 광고/분석 스크립트 실패 | 핵심 기능과 무관하면 Warning |
| SSE 연결 끊김 로그 | 화면 기능에 영향 없으면 ignore 또는 Warning |
| 보안/봇 차단 | 사람이 직접 확인 후 재실행 |
| Visual baseline missing | 제품 버그가 아니라 baseline 관리 항목일 수 있음 |
| Crawler output missing | `release-with-crawl`에서는 review item으로 볼 수 있음 |
| Final Tables count mismatch | 실제 row 누락인지, 중복 렌더링인지 구분 |
| `rendered duplicates` | 화면 중복 row이므로 실제 오류 후보로 확인 |

실패가 나오면 먼저 최신 리포트를 보고, 그다음 아래 순서로 원인을 나눕니다.

| 상황 | 먼저 볼 것 |
| --- | --- |
| 페이지가 안 열림 | 네트워크, 보안 차단, `BASE_URL` |
| selector를 못 찾음 | 실제 화면 변경 여부 |
| 숫자가 안 맞음 | Crawler 최신 JSON/CSV와 프로필 탭 |
| 대시보드 상태와 리포트가 다름 | `web-runner-server.*.log` |

## 환경변수

| 값 | 의미 |
| --- | --- |
| `BASE_URL` | 테스트 대상 URL, 기본값은 live `https://www.wsop.com` |
| `ENVIRONMENT` | `production` 또는 `stage`, Stage 이미지 warning 판단에 사용 |
| `PORT` | 대시보드 포트, 기본값 `3000` |
| `HOST` | 대시보드 바인딩 주소, 기본값 `0.0.0.0` |
| `AUTO_LAUNCH` | 서버 시작 시 브라우저 자동 열기 여부 |
| `PROFILE_ONLY` | Crawler profile-only 실행 |
| `BRAND` | Crawler standings 브랜드 필터 |
| `PROFILE_BRAND` | Crawler profile 내부 브랜드 필터 |

Stage를 직접 실행할 때 예시입니다.

```bat
set BASE_URL=https://wsop-stage.ggnweb.com
set ENVIRONMENT=stage
npm run test:phase1
```

## 유지보수 규칙

- 새 기능이나 실행 방식이 바뀌면 이 README를 먼저 갱신합니다.
- 하위 프로젝트 README에는 중복 설명을 늘리지 않습니다.
- `node_modules`, `automation/output`, `test-results`, `playwright-report`, `artifacts`는 Git에 포함하지 않습니다.
- 외부 사이트 대상 자동화이므로 요청 수와 동시성을 과도하게 올리지 않습니다.
- selector, 문구, 네트워크 정책, 보안 차단은 언제든 바뀔 수 있습니다.
- 최신 원인은 항상 `automation/output`의 최신 HTML/JSON/CSV와 로그를 먼저 보고 판단합니다.
- Badge 이미지 경로, alt, class, data key가 확정되면 `badge-definitions.json`과 이 README를 함께 갱신합니다.
