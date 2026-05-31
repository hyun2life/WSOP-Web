# Dashboard Status Troubleshooting (Phase Runner)

## 증상
- 개별 Phase 리포트는 정상으로 보이는데 대시보드 실행 상태가 `Failed`로 표시됨
- 특히 Windows 환경에서 실행 직후 `spawn` 관련 오류가 섞여 나오면서 실제 체감 결과와 상태가 어긋날 수 있음

## 이번 반영 내용
1. `scripts/run-phase.cjs`
- Windows Playwright 실행 경로를 `cmd.exe` 중첩 호출에서 직접 `npx.cmd playwright ...` 호출로 단순화
- child process 옵션을 `shell: false`로 고정

2. `scripts/web-runner-server.js`
- 마지막 실행 메타데이터(`phaseId`, `startedAt`, `finishedAt`, `exitCode`, `status`)를 서버 메모리에 보존
- `GET /api/status`에 `lastRun` 필드 추가
- 리포트 열기 시 선택된 최신 리포트의 `mtime`를 로그에 출력
- 리포트 시각이 마지막 실행 시작 시각보다 오래된 경우 `[SERVER_WARN]` 로그 출력

## 운영 포인트
- 대시보드 상태는 **프로세스 종료 코드(exit code)** 기준으로 최종 확정됨
- 리포트 파일은 최신이라도, 현재 실행보다 먼저 생성된 파일일 수 있음
- 상태/리포트가 어긋나 보이면 서버 로그에서 아래 순서로 확인
  1. `[SERVER] Starting execution ...`
  2. `[SERVER] Process finished: exit code ...`
  3. `[SERVER] Opening latest ... (mtime: ...)`
  4. `[SERVER_WARN] Report file is older than the latest run start time ...` 여부
