# Workspace Rules

이 workspace에서 새 프로젝트, 자동화 도구, 데모 앱, 크롤러, 리포트 생성기 등을 만들거나 큰 구조 변경을 할 때는 아래 규칙을 따른다.

## Documentation

- 새 프로젝트 폴더를 만들면 반드시 `README.md`를 함께 만든다.
- 기존 프로젝트에 주요 기능, 실행 방식, 산출물 구조가 바뀌면 `README.md`도 같이 갱신한다.
- 사용자가 별도로 요청하지 않아도 문서 생성을 기본 작업 범위에 포함한다.

## README 필수 내용

`README.md`에는 가능한 한 아래 항목을 포함한다.

- 프로젝트 목적
- 주요 기능
- 폴더 구조
- 설치 방법
- 실행 방법
- 주요 npm/bat/스크립트 명령
- 리포트, 로그, 다운로드, output 등 산출물 위치
- 환경변수 또는 설정값
- 유지보수 시 주의사항
- 알려진 제한사항 또는 의도적인 skip/ignore 기준

## Automation Notes

- 테스트 자동화 프로젝트는 smoke, regression, crawler, report 등 검증 범위를 명확히 구분한다.
- 리포트가 생성되는 프로젝트는 한글 리포트를 우선 제공하고, 필요하면 영문 리포트도 함께 생성한다.
- 외부 사이트 대상 테스트는 과도한 요청을 피하도록 샘플링/제한값을 README에 기록한다.
- 실행 실패 가능성이 높은 selector, 문구, 네트워크/보안 정책은 README에 유지보수 포인트로 남긴다.

## Git Safety

- 사용자가 만들었을 수 있는 기존 변경사항은 임의로 되돌리지 않는다.
- `node_modules`, test-results, report output, build output 등 생성 산출물은 `.gitignore`에 포함한다.

## Response
- 사용자가 질문한 답변에는 생각하는 과정과, 결과물들은 기본적으로 한글로 대답한다.
