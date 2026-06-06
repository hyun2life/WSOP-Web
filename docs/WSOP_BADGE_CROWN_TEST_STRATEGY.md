# WSOP Badge/Crown 테스트 방향성

## 1. 핵심 원칙

Badge/Crown 자동화는 UI 노출 검증과 데이터 정합성 검증을 분리한다.

- Crown은 Badge 개수로 산출되는 결과값이다.
- Crown UI 자체는 비교적 단순하지만, Crown 등급이 맞는지는 Badge 정합성 결과에 의존한다.
- Badge는 타입, 그룹화, count, rank, 표시 순서, 데이터 출처, 라이브 변동성이 얽혀 있으므로 정합성 검증의 핵심 난점이다.

따라서 Phase 3에서 Crown tier 또는 Badge count를 정답처럼 판정하지 않는다. Phase 3는 표현 검증만 담당하고, Badge count 역검증은 별도 Badge 크롤러가 아니라 기존 `WSOP-Player-Standings-Crawler`의 profile/profile-only 정합성 흐름에 합친다. Phase 6는 backend/API 비교가 붙을 때의 보조 데이터 정합성 영역으로만 다룬다.

Profile filter 기반 Badge count 역검증의 상세 실행 스텝은 `docs/WSOP_BADGE_CROWN_PROFILE_FILTER_VALIDATION_STEPS.md`에 별도로 정리한다.

## 2. Phase별 역할

| 영역 | 담당 | 목적 |
| :--- | :--- | :--- |
| UI 표현 | Phase 3 Player Presentation | Badge/Crown이 화면에 렌더링되는지, 위치와 asset이 깨지지 않는지 확인 |
| UI 조작성 | Phase 4 Search/Filter/Sort | 검색, 필터, 탭, 목록 전환 후 Badge/Crown UI가 유지되는지 확인 |
| 후보군 수집 | Crawler discovery | 라이브 필터 기준으로 Badge 검증 후보군을 동적으로 생성 |
| 데이터 정합성 | Existing Player Crawler profile-only integrity | profile UI Badge count, 기존 브랜드 scope, ALL 탭 row 계산값 간 비교 |
| 레이아웃 회귀 | Phase 8 Visual Regression | Badge row overflow, Crown clipping, 모바일 겹침 확인 |
| 릴리즈 게이트 | Phase 9 Regression | 안정화된 필수 검증만 release gate에 편입 |

## 3. Phase 3 범위

Phase 3는 Badge/Crown의 정확한 값을 검증하지 않는다. 다음과 같은 UI signal만 확인한다.

- Player Profile 아바타에 Crown UI 후보가 붙는지
- 이름 하단 Badge 영역이 렌더링되는지
- Badge/Crown 이미지나 asset이 깨지지 않는지
- Badge가 많을 때 overflow, scroll, arrow UI 후보가 있는지
- Player Standings, Player Search, POY Leaderboard 등에서 Crown/Badge UI 구조가 깨지지 않는지

Phase 3에서 하지 않는 것:

- Badge 개수 기준 Crown tier 판정
- Badge group 포함 여부 정합성 판정
- POY/Standings rank 값 정합성 판정
- backend payload와 UI 값 비교
- GGPass/Scouter 동기화 지연 판정

## 4. Player Crawler 정합성 범위

Badge count 역검증은 `WSOP-Player-Standings-Crawler`의 기존 profile/profile-only 흐름에서 다룬다. Phase 6는 추후 backend/API payload 비교가 필요한 경우에만 보조 검증으로 연결한다.

검증 대상:

- Badge 타입별 대상자가 맞는지
- 동일 타입 Badge가 대표 Badge 1개로 그룹화되는지
- count 합산값이 맞는지
- POY/Standings Badge의 rank 표시가 맞는지
- Badge 표시 순서가 기획과 맞는지
- Badge 개수 기준 Crown tier 계산이 맞는지
- backend 값과 profile UI/crawler 계산값이 서로 어떻게 다른지
- GGPass/Scouter 시차로 인한 mismatch인지 실제 결함인지

## 5. POY 대상자 관리

역대 POY 유저는 이미 fixture로 관리되고 있으므로 Badge/Crown 전용 fixture로 중복 관리하지 않는다.

- 기존 fixture: `WSOP-Web-Automation/fixtures/player-presentation/poy-players.fixture.json`
- Phase 3/4: 기존 POY fixture를 재사용해 표시 구조를 확인
- Player Crawler/Phase 6: POY rank, 연도, Badge count 정합성 비교

## 6. 브랜드별 Badge 대상자 관리

브랜드별 Badge 대상자는 고정 fixture로 관리하면 안 된다. 대회는 계속 진행되고, Badge 대상자와 순위가 유동적으로 바뀔 수 있기 때문이다.

방향:

```text
Player Filter / Brand Filter
-> profile-only live 후보 확보
-> 후보 profile-only 검증
-> backend / profile UI / crawler 계산값 비교
-> 리포트에서 source별 차이 표시
```

기존 플레이어 크롤러에는 브랜드 분리와 profile brand filter가 이미 들어와 있다. 따라서 이번 작업의 핵심은 필터를 새로 만드는 것이 아니라, 이미 분리된 브랜드/프로필 이벤트 scope 위에 Badge definition과 count rule을 추가하는 것이다. 신규 Badge의 이미지 경로/alt/class/data key는 추후 확정되면 반영한다.

### Profile Badge count 역검증 파일럿

필터별 크롤러를 많이 늘리기 전에, 프로필에서 실제로 노출된 Badge count와 기존 ALL 탭 row 수집값을 우선 활용한다. Badge는 프로필에서만 노출되므로, 자동화의 시작점도 프로필 Badge 영역이어야 한다.

방향:

```text
Player Profile에서 노출된 Badge group/type/count 확인
-> 필요한 경우 기존 brand/profile brand filter로 이벤트 scope 제한
-> ALL 탭 row를 Badge별 조건으로 계산
-> 계산 count와 Badge count 비교
-> mismatch를 Badge count mismatch 또는 source delay 후보로 리포트
```

예를 들어 프로필에서 GGPoker Badge가 7개로 노출되면, 기존 Profile Brand Filter로 GGPoker scope를 적용하거나 이미 brand가 분리된 row를 기준으로 ALL 탭의 1위 row 수가 7개인지 비교한다. 이 방식은 라이브 브랜드별 대상자를 별도 fixture로 고정하지 않고, 이미 노출된 Badge 수를 기준으로 역검증한다는 장점이 있다.

초기에는 Bracelet/Ring이 현재 UI asset(`badge_WSOPBracelet.webp`, `badge_WSOPRing.webp`)과 프로필 요약 수치가 이미 존재하므로 첫 번째 pilot source가 된다. 이후 GGPoker, WPT 등 신규 Badge asset/key가 확정되면 필터 로직이 아니라 Badge definition을 추가하고, 신규 Badge 공통 count rule은 “필터 적용 후 1위 row 수”로 둔다.

## 7. 전 유저 검증 방향

전 유저 대상 정합성은 public UI 크롤링으로 처리하지 않는다.

이유:

- 요청량이 너무 크다.
- 대회 진행에 따른 변동성이 높다.
- public UI selector나 네트워크 상태에 따라 flaky해질 수 있다.

전 유저 기준 검증은 backend, API, DB, export 데이터 계층에서 수행하고, public automation은 그중 위험도가 높은 후보군을 샘플링해 검증한다.

후보군 예시:

- 브랜드별 1위 또는 대표 유저
- 프로필에 Bracelet/Ring Badge가 이미 노출되어 profile filter로 역검증 가능한 유저
- Badge count가 Crown 경계값에 걸린 유저: 1개, 3개, 5개 이상
- 최근 대회 우승자
- POY/Standings rank가 붙는 유저
- Badge가 많아 overflow가 발생할 가능성이 높은 유저
- 이전 run에서 mismatch가 발생한 유저
- backend와 profile UI/crawler 계산값이 어긋난 유저

## 8. 라이브 후보 운영

라이브 기준 후보군은 고정 expected fixture나 별도 snapshot generator로 관리하지 않는다. 브랜드별 대상자는 대회 진행에 따라 계속 바뀌므로, 기존 Player Crawler의 `BRAND`/`PROFILE_BRAND` 실행 범위에서 현재 대상자를 확보하고 그 run의 output을 기준으로 리포트한다.

신규 Badge에 필요한 정적 입력은 asset/key 정의뿐이다.

```text
WSOP-Player-Standings-Crawler/automation/config/badge-definitions.json
```

해당 파일의 `additionalBadges`에 `key`, `label`, `detailType`, `brand`, `fileName` 또는 `altPattern`/`classPattern`/`dataKey`를 넣으면 기존 profile/profile-only 흐름에서 Badge count를 읽고 ALL 탭 1위 row 수와 비교한다.

정식 역검증 실행 명령:

```bat
cd WSOP-Web\WSOP-Player-Standings-Crawler
set "PROFILE_ONLY=true"
set "BRAND=WSOP"
set "PROFILE_BRAND=WSOP"
set "PLAYER_LIMIT=5"
RUN_WSOP_PLAYER_CRAWLER_LIVE.bat
```

통합 Run 대시보드에서는 기존 `플레이어 스탠딩 크롤러` 카드를 선택하고 `Profile Only`, `Brand Filter`, `Profile Brand Filter` 옵션으로 실행한다.

기본은 warning 중심이다. 신규 Badge asset/key, profile filter selector, GGPass/Scouter 동기화가 안정화되기 전에는 mismatch를 review note로 먼저 보고, hard fail 전환은 별도 정책으로 검토한다.

리포트에는 실행 scope를 반드시 표시한다.

```text
Mode: profile-only
Brand Filter: GGPoker
Profile Brand Filter: GGPoker
This is a sampled public UI validation run, not a full-user truth set.
```

## 9. 리포트 방향

리포트는 Crown 중심이 아니라 Badge evidence 중심이어야 한다.

권장 구성:

1. Badge/Crown Summary
   - 전체 대상자 수
   - pass / warn / fail
   - Badge mismatch 수
   - Crown tier mismatch 수
   - source delay 의심 수
   - filter scope warning 수

2. Player별 요약 카드
   - Crown actual / expected
   - eligible Badge count
   - displayed Badge groups
   - status
   - 주요 reason

3. Badge group 상세 테이블

| Group | Type | Backend | Crawler Calc | UI | Result |
| :--- | :--- | ---: | ---: | ---: | :--- |
| WSOP Official Event | Bracelet | 17 | 17 | 17 | Pass |
| WSOP Official Event | Ring | 0 | 0 | 0 | Pass |
| Additional Badge | GGPoker Tournament | 7 | 7 | 7 | Pass |
| Additional Badge | WPT | 2 | 2 | 1 | Warn |
| POY | 2013 POY | 1 | 1 | 0 | Warn |
| Standings | All-Time Earnings Men | #3 | #3 | #3 | Pass |

Bracelet/Ring은 기존처럼 탭/요약 지표가 분리되어 있으므로 현재 리포트 구조를 유지한다. 추가되는 신규 Badge는 그룹을 여러 개로 쪼개지 않고 `Additional Badge` 같은 단일 그룹으로 묶고, 그 안에서 `GGPoker Tournament`, `GGPoker Cash Game`, `WPT`, `EPT`처럼 세부 타입을 나눠 보여준다.

4. Source disagreement 분류
   - `Backend badge missing`
   - `UI badge missing`
   - `Badge count mismatch`
   - `Badge rank mismatch`
   - `Badge order mismatch`
   - `Representative badge mismatch`
   - `Filter scope mismatch`
   - `GGPass/Scouter sync delay`
   - `Crown tier mismatch from badge count`

## 10. 결론

테스트 방향성은 다음으로 고정한다.

- Phase 3: Badge/Crown UI가 보이는지 관찰
- Phase 4: Search/filter/sort 전환 후 Badge/Crown UI가 유지되는지 확인
- Player Crawler discovery: 플레이어/브랜드 필터로 라이브 후보군 확보
- Existing Player Crawler profile-only integrity: 프로필 Badge count와 profile filter 결과 간 역검증
- Phase 8: Badge/Crown 레이아웃 깨짐, overflow, clipping 확인
- Phase 9: 안정화 후 필요한 항목만 release gate에 편입

가장 중요한 원칙은 이렇다.

Badge 대상자 확보는 고정 fixture가 아니라 기존 live filter/profile-only 실행 결과로 가야 하고, Crown은 Badge count 검증의 결과값으로 다룬다.
