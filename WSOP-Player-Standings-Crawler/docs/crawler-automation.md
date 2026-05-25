# 크롤링 기반 검증 자동화

이 자동화는 화면의 요약값만 비교하는 방식이 아니라, 페이지별 데이터를 구조화해서 비교합니다.

## 데이터 모델

```text
Player
  summary
  events[]
    resultPage
  comparisons[]
  defects[]
```

## 비교 기준

- `Title`: 이벤트 순위가 `1`인 행 수
- `Bracelets`: Bracelet 계열 이벤트에서 `1`등한 수
- `Rings`: Circuit/Ring 계열 이벤트에서 `1`등한 수
- `Final Tables`: 이벤트 순위가 `1`부터 `9`까지인 행 수
- `Cashes`: 이벤트 행 수
- `Total Earnings`: 이벤트 상금 합계
- Result page: 이벤트 행과 Result 페이지의 플레이어명, 이벤트명, 순위, 상금 표시 여부

## 기존 버전과 차이

`WSOP-Player-Standings-Check`는 현재 사용 가능한 점검 버전입니다.

`WSOP-Player-Standings-Crawler`는 다음 단계 자동화로, 플레이어 상세와 Result 페이지를 모두 크롤링해서 데이터 모델로 저장하고 비교합니다.

## 라이브 실행

라이브 `wsop.com` 기준으로 실행하려면 아래 배치 파일을 사용합니다.

```text
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

직접 명령어로 실행할 때는 `-PlayersUrl`만 라이브 URL로 바꾸면 됩니다.

```powershell
powershell -ExecutionPolicy Bypass -File automation\run_player_standings_crawler.ps1 `
  -PlayersUrl "https://www.wsop.com/player-standings/" `
  -Headed `
  -Limit 10 `
  -ResultLimit 3 `
  -ResultPageLimit 0 `
  -Out "automation\output\wsop-player-crawler-live-data.json" `
  -HtmlReport "automation\output\wsop-player-crawler-live-report.html" `
  -DefectReport "automation\output\wsop-player-crawler-live-defects.csv"
```

`-ResultPageLimit 0`은 각 Result 상세의 최종 순위표를 마지막 페이지까지 모두 확인합니다. 정합성보다 실행 시간을 줄이는 것이 중요하면 `-ResultPageLimit 50`처럼 충분히 큰 양수로 제한할 수 있습니다.
