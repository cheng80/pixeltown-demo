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
| Mac mini 서버 주소 / SSH / 서비스 점검 / 게임 이전 / 백업·복구 | [SERVER_OPERATIONS.md](SERVER_OPERATIONS.md) |
| 별 소비 / 사용자 상태 변경 전체 목록 / 최소 게임 선행 조사 | [reviews/2026-10-08-game-state-audit.md](reviews/2026-10-08-game-state-audit.md) |
| 최소 게임 / 활동 중 배포 / 접속 불가 안내 구현 계획 | [plans/PLAN-007.md](plans/PLAN-007.md) — 최소 게임·worker 교체 로컬 구현/검증 |
| 게임 로직 무중단 배포 인계 | [architecture/zero-downtime.md](architecture/zero-downtime.md) — 동작 설명·용어·구현·배포 절차 |
| 무중단 배포 구조와 교체 순서 | [diagrams/worker-hot-swap.html](diagrams/worker-hot-swap.html) — 브라우저에서 보는 HTML/SVG 그림 |
| 새로고침 없이 화면 코드·리소스 반영 | [diagrams/frontend-live-update.html](diagrams/frontend-live-update.html), [계약·배포·한계](handoffs/2026-10-08-frontend-live-update.md) |
| 화면·기능 확장과 전체 프런트 OTA(로컬 구현, 운영 미적용) | [HTML 설명](diagrams/frontend-ota.html), [PLAN-008](plans/PLAN-008.md), [기술 계약](02_TECH_SPEC.md#frontend-ota-contract), [로컬 결과](reviews/2026-10-11-frontend-ota.md), [새 세션 인계](handoffs/2026-10-11-frontend-ota.md), [활성화 인계](handoffs/2026-10-11-frontend-activation.md) |
| 도입 전 / 현재 배포 구조 비교 | [diagrams/zero-downtime.html](diagrams/zero-downtime.html) |
| 최소 게임 실행·API / 기존 게임 보존 | [minimal/README.md](../minimal/README.md), [legacy/README.md](../legacy/README.md) |
| 여러 계층에 걸친 구현과 확인 계획 | [plans/PLAN-004.md](plans/PLAN-004.md) Mac mini 서버 이전·Colyseus 0.18, [plans/PLAN-003.md](plans/PLAN-003.md) 별 상점·상시 이벤트, [plans/PLAN-002.md](plans/PLAN-002.md) 재제작 (이전: [PLAN-001](plans/PLAN-001.md)) |
| 서버 권한·결과 원자성·재시도 결정 | [decisions/ADR-001.md](decisions/ADR-001.md) |
| 맵·충돌 공용 모듈과 깊이 렌더링 | [decisions/ADR-002.md](decisions/ADR-002.md) |
| 미니홈피 UI와 정수배 도트 스케일 | [decisions/ADR-003.md](decisions/ADR-003.md) |
| 별 지갑·상점 원장과 상시 이벤트 정산 | [decisions/ADR-004.md](decisions/ADR-004.md) |
| 기존 원본 조사와 관찰 한계 | [analysis.md](analysis.md) — 원문 보존 |
| 초기 조사 자료 / 제작·검증 스크립트 / 문서 템플릿 / 과거 테스트 데이터 | [references/README.md](references/README.md) — 용도·현재 코드와의 관계·재사용 방법 |
| 실행 / 설치 / 공개 저장소 사용 안내 | [프로젝트 README](../README.md) — 메인 담당 관리 |

처음 이해할 때는 제품 → 기술 → 작업 흐름을 읽는다. AI 작업 진입과 읽기 순서는 [AGENTS.md](../AGENTS.md)를 따른다. 진행률과 검증 통과 기록은 PROJECT_STATUS에만 모으며 명세의 수용 기준은 실행 결과를 대신하지 않는다.

## 기존 자료와 정본 차이

`analysis.md`의 원본 조사·관찰 한계는 보존되어 있다. 메인 담당은 자체 데모 연동 기술 설명을 현재 PocketBase 트랜잭션 계약으로 갱신했다. 추가 문서 담당은 해당 파일을 편집하지 않았다. 제품·기술 정본은 요구사항과 현재 계약을 설명하고, 조사 기록을 중복 복제하지 않는다.

충돌을 판단할 때 현재 실행 코드·테스트, 결정 문서·기술 계약, 제품 명세, 현황·계획, 과거 기록 순으로 근거를 확인하되 사용자 요구를 임의로 축소하지 않는다. 코드가 요구를 충족하지 못하면 `DOC-CODE-MISMATCH`로 남겨 구현 담당에게 전달한다.

- [미니멀 픽셀타운 → 실 서비스 인계·정리 조건](handoffs/2026-10-08-minimal-service.md)
- [PB 단독 배포: 기존 플레이 유지·실행·복구](handoffs/2026-10-08-pb-deployment.md)
- [상단 배포 상태 표시 계약](handoffs/2026-10-08-deployment-indicator.md)
