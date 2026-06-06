# WSOP Player Standings Crawler

Player Standings/Profile 데이터를 수집하고 숫자 정합성 리포트를 만드는 하위 프로젝트입니다.

사용법, 실행 옵션, Badge/Crown 검증 방식, 리포트 읽는 법은 상위 [README.md](../README.md)에 통합되어 있습니다.

## 이 폴더에서 직접 실행할 때

```bat
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
npm run crawl
npm run crawl:headed
npm run crawl:self-test
npm run crawl:tournament
npm run crawl:tournament:self-test
```

## 주요 위치

| 위치 | 역할 |
| --- | --- |
| `automation/config/` | Badge 정의와 실행 설정 |
| `automation/output/` | 크롤러 HTML/JSON/CSV 리포트 |
| `automation/.auth/` | 브라우저 인증 상태 |
| `automation/crawl_player_standings.mjs` | Player Standings/Profile 크롤러 |
| `automation/crawl_tournaments.mjs` | Tournament 전용 크롤러 |

중복 설명은 이 파일에 추가하지 말고 상위 README에 반영합니다.
