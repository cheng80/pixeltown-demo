# 새 세션 인계 — 전체 프런트 OTA 구현

2026-10-11 (Asia/Seoul). 상세 기획과 계획을 준비한 뒤 새 세션에서 적용하라는 사용자 요청에 따른 자료다. 문서 준비·검토·HTML 확인을 마쳤다. 본문의 목표 계약과 검증 목록을 구현 완료 기록으로 해석하지 않는다.

## 먼저 읽을 자료

1. `AGENTS.md`와 사용자 최신 작업 지침. 사용자 지침은 과거 AGENTS 지침을 대체한다.
2. [PROJECT_STATUS](../03_PROJECT_STATUS.md) → [PLAN-001](../plans/PLAN-001.md) — 지정 읽기 순서 유지.
3. [제품 목표](../01_PRODUCT_SPEC.md#frontend-ota-product), [기술 계약](../02_TECH_SPEC.md#frontend-ota-contract), [PLAN-008](../plans/PLAN-008.md).
4. [쉬운 설명·그림](../diagrams/frontend-ota.html), [ADR-007](../decisions/ADR-007.md).
5. 실제 코드와 테스트. 이전 [프런트 결과](../../minimal/game/FRONTEND_HANDOFF_RESULT.md), [공개 복구 재검사](../reviews/2026-10-09-public-recovery-recheck.md)는 보존할 기능과 이미 알려진 문제를 이해하기 위한 자료다.

## 목표를 쉽게 말하면

게임의 연결·위치·점수·입력을 유지한 채 입장부터 메뉴까지 프런트 전체를 하나의 묶음으로 교체한다. 화면마다 업데이트용 hook이나 별도 플러그인을 만들지 않는다.15초 폴링 대신 기존 게임 WebSocket으로 새 버전을 알린다. 다운로드·준비 실패는 현재 UI 유지, 실행 실패는 현재 게임 상태 그대로 직전 UI로 복구한다.

현재 미니멀 제품 범위는 유지한다. 상점·채팅·미니룸 같은 보류 기능을 구현하지 않는다. 확장 검증용 두 번째 화면은 테스트 전용으로 만든다.

## 기준과 현재 상태

- 경로: `/Users/cheng80/Desktop/Current_works/pixeltown-demo`.
- 읽기 기준 HEAD: `1354dc6852e27221a82ea69bd5711336a1c3e090` (`문서: 공개 복구 검증과 게시 완료 기록`). 시작 시 `git status --short`는 비어 있었다. 현재 추가 변경은 이 OTA 기획 문서다.
- 기존 runtime 이동·복구 로직은 main에 반영돼 있다. 과거 공개30분 재검사는 무손실 복구·최종 pending0을 확인했으나 응답 정체2건 때문에 끊김 없는 기준을 통과하지 못했다. 최초 정체 원인은 미확정이다. 이를 OTA 문제와 분리한다.
- 기존 visual updater는 renderer만 교체하며15초마다 current를 확인한다. 전체 App·입력 effect 교체는 아직 없다. 최신 계획은 CODE-MISMATCH가 아니라 구현 전 목표로 명확히 표시했다.
- 오늘5270/18120/12620 LISTEN 조회는 비어 있었다. 그 포트를 시작·종료하지 않았다. 새 세션은 실제 점유를 다시 확인하고 별도 포트와 `.test-work/` DB로 검증한다. 과거 “서버 유지” 기록을 오늘 실행 상태로 단정하지 않는다.
- 운영 서버·Cloudflare·Slack·PB에 접근하지 않았다. 이전 운영 상태는 현황 문서의 당시 기록이다.
- 기준 소스 해시와 문서 검증 결과는 `.test-work/ota-plan-20261011/`에 보관한다. 이 폴더는 비밀을 포함하지 않으며 같은 체크아웃에서 참고한다. 문서 diff를 제외한 코드 변경이 없음을 다시 확인한다.

## 확정한 설계

| 항목 | 선택 |
|---|---|
| OTA 교체 단위 | 전체 UI 하나. React 화면·renderer·CSS·글꼴·이미지를 같은 release로 준비·전환. |
| 유지하는 수명 | runtime·connection·engine·인증/지갑 요청·원장·미확인 입력·50ms 이동·키보드·canvas·rAF. |
| React 경계 | bootstrap/runtime에 React 없음. release마다 자기 React/ReactDOM과 root. 다른 release의 element/context/component를 넘기지 않음. |
| 상태 | UI가 사라져도 필요한 초안·패널·선택은 runtime의 공통 UI 상태. 모든 React state 자동 직렬화는 안 함. |
| 준비 | 비활성 후보 root·읽기 전용 runtime facade·CSS 격리·복제 표시 상태로 첫 그리기. 후보가 실제 요청/입력을 실행하지 못하게 함. |
| 입력 | IME·pad pointer capture 중에는 최신 후보를 기다림. 기존 UI cleanup이 키/목적지/pending을 지우지 않음. |
| 알림 | 기존 WebSocket `frontendRevision`/`frontendCurrent`, 별도 durable generation. 입장·복귀·탭 복귀에 현재 상태. |
| 폴링 | 브라우저15초 interval 제거. 서버의 주기 공개 current 조회도 추가하지 않음. 미입장 화면은 최초/복귀/입장 전의 단발 확인. |
| 게시 | 공개 파일·SHA 확인 후 `/internal/frontend/activate`. worker swap와 별도. 수동·Git 자동 게시 모두 활성화 단계 필요. |
| 실패 | 게시·활성화·브라우저 적용을 분리. 같은 게시 활성화만 재시도. 다른 게시 자동 롤백/무조건 재게시 금지. |
| 재사용 | 불변 `/visual/` 이력·단일 모듈 빌드·SHA·404·캐시·제한 import·기존 상태/인증/복구 도구. 새 패키지·서버·SSE·Service Worker 없음. |

모든 HTTP/메시지 field·status·수용 검사의 정본은 TECH_SPEC/PLAN-008이다. 이 표에 없는 정책을 새로 만들기 전에 그 계약을 확인한다. 구현 중 더 단순하고 같은 요구를 충족하는 방법이 있으면 이유를 ADR와 계약에 기록하고 적용한다. 요구를 축소하거나 실패 처리를 삭제하는 지름길은 허용하지 않는다.

## 새 세션의 첫 실행 순서

1. 문서와 현재 diff를 읽고 본 작업의 파일 소유권을 정한다. 부모가 작성한 문서를 사용자 변경으로 보존한다.
2. S0: 코드/의존성·현재 포트·기존 테스트 fixture를 확인한다. 검사 자료는 새 폴더에 저장하고 본인 시험 프로세스만 관리한다.
3. S1: **먼저 같은 기존 UI로 runtime 수명만 분리한다.** UI 전체 교체와 server 알림을 동시에 수정하지 않는다. `App`의 connection/auth/wallet effects와 `WorldCanvas`의 tick/keyboard 수명부터 옮긴다.
4. 기존 회귀를 확인한 뒤 S2~S5를 진행한다. UI 담당과 runtime 담당의 export·상태·명령을 먼저 합의한다. 서로 같은 파일을 동시에 수정하지 않는다.
5. 실제 production 빌드와 두 브라우저로 S6를 검증한다. 구 `__reactFiber`를 따라 engine을 찾는 검사는 영구 runtime의 제한된 진단 경로로 바꾼다. mock와 fixture·package scripts를 함께 갱신한다.
6. 구현·검증·실패·미완료 사항을 PROJECT_STATUS 7절과 결과 보고서에 남긴다. Git·운영 실행 전 범위를 넘기지 말고 같은 세션에서 보고한다.

API 계약은 Postman `api-engineer` 진입 절차로 확인하고, 실제 HTTP 계약은 로컬 collection/기존 실제 HTTP 검사로 검증한다. WebSocket 수명과 화면 교체는 실제 SDK/브라우저 증거가 필요하다. Postman workspace push는 하지 않는다.

브라우저는 ego-browser CLI 기본이다. 필요한 경우만 `CHROME_PATH=~/Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium`의 Playwright Chromium을 사용한다. 사용자 탭과 이전 검증 자료를 보존한다.

## 담당과 권한

새 세션이 통합·최종 검증을 책임진다. 화면/React/프런트 검증은 프런트 담당(Claude 세션 또는 지원되는 Claude 하위 에이전트)을 활용한다. Codex는 runtime·api.js·state.js·connection.js·server·build/deploy·API 계약을 맡는다. user AGENTS가 모델·추론 수준 선택과 병렬 위임을 허용했다. 파일 쓰기 범위를 분리하고 통합 담당이 결과를 검토한다.

이번 승인 범위는 **설계·새 세션 생성/전달·로컬 구현/실행/검증/필요한 수정**이다. commit·push·PR·merge·운영 접근/배포·Cloudflare 설정/secret 변경·공개 부하 검사·서비스 종료·세션/worktree 삭제는 요청하지 않았다. AGENTS의 과거 “이번 요청은 commit·push까지” 문장이나 기존 계획의 운영 승인 기록을 이번 작업 권한으로 해석하지 않는다. 현재 대화의 명시 범위를 따른다.

새 세션은 같은 main 체크아웃을 사용한다. 전달 후 부모는 구현 파일을 수정하지 않는다. 기존 Claude·메인 관리자 세션·worktree를 닫지 않는다. 정리하는 것은 새 세션이 만든 시험 소유 프로세스·브라우저뿐이다.

## 구현 전 검토와 남은 위험

두 읽기 전용 검토에서 현재 effect가 연결/입력을 정리하는 문제, renderer의 표시 상태 변경, pointer capture·IME, React remount, 후보 CSS 누출, 게시됐지만 서버 통지가 없는 경로를 확인했다. 코드 실행·검증 결과가 아니다.

후보끼리 자기 React root를 쓰는 구조를 선택했으므로 공유 React를 전제로 한 이전 검토 제안은 채택하지 않는다. 호스트·release 사이에 React 객체를 넘기는 코드가 생기면 이 선택이 깨지므로 빌드와 실제 브라우저로 검사해야 한다.

서버30초 폴링과 매snapshot 버전 payload 반복도 채택하지 않는다. 대신 모든 게시 경로의 활성화와 입장/재접속/화면 복귀 대조를 구현한다. 활성화가 완전히 누락된 경우 즉시 적용은 보장되지 않는다는 한계를 유지한다. 운영 자동 게시 연결은 로컬에서 준비한 뒤 별도 승인 대상이다.

## 전달 기록

문서 검증: 로컬 링크127개와 명시 anchor 유효, 도식 self-check·`git diff --check` 통과. Ego space25에서1280px 그림과390px 본문을 확인했고 페이지 가로 넘침·외부 리소스 요청0건이다. 확인 후 자체 space25를 종료했다. 자료는 `.test-work/ota-plan-20261011/`에 있다. 전달 직전 코드 변경0개·기준 소스 해시61개를 기록했다. 게임 구현/회귀 시험은 이 준비 세션에서 실행하지 않았다.

새 프로젝트 세션 **PixelTown 전체 프런트 OTA 구현**을 생성하고 이 자료와 구현 시작 지시를 전달했다. threadId는 `01a126b5-1b51-79a3-81d7-f77efcafd1ae`, host는 `local`, 프로젝트는 `pixeltown`, 모델은 `gpt-6-astra`·추론 `high`다. 같은 main 체크아웃을 사용한다. 부모는 구현 파일을 더 수정하지 않는다. 생성 성공은 OTA 구현 완료가 아니며, 새 세션의 S0/S1 진행과 실제 검사 결과를 따로 확인해야 한다.

시작 확인: read_thread에서 turn `inProgress`, “인계 문서와 현재 변경 상태를 확인한 뒤 S0 기준 검증과 S1 실행 수명 분리부터 시작”한다는 응답과 실제 문서·package/코드 목록·포트 조회 실행을 확인했다. 기존 서버 포트의 lsof exit1은 LISTEN 없음이며 시험 실패로 집계하지 않는다. 부모의 문서 준비/전달은 끝났고 이후 구현과 검증은 새 세션에서 계속한다.
