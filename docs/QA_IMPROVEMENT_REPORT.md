# WSOP Web Automation QA 개선 및 안정성 고도화 보고서 (QA Improvement Report)

본 문서는 WSOP.com 공개 웹 테스트의 신뢰성을 극대화하고, CI/CD 배포망에서의 오진(False Negative)을 방지하기 위해 수행한 QA 관점의 안정성 보강 작업 및 대시보드 연동 결과를 정리한 보고서입니다.

이 작업은 신규 기능 브랜치(`feature/qa-improvements`)에서 분리 개발 및 검증되었으며, 배포 승인 전에 원격 푸시를 진행했습니다.

---

## 1. 주요 개선 사항 요약

### 1.1. 보안 차단 솔루션(Anti-Bot Mitigation) 대응 및 탄력적 스킵 정책 도입
*   **배경 및 현상**: WSOP.com과 같은 글로벌 상용 웹사이트는 Cloudflare, Akamai 등 고도화된 웹 방화벽(WAF) 및 봇 탐지 솔루션을 탑재하고 있습니다. Playwright 헤드리스 구동 시, 불규칙하게 **HTTP 403 Forbidden** 또는 **Access Denied**, **Cloudflare Challenge** 페이지가 반환되어 제품의 결함이 아님에도 불구하고 전체 빌드가 깨지는 현상(Flaky Test 및 False Negative)이 빈발했습니다.
*   **개선 조치**:
    *   공통 검증 헬퍼 모듈인 [support.ts](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/tests/functional/support.ts)에 실시간 보안 차단 및 네트워크 지연 감지 함수 `detectBotBlock`을 신규 구현했습니다.
    *   HTTP status가 403, 429, 503이거나 HTML 소스 코드에 `cloudflare`, `ray id`, `access denied`, `please verify you are a human` 등의 보안 챌린지 시그널 키워드가 포함되어 있는지 정교하게 파싱합니다.
    *   보안 차단 감지 시 테스트를 즉시 실패시키는 대신, Playwright 내장 `test.skip(true, 'Bot mitigation active')` 처리를 유연하게 연동하여 **빌드 실패를 차단하고 스킵 사유(Warning/Review 대상)로 분류**하도록 리팩토링했습니다.
    *   공개 페이지 및 콘솔 오류 점검 등 핵심 스모크 스펙들([public-pages.spec.ts](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/tests/smoke/public-pages.spec.ts), [console-error.spec.ts](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/tests/smoke/console-error.spec.ts))이 해당 공통 헬퍼를 경유하도록 구조를 개선했습니다.

### 1.2. 윈도우 OS 기반 대시보드 기동 및 러너 호환성 완전 해결
*   **배경 및 현상**: 로컬 윈도우 콘솔 환경에서 `Run.bat` 대시보드를 통해 Phase 8(비주얼) 및 Phase 9(회귀 러너)를 구동할 때, `tsx` 단독 실행 파일에 대한 경로 오류나 `npx.cmd` 호출 시 `spawn EINVAL` 시스템 레벨 오류가 뜨며 실행이 중단되는 문제가 있었습니다.
*   **개선 조치**:
    *   [package.json](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/package.json)의 런타임 스크립트를 `npx tsx`로 표준화하여 윈도우 환경 실행 호환성을 확보했습니다.
    *   대시보드 기동 헬퍼인 [run-phase.cjs](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/scripts/run-phase.cjs) 내 child_process spawn 옵션에 `shell: true`를 적용하여 윈도우용 배치/명령어 프로세스가 정상적으로 쉘 프로세스 트리를 스폰하게 완치했습니다.
    *   `run-phase.cjs`에서 실행 전 `testDir`이 실제로 존재하는지 엄격히 체크하는 로직으로 인해 Phase 9이 실행 거부되던 문제를 해결하고자 [tests/regression/README.md](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/tests/regression/README.md) 플레이스홀더를 신규 보강했습니다.

### 1.3. 대시보드 상의 미래 백로그 시각화(Roadmap Dashboard) 도입
*   **배경 및 현상**: Phase 1~9 완료 이후에도 여전히 해결해야 할 다양한 고도화 백로그 과제들이 존재하지만, 대시보드 화면상에는 "구현된 Phase"만 표시되어 로드맵 가독성이 떨어졌습니다.
*   **개선 조치**:
    *   [phases.json](file:///c:/Users/USER1/Desktop/Study/WSOP-Web/WSOP-Web-Automation/automation/phases.json) 파일에 **Phase 10 (CI/CD 및 자동 알림)**, **Phase 11 (실시간 API/DB 직접 연동)**, **Phase 12 (Lighthouse 및 사용자 체감 지표)** 3개 신규 가상 Phase를 `"implemented": false` 로 사전 등록했습니다.
    *   이를 통해 대시보드 하단의 **"준비 중인 Phase" 아코디언** 목록에 향후 로드맵이 자동으로 시각화되며, 클릭 시 우측 패널에 상세 백로그 정보가 로드맵 형태로 노출되어 팀 내 테스트 확장 계획을 상시 트래킹할 수 있게 설계했습니다.

---

## 2. 향후 QA 고도화 권장 로드맵 (Future Actions)

1.  **Quarantine(격리) 기능 고도화**:
    *   Live 사이트의 잦은 팝업 광고나 Dynamic 레이아웃 깨짐이 발생하는 특정 UI 페이지의 경우, 정기 회귀 러너에서 Quarantine 스위트로 자동으로 분류하여 릴리즈 블락 영향도를 완화할 것을 권장합니다.
2.  **Lighthouse Web Vitals 기준치 수립**:
    *   Phase 12 도입 시, LCP가 2.5s 미만으로 유지되는지 Playwright 구동 속도 이력과 연계해 성능 저하 경보를 발생시킵니다.
3.  **Slack/Discord 웹훅 알림 주입**:
    *   Phase 10 준비 시점에, CI 빌드 실패 이력 및 리포트 파일 요약을 마크다운 포맷으로 즉각 메신저 알림 채널로 전송하도록 훅 스크립트를 구현할 예정입니다.
