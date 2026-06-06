# WSOP Badge/Crown Profile Filter 검증 스텝

## 1. 목적

Badge는 Player Profile에서만 노출된다. 따라서 Badge 정합성 검증은 목록 화면에서 시작하지 않고, 프로필에 실제로 표시된 Badge count를 기준으로 역검증한다.

Player filter와 브랜드 분리 수집은 기존 플레이어 크롤러에 이미 들어와 있다. 따라서 이번 Badge/Crown 정합성에서 새로 필요한 부분은 필터 크롤러가 아니라 Badge definition과 Badge별 count rule이다.

- 기존 Brand/Profile Brand 필터로 라이브 기준 이벤트 scope를 좁힌다.
- 프로필 Badge count와 ALL 탭 row 계산값을 비교한다.
- 신규 Badge의 asset/key는 추후 확정되면 `PROFILE_BADGE_DEFS` 계열 구조에 추가한다.
- 신규 Badge의 count rule은 기존 브랜드/profile brand filter scope 안에서 `1위` row 수를 세는 방식으로 둔다.

## 2. 핵심 검증 아이디어

```text
Player Profile 진입
-> 프로필 Badge 영역에서 group/type/count 확인
-> 필요한 경우 기존 brand/profile brand filter로 이벤트 scope 제한
-> ALL 탭 row 수집
-> Badge definition별 row 판별 조건으로 count 계산
-> 프로필에 보이는 Badge count와 ALL 탭 계산 count 비교
-> mismatch/source delay/filter 미적용 여부를 리포트
```

예시:

```text
프로필 Badge: GGPoker Badge 7개
-> 기존 Profile Brand Filter로 GGPoker scope 적용
-> ALL rows 중 1위 row 수 계산
-> 실제 row 수가 7개인지 비교
```

## 3. 테스트 데이터 흐름

1. 기존 플레이어 크롤러를 `PROFILE_ONLY=true`로 실행한다.
2. 필요한 브랜드가 있으면 `BRAND`와 `PROFILE_BRAND`로 같은 scope를 지정한다.
3. Player Profile에서 실제로 노출된 Badge count를 읽는다.
4. ALL 탭 row를 수집하고, 신규 Badge는 해당 scope 안의 `1위` row 수를 계산한다.
5. UI Badge count와 계산 count를 `additionalBadgeChecks`로 리포트한다.

추가 Badge 정의는 아래 설정 파일에 둔다.

```text
WSOP-Player-Standings-Crawler/automation/config/badge-definitions.json
```

예시:

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

현재 pilot은 이미 라이브 UI에서 asset이 확인된 Bracelet/Ring을 먼저 사용한다. Bracelet/Ring은 기존 summary/tab 검증을 유지하고, 신규 Badge만 `Additional Badge` 그룹으로 추가한다.

```json
{
  "brand": "WSOP",
  "badgeType": "bracelet",
  "badgeLabel": "Bracelet",
  "expectedVisibleCount": 7,
  "preferredTabLabels": ["Bracelets"],
  "countMode": "profile-badge-or-all-tab"
}
```

## 4. 정식 실행 위치

이 검증의 소유권은 기존 `WSOP-Player-Standings-Crawler`에 둔다. 별도 Badge 크롤러를 만들지 않고, 기존 플레이어 크롤러의 profile/profile-only 흐름에 Badge count 정합성 검증을 합친다.

이유:

- Badge는 Player Profile에서만 노출된다.
- 검증 대상은 기존 profile filter가 적용된 이벤트 scope, ALL 탭 event row count, Badge count 정합성이다.
- 따라서 Web UI 표현 검증보다 플레이어 크롤러의 profile-only 정합성 검증에 가깝다.
- 한글/영문 리포트도 플레이어 크롤러 리포트의 결함 후보와 review note로 보는 것이 자연스럽다.

대시보드 실행:

```text
Run.bat
-> 플레이어 스탠딩 크롤러
-> Profile Only 활성화
-> Brand Filter / Profile Brand Filter 설정
```

크롤러 단독 실행:

```bat
cd WSOP-Web\WSOP-Player-Standings-Crawler
set "PROFILE_ONLY=true"
set "BRAND=WSOP"
set "PROFILE_BRAND=WSOP"
set "PLAYER_LIMIT=5"
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

기본값:

```bat
PROFILE_ONLY=true
BRAND=WSOP
PROFILE_BRAND=WSOP
PLAYER_LIMIT=5
RESULT_LIMIT=0
```

GGPoker Badge 검증 시에는 Badge asset/key 확정 후 아래처럼 브랜드를 바꿔 실행한다.

```bat
set "BRAND=GGPoker"
set "PROFILE_BRAND=GGPoker"
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

## 5. 자동화 테스트 스텝

상세 스텝:

1. Player Standings에서 브랜드 기준 대상자를 수집한다.
2. 대상자의 Player Profile URL로 이동한다.
3. 프로필 Badge 영역에서 현재 보이는 Badge count를 읽는다.
   - Bracelet: `badge_WSOPBracelet.webp`
   - Ring: `badge_WSOPRing.webp`
   - GGPoker/WPT 등 신규 Badge: asset path, alt, class, data key 확정 후 추가
4. 필요한 경우 기존 profile brand filter를 적용한다.
5. ALL 탭에서 `Load More` 또는 `Show More`를 제한 횟수 안에서 펼친다.
6. 결과 row를 수집하고 중복 result link를 제거한다.
7. Badge type별 row 판별 조건으로 비교 count를 계산한다.
   - `bracelet` -> 기존 Bracelet badge count 또는 ALL row의 bracelet 조건
   - `ring` -> 기존 Ring badge count 또는 ALL row의 ring 조건
   - 기타 신규 Badge -> 기존 brand/profile brand filter scope 안의 `1위` row 수
8. Bracelets/Rings/Titles 같은 탭은 기본 truth가 아니라 보조 교차 검증으로 사용한다.
9. 프로필에 현재 보이는 Badge count와 비교한다.
10. mismatch를 플레이어 크롤러 결함 후보 또는 review note로 남긴다.

## 6. 판정 기준

기본 모드는 warning 중심이다.

| 상황 | 기본 판정 | 비고 |
| :--- | :--- | :--- |
| Badge count와 ALL 탭 계산 count 일치 | pass | `additionalBadgeChecks.status=pass` |
| profile brand filter scope 미일치 | warn | Badge가 보이면 올바른 `PROFILE_BRAND` 재실행 필요 |
| 신규 Badge count와 ALL 탭 1위 row 수 불일치 | warn | asset/key와 데이터 동기화 안정화 후 fail 전환 검토 |
| Badge count를 읽을 수 없음 | warn | definition matcher 보강 필요 |

## 7. 리포트 산출물

크롤러 산출물:

- `WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-*-data.json`
- `WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-*-report-ko.html`
- `WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-*-report.html`
- `WSOP-Player-Standings-Crawler/automation/output/wsop-player-crawler-*-defects.csv`

주요 필드:

- `brand`
- `badgeType`
- `badgeLabel`
- `group`
- `detailType`
- `filterScope`
- `countMode`
- `displayedCount`
- `firstPlaceCount`
- `actualComparedCount`
- `status`
- `detail`
- `rowSamples`

운영 기준의 정식 검증과 리포트는 기존 플레이어 크롤러 산출물에 합친다. 별도 Web-Automation Badge spec나 후보 snapshot generator는 공식 실행 경로로 두지 않는다.

## 8. 유지보수 포인트

- Brand/Profile Brand 필터는 기존 플레이어 크롤러 기능으로 유지하고, Badge/Crown 작업에서는 새 필터 크롤러를 만들지 않는다.
- 필터 컨트롤이 없거나 적용 실패하면 브랜드 scope 검증은 warning으로 남기되, 브랜드 제한이 필요 없는 Bracelet/Ring 기본 검증은 ALL 탭 기준으로 계속 수행한다.
- GGPoker 등 신규 Badge는 이미지 경로, alt/class/data key가 확정된 뒤 추가한다. count rule은 별도 탭이 아니라 필터 적용 후 ALL 탭의 `1위` row 수를 기준으로 한다.
- 전 유저를 public UI로 전수 검증하지 않는다. 기존 플레이어 크롤러의 브랜드 분리와 최신 산출물을 후보군 discovery와 high-risk sampling 용도로 사용한다.
- POY 유저는 기존 `poy-players.fixture.json`을 재사용하고, Badge/Crown 전용 fixture로 중복 고정하지 않는다.
- GGPass와 Scouter 동기화 지연으로 Crown과 Badge count가 일시적으로 다를 수 있으므로, 초기에는 hard fail보다 warning으로 관찰한다.
