# WSOP Web

WSOP 공개 웹사이트 검증, 크롤링, 리포트 생성을 한 작업 공간에서 관리하는 통합 프로젝트입니다.

## 프로젝트 목적

`wsop.com` 공개 페이지의 기본 동작을 자동 검증하고, Player Standings 데이터를 수집/검증해 QA 리포트로 남깁니다.

## 주요 기능

- 공개 페이지 smoke/functional Playwright 자동화
- Player Presentation & Identity UI 자동화
- Player Standings, Player Profile, Result 상세 데이터 크롤링
- 한글/영문 HTML 리포트 및 JSON/CSV 산출물 생성
- Web Automation 대시보드에서 일반 웹 검증과 크롤러 실행 흐름을 함께 관리

## 폴더 구조

```text
WSOP-Web/
  Run.bat
  Setup.bat
  README.md
  .gitignore
  WSOP-Web-Automation/
    automation/
    data/
    scripts/
    tests/
    README.md
  WSOP-Player-Standings-Crawler/
    automation/
    docs/
    README.md
```

## 설치 방법

최초 1회 또는 의존성이 바뀐 뒤에는 상위 폴더의 `Setup.bat`을 실행합니다. 이 스크립트는 Web Automation과 Player Standings Crawler 양쪽의 npm 패키지와 Playwright Chromium을 함께 준비합니다.

```bat
cd WSOP-Web
Setup.bat
```

하위 프로젝트를 개별 개발할 때만 각 폴더에서 npm 명령을 직접 실행합니다.

```bat
cd WSOP-Web\WSOP-Player-Standings-Crawler
npm install
npx playwright install chromium
```

## 실행 방법

평상시 실행 진입점은 상위 폴더의 `Run.bat`입니다.

```bat
cd WSOP-Web
Run.bat
```

`Run.bat`은 `WSOP-Web-Automation` 대시보드 서버를 백그라운드로 띄우고 브라우저에서 실행 콘솔을 엽니다. 대시보드에서 smoke, functional, player presentation, crawler 단계를 선택해 실행할 수 있습니다.

크롤러만 단독 실행해야 할 때는 아래 BAT를 직접 사용할 수 있습니다.

```bat
cd WSOP-Web\WSOP-Player-Standings-Crawler
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

## 주요 명령

Web Automation:

```bat
npm run test:smoke
npm run test:functional
npm run test:player-presentation
npm run test:phase3
npm run report:smoke:ko
npm run report:functional:ko
npm run report:smoke:en
npm run report:functional:en
```

Player Standings Crawler:

```bat
npm run crawl
npm run crawl:headed
npm run crawl:self-test
```

## 산출물 위치

- Web Automation 리포트: `WSOP-Web-Automation/automation/output/`
- Web Automation 테스트 산출물: `WSOP-Web-Automation/test-results/`, `WSOP-Web-Automation/playwright-report/`
- Player Standings 크롤러 리포트/데이터: `WSOP-Player-Standings-Crawler/automation/output/`
- 크롤러 인증 상태: `WSOP-Player-Standings-Crawler/automation/.auth/`

## 환경변수 및 설정값

대부분의 실행 설정은 각 BAT 파일과 하위 프로젝트 README에서 관리합니다.

- `Run.bat`: 통합 대시보드 실행
- `Setup.bat`: Web Automation 및 Crawler 의존성/Playwright 준비
- `WSOP-Player-Standings-Crawler/RUN_WSOP_PLAYER_CRAWLER_LIVE.bat`: 크롤러 범위, 동시성, headed/headless 설정

대시보드 서버는 필요할 때 아래 환경변수를 사용할 수 있습니다.

- `PORT`: 대시보드 포트, 기본값 `3000`
- `HOST`: 바인딩 주소, 기본값 `0.0.0.0`
- `AUTO_LAUNCH`: 서버 시작 시 브라우저 자동 열기 여부, 기본값 `true`
- `ENVIRONMENT`: Web Automation Phase 3의 avatar/image warning 기준, `production` 또는 `stage`, 기본값 `production`

## 리포트 UI/UX 기준

- 한글 HTML 리포트를 기본 검토 대상으로 둡니다.
- Web smoke/functional/player presentation 리포트와 crawler 리포트는 같은 dark operations 톤, red/gold accent, 상태색(pass/warn/fail)을 사용합니다.
- 리포트 카드와 패널은 8px radius를 기준으로 맞춥니다.
- 대시보드는 테스트 실행, 로그 확인, KO/EN/Playwright 리포트 열기를 한 화면에서 처리합니다.

## 유지보수 주의사항

- 두 하위 프로젝트는 같은 상위 폴더 안에 sibling으로 있어야 합니다.
- 크롤러 폴더명은 `WSOP-Player-Standings-Crawler`를 기준으로 합니다.
- `node_modules`, `automation/output`, `test-results`, Playwright report 산출물은 Git에 포함하지 않습니다.
- 외부 사이트 대상 자동화이므로 요청 범위와 동시성을 과도하게 올리지 않습니다.
- selector, 로그인/접근 제한, 네트워크/보안 정책 변화는 실패 원인이 될 수 있으므로 리포트의 실패 상세와 각 README의 유지보수 포인트를 함께 확인합니다.

## 알려진 제한사항

- `wsop.com`의 UI/라우팅/보안 정책 변경 시 일부 selector 또는 링크 검증이 실패할 수 있습니다.
- 크롤러는 사이트 응답 속도와 인증/접근 상태에 영향을 받습니다.
- Web Automation의 phase 중 일부는 예약 항목이며, 구현 여부는 `WSOP-Web-Automation/automation/phases.json`에서 관리합니다.
- Phase 3은 Data/API Integrity가 아니라 공개 웹 화면의 플레이어 이름, 국가/국기, avatar/profile image, HOF/POY/Legend 표현 상태를 확인하는 UI 검증입니다. 수치 계산과 API/DB 정합성은 Phase 6 범위로 분리합니다.
