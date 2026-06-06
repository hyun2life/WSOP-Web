# WSOP Badge/Crown 자동화 1차 설계

## 1. 목적

Badge 및 Crown 개편이 WSOP.com 유저 프로필과 관련 목록 화면에 적용될 예정이므로, 배포 전후에 UI 노출, Badge 순서, Crown 등급, 데이터 동기화 예외를 자동화 시스템에서 검증할 수 있도록 1차 설계를 정리한다.

이번 문서는 구현 전 설계 문서이며, 실제 테스트 코드/러너/리포트 구조 변경은 후속 작업에서 분리한다.

Profile filter 기반 Badge count 역검증의 실제 테스트 스텝은 `docs/WSOP_BADGE_CROWN_PROFILE_FILTER_VALIDATION_STEPS.md`에서 관리한다. 이 역검증은 Web-Automation Phase 6나 별도 Badge 크롤러가 아니라 기존 `WSOP-Player-Standings-Crawler`의 profile/profile-only 정합성 흐름에 합친다.

## 2. 기획 요약

### 적용 대상

- WSOP+ LIVE
- PokerStake
- WSOP.com

### WSOP.com 영향 화면

| 화면 | 적용 내용 | 자동화 우선순위 |
| :--- | :--- | :---: |
| Player Standings | 아바타에 Crown 적용 | High |
| Player Profile | 아바타에 Crown 적용, 이름 하단에 Badge 적용 | High |
| Player Search | 아바타에 Crown 적용 | High |
| POY Leaderboard | 아바타에 Crown 적용 | Medium |

### Crown 등급

| Badge 보유 수 | Crown |
| :--- | :--- |
| 1개 | Bronze Crown |
| 3개 | Silver Crown |
| 5개 이상 | Gold Crown |

자동화에서는 Crown 등급을 단순 이미지 존재 여부로만 보지 않고, Badge 보유 수 기준의 기대 등급과 실제 UI 표현을 비교할 수 있어야 한다.

### Badge 타입

| 그룹 | Badge 타입 | 주요 노출 규칙 |
| :--- | :--- | :--- |
| POY | 올해 POY, 연도별 POY | 복수 보유 시 각각 표시, 최신 연도 우선, 하단 rank 표시 |
| Standings | 올해 Standings, All-Time Earnings Men/Women | 대표 Badge 1개 표시, 하단 rank 표시 |
| WSOP Official Event | Bracelet, Ring | 동일 토너 타입은 대표 Badge 1개, 개수 합산 표시 |
| GGPoker Official Event | GGMillions, GGMasters | 동일 토너 타입은 대표 Badge 1개, 개수 합산 표시 |
| Other Official Event | Triton, WPT, EPT 등 | 기획 순서에 따라 표시 |
| GGPoker Badge | Tournament, Cash Game | GM Group 순서 기준 표시 |

### 중요 예외

- 아바타 Crown은 GGPass 기준으로 먼저 반영될 수 있다.
- Player Profile > badges 영역은 Scouter 기준으로 표시된다.
- Bracelet, Ring, GGMasters, GGMillions 등 일부 Badge는 GGPass에는 즉시 반영되지만 Scouter에는 수 시간 지연될 수 있다.
- 따라서 Crown 등급과 Badge 개수가 일시적으로 어긋나는 케이스는 즉시 hard fail로 보지 않고, 동기화 지연 가능 warning으로 분류한다.

## 3. 자동화 범위 분리

Badge/Crown 검증은 한 Phase에 몰아넣지 않고 기존 Phase 역할에 맞춰 분리한다.

| 영역 | 담당 Phase/모듈 | 검증 목적 | 실패 정책 |
| :--- | :--- | :--- | :--- |
| UI 노출 | Phase 3 Player Presentation | Crown/Badge 영역이 존재하고 깨지지 않는지 확인 | 핵심 화면은 fail, optional/환경차는 warning |
| 상호작용 | Phase 4 Search/Filter/Sort | 검색/탭/리스트 전환 후 Crown/Badge가 유지되는지 확인 | UI 조작성 문제는 fail 또는 warning |
| 데이터 정합성 | Existing Player Crawler profile-only integrity | Badge 타입, 개수, rank, Crown 기대 등급 비교 | 데이터 확정 후 fail, 동기화 지연은 warning |
| 레이아웃 회귀 | Phase 8 Visual Regression | Badge overflow, avatar crown clipping, 모바일 겹침 확인 | baseline 정책에 따라 diff 분류 |
| 릴리즈 게이트 | Phase 9 Regression | 필수/옵션 검증 묶음 관리 | 초기에는 review item, 안정화 후 gate 편입 검토 |

### Phase 3와 정합성 경계

- Phase 3는 Crown/Badge가 UI에 렌더링되는지, avatar/name/badge row 위치가 깨지지 않는지, asset/overflow UI가 관찰되는지만 확인한다.
- Crown 등급은 Badge 개수로 산출되는 값이므로 Phase 3에서 기대 등급을 pass/fail 기준으로 삼지 않는다.
- Badge 개수, Badge 그룹 포함 여부, Crown tier 산출값, GGPass/Scouter 동기화 차이는 기존 Player Crawler profile/profile-only 정합성 흐름에서 우선 다룬다. Phase 6 Data Integrity는 backend/API 비교가 붙을 때의 보조 영역이다.
- Phase 3에 별도 Badge/Crown truth fixture를 만들지 않는다. UI 샘플이 필요하면 기존 player-presentation fixture를 재사용하고, 데이터 truth는 Player Crawler 산출물에서 다룬다.

## 4. 1차 검증 시나리오

### 4.1 Player Standings

- standings row 또는 card에 player avatar가 노출되는지 확인한다.
- Crown 보유 대상자의 avatar 주변에 crown/border 표현이 있는지 확인한다.
- Crown이 없는 대상자의 avatar에 잘못된 crown/border가 붙지 않는지 확인한다.
- row 클릭 또는 profile link 이동이 기존처럼 동작하는지 확인한다.
- 이미지 lazy-load 또는 CDN 실패 시 report에 asset warning을 남긴다.

### 4.2 Player Profile

- profile header avatar에 Crown이 표시되는지 확인한다.
- player name 하단 Badge 영역이 존재하는지 확인한다.
- Badge가 없을 수 있는 대상자는 Badge 영역 미노출 또는 empty state를 정상으로 인정한다.
- Badge 하단 rank 표시가 필요한 타입은 `# {rank}` 형식의 표시 후보를 확인한다.
- 동일 타입 Badge가 복수일 때 대표 Badge 1개와 count 표시가 유지되는지 확인한다.
- count 표기는 99 초과 시 `99` 고정 표시 정책을 검증 후보로 둔다.
- Badge가 화면 폭을 넘으면 좌우 스크롤 또는 arrow UI가 동작하는지 확인한다.

### 4.3 Player Search

- 검색 자동완성 row 또는 검색 결과 card의 avatar에 Crown이 표시되는지 확인한다.
- 검색어 입력, 결과 갱신, profile 이동 후 Crown/Badge 관련 DOM이 깨지지 않는지 확인한다.
- 검색 결과가 동적으로 바뀌는 경우, 대표 fixture 대상만 샘플링하고 전체 사용자 전수 검색은 하지 않는다.

### 4.4 POY Leaderboard

- POY leaderboard 대상자의 avatar에 Crown이 표시되는지 확인한다.
- 올해 POY Badge는 현재 rank가 변동 가능하므로, rank 값 정확성은 데이터 검증 Phase에서 다루고 Phase 3/4에서는 표시 구조만 확인한다.
- POY 페이지 접근이 불안정하면 기존 Phase 3 방식처럼 Player Search fallback을 허용한다.

## 5. Badge/Crown 데이터 모델 초안

자동화 결과 JSON에는 기존 summary/badgeCounts와 별도로 Badge/Crown 전용 구조를 추가하는 방향을 권장한다.

```json
{
  "badgeCrown": {
    "crown": {
      "expectedTier": "gold",
      "actualTier": "silver",
      "source": "ui-avatar",
      "status": "warn",
      "reason": "possible-ggpass-scouter-sync-delay"
    },
    "badges": [
      {
        "group": "poy",
        "type": "current-year-poy",
        "label": "2026 POY",
        "rank": 23,
        "count": 1,
        "isRepresentative": false,
        "source": "profile-badges",
        "status": "pass"
      }
    ],
    "summary": {
      "eligibleBadgeCount": 5,
      "displayedBadgeCount": 4,
      "hasOverflowControl": true
    }
  }
}
```

### 권장 필드

- `expectedTier`: Badge 수 기준 기대 Crown 등급
- `actualTier`: UI에서 감지한 Crown 등급
- `eligibleBadgeCount`: Crown 산정에 포함되는 Badge 개수
- `displayedBadgeCount`: Player Profile badges 영역에서 감지한 Badge 개수
- `group`: `poy`, `standings`, `wsop-official-event`, `ggpoker-official-event`, `other-official-event`, `ggpoker-badge`
- `type`: 세부 Badge 타입
- `rank`: POY/Standings 등수
- `count`: 그룹 대표 Badge 우측 상단 표시 개수
- `isRepresentative`: 동일 타입 그룹화 대표 Badge 여부
- `status`: `pass`, `fail`, `warn`, `skipped`
- `reason`: warning/fail 분류 사유

## 6. Fixture 설계

초기 fixture는 적은 수의 대표 계정으로 시작하고, 실제 데이터가 안정화되면 확장한다.

| Fixture 유형 | 목적 | 필요 데이터 |
| :--- | :--- | :--- |
| no-badge | Crown/Badge 미노출 정상 케이스 | profile URL, expectedTier null |
| bronze-crown | Badge 1개 보유 | profile URL, expectedTier bronze |
| silver-crown | Badge 3개 보유 | profile URL, expectedTier silver |
| gold-crown | Badge 5개 이상 보유 | profile URL, expectedTier gold |
| poy-current | 올해 POY rank 표시 | year, rank, profile URL |
| poy-history | 과거 POY 복수 보유 | years, expected order |
| standings | Standings Badge/rank 표시 | category, rank |
| bracelet-ring | WSOP Official Event 그룹/개수 표시 | bracelets, rings |
| overflow | Badge row overflow/scroll 확인 | minimum displayed badges |
| sync-delay | GGPass/Scouter 지연 가능 케이스 | expected warning reason |

Fixture는 `WSOP-Web-Automation/fixtures/player-presentation/` 아래의 UI fixture와 `WSOP-Player-Standings-Crawler` 쪽 데이터 검증 fixture를 분리한다. 동일 선수를 쓰더라도 UI fixture는 표시/접근성 중심, crawler fixture는 값 비교 중심으로 관리한다.

### POY fixture 재사용

- 역대 POY 대상자는 이미 `WSOP-Web-Automation/fixtures/player-presentation/poy-players.fixture.json`에서 관리한다.
- Badge/Crown 작업에서 POY 대상자를 별도 fixture로 중복 관리하지 않는다.
- POY Badge 표시 구조는 기존 POY fixture를 재사용해 Phase 3/4에서 확인하고, POY rank/연도/Badge count 정합성은 Player Crawler에서 우선 비교한다. backend/API truth 비교가 필요해지면 Phase 6로 확장한다.

### 브랜드별 대상자 확보

- 백엔드에서 Badge/Crown 산출 데이터를 넘겨주더라도, 그 데이터를 단독 truth로 신뢰하지 않는다.
- 브랜드별 1위 또는 대표 Badge 보유자는 현재 라이브 WSOP 화면 기준으로 기존 Player Crawler 실행에서 확보한다.
- 신규 Badge 대상자 검증은 고정 snapshot fixture가 아니라 `BRAND`/`PROFILE_BRAND` 범위와 `PROFILE_ONLY=true` 실행 결과를 기준으로 한다.
- 라이브 순위와 Badge 데이터는 변동 가능하므로, public UI 기준 mismatch는 초기에 바로 hard fail하지 않고 warning/review item으로 분리한다.
- 전체 유저 기준의 truth가 필요하면 public crawler가 아니라 backend/API/DB/export 계층에서 처리한다.

### Profile Badge count filter 역검증

- 필터별 크롤러 실행을 무리하게 늘리기보다, Player Profile에 노출된 Badge count를 우선 검증 기준으로 삼는다.
- Player filter와 브랜드 분리는 기존 플레이어 크롤러에 이미 들어와 있으므로, Badge/Crown 작업에서는 새 필터 크롤러를 만들지 않는다.
- 프로필에서 보이는 Badge group/type/count를 읽은 뒤, 기존 brand/profile brand filter 또는 이미 분리된 row brand 값을 scope 조건으로 사용한다.
- 기본 truth는 `ALL` 탭 수집 row이며, `Bracelets`, `Rings`, `Titles` 같은 Badge 관련 tab은 보조 교차 검증으로 사용한다.
- 이 후보군은 별도 snapshot fixture가 아니라 해당 crawler run의 player/result output 안에서 관리한다.
- 이 방식은 “Badge가 이미 UI에 보인다”는 사실을 출발점으로 삼기 때문에, 신규 Badge/Crown 전체 규칙이 확정되기 전에도 정합성 리포트 파일럿을 시작할 수 있다.
- 예를 들어 프로필에서 GGPoker Badge가 7개로 보이면, 기존 GGPoker profile filter 또는 row brand 기준으로 scope를 좁힌 뒤 ALL row 중 1위 row 수가 7개인지 비교한다.
- Bracelet/Ring 이미지 경로는 현재 UI에서 쓰는 `badge_WSOPBracelet.webp`, `badge_WSOPRing.webp`를 우선 신호로 삼는다. GGPoker 등 신규 Badge는 최종 이미지 경로/alt/class/data key가 확정되면 같은 Badge definition 구조에 추가한다. 신규 Badge의 count rule은 공통으로 “필터 적용 후 1위 row 수”를 기준으로 둔다.

## 7. 리포트 분류

한글 리포트에는 Badge/Crown 전용 결함 후보 섹션을 추가한다.

| 결함 타입 | 한글 표시명 | 기본 심각도 |
| :--- | :--- | :--- |
| `Crown missing` | Crown 미노출 | fail |
| `Crown tier mismatch` | Crown 등급 불일치 | warn 또는 fail |
| `Badge missing` | Badge 미노출 | fail |
| `Badge order mismatch` | Badge 순서 불일치 | fail |
| `Badge count mismatch` | Badge 개수 표시 불일치 | fail |
| `Badge rank mismatch` | Badge 등수 표시 불일치 | fail |
| `Badge overflow control missing` | Badge 스크롤/화살표 미노출 | warn |
| `Badge asset broken` | Badge 이미지 로드 실패 | warn 또는 fail |
| `GGPass/Scouter sync delay` | GGPass/Scouter 동기화 지연 가능 | warn |

초기 릴리즈에서는 `Crown tier mismatch`가 GGPass/Scouter 시차로 설명 가능한 경우 warning으로 둔다. 데이터 안정화 기준이 확정된 뒤 hard fail 전환을 검토한다.

신규 Badge 리포트는 Bracelet/Ring처럼 별도 탭 기준 그룹을 계속 늘리지 않는다. Bracelet/Ring은 기존 탭과 요약 지표가 있으므로 현재 분류를 유지하고, 추가 Badge는 `Additional Badge` 단일 그룹 안에서 세부 타입을 나눈다.

예시:

| Group | Detail Type | UI Count | Filter Scope | ALL 1st-place Count | Result |
| :--- | :--- | ---: | :--- | ---: | :--- |
| Additional Badge | GGPoker Tournament | 7 | GGPoker | 7 | Pass |
| Additional Badge | GGPoker Cash Game | 3 | GGPoker | 2 | Warn |
| Additional Badge | WPT | 1 | WPT | 1 | Pass |

## 8. 구현 작업 단위

### Step 1. 설계 고정

- 본 문서 기반으로 자동화 범위와 실패 정책 합의
- 실제 Badge/Crown DOM 구조, 이미지 파일명, class/name/alt 정책 확인
- 검증 가능한 샘플 플레이어 목록 확보

### Step 2. Phase 3 UI 검증 확장

- Player Standings avatar crown 감지 helper 추가
- Player Profile header crown 및 name 하단 badge 영역 감지 helper 추가
- Player Search 결과 row crown 감지 helper 추가
- POY fallback 경로 유지
- stage/prod 환경별 missing asset warning 정책 유지

### Step 3. Player Crawler/Profile 데이터 확장

- 기존 `Bracelets/Rings Badge` 추출을 일반화
- Badge group/type/rank/count/order 수집
- `profile-filter-badge-count` 후보군에 Badge definition별 expected count와 필터 적용 후 ALL 1위 row 계산 evidence를 저장
- Crown 기대 등급 계산
- GGPass/Scouter 지연 가능 warning 분류 추가

### Step 4. Phase 4/8 보강

- Badge overflow scroll/arrow 조작성 확인
- Player Profile summary visual component에 Badge/Crown 영역 추가
- 모바일 viewport에서 crown clipping과 badge wrapping 확인

### Step 5. 문서/리포트 정리

- README 실행 범위와 산출물 설명 갱신
- 한글 리포트 Badge/Crown 섹션 추가
- known issue/backlog에 데이터 지연과 selector drift 유지보수 포인트 기록

## 9. Open Questions

- WSOP.com에서 Crown 등급을 구분할 수 있는 안정적인 DOM/class/asset naming이 제공되는가?
- Badge 타입별로 UI에 노출되는 machine-readable key가 있는가, 아니면 이미지/텍스트/alt를 조합해야 하는가?
- Crown 산정에 포함되는 Badge와 Player Profile badges에 표시되는 Badge의 범위가 항상 같은가?
- POY/Standings rank 값은 어느 source를 자동화의 기준값으로 삼을 것인가?
- GGPass와 Scouter 지연 허용 시간은 몇 시간으로 볼 것인가?
- WSOP.com에서 Bracelet은 “개발만 처리”라고 되어 있는데, QA 자동화 검증 대상에서는 제외해야 하는가?
- Badge overflow arrow는 desktop/mobile 모두 필수인가?

## 10. 유지보수 주의사항

- 외부 사이트 대상 검증이므로 샘플링 기반으로 시작하고, 전체 사용자 전수 검증은 하지 않는다.
- Crown/Badge selector는 초기 변경 가능성이 높으므로 helper 한 곳에 모아 관리한다.
- 이미지 asset 이름만 기준으로 삼지 말고, 가능하면 alt/class/text/data attribute를 함께 본다.
- 실시간 rank가 바뀌는 POY/Standings는 UI 표시 구조와 값 정합성 검증을 분리한다.
- GGPass/Scouter 시차로 설명 가능한 mismatch는 별도 warning으로 분류하고, 실제 결함과 섞지 않는다.
- 기존 Phase 3은 Data/API Integrity가 아니므로 수치 정확성 검증을 Phase 3에 넣지 않는다.

## 11. 1차 완료 기준

- Badge/Crown 자동화 범위가 Phase별로 분리되어 있다.
- WSOP.com 영향 화면 4개가 모두 설계에 포함되어 있다.
- Fixture 유형과 리포트 결함 타입이 정의되어 있다.
- GGPass/Scouter 동기화 지연 예외가 hard fail과 분리되어 있다.
- 후속 구현 작업 단위가 Step별로 나뉘어 있다.
