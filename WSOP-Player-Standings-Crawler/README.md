# WSOP Player Standings Crawler

WSOP Player Standings 데이터를 크롤링하고 JSON, CSV, HTML 리포트를 생성하는 자동화 도구입니다.

이 프로젝트는 `WSOP-Web` 작업 공간의 Player Standings 크롤러입니다. 현재 범위는 Player Standings와 Player Profile, Result 상세 페이지의 데이터 정합성 검증입니다.

전체 자동화 구조는 상위 작업 공간 [`../`](../)에서 관리합니다. Web smoke/functional 검증은 sibling 프로젝트 [`../WSOP-Web-Automation/`](../WSOP-Web-Automation/)에서 관리합니다.

## 팀원 실행 방법

일반 실행은 상위 `WSOP-Web\Run.bat` 대시보드에서 `crawler` 단계를 선택하는 방식을 권장합니다. 크롤러만 단독으로 돌리거나 BAT 상단 설정값을 직접 조정해야 할 때는 이 폴더의 `RUN_WSOP_PLAYER_CRAWLER_LIVE.bat`을 실행합니다.

라이브 `wsop.com` 테스트:

```text
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

스테이지 테스트:

```text
RUN_WSOP_PLAYER_CRAWLER.bat
```

처음 실행할 때는 PC 상태에 따라 몇 분 정도 걸릴 수 있습니다. 실행 창은 닫지 말고, 열린 브라우저도 리포트가 생성될 때까지 닫지 마세요.

배포받은 사용자는 보통 BAT 파일만 실행하거나 BAT 상단 설정값만 바꾸면 됩니다. `automation` 폴더 안의 `.mjs`, `.ps1` 파일은 개발자가 수정하는 영역이므로 일반 사용자는 건드리지 않아도 됩니다.

### 처음 실행하는 사람을 위한 순서

1. 압축을 풀거나 저장소를 받은 뒤 폴더 안의 `RUN_WSOP_PLAYER_CRAWLER_LIVE.bat`을 더블클릭합니다.
2. 크롬 창이 뜨면 닫지 말고 그대로 둡니다. 로그인이나 접근 확인 화면이 보이면 직접 처리합니다.
3. 검증이 끝나면 `automation\output` 폴더에 리포트가 생성되고, BAT가 한글 리포트를 자동으로 엽니다.
4. 실패 항목이 있으면 열린 한글 리포트의 `누락:` 내용을 확인합니다.
5. 중간에 멈추고 싶으면 BAT 창에서 `Ctrl+C`를 누릅니다. 이미 완료된 선수 기준의 부분 리포트는 남습니다.

### 사용자가 주로 수정하는 위치

라이브 검증 기준으로는 `RUN_WSOP_PLAYER_CRAWLER_LIVE.bat` 상단의 아래 부분만 수정하면 됩니다.

```bat
set "PLAYER_LIMIT=10"
set "RESULT_LIMIT=0"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=100"
set "RESULT_PAGE_LIMIT=0"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=8"
```

또한, 대시보드나 CI/CD 환경처럼 무인 자동화 빌드를 실행할 때 배치 파일 마지막에서 입력 대기(`pause`)하지 않고 즉시 종료되도록 하기 위해 `WSOP_NO_PAUSE` 환경변수를 설정할 수 있습니다.
```bat
set "WSOP_NO_PAUSE=true"
```

정합성을 높이고 싶으면 `RESULT_LIMIT=0`, `RESULT_PAGE_LIMIT=0`, `MAX_LOAD_MORE=100` 이상을 유지하는 것을 권장합니다. 빠른 동작 확인만 할 때만 값을 줄이세요.

## 브라우저 표시 여부

기본 BAT는 실제 브라우저 창을 띄워서 실행합니다. 로그인, 접근 확인, 차단 여부를 직접 볼 수 있어서 라이브 검증에는 이 방식이 가장 안전합니다.

```bat
  -Headed ^
```

브라우저 창을 띄우지 않고 백그라운드(headless)로 실행하려면 BAT 파일의 PowerShell 실행 옵션에서 위 줄을 제거하면 됩니다.

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%CRAWLER_SCRIPT%" ^
  -PlayersUrl "%PLAYERS_URL%" ^
  -OutputTag "%OUTPUT_TAG%" ^
  -RunId "%RUN_ID%" ^
  -AuthWaitMs 300000 ^
  -Limit %PLAYER_LIMIT% ^
  ...
```

headless 실행에서 로그인/접근 차단 문제가 생기면 다시 `-Headed ^` 줄을 넣고 실행하세요.

배포용으로는 `-Headed ^`를 켜둔 상태를 권장합니다. 사용자는 실제로 페이지가 열리는지, 로그인이 필요한지, 사이트가 막혔는지 눈으로 확인할 수 있기 때문입니다.

## 자동 준비되는 항목

BAT 파일을 실행하면 `automation\run_player_standings_crawler.ps1`이 아래 항목을 최대한 자동으로 준비합니다.

- Node.js/npm 확인
- Node.js가 없으면 `winget`으로 Node.js LTS 자동 설치 시도
- `npm ci` 또는 `npm install`로 패키지 설치/복구
- Playwright Chromium 자동 설치
- 출력 폴더 생성
- 크롤러 실행 및 한글 HTML 리포트 열기

회사 보안 정책, 프록시, 권한 문제로 자동 설치가 막힐 수 있습니다. 그 경우 Node.js LTS를 수동 설치하거나 네트워크/프록시 권한을 확인한 뒤 BAT 파일을 다시 실행하면 됩니다.

## 라이브 테스트 범위 조절

`RUN_WSOP_PLAYER_CRAWLER_LIVE.bat` 상단의 값을 바꾸면 실행량을 조절할 수 있습니다.

```bat
set "PLAYER_LIMIT=10"
set "RESULT_LIMIT=0"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=100"
set "RESULT_PAGE_LIMIT=0"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=8"
```

각 값의 의미는 아래와 같습니다.

| 값                     | 의미                                                                                                                                                                                        | 현재값 기준 동작                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PLAYER_LIMIT`         | standings 카테고리별로 가져올 선수 수입니다. 카테고리는 2026 Standings, All-Time Earnings - Men/Women, All-Time Bracelets, All-Time Rings입니다.                                            | 각 카테고리에서 10명씩 가져옵니다. 중복 선수가 있으면 실제 크롤 선수 수는 더 적을 수 있습니다. |
| `RESULT_LIMIT`         | 선수 1명당 확인할 `Result` 항목 수입니다. `0`이면 가능한 모든 Result를 확인합니다.                                                                                                          | 가능한 모든 Result를 확인합니다.                                                               |
| `RESULT_RANK_LIMIT`    | Result에서 플레이어 순위가 이 값보다 크면 해당 Result 확인을 건너뜁니다. `0`이면 순위 제한이 없습니다.                                                                                      | 순위 제한 없이 확인합니다.                                                                     |
| `MAX_LOAD_MORE`        | 선수 프로필의 ALL 탭에서 `Load more` 버튼을 최대 몇 번 누를지 정합니다.                                                                                                                     | 선수 1명당 최대 100번까지 더 불러옵니다.                                                       |
| `RESULT_PAGE_LIMIT`    | Result 상세 페이지에서 최종 순위표 페이지를 최대 몇 페이지까지 확인할지 정합니다. `0`이면 대상 row를 찾은 뒤에도 마지막 페이지까지 모두 확인하고, 양수이면 해당 페이지 수까지만 확인합니다. | Result마다 제한 없이 끝까지 확인합니다.                                                        |
| `DISABLED_RESULT_MODE` | 비활성화된 Result 버튼/링크를 어떻게 처리할지 정합니다. `skip`, `fail`, `check` 중 하나입니다.                                                                                              | `skip`이므로 비활성 Result는 아직 검증 불가로 보고 실패에서 제외합니다.                        |
| `CONCURRENCY`          | 동시에 크롤링할 선수 수입니다. BAT에서 조절하는 실행 튜닝값이며, 코드는 최대 `10`까지 허용합니다.                                                                                           | 선수 8명을 병렬로 확인합니다.                                                                  |

정합성을 최우선으로 볼 때는 `RESULT_PAGE_LIMIT=0`을 권장합니다. 실행 시간을 제한해야 하면 `50`처럼 충분히 큰 양수로 두면 최대 50페이지까지만 확인합니다. 비활성 Result 버튼 자체를 결함으로 봐야 하는 검증에서는 `DISABLED_RESULT_MODE=fail`로 바꾸세요.

현재 기본값은 실제 QA 검증용입니다. 빠른 스모크 테스트만 하려면 예를 들어 아래처럼 줄일 수 있습니다.

```bat
set "PLAYER_LIMIT=1"
set "RESULT_LIMIT=1"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=3"
set "RESULT_PAGE_LIMIT=1"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=3"
```

### 특정 선수만 다시 확인하기

스탠딩 전체를 다시 돌리지 않고 특정 선수 프로필만 재검증하려면 `--player-url` 옵션을 사용합니다.

PowerShell이 임시 경로 문제 등으로 실행되지 않을 때는 명령 프롬프트(cmd)에서 아래처럼 실행합니다.

```cmd
cd /d D:\Work\Study\WSOP-Web\WSOP-Player-Standings-Crawler
node automation\crawl_player_standings.mjs --player-url https://www.wsop.com/players/선수정보URL/ --result-limit 0 --result-page-limit 0 --max-load-more 50
```

다른 선수를 확인할 때는 `--player-url` 뒤의 URL만 해당 선수 프로필 URL로 바꾸면 됩니다.

`--player-url`로 직접 실행하면 기본 출력 파일명에는 선수 slug와 실행 날짜/시간이 자동으로 붙습니다. 예를 들어 Tony Ren Lin 단건 실행은 아래처럼 별도 파일로 저장됩니다.

```text
automation\output\wsop-player-crawler-tony-ren-lin-20260522-114812-123-data.json
automation\output\wsop-player-crawler-tony-ren-lin-20260522-114812-123-report.html
automation\output\wsop-player-crawler-tony-ren-lin-20260522-114812-123-report-ko.html
automation\output\wsop-player-crawler-tony-ren-lin-20260522-114812-123-defects.csv
```

따라서 문제 케이스를 여러 명 또는 여러 번 나눠서 돌려도 이전 단건 리포트를 덮어쓰지 않습니다. 직접 파일명을 고정하고 싶을 때만 `--out`, `--html`, `--defects`를 지정하세요.

주의할 점은 `--players-url`과 `--player-url`이 다르다는 것입니다.

| 옵션            | 용도                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `--players-url` | standings 목록 페이지를 지정합니다. 목록에서 여러 선수를 수집할 때 사용합니다. |
| `--player-url`  | 특정 선수 프로필 페이지를 직접 지정합니다. 한 명만 재검증할 때 사용합니다.     |

`--limit`은 standings 목록에서 몇 명을 가져올지 정하는 옵션이므로, `--player-url`로 특정 선수만 실행할 때는 보통 필요하지 않습니다.

### Standings-only 빠른 대상자 추출

Phase 3 Player Presentation처럼 Result 상세 검증 없이 Player Standings 대상자만 빠르게 추출해야 할 때는 `--standings-only` 옵션을 사용합니다. 이 모드는 기존 standings 카테고리/selector 수집 로직을 그대로 사용하지만, 선수 Profile과 Result 상세 페이지 크롤링은 수행하지 않습니다.

```cmd
cd /d D:\Work\Study\WSOP-Web\WSOP-Player-Standings-Crawler
node automation\crawl_player_standings.mjs --standings-only --players-url https://www.wsop.com/player-standings/ --limit 10 --out automation\output\phase3-standings-targets-data.json
```

생성 JSON의 `mode`는 `standings-only`이며, `players[].standingsSources[]`에 category, rank, name, sourceUrl이 저장됩니다. 이 산출물은 빠른 UI 검증 대상자 목록으로 사용하고, DB/API/Result 정합성 판단에는 사용하지 않습니다.

### 추천 설정 예시

정확도를 우선으로 전체 검증에 가깝게 돌릴 때:

```bat
set "PLAYER_LIMIT=10"
set "RESULT_LIMIT=0"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=100"
set "RESULT_PAGE_LIMIT=0"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=8"
```

이 설정은 시간이 오래 걸릴 수 있지만, 선수 프로필의 Result와 Result 상세 페이지를 최대한 많이 확인합니다.

빠르게 실행 여부만 확인할 때:

```bat
set "PLAYER_LIMIT=1"
set "RESULT_LIMIT=1"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=3"
set "RESULT_PAGE_LIMIT=1"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=3"
```

이 설정은 설치, 브라우저 실행, 리포트 생성 흐름이 정상인지 보는 용도입니다. 실제 정합성 검증용으로는 부족할 수 있습니다.

PC가 느리거나 브라우저 오류가 자주 날 때:

```bat
set "CONCURRENCY=3"
```

`CONCURRENCY`는 동시에 검사하는 선수 수입니다. 값을 높이면 빨라질 수 있지만 PC 부하와 브라우저 오류 가능성도 같이 올라갑니다. 오류가 반복되면 3~5 정도로 낮춰서 다시 실행하세요.

Result 페이지가 매우 길어서 시간이 오래 걸릴 때:

```bat
set "RESULT_PAGE_LIMIT=50"
```

`0`은 제한 없이 끝까지 확인한다는 뜻입니다. 시간이 너무 오래 걸릴 때만 `50`처럼 충분히 큰 값으로 제한하세요. 단, 제한한 페이지 밖에 대상 순위가 있으면 실패로 나올 수 있습니다.

비활성 Result 버튼/링크를 결함으로 잡고 싶을 때:

```bat
set "DISABLED_RESULT_MODE=fail"
```

모드별 의미는 아래와 같습니다.

| 모드    | 동작                                                                                  |
| ------- | ------------------------------------------------------------------------------------- |
| `skip`  | 비활성 Result는 아직 검증 가능한 페이지가 아니라고 보고 실패에서 제외합니다.          |
| `fail`  | 비활성 Result 자체를 결함으로 보고 리포트에 실패로 기록합니다.                        |
| `check` | 비활성 상태여도 href가 있으면 해당 URL에 직접 접근해 Result 페이지 검증을 시도합니다. |

### 자주 보이는 실패 메시지 해석

리포트의 `누락:` 항목은 아래 의미입니다.

| 항목                   | 의미                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasFinalResultRows`   | Result 상세 페이지에서 최종 결과표 row를 찾지 못했습니다. 페이지 로딩, 접근 차단, 페이지 구조 변경 가능성이 있습니다.                          |
| `rankMatches`          | standings/profile의 순위와 Result 상세 페이지의 순위가 일치하지 않습니다.                                                                      |
| `playerMatches`        | 선수명이 일치하지 않습니다. 닉네임/실명 병기, 특수문자, 사이트 표기 차이를 확인해야 합니다.                                                    |
| `earningsMatches`      | Result 상세 페이지의 상금이 profile/event row의 상금과 일치하지 않습니다. Result 검증에서는 상금까지 정확히 일치해야 하므로 실패로 기록합니다. |
| `resultControlEnabled` | `DISABLED_RESULT_MODE=fail`일 때 비활성 Result 버튼/링크를 결함으로 기록한 항목입니다.                                                         |

실패가 나오면 먼저 열린 브라우저에서 해당 `Link`를 직접 확인하고, 실제 페이지에도 같은 값이 보이는지 비교하세요.

## 크롤링/검증 기준

크롤러는 속도와 정합성을 같이 맞추기 위해 아래 기준으로 데이터를 확인합니다.

### 프로필 요약값 검증

프로필의 ALL 탭을 기준으로 이벤트 row를 수집하고, 수집된 row 또는 프로필 상단 뱃지로 아래 값을 다시 검증합니다.

- `Title`
- `Bracelets`
- `Rings`
- `Final Tables`
- `Cashes`
- `Total Earnings`

ALL 탭에서는 `MAX_LOAD_MORE` 값만큼 `Load more`를 눌러 더 많은 row를 펼칩니다. 프로필 상단 `Cashes` 값에 도달하면 더 누르지 않고 멈춥니다.

`Total Earnings` 합계는 환율 변환, 통화 표기, 사이트 원본값 차이로 profile 상단 값과 ALL 탭 계산값이 다를 수 있습니다. 따라서 `Total Earnings` 불일치는 리포트에서 `주의`로 표시하고 실패 집계에서는 제외합니다. 단, Result 상세 페이지 검증의 상금 불일치는 정확성 검증 대상이므로 실패입니다.

`Bracelets`와 `Rings`는 ALL 탭 이벤트 분류 계산값을 실패 기준으로 사용하지 않고, 프로필 요약 영역에 표시되는 `badge_WSOPBracelet.webp`, `badge_WSOPRing.webp` 뱃지의 `.count` 값을 프로필 탭의 `Bracelets`, `Rings` 값과 비교합니다. 불일치하면 결함 후보로 리포트에 노출합니다. `.count`가 없으면 해당 뱃지 이미지 1개를 1개로 계산합니다.

`Title`, `Bracelets`, `Rings`, `Final Tables` 탭도 프로필 상단 요약값보다 표시 row 수가 적으면 해당 탭 안에서 `Load more`를 눌러 요약값에 도달할 때까지 펼친 뒤 비교합니다.

### 비활성 Result 처리

`DISABLED_RESULT_MODE=skip`일 때 비활성 Result 버튼/링크는 아직 검증 가능한 Result 페이지가 아니라고 보고 건너뜁니다.

이때 건너뛴 row는 Result 상세 페이지 검증에서만 제외합니다. 프로필 상단 요약값, ALL 탭 계산값, Title/Bracelets/Rings/Final Tables 탭 row 수 비교에는 그대로 포함합니다. 비활성 Result는 상세 결과 페이지 검증만 아직 할 수 없다는 뜻이지, 프로필 이벤트 row 자체가 무효라는 뜻은 아니기 때문입니다.

예를 들어 비활성 Result row가 1건 있고 그 row가 1~9위라면, Result 페이지 검증은 건너뛰지만 `Cashes`, `Total Earnings`, `Final Tables` 계산에는 포함합니다.

비활성 Result 자체를 결함으로 보고 싶으면 BAT에서 아래처럼 바꾸면 됩니다.

```bat
set "DISABLED_RESULT_MODE=fail"
```

비활성이어도 href가 있으면 직접 Result URL 접근을 시도하려면 아래처럼 바꿉니다.

```bat
set "DISABLED_RESULT_MODE=check"
```

### Result 페이지 검색 기준

각 이벤트의 Result 페이지에서는 최종 결과표에서 아래 3가지를 모두 만족하는 row를 찾습니다.

- 순위 No
- 선수명
- 상금

`RESULT_PAGE_LIMIT=0`이면 찾을 때까지 다음 페이지를 계속 확인합니다. 단, 대상 row를 찾으면 즉시 멈춥니다.

속도를 높이기 위해 순위가 51위 이상이면 예상 페이지보다 2페이지 앞에서 검색을 시작합니다. 이후에는 한 페이지씩 뒤로 넘기면서 찾습니다.

예시는 아래와 같습니다.

| 선수 순위 | 예상 페이지 | 실제 검색 시작 |
| --------- | ----------- | -------------- |
| 28위      | 1페이지     | 1페이지        |
| 343위     | 7페이지     | 5페이지        |
| 501위     | 11페이지    | 9페이지        |
| 1200위    | 24페이지    | 22페이지       |

이렇게 하는 이유는 WSOP Result 페이지에 순위 누락이나 공백이 있을 수 있어서, 예상 페이지로 바로 이동하면 대상 row를 건너뛸 가능성이 있기 때문입니다.

Result 페이지가 `1 2 3 ... 10`처럼 페이지 그룹을 나누는 경우에는 `Next`, `...`, `»` 계열 컨트롤을 눌러 다음 페이지 그룹으로 이동한 뒤 계속 검색합니다.

리포트의 `searchedPages`에는 각 페이지에서 본 row 수와 `rankRange`가 남습니다. 예를 들어 `rankRange: "501-550"`이면 해당 페이지에서 501~550위 구간을 확인했다는 뜻입니다.

## 검증 범위

크롤러는 선수별로 아래 항목을 검증합니다.

- ALL 탭을 펼쳐서 상단 요약값과 계산값을 비교합니다.
- Title, Bracelets, Rings, Final Tables 탭을 각각 눌러서 현재 표시된 row 수가 상단 요약값과 같은지 비교합니다.
- 각 이벤트의 Result 페이지를 열어 최종 결과표에서 선수명, 순위, 상금이 맞는지 확인합니다.

다른 탭들은 일반적으로 row 수가 많지 않기 때문에 `Load more`를 반복하지 않고, 탭 클릭 직후 표시된 row 수를 기준으로 빠르게 검증합니다. ALL 탭은 `Cashes`와 `Total Earnings` 계산에 필요하므로 `MAX_LOAD_MORE` 설정에 따라 더 많이 펼칩니다.

## 출력물

결과 파일은 `automation\output` 아래에 생성됩니다.

```text
*-data.json
*-report.html
*-report-ko.html
*-defects.csv
```

정확도를 우선으로 전체 검증에 가깝게 돌릴 때:

```bat
set "PLAYER_LIMIT=10"
set "RESULT_LIMIT=0"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=100"
set "RESULT_PAGE_LIMIT=0"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=8"
```

이 설정은 시간이 오래 걸릴 수 있지만, 선수 프로필의 Result와 Result 상세 페이지를 최대한 많이 확인합니다.

빠르게 실행 여부만 확인할 때:

```bat
set "PLAYER_LIMIT=1"
set "RESULT_LIMIT=1"
set "RESULT_RANK_LIMIT=0"
set "MAX_LOAD_MORE=3"
set "RESULT_PAGE_LIMIT=1"
set "DISABLED_RESULT_MODE=skip"
set "CONCURRENCY=3"
```

이 설정은 설치, 브라우저 실행, 리포트 생성 흐름이 정상인지 보는 용도입니다. 실제 정합성 검증용으로는 부족할 수 있습니다.

PC가 느리거나 브라우저 오류가 자주 날 때:

```bat
set "CONCURRENCY=3"
```

`CONCURRENCY`는 동시에 검사하는 선수 수입니다. 값을 높이면 빨라질 수 있지만 PC 부하와 브라우저 오류 가능성도 같이 올라갑니다. 오류가 반복되면 3~5 정도로 낮춰서 다시 실행하세요.

Result 페이지가 매우 길어서 시간이 오래 걸릴 때:

```bat
set "RESULT_PAGE_LIMIT=50"
```

`0`은 제한 없이 끝까지 확인한다는 뜻입니다. 시간이 너무 오래 걸릴 때만 `50`처럼 충분히 큰 값으로 제한하세요. 단, 제한한 페이지 밖에 대상 순위가 있으면 실패로 나올 수 있습니다.

비활성 Result 버튼/링크를 결함으로 잡고 싶을 때:

```bat
set "DISABLED_RESULT_MODE=fail"
```

모드별 의미는 아래와 같습니다.

| 모드    | 동작                                                                                  |
| ------- | ------------------------------------------------------------------------------------- |
| `skip`  | 비활성 Result는 아직 검증 가능한 페이지가 아니라고 보고 실패에서 제외합니다.          |
| `fail`  | 비활성 Result 자체를 결함으로 보고 리포트에 실패로 기록합니다.                        |
| `check` | 비활성 상태여도 href가 있으면 해당 URL에 직접 접근해 Result 페이지 검증을 시도합니다. |

### 자주 보이는 실패 메시지 해석

리포트의 `누락:` 항목은 아래 의미입니다.

| 항목                   | 의미                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasFinalResultRows`   | Result 상세 페이지에서 최종 결과표 row를 찾지 못했습니다. 페이지 로딩, 접근 차단, 페이지 구조 변경 가능성이 있습니다.                          |
| `rankMatches`          | standings/profile의 순위와 Result 상세 페이지의 순위가 일치하지 않습니다.                                                                      |
| `playerMatches`        | 선수명이 일치하지 않습니다. 닉네임/실명 병기, 특수문자, 사이트 표기 차이를 확인해야 합니다.                                                    |
| `earningsMatches`      | Result 상세 페이지의 상금이 profile/event row의 상금과 일치하지 않습니다. Result 검증에서는 상금까지 정확히 일치해야 하므로 실패로 기록합니다. |
| `resultControlEnabled` | `DISABLED_RESULT_MODE=fail`일 때 비활성 Result 버튼/링크를 결함으로 기록한 항목입니다.                                                         |

실패가 나오면 먼저 열린 브라우저에서 해당 `Link`를 직접 확인하고, 실제 페이지에도 같은 값이 보이는지 비교하세요.

## 크롤링/검증 기준

크롤러는 속도와 정합성을 같이 맞추기 위해 아래 기준으로 데이터를 확인합니다.

### 프로필 요약값 검증

프로필의 ALL 탭을 기준으로 이벤트 row를 수집하고, 수집된 row 또는 프로필 상단 뱃지로 아래 값을 다시 검증합니다.

- `Title`
- `Bracelets`
- `Rings`
- `Final Tables`
- `Cashes`
- `Total Earnings`

ALL 탭에서는 `MAX_LOAD_MORE` 값만큼 `Load more`를 눌러 더 많은 row를 펼칩니다. 프로필 상단 `Cashes` 값에 도달하면 더 누르지 않고 멈춥니다.

`Total Earnings` 합계는 환율 변환, 통화 표기, 사이트 원본값 차이로 profile 상단 값과 ALL 탭 계산값이 다를 수 있습니다. 따라서 `Total Earnings` 불일치는 리포트에서 `주의`로 표시하고 실패 집계에서는 제외합니다. 단, Result 상세 페이지 검증의 상금 불일치는 정확성 검증 대상이므로 실패입니다.

`Bracelets`와 `Rings`는 ALL 탭 이벤트 분류 계산값을 실패 기준으로 사용하지 않고, 프로필 요약 영역에 표시되는 `badge_WSOPBracelet.webp`, `badge_WSOPRing.webp` 뱃지의 `.count` 값을 프로필 탭의 `Bracelets`, `Rings` 값과 비교합니다. 불일치하면 결함 후보로 리포트에 노출합니다. `.count`가 없으면 해당 뱃지 이미지 1개를 1개로 계산합니다.

`Title`, `Bracelets`, `Rings`, `Final Tables` 탭도 프로필 상단 요약값보다 표시 row 수가 적으면 해당 탭 안에서 `Load more`를 눌러 요약값에 도달할 때까지 펼친 뒤 비교합니다.

### 비활성 Result 처리

`DISABLED_RESULT_MODE=skip`일 때 비활성 Result 버튼/링크는 아직 검증 가능한 Result 페이지가 아니라고 보고 건너뜁니다.

이때 건너뛴 row는 Result 상세 페이지 검증에서만 제외합니다. 프로필 상단 요약값, ALL 탭 계산값, Title/Bracelets/Rings/Final Tables 탭 row 수 비교에는 그대로 포함합니다. 비활성 Result는 상세 결과 페이지 검증만 아직 할 수 없다는 뜻이지, 프로필 이벤트 row 자체가 무효라는 뜻은 아니기 때문입니다.

예를 들어 비활성 Result row가 1건 있고 그 row가 1~9위라면, Result 페이지 검증은 건너뛰지만 `Cashes`, `Total Earnings`, `Final Tables` 계산에는 포함합니다.

비활성 Result 자체를 결함으로 보고 싶으면 BAT에서 아래처럼 바꾸면 됩니다.

```bat
set "DISABLED_RESULT_MODE=fail"
```

비활성이어도 href가 있으면 직접 Result URL 접근을 시도하려면 아래처럼 바꿉니다.

```bat
set "DISABLED_RESULT_MODE=check"
```

### Result 페이지 검색 기준

각 이벤트의 Result 페이지에서는 최종 결과표에서 아래 3가지를 모두 만족하는 row를 찾습니다.

- 순위 No
- 선수명
- 상금

`RESULT_PAGE_LIMIT=0`이면 찾을 때까지 다음 페이지를 계속 확인합니다. 단, 대상 row를 찾으면 즉시 멈춥니다.

속도를 높이기 위해 순위가 51위 이상이면 예상 페이지보다 2페이지 앞에서 검색을 시작합니다. 이후에는 한 페이지씩 뒤로 넘기면서 찾습니다.

예시는 아래와 같습니다.

| 선수 순위 | 예상 페이지 | 실제 검색 시작 |
| --------- | ----------- | -------------- |
| 28위      | 1페이지     | 1페이지        |
| 343위     | 7페이지     | 5페이지        |
| 501위     | 11페이지    | 9페이지        |
| 1200위    | 24페이지    | 22페이지       |

이렇게 하는 이유는 WSOP Result 페이지에 순위 누락이나 공백이 있을 수 있어서, 예상 페이지로 바로 이동하면 대상 row를 건너뛸 가능성이 있기 때문입니다.

Result 페이지가 `1 2 3 ... 10`처럼 페이지 그룹을 나누는 경우에는 `Next`, `...`, `»` 계열 컨트롤을 눌러 다음 페이지 그룹으로 이동한 뒤 계속 검색합니다.

리포트의 `searchedPages`에는 각 페이지에서 본 row 수와 `rankRange`가 남습니다. 예를 들어 `rankRange: "501-550"`이면 해당 페이지에서 501~550위 구간을 확인했다는 뜻입니다.

## 검증 범위

크롤러는 선수별로 아래 항목을 검증합니다.

- ALL 탭을 펼쳐서 상단 요약값과 계산값을 비교합니다.
- Title, Bracelets, Rings, Final Tables 탭을 각각 눌러서 현재 표시된 row 수가 상단 요약값과 같은지 비교합니다.
- 각 이벤트의 Result 페이지를 열어 최종 결과표에서 선수명, 순위, 상금이 맞는지 확인합니다.

다른 탭들은 일반적으로 row 수가 많지 않기 때문에 `Load more`를 반복하지 않고, 탭 클릭 직후 표시된 row 수를 기준으로 빠르게 검증합니다. ALL 탭은 `Cashes`와 `Total Earnings` 계산에 필요하므로 `MAX_LOAD_MORE` 설정에 따라 더 많이 펼칩니다.

## 출력물

결과 파일은 `automation\output` 아래에 생성됩니다.

```text
*-data.json
*-report.html
*-report-ko.html
*-defects.csv
```

`*-report.html`은 기존 영문 리포트이고, `*-report-ko.html`은 같은 내용을 사람이 보기 쉽게 번역한 한글 리포트입니다. BAT 실행 후에는 한글 리포트를 우선으로 엽니다.

크롤러는 실행 중에도 선수 1명 검증이 끝날 때마다 JSON, HTML, CSV 리포트를 갱신합니다. 긴 live 검증 중 결함 후보가 보이면 크롤러가 계속 도는 동안에도 `automation\output`의 최신 한글 리포트를 열어 직접 확인할 수 있습니다. `Ctrl+C`로 중단하면 새 선수 작업은 시작하지 않고, 현재까지 완료된 선수 기준으로 `interrupted` 상태의 부분 리포트를 남깁니다.

## 자체 검증

브라우저를 열지 않고 로컬 로직만 확인하려면:

```powershell
npm.cmd run crawl:self-test
```

## 유지보수 포인트

### Load More 버튼 감지 및 오분류 방지
프로필 페이지에서 입상 이력을 펼치기 위해 사용하는 `Load More` 버튼은 웹사이트 레이아웃 및 렌더링 방식의 영향을 크게 받아 실행 실패 가능성이 높습니다. 크롤러의 `findVisibleLoadMoreControl` 함수는 다음과 같은 방어적 탐색 로직을 수행합니다.

- **대상 요소 확장**: 표준 `button`, `a` 태그 외에 custom element로 렌더링된 `div` 및 `span`을 모두 검색합니다.
- **인터랙티브 요소 필터링**: `div`나 `span`을 수집할 때 단순 텍스트 메시지(예: *"Showing 10 more results"*)가 잡히는 것을 막기 위해, 클래스명에 버튼 관련 키워드(`btn`, `button`, `click`, `load-more`, `show-more`)가 존재하거나 마우스 커서 스타일이 `cursor: pointer`로 선언된 요소만 후보로 삼습니다.
- **로딩 상태 감지**: 클래스명에 상시 포함된 `lazy-loading`, `loading-more` 같은 단어로 인해 활성 버튼이 비활성 상태로 오인되는 것을 방지합니다. 실제 로딩 지시 클래스(`is-loading`, `loading-active` 등)나 단독 `loading` 클래스만 로딩 중(disabled)으로 인식하도록 조율되었습니다.
- **오분류 차단**: 검색, 필터, 정렬 버튼(`wrongControl`)을 구분할 때 ID나 클래스명 문자열을 통째로 포함하지 않고, 사용자의 화면에 보이는 실제 텍스트(`textContent` 등) 내용만을 기준으로 판별합니다.
- **점진적 스크롤 및 키보드 모사**: 단순히 윈도우 스크롤을 끝으로 이동시키는 방식 외에, 점진적으로 아래 영역을 스크롤하고 `PageDown` 키 입력을 전송하여 브라우저의 스크롤 이벤트를 강제로 활성화합니다.

## New Mode: Profile Only

You can now run the crawler with `--profile-only`.

- `--standings-only`: collect standings targets only (no profile, no Result checks)
- `--profile-only`: collect standings + profile summary/tab/event checks, then skip Result detail checks
- default mode: full crawl including Result detail checks

## 2차 확인 완료

- `--profile-only` 모드를 추가해 프로필/이벤트 검증까지만 수행하고 Result 상세 검증을 건너뛸 수 있습니다.
- 기존 `--standings-only` 및 full 모드와 함께 3단계 실행 범위를 선택할 수 있습니다.

## 브랜드 옵션 자동 수집

크롤러는 standings 대상자 수집 전에 실제 Player Standings 화면의 브랜드 필터 옵션을 먼저 읽고, JSON 리포트의 `brandOptions`에 저장합니다.

- `brandOptions.options`: `All Brands` 같은 기본/placeholder 항목을 제외한 실제 선택 가능 브랜드 목록
- `brandOptions.rawOptions`: 화면에서 발견한 원본 옵션 목록
- `brandOptions.count`: 실제 선택 가능 브랜드 수
- `brandOptions.sourceCategory` / `sourceUrl`: 옵션을 수집한 standings 카테고리와 URL

대시보드는 최근 크롤러 JSON에 `brandOptions`가 있으면 이 값을 기준으로 Brand Filter 체크박스를 자동 구성합니다. 아직 최신 JSON이 없거나 옵션 수집에 실패한 경우에는 기본 브랜드 목록을 fallback으로 사용합니다.

## Snapshot result-only mode

Use this when the full Result verification must cover the same player/event set but should not repeat brand filtering and profile tab collection.

Recommended flow:

1. Run the crawler with `PROFILE_ONLY=true` to create a profile/event snapshot JSON.
2. Run Result verification with `--result-only --from-report <snapshot-json>`.
3. Review the generated report and CSV. Profile defects from the snapshot are preserved, and Result defects are added.

PowerShell example:

```powershell
cd C:\Users\USER1\Desktop\WSOP-Web\WSOP-Player-Standings-Crawler
powershell -NoProfile -ExecutionPolicy Bypass -File automation\run_player_standings_crawler.ps1 `
  -PlayersUrl "https://www.wsop.com/player-standings/" `
  -ResultOnly `
  -FromReport "automation\output\wsop-player-crawler-live-YYYYMMDD-HHMMSS-data.json" `
  -Headed `
  -ResultLimit 0 `
  -ResultPageLimit 0 `
  -Concurrency 10
```

BAT environment example:

```bat
set "RESULT_ONLY=true"
set "FROM_REPORT=automation\output\wsop-player-crawler-live-YYYYMMDD-HHMMSS-data.json"
set "WSOP_NO_PAUSE=true"
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

Notes:

- `--result-only` requires `--from-report`.
- Snapshot rows without a direct Result URL are not silently passed. They are reported as `Result skipped` review notes.
- Profile-only skip warnings are removed from the result-only report, but profile mismatches from the snapshot are preserved.
- This keeps coverage intact while avoiding repeated profile and brand collection work.

## Report brand filtering

Generated HTML reports include a Brand Filter dropdown in the player directory controls.

- The filter is populated from each player's `standingsSources[].brand` values.
- It applies to the defect inspector, warning/skipped inspector, and player detail cards together.
- Profile-only reports use the same filter so profile validation results can be reviewed brand by brand.

## Crawler mode exclusivity

`--standings-only` and `--profile-only` are mutually exclusive.

- Use `--standings-only` when only standings target collection is needed.
- Use `--profile-only` when standings targets should be collected and player profile summary/tab/event checks should run, but Result detail pages should be skipped.
- With `--brand`, profile-only collection is intended to review the first-page target set from the brand-filtered categories: `All-Time Earnings - Men`, `All-Time Earnings - Women`, and `All Player Stats`.

## Stage/Live output tag

`RUN_WSOP_PLAYER_CRAWLER_LIVE.bat`는 `BASE_URL`이 stage 도메인을 포함하면 `OutputTag`를 `wsop-player-crawler-stage`로 설정합니다. 기본 Live 실행은 `wsop-player-crawler-live`를 사용합니다.
