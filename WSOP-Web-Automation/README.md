# WSOP Web Automation

Playwright 기반 웹 테스트와 통합 대시보드가 있는 하위 프로젝트입니다.

사용법, Phase 설명, 리포트 위치, 회귀 테스트 기준은 상위 [README.md](../README.md)에 통합되어 있습니다.

## 이 폴더에서 직접 실행할 때

```bat
npm run phase:list
npm run test:phase1
npm run test:phase2
npm run test:phase3
npm run test:phase4
npm run test:phase5
npm run test:phase6
npm run test:phase7
npm run test:phase8
npm run test:release
```

## 주요 위치

| 위치 | 역할 |
| --- | --- |
| `automation/output/` | phase별 HTML/JSON 리포트와 대시보드 로그 |
| `artifacts/full-regression/latest/` | 회귀 테스트 최신 요약 |
| `tests/` | Playwright 테스트 |
| `scripts/` | phase 실행, 대시보드, 리포트 열기 스크립트 |
| `automation/phases.json` | Phase 목록과 실행 설정 |

중복 설명은 이 파일에 추가하지 말고 상위 README에 반영합니다.
