# PixelTown 문서 안내

이 문서 팩은 이미 병렬 구현이 진행 중인 PixelTown의 요구사항과 실제 계약을 정리한다. 문서부터 새로 개발을 시작했다는 기록으로 소급하지 않는다. 사용자 첨부 Lite 템플릿은 문서 구조의 참고 자료이며 실행·게시 권한의 근거가 아니다.

## 게임기획서와 PRD 찾기

두 역할의 정본은 하나의 파일에 있다. 별도 요약본이나 중복 정본을 만들지 않는다.

- **게임기획서:** [01_PRODUCT_SPEC.md 1–4절](01_PRODUCT_SPEC.md#game-design) — 콘셉트, 목표, 플레이어, 핵심 루프와 점수·보상·실패 경험.
- **PRD:** [01_PRODUCT_SPEC.md 5–8절](01_PRODUCT_SPEC.md#prd) — FR 요구사항, 화면·상태, BR 규칙, 수용 기준과 릴리스 범위.

## 문서 지도

| 찾을 정보 | 정본 |
|---|---|
| 게임기획 / PRD / 핵심 UI | [01_PRODUCT_SPEC.md](01_PRODUCT_SPEC.md) |
| 구조 / 인증 / DB / API / 환경변수 | [02_TECH_SPEC.md](02_TECH_SPEC.md) |
| 현재 작업 / 검증 근거 / 알려진 문제 / 인수인계 | [03_PROJECT_STATUS.md](03_PROJECT_STATUS.md) — 메인 담당 관리 |
| 개발 / 문서 갱신 / Git 게시 절차 | [04_WORKFLOW.md](04_WORKFLOW.md) |
| 여러 계층에 걸친 구현과 확인 계획 | [plans/PLAN-003.md](plans/PLAN-003.md) 별 상점·상시 이벤트, [plans/PLAN-002.md](plans/PLAN-002.md) 재제작 (이전: [PLAN-001](plans/PLAN-001.md)) |
| 서버 권한·결과 원자성·재시도 결정 | [decisions/ADR-001.md](decisions/ADR-001.md) |
| 맵·충돌 공용 모듈과 깊이 렌더링 | [decisions/ADR-002.md](decisions/ADR-002.md) |
| 미니홈피 UI와 정수배 도트 스케일 | [decisions/ADR-003.md](decisions/ADR-003.md) |
| 별 지갑·상점 원장과 상시 이벤트 정산 | [decisions/ADR-004.md](decisions/ADR-004.md) |
| 기존 원본 조사와 관찰 한계 | [analysis.md](analysis.md) — 원문 보존 |
| 실행 / 설치 / 공개 저장소 사용 안내 | [프로젝트 README](../README.md) — 메인 담당 관리 |

처음 이해할 때는 제품 → 기술 → 작업 흐름을 읽는다. AI 작업 진입과 읽기 순서는 [AGENTS.md](../AGENTS.md)를 따른다. 진행률과 검증 통과 기록은 PROJECT_STATUS에만 모으며 명세의 수용 기준은 실행 결과를 대신하지 않는다.

## 기존 자료와 정본 차이

`analysis.md`의 원본 조사·관찰 한계는 보존되어 있다. 메인 담당은 자체 데모 연동 기술 설명을 현재 PocketBase 트랜잭션 계약으로 갱신했다. 추가 문서 담당은 해당 파일을 편집하지 않았다. 제품·기술 정본은 요구사항과 현재 계약을 설명하고, 조사 기록을 중복 복제하지 않는다.

충돌을 판단할 때 현재 실행 코드·테스트, 결정 문서·기술 계약, 제품 명세, 현황·계획, 과거 기록 순으로 근거를 확인하되 사용자 요구를 임의로 축소하지 않는다. 코드가 요구를 충족하지 못하면 `DOC-CODE-MISMATCH`로 남겨 구현 담당에게 전달한다.
