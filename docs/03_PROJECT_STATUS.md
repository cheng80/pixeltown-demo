# 프로젝트 현황

갱신일: 2026-10-08 (Asia/Seoul). 미니멀 게임의 worker 무중단 교체·동기화·상단 배포 표시를 구현하고 공개 화면에 게시했다. 사용자 게임 주소는 `https://pixeltown.fastmake.net` 그대로이며, 기존 운영 서버를 유지하고 미니멀 전용 서버(PB 18820/game 13620)를 도입했다. 구현 게시 commit은 `68d4ca8`이다.

현재 실행: **85명 시험 접속·자동 worker 배포·운영 미니멀 게임 서버를 사용자 요청으로 종료**했다. 합성 접속 종료 18:14:16 KST, 미확인 입력 0. 게임 서비스 종료 18:15:25 KST, 종료 직전 players 0·generation 23·outbox 0/0. PB·Tunnel·기존 게임 서비스·로컬 개발 서버는 유지했다. 검사 제어 오류와 85명 복구/종료의 상세 기록은 7절을 따른다. 사용자 승인으로 이번 변경의 문서·커밋·푸시·main 병합을 진행한다.

화면 코드·리소스 교체도 공개 반영했다. 최초 한 번 기능을 받은 뒤에는 렌더러·CSS·글꼴·이미지를 새로고침 없이 바꾼다. 최종 화면 버전 `2ca05cdd`, 공개 두 번 교체의 끊김·입력 차단 0. dot이 발견한 걷기 시각 대입의 주석 포함 오류도 복구하고 실제 걷기 그림을 확인했다. [그림](diagrams/frontend-live-update.html), [계약과 배포 방법](handoffs/2026-10-08-frontend-live-update.md). 이번 소스는 미커밋 상태이며 이전 자동 Git 빌드가 덮어쓰지 않도록 다음 승인된 코드 게시에 포함해야 한다.

반복 검사 중지 기록: 사용자 요청으로 **85명 합성 접속과 3분 주기 worker 배포를 2026-10-08 15:34:59 KST에 중지**했다. 중지 당시 시험 접속은 0명, 원본 worker 복원 후 generation 21, 정산 대기/실패는 0/0이었다. 실제 접속자 1명과 게임 서버는 유지했다. 이후 PB 서비스 분리 과정에서 게임 프로세스를 새로 시작해 분리 직후 generation은 1이었다. 아래 중지 기록 이후 사용자 재개 지시를 받아 현재 반복 검사를 실행 중이다.

PB 배포 중 플레이 유지: 운영 서비스를 PB와 게임으로 분리했다. 공개 경로에서 PB hooks 교체·원본 복구 중 SDK 1개와 실제 브라우저 1개의 연결·이동이 유지됐다. 게임 PID와 room/session은 그대로였고, 끊김·재접속 안내는 0건이었다. [계약과 절차](handoffs/2026-10-08-pb-deployment.md), 상세 결과는 7절을 따른다.

초기 구현의 공개 100명/30분 검사에서 3,533,031 입력·30회 교체를 통과했다. 합성 98명과 실제 브라우저 2개가 있는 정원 100명에서도 6회 교체, 이동 유지, 상단 표시를 확인했다. 이 성공 기록을 이후 프런트 변경의 장시간 검증으로 확대하지 않는다. 검사별 코드와 결과는 최신 7절과 Claude 인계 결과를 따른다.

남은 실 서비스 작업과 나중에 정리할 자원은 [인계 문서](handoffs/2026-10-08-minimal-service.md)에 있다. 접속 서버 자체 재시작·호스트 재부팅은 연결을 끊는다. PB 단독 코드 배포는 기존 플레이를 유지하지만, 비호환 DB 변경·실행 파일 업그레이드는 별도 검증이 필요하다. 과거 절의 운영 미착수 기록은 당시 상태다.

## 프런트 재제작 인계 (2026-10-08)

- 사용자가 최소 게임의 시각적 완성도를 거절했다. 위 구현 검증은 기능/연동 결과이며 화면 품질 승인으로 해석하지 않는다.
- [핵심 제작 인계](handoffs/2026-10-08-frontend-remake.md)를 작성하고 Orca CLI로 현재 main 체크아웃의 Claude Opus 5.5(high) 세션에 프런트 재제작을 맡겼다. 시작 화면에서 모델을 확인하고 작업 입력의 `accepted:true` 및 `turn_started`를 확인했다. 이번 Codex 작업에서 `minimal/game/FRONTEND_HANDOFF_RESULT.md`의 완료·검증·남은 계약을 읽고 실제 새 프런트로 worker 교체를 검증했다.
- Claude 소유 범위는 `minimal/game/`의 표현/렌더링/프런트 검증이다. `api.js`, `state.js`와 인증·이동·정산 계약을 보존한다. Codex는 백엔드·게임 로직·무중단 배포를 계속 담당한다.
- Orca worktree ID: `ef16d44d-fa72-461e-a466-d41637f5c26e::/Users/cheng80/Desktop/Current_works/pixeltown-demo`. 터미널 handle: `term_bf244c49-85b1-4721-addd-6b4fdcb43705`. 요청 ID: `b0d10506-afca-4541-a06c-14704465c217`. 앱 재시작 뒤에는 handle을 다시 조회한다.
- 완료 결과는 Claude의 `minimal/game/FRONTEND_HANDOFF_RESULT.md`에 있다. 새 worktree 생성, 기존 세션 종료, commit/push/운영 배포는 지시하지 않았다.

## 최소 게임 격리·실행 기반 구축 (2026-10-08, worker 구현 전 기록)

- [배포 도식](diagrams/zero-downtime.html): 현재의 같은 프로세스 접속·게임 실행과, 목표인 연결 유지·후보 worker 추격·틱 경계 전환·늦은 결과 차단을 나눴다. 구현 범위와 향후 범위를 화면에 표시했다.
- [최소 게임](../minimal/README.md): 단일 메인 로비·정원 100명·이동/충돌·서로 보기·별 획득/정산·개인 지갑만 제공한다. 기본 `dev:all`/`dev`/`build`는 최소 환경으로 전환했다. 상점·외형·장착·미니룸·채팅·다른 장소는 새 API/실시간 진입에서도 제한한다.
- [기존 게임 보존](../legacy/README.md): 기존 소스를 이동·삭제하지 않고 `dev:legacy`/`build:legacy`로 분리했다. 기존 소스 40개는 manifest SHA-256과 모두 일치한다. 기존 DB·계정·원장은 새 환경에 이관하지 않았다. 운영 `build:remote`와 Mac mini 배포 경로는 기존 게임을 가리킨다.
- 최소 환경의 프런트/게임/PB 포트는 5270/12620/18120, 상태 폴더는 `.local/minimal/`이다. 관리자·DB·hooks·outbox·브라우저 인증을 분리했다. 기존 DB 경로·미표시 기존 DB·연결 파일·사용 중 포트는 초기화 전에 거절한다. PB는 전용 실행 잠금과 관리자 파일 `0600`을 사용한다.
- 정산은 디스크 기록 뒤 통지, 전체 매치 내용 기준 멱등 저장, 실패 파일별 격리, 개인 원장·확정 매치 ID 동시 조회를 구현했다. 없는 사용자가 있는 매치는 증거를 보존하고 다른 매치를 진행한다. 자동 계정 삭제는 없고 필수 관계로 원장 보유 계정의 관리자 삭제도 거절된다.
- 지갑 실패 시 이전 성공 잔액을 유지하며 미확인 표시를 한다. 늦은 응답·중복 완료 통지·429 재시도를 처리한다. `/unavailable.html`은 PB/Colyseus 호출과 JavaScript 의존성이 없는 정적 안내다. Cloudflare Pages의 운영 제공은 아직 하지 않았다.
- 실제 재시작 검사에서 PB JSVM 필드의 `type()`이 JSON 직렬화에서 빠져 정상 스키마를 거절하는 문제를 발견하고 메서드 직접 비교로 수정했다. 기존 사용자 102명·결과/보상 원장·관리자 파일을 보존한 별도 3회 재시작과 전체 통합 재검사를 통과했다.

### 이번 구현의 검증 결과

| 검사 | 결과·근거 |
|---|---|
| 최소 단위 | `npm run test:minimal:unit` **11/11**; 100명 이동 검증, 100명 점수의 64+36 정산, 디스크 실패 재시도, outbox 격리, 지갑 응답/대기 처리 |
| 실제 PB·Colyseus | `npm run test:minimal` **6/6**; 전용 스키마/게스트, 이동/보류 요청, 실제 획득/정산/재전송, 실패 outbox 뒤 정상 저장, 동일 로비 100명/101번째 거절, DB 재시작 보존 |
| 통합 보고서 | `.test-work/minimal-integration-AP1UoN/report.json`; 검사 소유 프로세스 종료, DB와 실패 증거는 해당 폴더에 보존 |
| 실제 브라우저 | Chromium 두 계정 입장·내/타인 이동·클릭으로 별 획득·퇴장 정산·새로고침 지갑 복원, 390px 방향 패드/넘침, 지갑 요청 차단 후 값 보존, 연결 종료 안내·독립 안내 확인. `.test-work/minimal-browser-report.json` |
| 오프라인 UI | `CHROME_PATH=… npm run test:minimal:ui` 통과. 모의 SDK/API로 429 대기·재인증·정산 대조·1280/390px 검증. 실제 서버 검사와 별개 |
| 기존 게임 회귀 | `npm --prefix colyseus test` **32/32**, `npm run build:legacy` 통과. 전체 기존 게임 통합은 재실행하지 않음 |
| 최소 빌드·도식 | `npm run build`, 도식 `self_check.py` 통과. 데스크톱/모바일 렌더 확인, 문서 링크 검사·`git diff --check` 통과 |
| 기본 실행 재시작 | 이번 세션 소유 최소 런처를 정상 종료한 뒤 `npm run dev:all` 재기동. `/ready` 200, 정산 대기/실패 0. 사용자가 열 수 있도록 로컬 실행 유지 |

### 당시 남은 구현과 검증 한계

- 이 절은 worker 구현 전 기록이다. 위 미구현 항목은 이번 worker 작업에서 해결했다(7절). 다만 보존한 기존 12620 프로세스는 재시작하지 않아 `hotSwap:false`이며, 접속 계층 자체 재시작은 여전히 연결을 끊는다.
- 진행 중 위치/점수는 메모리 상태다. 강제 종료 복원·디스크 손실·PB 업데이트·Mac mini 재부팅의 무중단을 검증한 것이 아니다. 호스트 장애 안내는 제공한다.
- 100명 검사는 로컬 가입/인증 및 실제 단일 로비 동시 접속 검사다. 공유 IP rate-limit 제외가 있는 로컬 설정이므로 운영에서 68명 부근 입장이 막힌 원인을 해결했다고 볼 수 없다. 실제 100명 전원의 브라우저 활동·장시간 획득·배포 교체 측정은 아직 남아 있다.
- 별 공급은 초기 5개·6초당 1개·맵 상한 12개·3분/총점 64 정산이다. 100명에 맞춘 공급 확대, 한 종류의 별 소비 기능 재도입은 분리된 후속 검증이다.
- 운영 메인 로비 100명·30분 승인은 유지하지만 선행 기반 검증이 끝나기 전에는 시작하지 않는다. 이번 작업에는 운영 서버 변경·배포·commit/push가 없다.

## 최소 게임·활동 중 배포 사전 조사 (2026-10-08) — 당시 조사 기록

아래는 최소 게임 구현에 앞서 작성한 조사 시점의 기록이다. 최신 구현/검증은 위 절을 따른다.

- 사용자 요청에 따라 [별 소비·사용자 상태 변경 전체 조사](reviews/2026-10-08-game-state-audit.md)를 작성했다. 상품 24종(총 298별)의 구매만 별을 차감하며, 장착·외형·가구 배치는 무료 상태 변경이다. DB, 실시간 룸, 브라우저, 자동 정산·계정 정리, 관리자 경로를 구분했다.
- [PLAN-007](plans/PLAN-007.md)에 단일 로비·이동·별 획득/정산 중심 최소 모드, 접속 유지 계층과 교체 가능한 게임 worker, 영속 정산 처리, 단계별 재도입·검증을 제안했다. 단순화의 세부 기능 정책은 아직 코드에 적용되지 않았다.
- Supabase·Vercel 이전은 하지 않는다. PocketBase 자체 업데이트·Mac mini 재부팅의 무중단화는 사용자 제외 범위다. 백엔드 접속 불가 시 Cloudflare Pages의 독립 안내 경로는 구현할 요구로 기록했다.
- 선행 결함: 삭제된 참가자가 매치 전체 정산을 막는 경로, 실패 파일이 다른 outbox를 막는 경로, 개인/전체 저장 상태 혼용, 원장 조회 실패·응답 역전, 동시 장착 덮어쓰기. 코드와 이전 로컬 재현 기록에 근거하며 이번 조사에서 운영 로그를 다시 조회하거나 수정하지 않았다.
- 검증: 현재 코드의 `npm --prefix colyseus test` **32/32 통과**. 카탈로그 24개·가격 합 298을 직접 계산했다. 단위 통과를 운영 100명·무중단 전환·전체 API의 최신 검증으로 해석하지 않는다. 이번 턴에는 통합/UI/운영 부하 검사를 재실행하지 않았다.
- 문서 검증: 변경/추가 문서 5개의 로컬 링크 58개가 모두 유효하고 `git diff --check`를 통과했다.
- 운영 메인 로비의 합성 사용자 100명·30분 테스트 승인은 유지한다. 사용자가 선행 문제 해결을 요청했으므로 아직 시작하지 않았으며, 최소 모드·정산·배포 인계의 로컬 검증 이후 진행하는 순서를 제안했다.
- 이번 변경은 조사·요구·계획 문서뿐이다. 게임 기능 비활성화, 새 시스템 구축, 계정/원장 수정, 운영 배포, commit/push는 수행하지 않았다.

## 로컬 폴더 정리 (2026-10-08)

- 기존 `pixeltown-demo/outputs/pixeltown/`의 전체 내용을 `pixeltown-demo/` 루트로 이동했다. 개발 명령은 새 루트에서 실행한다.
- `.git`, 환경 파일, 의존성, `pocketbase/.local` DB, `colyseus/.local` outbox, `.test-work`를 보존했다.
- 초기 `work/`, `.playwright-cli/`, 바깥 폴더의 빈 lockfile·메타데이터는 같은 날 사용자 요청에 따라 프로젝트 내부 `docs/references/`로 최종 정리했다. 임시로 사용한 형제 아카이브 폴더는 자료 이동 후 제거했다. [참고 자료 안내](references/README.md)에 용도·현재 코드와의 관계·재사용 방법을 기록했다.
- 문서 템플릿은 `docs/references/templates/`, 조사 원본·제작 스크립트·UI 검증 스크립트·과거 테스트 DB·도구 설정·보존 기록은 `docs/references/local/` 아래 용도별 폴더에 있다. `local/`은 Git에서 제외한다. 기존 `AGENTS.md` 템플릿은 실행 지시와 구분하도록 `AGENTS.template.md`로 이름을 바꿨다.
- 이동 직후 프로젝트 6,120개·초기 자료 30개·브라우저 기록 12개 파일의 내용과 권한, 디렉터리 권한과 심볼릭 링크를 이동 전과 대조해 일치를 확인했다. 원격 배포는 변경하지 않았다.
- 프로젝트 루트 이동 후 검증: `npm run build` 통과, 새 루트에서 Vite 시작 및 HTML·`/src/main.jsx` HTTP 200 확인, 검증 서버 종료. Git은 새 루트의 `main` 체크아웃을 정상 인식한다. 이번 정리에서는 게임 플레이·백엔드 통합 테스트를 재실행하지 않았다.
- 참고 자료 재배치 검증: 기존 47개 파일 이동 시 해시·권한 일치, 초기 작업·브라우저 자료 42개는 첫 이동 manifest와 추가 대조했다. 이후 템플릿 README에 안내를 추가했다. 로컬 문서 링크 48개가 유효하며, 로컬 참고 파일 39개가 모두 Git에서 제외되고 안내·템플릿 10개는 관리 가능한 상태임을 확인했다. `git diff --check` 통과.
- 게시 전 검증(2026-10-08): 원격 `main`의 룸 정원 100명 변경(`05bf66c`)을 fast-forward로 반영하고 문서 작업을 충돌 없이 적용했다. README의 정원 설명을 맞췄으며 문서 템플릿의 줄 끝 공백을 정리했다. `npm run build`, `npm --prefix colyseus test` 32/32, 로컬 문서 링크 58개와 참고 파일 39개의 Git 제외 확인을 통과했다.

## 1. 로드맵

| 단계 | 마일스톤 | 상태 |
|---|---|---|
| M1 | 원본 읽기 전용 조사·기획·PRD·기술 계약·개발 계획 | 완료 (`5fa022a`) |
| M2 | 1차 도트 게임·PocketBase/Colyseus 연동·3개 방 | 완료했으나 **사용자 거절** (`9bc3d66`) |
| M3 | 1차 보안·복구·20명 로컬·모바일 검증 | 백엔드 증거만 유효. 화면 증거는 거절판 기준 |
| M4 | 공개 GitHub 단계별 게시 | 완료 (`dc2e191`) |
| M5 | 싸이월드 도트 감성 재제작 (PLAN-002) | 구현·검증 완료, main 병합(`965d266`). 사용자 디자인 승인(2026-10-02) |
| M6 | 상시 별 이벤트·별 상점·옷장·펫·미니룸·클릭 이동·큰 채팅 (PLAN-003) | 구현·검증 완료, main 병합(`965d266`). 사용자 승인(2026-10-02) |
| M7 | Mac mini PocketBase 0.39.7·Colyseus 0.18 이전, 로컬 프런트 원격 연동 (PLAN-004) | 이전·원격 검증 완료(원격 8/8, 서버 측 멱등·롤백, outbox 장애 복구) |
| M8 | 첫 입장 캐릭터 만들기·꾸미기 (PLAN-005) | 구현·로컬·원격 검증 완료 |
| M9 | 첫 화면 캐릭터 만들기 + 게스트 자동 가입, 로그인·연습 모드 제거 (PLAN-006) | 구현·로컬·원격 검증 완료 |

## 2. 계획

- `plans/PLAN-007.md` — S1~S5 로컬 구현·검증 완료. 최소 게임·정산·worker 교체·실제 두 브라우저 확인. S6 공개 100명/30분 검사를 통과했고 Pages에 게시했다. 실제 브라우저 정원 검사도 통과했다.
- `plans/PLAN-001.md` — DONE. 1차 로컬 멀티플레이 데모. 백엔드 계약은 유지, 화면·맵·충돌은 PLAN-002로 대체.
- `plans/PLAN-002.md` — DONE(구현·검증·사용자 디자인 승인 2026-10-02).
- `plans/PLAN-006.md` — DONE(구현·검증). 사용자 결정: 게스트 자동 가입, 이메일 로그인 제거, 남용 방지는 이후.
- `plans/PLAN-005.md` — DONE(구현·검증). FR-014 닉네임·피부·머리 색·머리 모양·옷 색, 첫 입장 게이트, 게임 안 수정.
- `plans/PLAN-004.md` — DONE(이전·검증). Mac mini 서버 이전, Colyseus 0.18·`@colyseus/sdk` 전환, 백업·롤백.
- `plans/PLAN-003.md` — DONE(구현·검증·사용자 승인 2026-10-02). 2026-10-02 추가 피드백(별 얼굴, 상시 이벤트, 상점·꾸미기·미니룸, 채팅·마우스 이동).

## 3. 현재 작업 (PLAN-005)

- [x] S1 카탈로그 `avatar`·`profile.pb.js`·`cleanProfile`·시드(`profiles.avatar`, 데모 기본 외형)
- [x] S2 서버 `lookOf`(색인 검사)·`look` 메시지로 이름·옷 색·외형 갱신, 렌더러 `lookFor`
- [x] S3 SCREEN-008(첫 입장·게임 안 꾸미기), 프로필 로드 후 입장 게이트
- [x] S4 Mac mini 반영(배포 스크립트에 훅·스키마 추가 포함), 원격 검증
- [x] S5 문서

### 이전 작업 (PLAN-004)

- [x] S1 원격 읽기 전용 조사·SQLite online 백업·코드/훅/설정 백업
- [x] S2 저장소 Colyseus 0.18.18·`@colyseus/sdk 0.18.4` 전환(토큰 `context.token`, `moveInputs`, express·Monitor 보호·Origin 공용 서버), nanoid 대체 모듈 제거, PB 0.39.7 훅 호환(통합 15/15)
- [x] S3 원격 배치(app·독립 node_modules, outbox superuser·.env, 게임 훅·스키마 멱등 추가, 진입점 교체·Colyseus만 재시작)
- [x] S4 무작위 암호 테스트 계정 2개, `tests/remote-check.mjs` 7/7(기본 3분 정산 포함)
- [x] S5 Mac mini 서버 측 멱등·충돌·롤백, outbox 장애·재시작 복구(30초 단축 후 원복)
- [x] S6 로컬 프런트 `npm run dev:remote` 2유저 브라우저 확인
- [x] S7 문서(SERVER_OPERATIONS·verification 10절·TECH_SPEC·README·colyseus README)

### 이전 작업 (PLAN-003)

- [x] S1 별 그림(다리 사이 막대 제거) · S2 상시 이벤트·6초·넓은 배치·3분 정산 · S3 최단 경로·채팅 클릭 통과·큰 채팅 (`a01afab`)
- [x] S4 카탈로그·purchases·shop 훅 · S5 모자·옷·펫 표시와 서버 look · S6 미니룸 배치·저장
- [x] S7 단위18·통합15·UI7·build, 기본값 3분 정산 브라우저 확인, 스크린샷, 문서

### 이전 작업 (PLAN-002)

- [x] S1 원본 재관찰(무통신 stub)·PRODUCT_SPEC 재작성·PLAN-002·ADR-002/003
- [x] S2 공용 맵·충돌 모듈 `shared/world.js`, 서버 연결, 포트 환경변수화 (`332ae9b`)
- [x] S3 도트 렌더러: 3계층 깊이·자동 외곽선·정수배 스케일·2등신 아바타 (`216d963`)
- [x] S4 미니홈피 UI·반응형·채팅·클릭 이동·출입구 (`216d963`)
- [x] S5 단위14·통합13·UI5·build, 2유저·기본30초 라운드·4 뷰포트 검증과 스크린샷 (`12aefce`)
- [x] S6 TECH_SPEC·README·현황 정리와 인계 (`12aefce`)

## 4. 거절과 재제작 사유

2026-10-02 사용자 피드백: "원본의 싸이월드 도트 감성도 다 사라지고 픽셀맵의 구성도 엉망이다. 캐릭터가 움직일 수 있는 부분과 못 움직이는 부분이 제대로 뎁스가 안 잡혀 있다." 원인 분석은 PRODUCT_SPEC 1.2, 설계 결정은 ADR-002/003에 둔다. 1차 판의 "완료" 표기는 기능 동작 기준이었고 디자인 승인 근거가 아니다.

1차 판에서 유지하는 것: PB 사용자별 authRefresh, ID 위조 차단, 서버 점수, `match_id` 멱등, 결과+inventory 원자 저장, 영구 outbox 재시도·재시작 보존, 채팅 투명도·접기·미읽음 요구, 별 상한 규칙.

## 5. 막힘 / 알려진 문제

- 해결: Colyseus 0.18 전환으로 패치된 `nanoid 3.3.19`를 쓰고, 0.16용 대체 모듈은 제거했다. `npm audit` 0건.
- 갱신(PLAN-006): 가입 경로는 게스트 훅 `POST /api/pixeltown/guest` 하나다. 공개 `users` 직접 생성은 여전히 막는다.
- 해결(사용자 지시): 게스트 발급은 방문자 IP(Cloudflare `CF-Connecting-IP`)당 시간당 20회, PB 기본 rate limit 활성(게임 서버 loopback 제외), 30일 미접속 게스트 매일 자동 삭제(PLAN-006 5절).
- 남은 한계: 브라우저 저장소를 지우면 캐릭터를 되찾을 수 없고 다른 기기에서 이어 할 수 없다. 같은 IP를 쓰는 사람들은 시간당 20개 한도를 나눠 쓴다. rate limit 카운터는 PB 재시작 시 초기화된다. 채팅 신고 없음.
- 결정(2026-10-02 사용자): 원격 공개 가입 차단. `users.createRule`을 `''` → `null`로 바꿨다(다른 규칙·계정 유지, 직전 백업 `/Users/cheng80/Servers/backups/pixeltown-signup-close-20261002/data.db`). 새 사용자는 superuser 권한의 `scripts/provision-accounts.mjs`로만 만든다(계정+프로필). 실제 공개 가입을 열 때는 가입 UI·이메일 인증·가입 속도 제한·프로필 자동 생성 훅을 함께 도입한다. Mac mini의 옛 `verify.mjs`(lobby 검증)는 공개 가입에 의존하므로 더 이상 쓰지 않는다.
- 원격 outbox 저장은 전용 superuser(`colyseus-outbox@pixeltown.local`)를 쓴다. Monitor 보호가 이 계정을 거부한다.
- 해결: 닉네임은 DB unique 식 인덱스(띄어쓰기·_·-·영문 대소문자 무시)와 사칭 단어 거부로 막고, 화면이 입력칸 아래에 안내한다. 일반 욕설 필터는 없다.
- 해결: 통합 테스트 셋업의 1회성 "Something went wrong."은 PocketBase가 훅 파일 변경을 감지해 재시작하는 동안(약 2–3초) 요청이 status 0으로 실패하는 현상으로 재현됐다. 통합 테스트는 이제 훅 사본을 쓰고, 실패 보고에 상태 코드·URL을 남긴다. 원격 배포에서 훅이 바뀌면 같은 짧은 중단이 생긴다.
- 해결: 원격 클릭 이동이 지연(왕복 약 100–200ms) 때문에 목표를 6–7도트 지나쳐 멈추거나 왕복했다. 마지막 구간에 목표점 `to`를 보내 서버가 실제 위치 기준으로 정확히 멈춘다. 원격 실제 브라우저 클릭 20/20 도착.
- 해결: 원격 별 회수 검사 실패의 원인은 경로 탐색 버그였다. 소품 가장자리(칸 중심이 막힌 빈 위치)에서 `findPath`가 빈 경로를 돌려주고, 반올림 0.03도트 어긋남이 모서리 비켜가기를 꺼서 멈췄다. 실제 플레이어의 클릭 이동도 같은 위치에서 반응하지 않았다. 원격 지연(약 100–200ms) 때문에 이런 위치에 멈출 일이 많아 원격에서 드러났다. 수정과 회귀 테스트는 TECH_SPEC 마지막 절.
- 해결: 프런트 번들은 vendor(221KB)와 앱(283KB)으로 나눠 Vite 500KB 경고가 없다.
- 실제 iPhone/Android 가상 키보드·성능, 외부 배포·TLS·지속 운영은 미검증이다. 100명은 로컬 단일 머신에서 채널 방 자동 분할(32/32/32/4)까지만 측정했다(통합 opt-in). 2026-10-07 변경으로 한 방 정원을 100명으로 확대했다. 아래 인계의 최신 검증 범위를 참고한다.
- 내 이동은 로컬 우선(ADR-005)이라 지연이 조작감에 영향을 주지 않는다. 다른 플레이어는 걸음 단위로 재생하며, 지연이 처음 크게 출렁일 때 한 번 멈췄다가(배포 주소 핑 1640ms에서 최대 1.85초) 그만큼 뒤에서 따라간다.
- 그래픽은 절차 도트다. 2026-10-02 사용자가 배포 화면 기준으로 디자인을 승인했다. 이후 피드백이 오면 팔레트·소품을 조정한다.
- 이미 열려 있던 구 버전 탭이 제거된 `startGame`을 보내면 Colyseus가 연결을 끊는다. 새로고침하면 된다.
- 미니룸은 본인만 본다. 다른 사람 방문·방명록·선물은 후속 범위다.
- 진행 중 경기는 서버 프로세스 강제 종료 시 복원하지 않는다. 디스크 outbox에 완료 기록된 경기는 재시작 후 저장한다.

## 6. 다음 작업

0. 완료(2026-10-03): 로컬 우선 이동 + 서버 검증, 다른 플레이어 걸음 단위 재생(완충 자동 조절). 남은 근본 대책 후보: 서울 VPS 앞단 또는 Tailscale Funnel 지연 측정(사용자 결정 대기). Cloudflare 경로는 LAX(무료 요금제 한국 경로).
0. 완료(2026-10-02): 핑 표시·끊김 기록(`/health` `connections`, 서비스 로그)·GitHub Actions 외부 감시. 끊김이 다시 보고되면 `/health`와 Actions 실행 기록부터 본다.
1. 디자인은 승인됐다(2026-10-02). 새 디자인 피드백이 오면 반영한다.
2. 채팅 신고·숨김, 다른 기기에서 이어 하기(계정 연결)는 필요해지면 계획한다.
3. 한 방 정원은 100명으로 확대했다. 운영 100명 성능은 별도 측정이 필요하며, 필요하면 delta snapshot·관심 영역을 설계한다.
4. 실기기 키보드·인터넷 지연 측정은 실기기와 실제 사용자 환경이 필요하다. 원격 서버는 소수 기능 테스트만 하고 공개 경로 부하는 하지 않는다.
4. PWA·앱 포장은 웹 핵심 플레이 검증 후 별도 계획으로 다룬다.

## 7. 인수인계

### 사용자 요청에 따른 시험·게임 서비스 종료와 코드 게시 준비 (2026-10-08, Codex)

- 복구한 85명 이동 검사를 사용자 요청으로 18:14:16 KST에 정상 종료했다. `.test-work/minimal-live-2IhLNh/status.json`은 stopped·connected 0·410,224 입력·pendingAfterDrain 0·끊김/error/fix 0·배포 0회다. 정산 결과/원장 624/624와 사용자 100개를 대조했다. 실제 사용자와 서버는 이 단계에서 유지했다.
- 이어 게임 서버 종료 지시를 받아 18:15:25 KST에 운영 `com.fastmake.pixeltown.minimal.colyseus`만 launchctl bootout했다. 종료 직전 players 0·generation 23·outbox 대기/실패 0/0, 종료 후 loopback 13620 listener 없음·PB 18820 health 200 확인. 자료는 원격 app의 `.test-work/game-user-shutdown-20261008.json`이다. Pages·PB·Tunnel·기존 게임·로컬 5270/18120/12620·개발 세션은 보존했다. 게임 서비스 재시작은 별도 사용자 요청에 따른다. 이후 공개 game health/ready 실패는 이 종료 상태와 구분해 읽는다.
- 인계 HTML·화면 계약·TECH_SPEC·실 서비스 정리 문서를 마무리했다. 윤문 기록은 `_workspace/2026-10-08-003/`에 보존하며 원문과 검토 자료는 Git에서 제외한다. 스타일 수정 2곳·글자 기준 1.26%이며 이후 구현/검증 사실 추가는 윤문 변경률에 넣지 않았다. 이전 문서 윤문 자료도 보존한다.
- 최종 게시 전 검사: 최소 단위 21/21·오프라인 걷기 회귀·원격 빌드·Postman 5/5 통과. HTML 3개 self-check와 변경 문서의 로컬 링크 119개를 확인했다. Ego의 데스크톱 검사를 남겼으며 작업 공간이 사라져 최종 1280/390px 검사는 허용 Chromium 1193으로 완료했다. 페이지 넘침·브라우저 오류 0, 작은 화면의 그림 내부 스크롤만 허용한다. 자료는 `.test-work/frontend-live-source/`다. 공개 코드의 비밀정보 패턴 검사도 통과했고 `_workspace/`는 Git에서 제외했다.
- 게시 검사에서 `engine.js` 끝의 빈 줄만 정리했다. 실행 코드는 동일하지만 파일 해시가 바뀌어 게시 빌드의 화면/호환성은 `c72da755`/`bd6f0b65`다. 실제 공개 두 번 교체 검증은 정리 전 `2ca05cdd`/`c4294810`의 기록으로 유지한다. 새 CI 빌드는 과거 공개 버전 4개와 새 버전을 보존하며, 이 호환성 변경은 열린 구버전 탭에 강제 적용하지 않는다.
- 사용자가 commit/push/main 병합을 승인했다. 기존 dirty main을 유지하면서 별도 게시 브랜치에서 PB 서비스 분리·화면 교체·실제 검사·인계를 게시한다. 브랜치/worktree 삭제·개발 세션 종료는 하지 않는다. 병합 결과는 게시 후 아래에 기록한다.

### 화면·리소스 교체 완료와 자동 배포 중지 (2026-10-08, Codex)

- 사용자 요청으로 main의 대각선 방향 수정을 포함한 화면 교체 구조를 구현하고 직접 Pages에 게시했다. 사용자 게임 주소는 유지했다. 사용자는 이번 일회 작업의 직접 프런트 수정을 허용했다. Claude 로그인 완료·대기 상태를 확인했고 기존 세션과 main 변경을 보존했다. commit/push는 하지 않았다.
- `engine.js`/`WorldCanvas.jsx`에 상태·입력·이동 타이머를 남기고 `visual-release.js`로 그리기를 분리했다. `visual-update.js`가 15초마다 같은 origin의 버전 목록을 읽는다. 코드·CSS·이미지 decode·글꼴 load와 복제 상태의 첫 그리기 확인을 마친 뒤 기존 rAF에서 전환한다. 준비 오류는 기존 화면 유지, 전환 후 그리기 오류는 직전 버전 복구다. 상단에 서버 worker와 별도의 화면 버전을 표시한다. 인증·room·seq/fix·내 좌표·점수·입력 대기열은 다시 만들지 않는다.
- 범위: 월드 렌더러·도트 그림·CSS·글꼴·이미지. React 화면 구성·인증·연결·이동/충돌 규칙 변경은 호환성 값이 달라져 열린 탭에 적용하지 않는다. 기능 도입 전 탭은 최초 한 번 새로고침이 필요하다. 음원은 구현·검사 대상이 아니다. 타인 표시는 현재 `playback.js`의 확인된 걸음 재생을 유지했다. 초기 100ms 보간 구현으로 설명하지 않는다.
- 빌드/게시: 공개 버전별 파일과 SHA-256 목록을 보존한다. 새 로컬 저장소에서도 공개 이전 버전 4개를 내려받아 해시를 대조한 뒤 `build:remote`에 포함하는 검사를 통과했다(`.test-work/frontend-history-from-public/`). 포인터 no-store, 버전 파일 immutable, 누락 404. Pages 전용 잠금과 빌드 전후 공개 버전 대조를 추가했다. 여러 컴퓨터/CI의 최종 게시 경쟁은 CI 동시 실행 제한이 후속 작업이다.
- 공개 게시: 초기 `2ca05cdd` → 호환 후보 `ea9d28b8` → 원본 렌더러 복구 `2ca05cdd`. 마지막 Pages 배포 `baa68ba8.pixeltown-4x2.pages.dev`, 호환성 `c4294810`. 후보는 실제 JS 파일 내용이 달라지는 같은 동작의 표현 변경이며 그림 디자인 변경은 하지 않았다. PB·Colyseus·Tunnel 재시작과 게임 worker 제어 없이 Pages만 게시했다. 현재 운영은 미커밋 작업에서 게시됐으므로 다음 승인된 Git 코드 게시에 관련 파일을 함께 포함해야 한다.
- 실제 로컬 화면 교체 **PASS**: `.test-work/minimal-visual-X9a6dw/report.json`. 기존 18120/12620 서버에 실제 SDK/Chromium 접속, 5270 파일 제공만 검사 내 라우팅했다. 새 renderer·실제 SVG 이미지 픽셀 `[18,52,239,255]`·CSS `rgb(222,240,255)`·글꼴 두 개 적용을 확인했다. 누락 이미지·잘못된 renderer·전환 후 draw 오류·비호환 manifest도 검사했다. draw 오류 복구 1회, 같은 room/session, 1,798개 입력 전부 ack·pending 0·1,752개 snapshot·최대 간격 76.30ms. 끊김/error/장애 덮개/fix 0. 1280/390px 확인. 이는 공개 CDN 파일 교체 검사와 구분한다.
- 실제 공개 두 번 교체 **PASS**: `.test-work/minimal-visual-public-GpRvI3/report.json`. 운영 주소의 실제 JS/CSS/글꼴과 WebSocket을 사용했다. 같은 room/session에서 5,175개 입력 전부 ack·pending 0, 5,155개 snapshot·최대 간격 515.6ms. 끊김/error/장애 덮개/fix/준비 실패 0, navigation은 최초 1회뿐이었다. 각 전환 시 누른 키와 타인 86명 표시를 유지했다. 이 짧은 브라우저 성공을 85명 전체의 장시간 무장애 기록으로 확대하지 않는다.
- dot의 걷기 결함: 머지된 `WorldCanvas.jsx`에서 `engine.movedAt = engine.lastTick`이 주석에 포함된 것을 확인해 별도 실행 줄로 복구했다. UI 검사에 캐릭터 canvas의 실제 픽셀 비교를 추가했다. 공개 검사 `.test-work/minimal-walking-public-q2Eonc/report.json` **PASS**: 걷기 그림 0/1/3을 41/15/21프레임에서 확인했고 정지 뒤 서 있는 그림 39프레임만 확인했다. 실제 이동 시각/seq 증가·같은 session·fix 유지·장애 덮개 없음도 대조했다.
- 회귀: 최소 단위 **21/21**, 오프라인 UI **PASS**(실제 걷기 그림·정지 복귀 추가), 최종 공개 Postman 화면 계약 **5요청·5단언 PASS**. 원격 Postman workspace에 게시하지 않았다. 도식 self-check·문서 링크·모바일 렌더 결과는 아래 최종 검사 기록을 따른다.
- 자동 배포 중지와 사고: 사용자가 3분 배포만 중지하도록 요청했다. 18:07:38 KST에 기존 검사 PID 23626의 배포 예약만 해제했으나, 이어 임시 inspector를 닫으려던 Codex 처리에서 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`이 발생해 검사 프로세스가 종료됐다. 합성 사용자 85개가 함께 사라졌으며 이는 게임 worker 교체 실패가 아닌 **검사 제어 실수**다. 사용자에게 원인과 책임을 즉시 알렸다. 원본 worker 복구·서버 재시작은 수행하지 않았고 generation 23을 유지했다.
- 복구: 같은 계정으로 배포를 끈 새 검사 PID 17065를 시작했다(`.test-work/minimal-live-2IhLNh/`, `MINIMAL_DEPLOYMENT_PAUSED=1`). 18:10:57 KST 표본에서 85개 연결·106,895개 입력·drops/error/fix 0, 자동 배포 0회·다음 예약 null. 공개 health는 사용자 1명 포함 players 86·generation 23·outbox 0/0이었다. 기존 게임/PB/Tunnel PID 78495/78579/965와 로컬 5270/18120/12620을 보존했다. 새 도구는 `PAUSE_DEPLOYMENTS` 파일로 배포만 중지하므로 임시 debugger를 다시 사용하지 않는다. 현재 marker를 제거해 재개하거나 STOP을 만들어 전체 종료하는 것은 사용자 지시에 따른다.
- 장시간 검사에서 남은 문제: 이전 실행은 22회 worker 교체 후 총 6,255,740개 입력까지 기록했다. 검사 제어 사고 **이전** 18:04:44~18:07:00 KST에 서로 다른 7개 접속에서 code 1006이 발생했고 모두 재입장했다. snapshot 나이 440~640ms, 해당 시점 서비스 PID 유지·outbox 0/0·추가 관련 서버 로그 없음. 한 건은 교체 후 약 2.9초였고 나머지는 교체 사이에도 발생했다. 네트워크·Tunnel·클라이언트/서버 원인을 아직 확정하지 않았으며 최초 기록과 재입장/검사 종료를 합쳐 성공으로 지우지 않는다. `.test-work/minimal-live-Bb63BB/`의 events/진단/최종 실패 상태를 보존한다. **장시간 안정성 원인 분석은 미완료**다.
- 남은 작업: 승인 후 코드 commit/push와 Git 자동 빌드 반영, 위 1006 원인 분석, 여러 CI 게시 경쟁 제한·CDN/이전 버전 보관/장시간 탭 메모리·실제 모바일/지역 검사. 비호환 DB/상태 이행, PB 실행 파일 업그레이드, 접속 계층 자체 교체와 호스트 재부팅은 별도다. [화면 인계](handoffs/2026-10-08-frontend-live-update.md)와 [실 서비스 정리 목록](handoffs/2026-10-08-minimal-service.md)을 따른다.

### 85명·3분 주기 worker 교체 재개와 끊김 추적 (2026-10-08, Codex)

- 사용자 재개 지시에 따라 공개 미니멀 서버에 시험 계정 85개를 다시 접속시켰다. 새 계정을 발급하지 않고 이전 private 계정을 재사용했다. 17:00:42 KST에 85개 접속을 확인했다. 무작위 이동 80명·별 추적 5명이며 중지 지시까지 180000ms마다 호환 worker만 교체한다. PB·Colyseus 접속 프로세스·Tunnel은 재시작하지 않는다.
- 실행 소유 PID 23626, 도구 `tests/minimal-live-observe.mjs`, 실시간 자료 `.test-work/minimal-live-Bb63BB/status.json`과 `events.jsonl`이다. 중지는 사용자의 중지 지시를 받은 뒤 해당 폴더에 `STOP` 파일을 만드는 방식이다. 도구는 입력 ack를 최대 5초 확인하고 시험 연결만 종료한다. 마지막으로 자신이 배포한 worker가 활성인 경우 원본으로 복구하며 다른 배포가 활성이라면 보존한다. 정산 원장을 대조하고 결과를 기록한다.
- 끊김 기록을 보강했다. 연결별 room/session·마지막 snapshot 시각·이동 seq/ack/fix·위치·미확인 입력·배포 단계, raw WebSocket close/error, 서버 health를 기록한다. 재입장은 16초 뒤 별도로 기록하며 최초 끊김을 지우지 않는다. 이동 타이머 지연과 검사 프로세스 RSS도 기록한다. 중지 중에도 ack를 수집하도록 고쳐 이전 중지 보고서의 `pending:189` 계측 문제를 반복하지 않도록 했다.
- `tests/minimal-live-diagnostics.py`를 최소 app의 `.test-work/live-diagnostics.py`에 준비했다. 30초마다, 배포 전후와 끊김/error 발생 때 내부 health·서비스 PID·새 로그를 수집한다. 게임/PB 로그와 공유 Tunnel의 기반 오류·최소 경로 관련 로그만 읽는다. 계정·토큰을 출력하지 않으며 JWT·인증·암호·이메일·URL 쿼리를 가린 기록을 `diagnostics-*.json`(0600)에 보존한다. 기준 PID는 게임 78495/PB 78579/Tunnel 965다. PID 유지 여부로 프로세스 재시작을 구분하며 로그가 없다는 이유로 원인을 단정하지 않는다.
- 사전 확인: 공개 Postman 계약 4요청·4단언 통과(health 200, 제어 공개 거절 403). 원격 workspace에 게시하지 않았다. 로비 0명·hotSwap true·outbox 0/0, 원본 Simulation 소스 일치, 세 서비스 정상과 로그 읽기 권한을 확인했다. JS/Python 문법·`git diff --check` 통과. 로컬 5270/18120/12620과 기존 개발 작업·세션을 보존했다. commit/push 없음.
- 첫 교체 **완료**: 17:03:43 KST, generation 1→2, 준비 45.81ms·권한 전환 0.15ms. 17:03:53 KST 표본에서 85개 연결·332,730 입력·별 획득 48건, 끊김/error/fix/연속성 오류 0이었다. 교체 전후 게임/PB/Tunnel PID는 78495/78579/965로 같았고 새 오류 로그·outbox 대기/실패는 없었다. 다음 교체 예정은 17:06:42 KST다. 앞선 97명 검사에서 기록된 1006/4003의 최초 끊김 원인은 아직 확정하지 않았다. 동일 연결의 SDK 콜백 중복은 끊긴 접속자 수에 중복 합산하지 않는다. 이번 기록은 원인을 구분하기 위한 것이며 짧은 첫 주기를 장시간 안정성 통과로 보고하지 않는다.

### 배포 인계 문서 윤문·상태 갱신 (2026-10-08, Codex)

- HTML 두 문서와 기술 설명·PB 배포·실 서비스 인계 Markdown 세 문서의 표현을 다듬었다. worker는 Colyseus 안의 게임 계산 스레드이며 PB는 별도 프로그램임을 설명했다. Colyseus 접속 서버·게임 worker·PB를 수정할 때의 반영 방법과 연결 유지 범위를 구분했다. [상세 그림](diagrams/worker-hot-swap.html), [도입 전/현재 비교](diagrams/zero-downtime.html), [기술 문서](architecture/zero-downtime.md).
- 오래된 “운영 미반영”, “PB 분리 대기”를 서비스 분리·공개 PB 배포 검사 완료로 갱신했다. 도입 전 그림과 초기 검증 수치는 과거 기록으로 구분했다. 현재 타인 표시는 `playback.js`의 걸음 재생이며 초기 100ms 보간 검사와 구분했다.
- 윤문 두 차례에서 59곳을 수정했다. 수치·인용·코드·링크·HTML 태그·CSS·SVG 좌표/연결은 윤문 전후 대조에서 같았다. 글자 기준 변경률은 HTML별 5.19%/9.20%다. 검토 기록과 원문은 `_workspace/2026-10-08-002/`, 최종 수정 목록은 `03_rewrite_diff_v2.json`에 있다. 진행 상태 갱신과 윤문 대조는 구분해 기록했다.
- 검증: 두 HTML self-check 통과. 허용 Chromium 1193으로 1280/390px 네 렌더를 확인했으며 페이지 넘침·깨진 내부 목차·외부 리소스 요청·브라우저 오류는 0이었다. 변경한 11개 문서의 로컬 파일 링크 96개와 `git diff --check`도 통과했다. 그림 자체는 작은 화면에서 가로 스크롤한다. 렌더와 화면 자료는 위 윤문 폴더의 `browser/`에 있다.
- 운영 검사가 남긴 임시 hooks는 원본으로 복구했다. 최종 공개 health는 players 0·outbox 0/0·hotSwap true·candidate false·idle이었다. 85명·3분 반복 배포는 재개하지 않았다. 로컬 PB/game/Vite PID 31654/31655/31666, 미커밋 프런트 작업과 개발 세션을 보존했다. 문서 윤문 과정에서는 화면 소스를 수정하지 않았고 commit/push도 하지 않았다.
- 남은 일: 현재 프런트의 장시간 동기화 재검증, 실 서비스의 DB 이행·PB 버전 업그레이드·새 입장 재시도 안내·기기/지역별 검사. 접속 서버 자체 교체와 호스트 재부팅까지 연결을 유지하는 구조는 별도다. 시험 계정·백업·원문 자료는 정리 지시 전까지 보존한다.

### PB 배포 중 기존 플레이 유지 (2026-10-08, Codex)

- 구현: PB 전용 `scripts/minimal-pocketbase.mjs`와 게임 전용 `scripts/start-minimal-game.mjs`를 분리했다. `dev-minimal.mjs`는 PB 종료 때 PB만 재기동한다. 게임이 입장을 받기 시작했지만 런처 기동 확인은 끝나지 않은 경계에서도 PB 종료가 게임 종료로 이어지지 않도록 수정했다. 전체 런처를 명시 종료할 때는 게임 정산 후 PB 종료 순서를 유지한다.
- 운영 도구: 신규 설치는 두 launchd label을 만든다. 기존 설치 전환은 `scripts/split-minimal-services.py --apply`이며 건강한 빈 로비·outbox 0/0을 전환 직전에 다시 확인한다. `scripts/deploy-minimal-pb.py`는 DB online 백업·PB 단독 종료·완성된 hooks 배치·PB 단독 시작·게임 PID 대조를 수행한다. 시작 실패는 이전 hooks로 복구한다. DB 자동 덮어쓰기와 기존 서비스 재시작은 하지 않는다.
- 계약: 기존 WebSocket·room/session·50ms snapshot·이동 seq/fix를 유지한다. PB 중단 중 새 게스트 발급·입장은 실패할 수 있다. 지갑은 마지막 성공값을 미확인으로 표시하고 정산은 디스크 outbox에 보관했다가 복구 후 저장한다. `/health`는 정상 호스트이면 200, `/ready`는 PB 불가 시 503이다. API payload와 프런트 화면 파일은 이번 PB 작업에서 변경하지 않았다. [인계](handoffs/2026-10-08-pb-deployment.md), [ADR-006](decisions/ADR-006.md).
- 실제 로컬 PB + SDK + Chromium 1193: `.test-work/minimal-pb-restart-sOETqN/report.json` **PASS**. 계획된 hooks 교체·PB 강제 종료·잘못된 hooks 거절/복구의 3회 중단을 각각 13.11/12.12/12.35초 동안 재현했다. 총 753개 SDK 입력·808개 snapshot, 끊김/예상 밖 fix 0. snapshot p95 51.79ms·최대 129.62ms. 브라우저는 동일 room/session으로 ack 751, 장애 덮개/끊김/error/fix 0, snapshot 최대 66.30ms. 마지막 입력 ack 일치도 확인했다. PB 중단 중 별 정산 1건을 outbox에서 확인하고 복구 후 지갑 잔액 1과 매치 ID를 대조했다. PB 중단 중 worker 교체도 통과했다.
- 로컬 `dev:all`의 PB 단독 재기동·같은 방 유지도 위 검사에서 통과했다. 최초 검사 `.test-work/minimal-pb-restart-Bii1Lb/report.json`은 기동 완료 경계에서 전체 런처가 종료되어 **FAIL**이었다. 해당 경계를 수정한 뒤 위 최종 검사를 재실행했다. 최초 Postman 검사 `minimal-pb-restart-kZkxvs`는 `--output`의 로그인 요구로 시작을 끝내지 못했다. 로그인 요구 옵션을 제거하고 CLI 결과를 로컬 파일로 보존했다. 최종 Postman은 PB 정상/중단/복구 각각 2개 단언, 총 **6/6** 통과했고 원격 workspace에 게시하지 않았다.
- 실제 macOS launchd 배포 도구: `.test-work/minimal-services-Siw2Vw/report.json` **PASS**. 시험 전용 label·18127/12627·새 DB로 접속자 있는 최초 분리 거절, 빈 로비 최초 분리, 실제 PB hooks 교체, 시작 실패 뒤 이전 hooks 복구를 실행했다. 기존 room/session·게임 PID 유지, 610개 이동 입력·613개 snapshot, 끊김/fix 0, snapshot 최대 68.03ms. 시험 label과 프로세스는 종료했고 자료·DB·백업은 보존했다.
- 회귀: 최소 단위 **19/19**, 실제 PB/Colyseus 통합 **6/6**(`minimal-integration-advBh0`), worker 배포 통합 **5개 동작 그룹**(`minimal-deployment-BMs76O`) 통과. 수정한 다이어그램 self-check와 1280/390px 렌더에서 넘침·깨진 내부 목차·외부 리소스 요청 0, `git diff --check` 통과.
- 운영 서비스 분리 **완료**: 최초 읽기 전용 검사는 접속자 1명으로 거절됐다. 이후 사용자가 초기 끊김을 허용해 `--apply --allow-connected`로 전환했으며, 실제 전환 시점에는 접속자 0명·outbox 0/0이었다. 기존 통합 label을 종료하고 `.pocketbase`/`.colyseus` 두 label을 적용했다. 백업은 `.backups/service-split-20261008T071325795235Z`, 코드 백업은 `.backups/service-code-20261008T071324Z`다. 전후 private 보고서 `app/.test-work/service-split-before.json`/`service-split-after.json`에서 사용자/프로필/결과/원장/관리자 106/106/156/156/1개 기존 행 내용이 모두 같았고 `/ready` 200이었다. 기존 8091/2567·다른 서비스·Tunnel은 재시작하지 않았다.
- 공개 경로 PB 단독 배포 **PASS**: `.test-work/minimal-pb-public-a0dqvT/report.json`. SDK 1개와 Chromium 1193 브라우저 1개가 이동하는 동안 임시 loopback 전용 읽기 hooks를 배포해 revision 2를 확인하고 원래 hooks로 복구했다. 두 번 모두 게임 PID·worker generation 1·같은 room/session을 유지했다. SDK 입력 238개·snapshot 254개, 끊김/fix 0, snapshot 최대 142.44ms. 브라우저 입력 ack 167·snapshot 182개, 최종 pending 0, 장애 안내/끊김/error/fix 0, snapshot 최대 141.40ms. 이 검사는 소수 접속의 짧은 PB 코드 배포 확인이며 100명 장시간 검사·DB 이행·PB 버전 업그레이드 검증이 아니다.
- 공개 검사 정리: 원래 hooks의 바이트 일치와 outbox 0/0을 확인했고 시험 소켓·브라우저만 종료했다. PB 배포 백업은 `.backups/pb-deploy-20261008T071850534951Z`와 `pb-deploy-20261008T071852848278Z`다. 첫 공개 검사 `minimal-pb-public-u5Lofy`는 인증된 게스트의 자동 입장 뒤 없는 버튼을 기다려 실패했으며 PB 배포는 시작하지 않았다. 자동 입장에 맞춰 검사 도구를 고친 뒤 위 검사를 통과했다. 85명·3분 반복 배포는 재개하지 않는다.
- 보존: 로컬 5270/18120/12620과 PID 31653 런처·기존 DB·main 미커밋 작업·개발 세션을 유지했다. `main.jsx` 등 Claude의 기존 미커밋 변경은 보존했고 이번 PB 작업으로 수정하지 않았다. commit/push는 하지 않았다.

### 85명 활동·3분 주기 배포 중지 (2026-10-08, Codex)

- 사용자 요청으로 합성 85명(무작위 이동 80명·별 추적 5명)을 접속시키고, 3분마다 호환 게임 worker를 교체했다. Colyseus와 PB 프로세스의 재시작은 하지 않았다. 전체 서버 재배포와 구분한다.
- 15:31:27 KST에 85명이 모두 접속했고, 15:34:28에 첫 교체를 완료했다(generation 20). 중지 전까지 입력 356,339개·별 획득 58개, 연결 종료/보정/연속성 오류 0을 기록했다. 짧은 실행 결과이며 장시간 안정성을 보장하지 않는다.
- 사용자 중지 지시를 받고 15:34:51에 STOP을 전달했다. 시험 소유 연결 85개를 종료하고 원본 worker `0f9aad1911f4cb6b070452d7dbfa6756935614f745eca82dc124c3bb8aca0220`을 복원했다(generation 21). 15:34:59에 실행이 종료됐고 PID 3024의 종료를 확인했다. 다음 예약 시각은 더 이상 실행되지 않는다.
- 종료 후 공개 health: `ok:true`, `players:1`, `candidate:false`, `persistence.pending:0`, `persistence.failed:0`. 실제 접속자 연결은 종료하지 않았다. 시험 사용자 지갑 100개·원장 138건·결과 138건 대조를 완료했다. 계정·원장·DB와 실행 자료는 보존했다.
- 근거: `.test-work/minimal-live-KytYyv/status.json`, `events.jsonl`, `STOP`. 종료 시 수집기의 ack 추적이 먼저 멈춰 `pending:189`가 남았다. 이 값으로 실제 입력 유실 여부를 판정하지 않으며, 이번 실행에서 최종 미확인 입력 0을 검증했다고 보고하지 않는다.
- 이후 지시 전에는 합성 접속·반복 배포를 재개하지 않는다. 로컬 5270/18120/12620, 운영 게임 서비스, main 미커밋 작업과 개발 세션을 유지하고 대기한다. 이번 중지 처리에서는 commit/push를 하지 않았다.

### 미니멀 구조 도입·운영 검증 (2026-10-08)

- 기존 로컬 포트가 비고 PB 잠금 소유 프로세스도 종료된 것을 확인했다. SQLite online 백업과 사용자·프로필·원장·관리자 행 해시 대조 후 최소 런처를 시작했다. 23명/프로필 23개/결과 5개/원장 5개/관리자 1개의 내용이 같다. 5270/18120/12620 실행을 유지한다.
- Mac mini의 기존 PB 8091/game 2567과 다른 서비스·Tunnel은 재시작하지 않았다. 새 `~/Servers/pixeltown-minimal/app`, 전용 DB와 `com.fastmake.pixeltown.minimal`을 만들었다. 공개 경로는 `pixeltown-minimal-pb.fastmake.net` → 18820, `pixeltown-minimal-rt.fastmake.net` → 13620이다. 기존 다섯 터널 경로는 유지했다.
- 공개 PB health와 game health 200, 초기화/worker 제어 공개 요청 403을 확인했다. 최소 서버 최초 도입 뒤, 접속자가 없는 상태에서 상단 상태 메시지용 호스트 코드를 반영해 최소 서비스만 정상 종료·시작했다. 기존 서비스는 그대로다.
- 배포 도구 로컬 통합 5개 동작 그룹, 최신 단위 18개와 최소 빌드가 통과했다. 후보 선택 링크가 바뀐 동안 활성 worker가 실패해도 검증된 파일로 최신 상태를 복구하는 재현 검사를 추가했다. 보고서 `.test-work/minimal-deployment-CQG0Zz/report.json`. 후보 실패·잘못된 인증 시 이전 링크 복원, 같은 버전 건너뛰기, 이동 입력과 room/session 보존을 확인했다.
- 운영 부하 검사 첫 시도는 입장 HTTP `fetch failed`로 중단했다(`minimal-hotswap-YPoZ4U/report.json`). 30분 활동 검사에 진입한 성공 결과가 아니다. 개별 재확인에서는 실제 입장·퇴장이 성공했고, 준비 단계에 제한된 재시도를 넣었으며, 아래 최종 30분 검사와 구분해 실패 증거를 보존했다.
- 사용자 요청에 따라 상단 상태 계약과 실 서비스용 재사용·추가 작업·자원 정리 조건을 인계 문서에 작성했다. 화면 구현은 Claude가 완료했다. Codex는 화면 파일을 수정하지 않았으며 실제 두 브라우저에서 단계·최신 버전과 이동 유지, 6회 교체의 연결/cover/fix/예측/보간 이상 0을 확인했다(`minimal-hotswap-UpiiRu/browser-report.json`).
- 로컬 장시간 검사: `minimal-hotswap-ow3S5Q/report.json` **PASS**, 100명·1,800,040ms·3,530,400 입력·31회 교체. 연결 종료·예상 밖 보정·입력 누락·위치/점수 되돌림 0, 원장 12건/결과 12건 대조. 교체 snapshot p95/p99/max 53.84/56.74/164.36ms, ack 56.97/63.92/161.51ms.
- 공개 100명 활동의 기존 설정에서 배포 전 연결 종료를 재현했다(`minimal-hotswap-HULefX/report.json`, 32개 연결의 1006, 뒤따른 SDK 4003). 압축 적용 뒤 같은 공개 100명/30분 검사도 통과했다(`minimal-hotswap-eT1IBb/report.json`): 1,800,003ms, 3,533,031 입력, 30회 교체(의도한 fix 뒤 교체 포함), 연결·예상 밖 보정·입력 누락·연속성 오류 0. 개인 지갑 100개와 원장/결과 20건 일치, outbox 0/0. 교체 snapshot p95/p99/max 130.55/143.67/850.83ms, ack 266.37/346.89/1531.76ms. 인터넷 도착 간격/ack 최대치는 로컬보다 크며 100개 합성 SDK의 결과를 100개 실제 브라우저 입력 검사로 해석하지 않는다. 전송량/heartbeat 지연이 원인이라는 설명은 현재 추정이며, 단순 worker 교체 실패로 해석하지 않는다. 새 설정의 로컬 100명/9회 검사도 통과했다(`minimal-hotswap-mACdEz/report.json`).
- `68d4ca8`을 commit/push하고 Cloudflare Pages production의 해당 main 소스를 확인했다. 게임 주소는 그대로이며 새 미니멀 화면을 제공한다. 공개 JS/CSS `index-DGn17dBr.js` / `index-Pe__vhzg.css`는 로컬 빌드와 같다. 새 백엔드 주소와 배포 라벨이 들어 있다. 기존 빌드는 `build:legacy:remote`로 보존했다. PR/merge·브랜치/세션 정리는 하지 않는다.
- 최신 호스트 코드는 30분 검사 종료 뒤 players/outbox가 0인 상태에서 최소 서비스에만 반영했다. SQLite online 백업과 전후 전체 행 해시를 대조했다(사용자/프로필 100개, 결과/원장 20개, 관리자 1개 동일). 활성 worker 복구가 후보 링크를 다시 읽지 않고 검증된 파일을 사용하는 수정과 복구 완료 상태 메시지를 포함한다.
- ego-browser 공개 화면에서 이동 중 교체 후 같은 room/session, 입력 148개, fix/pending/장애 cover 0을 확인했다. 증거 `.test-work/minimal-ego-public.png`.
- 공개 실제 브라우저 검사 `.test-work/minimal-public-browser/report.json` **PASS**: 합성 98명+Chromium 1193 두 브라우저가 같은 방 100명을 유지한 상태에서 6회 교체했다. 두 계정 입력 264/259개, room/session 유지, 연결/error/cover/fix/stale/예측 오류 0. 최대 pending 5/6개로 입력 제한 20개에 닿지 않았고 마지막 미확인 입력 0개다. snapshot 최대 144.10/142.20ms, ack 최대 214.50/283.70ms. 타인 이동의 100ms 보간과 준비/추격/적용 라벨·새 버전 즉시 갱신을 확인했다. 390px 화면 넘침 0. 두 브라우저는 약 22초 측정이며 100개 실제 브라우저의 30분 검사가 아니다.
- 두 브라우저 검사에 함께 참여한 98명 합성 접속도 종료·정산 대조를 통과했다(`minimal-hotswap-IaEJZD/report.json`): 246,003ms, 477,409 입력, 연결/예상 밖 fix/입력 누락/연속성 오류 0, 시험 지갑 100개와 결과/원장 24건 일치. 이 실행의 자체 교체 수는 0이며, 위 브라우저 도구가 외부에서 6회 교체했다. 원본 worker 복원 뒤 players 0, outbox pending/failed 0/0, hotSwap true를 확인했다. 로컬 5270/18120/12620과 같은 개발 세션을 유지한다.
- 남은 실 서비스 작업: 전체 기능별 상태 인계, 호환되지 않는 계약 변경 절차, 실제 기기·다중 방 검사, 계정/원장 이전 여부, 접속 서버 자체 장애 복구. 이번 미니멀 worker 배포 완료와 구분한다. 입장 위치 변경은 보류한다.


### 무중단 배포 문서 (2026-10-08)

- [게임 로직 무중단 배포 인계](architecture/zero-downtime.md)와 [구조·교체 순서 그림](diagrams/worker-hot-swap.html)을 작성했다. 도입부에는 역할 설명, 별 3→4개 예시, 용어표와 인계 시점의 상태를 넣었다. 이후에는 체크포인트, 이벤트 순서, 전환 조건, 정산, 장애 복구, 제어 API, 배포 절차와 상태 조회를 설명한다.
- 그림은 전체 구조 6개 노드와 교체 순서 4개 참여자로 나눴다. CSS/SVG를 담은 단일 HTML이며 외부 폰트·이미지·JavaScript를 요청하지 않는다. 브라우저에서 열거나 인쇄할 수 있다. 인증·readiness 절차는 기술 문서에 있다.
- 검증 수치는 기존 로컬 보고서에서 가져왔다. 문서 작성 중에 게임 부하·운영 검증을 다시 실행하지 않았다. docs/README와 TECH_SPEC에 링크를 추가했다.
- 문서 검사: 다이어그램 self-check와 `git diff --check` 통과. 링크 21개와 HTML 내부 목차 정상. ego-browser 데스크톱 1458px·모바일 390px에서 본문 가로 넘침, SVG 밖으로 나간 글자, 외부 리소스 요청 없음. 모바일에서는 그림만 가로 스크롤한다. QA 자료는 `.test-work/worker-document-browser-report.json`, `worker-document-link-report.json`과 화면 캡처에 있다.
- 사용자 피드백에 따라 제목·설명·관련 링크 문구를 윤문했다. 반복 비유와 슬로건을 줄이고 프로그램의 동작을 직접 서술했다. 계약·수치·코드 예제는 유지했다. 윤문 전후 대조에서 API 표·코드 블록·인라인 식별자·링크가 같았고, 변경한 그림도 데스크톱·모바일에서 넘침이 없었다. 원문과 수정 내역은 `_workspace/2026-10-08-001/`에 남겼다.
- 서버·게임·프런트 소스·DB·개발 세션·기존 미커밋 작업은 변경하지 않았다. commit/push·운영 접근/배포 없음. 최초 접속 계층 도입과 운영 검증은 별도 지시를 기다린다.

### 동기화·끊김 없는 worker 배포 확인 (2026-10-08, Codex)

- 사용자 우선순위에 따라 AGENTS 읽기 순서와 Claude 결과 인계를 확인했다. `main.jsx`/`WorldCanvas.jsx` 등 프런트 화면·`api.js`/`state.js`·입장 위치는 수정하지 않았다. 기존 main 미커밋 작업을 보존했다.
- 구현: `WorkerHost`가 연결·room/session·최신 확정 상태·입력 순서를 유지하고, `simulation-worker.js`/`worker-runtime.js`가 후보 체크포인트·결정적 재생·상태/효과 hash 비교·틱 경계 승격·늦은 구 worker 차단을 처리한다. 단일 outbox가 정산을 기록하고 승인한 매치만 한 번 통지한다. 후보 실패는 기존 실행 유지, 승격 후 worker 실패는 최신 상태/처리 중 이벤트 재생, 연속 복구 실패는 health/ready 503이다.
- 계약: `hotSwap:true`, worker generation/sequence/revision/교체 계측 추가. loopback 전용 토큰 인증 `POST /internal/worker/swap`, `npm run swap:minimal`. wire protocol 1·50ms snapshot·100ms 타인 보간·seq/fix는 유지한다. [Claude 전달 계약](handoffs/2026-10-08-worker-contract.md)에 정상 배포는 재접속 콜백/장애 화면을 유발하지 않으므로 프런트 변경 불필요라고 정리했다. 재연결 관련 NEEDS-DECISION은 없다. 외형·입장 위치 보류는 유지한다.
- 검증: 최소 단위 **17/17**, 실제 PB/Colyseus 회귀 **6/6**, 기존 서버 단위 **32/32**, `npm run build` 통과. [검증 보고](reviews/2026-10-08-worker-swap-verification.md)에 재현 명령·실패 증거·한계를 기록했다.
- 실제 100명: `.test-work/minimal-hotswap-1SyljF/report.json`, **43,100 입력·9회 교체**, 연결 종료/입력 누락/예상하지 않은 fix/위치·점수 되돌림 0. 정산 뒤 outbox 0/0, 지갑·원장 일치. 교체 snapshot p95/p99/max **54.47/60.88/80.94ms**, ack **49.66/54.42/76.81ms**, 권한 전환 최대 **1.83ms**. 50ms는 주기이며 모든 도착 간격의 상한은 아니다.
- 실제 두 브라우저: ego로 입장·이동·서로 보기·화면과 실제 끊김 안내 확인. 비활성 ego 탭의 동시 렌더 계측이 유효하지 않아 사용자 허용 Chromium 1193으로 보완했다. `.test-work/minimal-hotswap-0uoaEw/browser-report.json`: **6회 교체·각 221 입력**, 장애 화면/끊김/보정/예측 불일치/stale 0, 100ms 타인 보간 각 658/659프레임. snapshot 최대 **65.1ms**, ack 최대 **51.6ms**, pending 최대 1·종료 0.
- 실패 기록: 첫 합성 봇 workload의 경로/왕복 종료 결함은 검사 코드를 고쳐 재검증했다. ego 동시 계측 실패를 통과로 집계하지 않았다. 별 접촉 지연은 표본이 적고 예비 검사에서 정산 포함 최대 152.65ms가 있었으므로 모든 획득 지연을 1틱 이내라고 보장하지 않는다.
- 보존: 5270/18120/12620 PID **56559/56557/56558** 유지, 기존 DB/사용자 작업/개발 세션 보존. 새 검증 서버 5272/18122/12622 등 검사 소유 프로세스만 종료했다. 기존 12620은 새 코드를 로드하지 않아 계속 `hotSwap:false`다. 운영 서버 접근·배포·commit/push는 없음.
- 최종 문서 확인: 관련 문서 로컬 링크 **43개** 유효, 변경 코드 구문 검사·`git diff --check` 통과.
- 남은 일: 최초 접속 계층 도입 및 운영 검증/배포는 별도 사용자 지시 후 진행한다. 이번 증거는 호환 worker 교체의 로컬 검증이며 운영 100명·30분, PB 업데이트·호스트 재부팅·접속 프로세스 손실·전체 게임 기능을 보장하지 않는다. 메인 체크아웃과 같은 세션을 유지하며 다음 요청을 기다린다.

### 룸 정원 100명 (2026-10-07)

- 사용자 요청: 광장·정원·오락실의 방당 정원을 32명에서 100명으로 변경하고 운영 배포.
- `ROOM_CAPACITY`를 서버 정원·인증 메타데이터 검증·PocketBase 시드에 공통 적용. 기존 `rooms` 스키마 최대값과 장소 3개 행을 멱등 갱신하며 ID·제목·접근 규칙은 유지.
- 진행 중 이벤트의 65번째 이후 합류자도 점수를 얻도록 등록 제한을 제거. 퇴장한 0점 항목만 삭제해 누적 메모리를 제한하며, 기존 점수·정산 상한 64는 유지.
- 배포는 Colyseus 정상 종료·재기동이 필요하므로 순간 단절이 발생한다. 프런트 자동 재접속은 기존 구현을 사용한다.
- 실제 검증·배포 결과는 `verification.md` 최신 절에 기록한다.

### 프런트 컴포넌트 분리·중복 정리 (2026-10-04)

- 사용자 요청: 구조·컴포넌트·재사용 로직 검토 후 리팩토링. 동작·DOM·클래스명은 바꾸지 않았다.
- `main.jsx` 656줄 → App만 남김. 화면 조각은 `game/src/components/`로, 장소 목록은 `zones.js`로 옮겼다. 모달 틀 `Sheet`, 캔버스 훅 `usePixels`, `useStored`(localStorage 상태), `clearRoute`·`stopInput`·`myPos`·`canAct`·`shopPost`로 반복을 묶었다. `render.js`는 그림자·좌우 반전 그리기를 `shadow`·`blit`로 묶었다.
- 남긴 것: 접속·입력·렌더 effect는 ref 20여 개를 공유하므로 커스텀 훅으로 떼지 않았다. oxlint 경고 15건은 의도된 코드나 스타일이다.
- 검증: build, `npm --prefix colyseus test` 31/31, 로컬 `ui-check` 8/8(대체 포트, ego lite Chromium). 첫 전체 실행에서 `click_move` 1회 실패했고 단독 재실행은 리팩토링 전·후 각 2/2, 전체 재실행 8/8 PASS였다(기존 간헐 실패로 판단).
- 배포(2026-10-04): Pages 자동 배포 후 공개 주소 번들 해시가 로컬 `build:remote`와 일치. 사용자가 `scripts/deploy-macmini.sh` 직접 실행, 원격 `town.js` sha256 일치, 공개 health 4곳 200. SSH 기본 호스트를 MagicDNS `mac-mini.tailc386bf.ts.net`으로 바꿨다(known_hosts에 같은 키로 이름 추가).

### 클릭 이동 8방향·걷기 들썩임 제거 (2026-10-03, `76cc1e4`)

- 사용자 보고: 마우스 이동 시 한 걸음마다 화면이 떨린다(키보드는 덜함). 일반 걸음도 털린다.
- 원인: (1) 걷기 프레임이 몸을 1px 올려 약 8Hz로 3px씩 떨렸다. (2) 클릭 경로의 임의 각도 구간에서 정수 픽셀 카메라가 x·y를 서로 다른 박자로 움직였다. 카메라 역행은 0회였다.
- 변경: 몸 높이 고정, 클릭 경로를 키보드와 같은 8방향(대각+직선)으로 나눔, `routeStep`(TECH_SPEC 클릭 이동). 단위 31/31, 로컬 브라우저 클릭 5회 8방향 프레임 93–99%·보정 0. 사용자 확인 후 Pages·Mac mini 배포, 공개 health 정상, 배포 주소 `remote-click` 10/10 PASS(재실행).
- 남은 일: 배포 주소 `remote-click` 첫 클릭이 3회 중 2회 도착하지 못했다(이후 9/9 도착). 끝 위치가 입구 옆(+16도트)이었다. 추정: 입구에 다른 세션(직전 실행의 재접속 대기 15초)이 있어 서버가 나를 옆에 세웠고, 연결 중 걸은 걸음이 거절(`fix`)되어 입구 옆으로 되돌아갔는데 경로는 이미 다 소모되어 다시 걷지 않았다. 연결 중 걷기(`bf0a56c`)부터 있던 동작으로 보며 이번 변경과 무관하다. 대책 후보: `fix` 되돌림 때 목적지가 남아 있으면 경로를 다시 찾는다.

### 장소 이동 즉시 표시·걷기 속도 (2026-10-03)

- 사용자 보고: 장소 이동이 느리고, 방 가운데를 비추다가 캐릭터가 나타나야 입구로 카메라가 간다. 요청: 걷기 속도 올리기.
- 원인: 새 방 연결(매칭 HTTP 0.8–1초 + WebSocket 0.7초 + 첫 snapshot 0.3초, 배포 경로 핑 300ms에서 약 1.9초)이 끝나야 내 위치를 알았고, 그동안 카메라는 맵 기본 위치를 비췄다.
- 변경: 입구에 바로 그리고 연결 중에도 걷는다(TECH_SPEC "로컬 우선 이동"의 장소 입장). 걷기 속도 60 → 80px/s. 측정 도구 `tests/zone-check.mjs` 추가. verification 24절.

### 로컬 우선 이동 전환 (2026-10-03, 커밋 `bbb7776` 이후)

- 사용자 결정(2026-10-03): "로컬 우선 + 서버 검증"으로 전환. ADR-005, TECH_SPEC "로컬 우선 이동", verification 23절.
- 완료·배포: 브라우저가 내 위치를 정하고 `move {x,y,seq,fix}`를 보낸다. 서버는 한 걸음 6도트·빈 자리·속도 허용량만 검사하고 어기면 `fix`로 되돌린다. 별은 서버가 판정한다. 대기열·크레딧·예측 대기·`input` 메시지 제거. 다른 플레이어는 `ack` 걸음 단위 재생(`game/src/playback.js`). `maxMessagesPerSecond` 40 → 120. Mac mini 배포(`scripts/deploy-macmini.sh`)와 Pages 배포 완료.
- 측정 도구 지연 흉내(`JITTER`)의 입장 시간 초과 원인은 도구가 SDK 버퍼를 복사하지 않은 것이었다. 고쳤다. 이제 JITTER 1000·1500도 측정된다.
- 남은 일: (1) 근본 경로 대책(서울 VPS 또는 Tailscale Funnel) 사용자 결정 대기. (2) 배포 주소 others-check에서 1회 보는 쪽이 이동을 전혀 못 받은 일(재현 안 됨, `walkerSide` 진단 추가). (3) 구 버전 탭은 `input`을 보내면 끊긴다. 새로고침하면 된다.


### 세션 인계 (2026-10-03, 커밋 `085fa47` 이후)

- 이전 Claude 세션은 사용자 지시로 새 세션(main 체크아웃)에 넘겼다. 이번 세션 완료(모두 배포·검증, 세부는 verification 17–22절):
  - 별 수집 히트박스·서버 자동 수집, 지갑 즉시 반영(정산 대기 표시, "+1"), 디자인 M5·M6 승인 기록.
  - 연결 끊김: 화면 차단 대화상자, 같은 세션 재접속(서버 15초 대기) → 실패·무응답이면 자동 새 입장 → 서버 불가일 때만 "다시 연결" 버튼.
  - 이동 롤백: 시간 기반 이동 크레딧, 장소 이동 시 이전 방 메시지·맵 분리, 대기열·크레딧·예측 대기 기준 3초(`MAX_QUEUED_INPUTS=60`, shared/world.js), 먹은 별 다시 보임·대각선 카메라 튐 수정.
  - 핑 표시, 끊김 기록(`/health` `connections`, Mac mini `server.out.log`), GitHub Actions `health` 10분 외부 감시.
- 핵심 진단: `pixeltown-rt`·`pixeltown`·`pixeltown-pb`(Cloudflare 무료 요금제)는 한국에서 LAX 접속점으로 가서 핑 약 280ms, 저녁에는 100–1460ms로 출렁인다. 대시보드 설정으로 못 바꾼다. 이 컴퓨터의 Unicorn HTTPS VPN은 원인이 아니었다(꺼도 LAX). 사용자 지시: VPN이 없다고 보고 가장 나쁜 연결에서도 동작하게 할 것.
- 사용자 결정 대기:
  1. 근본 해결 방향: 서울 VPS 앞단(Caddy, Tailscale로 Mac mini Colyseus) 또는 Tailscale Funnel 지연 측정(Mac mini 설정 변경이라 허락 필요). 집 서버 직접 공개는 사용자가 위험하다고 보류.
  2. 결정·완료(2026-10-03): "로컬 우선 + 서버 검증" 전환. 위 절 참고.
- 완료(2026-10-03): 다른 플레이어 표시 완충 자동 조절(걸음 단위 재생). 이전 기록: 측정 도구 `tests/others-check.mjs`(WALKER·WATCHER·JITTER). 큰 JITTER(600·1000)는 핑이 1초를 넘을 때 입장 단계 시간 초과로 측정을 끝내지 못했다.
- Oracle A1 예약(Mac mini `net.fastmake.pixeltown-a1-retry`)은 매시 0·30분 실행 중이며 2026-10-02 22:30까지 38회 모두 `Out of host capacity`. 읽기만 했고 변경 금지.
- 테스트 도구(새로 추가): `tests/rollback-check.mjs`(보정 0 기준, ZONE·SECONDS·HOPS·JITTER), `tests/offline-check.mjs`(4경우, STALE_AFTER), `tests/wallet-check.mjs`(SETTLE_MS), `tests/motion-check.mjs`(JITTER·ZONE, 보정·되돌아감 지표), `tests/remote-pickup.mjs`. 배포 주소 측정은 Tester 2 계정(Tester 1은 끊김 검사용)으로 한다.
- 로컬 개발 서버는 모두 꺼져 있다. 필요하면 10절 명령으로 띄운다. Mac mini 배포는 `scripts/deploy-macmini.sh`, Tailscale 경로가 빠졌으면 `PATH="$PWD/.test-work/bin:$PATH" scripts/deploy-macmini.sh`(`tailscale nc` ssh 래퍼, git 제외). Mac mini: `mac-mini.tailc386bf.ts.net`(100.92.43.82, LAN 192.168.0.204), 이 컴퓨터: `cheng80-macbookair15.tailc386bf.ts.net`(100.105.34.114). SSH는 MagicDNS 이름으로 접속한다(2026-10-04 사용자 지시). known_hosts에 이 이름이 있어야 한다(`BatchMode`).
- 자격증명은 git 밖 0600 파일에만 있다: `pocketbase/.local/remote-accounts.json`(Tester 1·2), `pocketbase/.local/remote-admin.env`(검증용 관리자). 출력·커밋 금지. 원격 SSH 키는 ssh 실행에만 쓰고 내용을 읽지 않는다.
- 금지 경계: `cheng80@gmail.com` 관리자 비밀번호 재설정, stonematch(8090)·Oracle A1 예약·다른 터널·`cloudflared` 설정, 원격 DB를 로컬 `pb_data`로 덮어쓰기, 공개 터널 부하 테스트. 원격 DB 변경 전에는 SQLite `.backup`으로 백업한다. 실제 방문자가 찍힌 스크린샷은 커밋하지 않는다.

변경하면 안 되는 경계: 운영 PocketBase·Oracle 작업·외부 브로커·클라우드 인증에는 접근하지 않는다. 개발 launcher는 기본 18090/12567/5173(환경변수로 변경 가능)을 loopback으로만 사용하고 포트 점유 시 시작을 거부한다. 재제작 브랜치 worktree 검증은 5273/18190/12667을 썼다. 병합 후 main 체크아웃은 기본 5173/18090/12567로 실행하고, 통합은 18191/12668을 쓴다. main을 fast-forward한 뒤에는 `npm install && npm --prefix colyseus install`(병합으로 `galmuri` 추가)을 하고 개발 서버를 재시작해야 한다. 구 실행이 남아 있으면 이전 코드를 서비스한다. `.env.local`, `.local`, DB, 다운로드 바이너리와 node_modules를 공개 저장소에 넣지 않는다.

주요 파일은 `shared/world.js`(맵·충돌·미니룸 정본), `shared/catalog.json`(상점 정본), `pocketbase/pb_hooks/shop.pb.js`·`shop_lib.js`, `game/src/main.jsx`(App·접속·입력·렌더 루프), `game/src/components/`(Chat·Shop·Notebook·CharacterSetup, 공용 `Pixels.jsx`의 Portrait·ItemIcon·Sheet), `game/src/zones.js`, `game/src/render.js`, `game/src/sprites.js`, `colyseus/town.js`, `colyseus/outbox.js`, `pocketbase/pb_hooks/matches.pb.js`, `scripts/init-pocketbase.mjs`, `tests/integration.mjs`, `tests/ui-check.mjs`다. 실제 명령은 루트 README에 있다. 맵을 고치면 `npm --prefix colyseus test`가 연결성·footprint 규칙을 자동 검사한다. Colyseus는 `shared/`를 import하므로 맵 수정 후 서버를 재시작해야 프런트와 판정이 일치한다.

UI에서 `sort:-created` 조회가 400인 문제를 발견했다. 신규 PocketBase collection에 날짜 필드가 없었던 원인으로, seed가 기존/신규 schema의 created/updated autodate를 보완하도록 수정했다. 재seed 후 프로필 조회·기록 패널 오류 0을 확인했다. 이전 실패 증거는 최종 검증의 성공으로 덮어 쓰지 않고 이 원인과 수정을 보존한다.

## 8. 변경된 계약

- 로컬 우선 이동(2026-10-03, ADR-005): C→S `input` 제거, `move {x,y,seq,fix}` 추가. player에 `fix`. snapshot의 서버 시각 `t` 제거. `MAX_QUEUED_INPUTS` 제거, `MAX_HOP`·`MOVE_SLACK`·`MOVE_BURST_MS` 추가(shared/world.js). `maxMessagesPerSecond` 120.
- 이동 크레딧(2026-10-02): 서버가 틱 횟수 대신 실제 흐른 시간(50ms당 1, 최대 20 = 1초)으로 이동 크레딧을 준다. 클라이언트는 미확인 입력이 16개면 예측을 멈춘다(`MAX_QUEUED_INPUTS`, shared/world.js). 클라이언트는 떠나는 방의 메시지를 무시하고 방마다 자기 장소 맵으로 예측·재적용한다.
- 연결 끊김(2026-10-02): 서버 `onDrop`이 끊긴 플레이어를 15초(`RECONNECT_SECONDS`) 동안 남기고 SDK 재접속을 받는다. 그 사이 같은 사용자의 새 입장은 대기 세션을 정리하고 받는다. 입력 대기열 상한 6 → 20(`MAX_QUEUED_INPUTS`). 클라이언트는 끊기면 화면 전체를 막는 대화상자를 띄우고 입력을 막는다. 같은 세션 재접속 → 거절·무응답이면 자동 새 입장 → 그것도 실패하면 버튼 순서로 복구한다. 카메라는 원본과 같이 고정(데드존·댐핑은 시험 후 쓰지 않음). TECH_SPEC 마지막 절.
- 별 수집 히트박스(2026-10-02): `COLLECT_RADIUS` 제거, `BODY_BOX`·`STAR_BOX`·`touchesStar` 추가(shared/world.js). 서버가 매 틱 자동 수집하고 클라이언트는 `collect`를 보내지 않는다(서버는 구 버전용으로 계속 받는다). 화면은 닿는 순간 별을 숨기고 1초 안에 서버가 지우지 않으면 다시 보인다. TECH_SPEC 마지막 절.
- PLAN-005: `profiles.avatar` json 필드, `POST /api/pixeltown/profile`, snapshot `look`에 `skin/hair/style`, `look` 메시지가 이름·옷 색도 갱신, `shared/catalog.json`에 `avatar` 선택지(렌더러의 피부·머리 색 상수 이동). 프로필에 외형이 없으면 클라이언트가 방 입장 전에 캐릭터 화면을 띄운다. `scripts/deploy-macmini.sh`가 원격 스키마 추가분도 반영한다.
- PLAN-004: Colyseus 0.16 → 0.18.18, 클라이언트 `colyseus.js` → `@colyseus/sdk 0.18.4`. 토큰은 join 옵션의 `token`이 아니라 `client.auth.token`(서버 `context.token`). 서버에 express·`/health/pocketbase`·`/me`·`/monitor/`(PB superuser)·`ALLOWED_ORIGINS` 추가, `/health`에 `service`. 환경변수 `POCKETBASE_URL`·`PORT`·`PB_ADMIN_*`(프로세스 환경 우선)·`MONITOR_ORIGINS` 인식. `seed(_, {remote:true})`, `provision-accounts.mjs`, `deploy-macmini.sh`, `.env.remote`·`npm run dev:remote`, 훅 카탈로그 경로 `pb_hooks/catalog.json` 우선. `vendor/nanoid`와 그 단위 테스트 제거.
- 2026-10-02 재개: 정면 볼 때 펫을 주인 옆에 배치, `colyseus/vendor/nanoid` override(PLAN-004에서 제거), 통합 opt-in `hundred_client_local_room_split`, `scripts/dev.mjs`·`dev-backend.mjs`가 자식 종료를 기다린 뒤 끝나도록 변경(PocketBase 종료가 늦을 때 포트가 남아 재시작이 거부되던 문제).
- PLAN-003: `startGame` 메시지 제거, 별 30초 라운드 → 상시 이벤트(6초 생성·3분 정산·0점 미기록·별 유지). 메시지 `look` 추가, player에 `look`, game에 `id`. PB `purchases` 컬렉션과 profiles `outfit`/`room` 필드, `/api/pixeltown/shop/{buy,equip,room}` 훅. `shared/catalog.json` 추가. 구 `scripts/verify-backend.mjs`·`verify-stars.mjs` 제거(통합 테스트로 대체).
- 재제작(PLAN-002): 월드 960×640 단일 지형 → 장소별 640×416 타일맵. 수집 거리 32 → 16도트, 서버 틱 100 → 50ms, 이동 3도트/틱. `joinOrCreate` 옵션에 `entry` 추가(고정 입구 이름만 허용). 충돌 정본이 `colyseus/town.js`에서 `shared/world.js`로 이동.

- 추가 요청에 따라 root/game, root/pocketbase, root/colyseus, root/docs 형제 구조로 재배치했다. 기존 개발 DB·바이너리·관리자 파일은 pocketbase로 보존했으며 outbox는 colyseus에 보존했다.
- 별 생성은 초기5·6초(`STAR_SPAWN_INTERVAL_MS` 기본 6000)마다1개·방별 미회수12개 상한, 회수 후 다음 주기 보충이다. 3분(`GAME_DURATION_MS` 기본 180000)마다 정산하고 별은 유지한다. 누적 burst와 별0개 즉시 종료를 하지 않는다. DB는 개인/전체 점수 합계64 상한으로 저장을 검증한다. 통합 테스트만 1.5초·30초로 단축한다.


- 최신 Colyseus 문서의 static JWT 훅을 기본 사용하지 않는다. 설치 0.16의 인스턴스 `onAuth(client, options)`에서 PocketBase 토큰을 검증한다.
- `gameEnded`는 outbox 디스크 저장 완료이며 PB 저장 완료가 아니다. `snapshot.persistence.status`가 saved로 전환될 때 기록을 조회한다.
- 회원가입은 이번 데모에서 제공하지 않는다. 초기 계정과 기존 계정 로그인을 지원하며 일반 사용자의 users 직접 쓰기는 차단한다.
- 채팅은 사용자 요청으로 배경 alpha 설정과 접기/펼치기, 미확인 수를 제공한다. 텍스트 opacity는 1이다.

## 9. 검증 상태

| 항목 | 결과 | 근거 | 날짜 | 리비전 | 유효성 | 출처 / 공백 |
|---|---|---|---|---|---|---|
| 로컬 우선 이동: 단위 30, 통합 17, 로컬 JITTER 1000·1500 브라우저, 배포 주소 rollback·motion·others | PASS(others-check 멈춤 기준만 FAIL, 튐 0) | RECHECKED | 2026-10-03 | `bbb7776` | CURRENT | verification 23절 |
| 단위 18개(Colyseus 0.18 서버) | PASS | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | `npm --prefix colyseus test` |
| 통합 15개 + 100명 opt-in 1개(0.18, 별도 포트 18191/12668) | PASS | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | `tests/report.json`. PB 0.39.7 바이너리로도 15/15 |
| 브라우저 UI 7개(로컬 5273) | PASS | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | `tests/ui-report.json`, `docs/assets/`, verification.md |
| **원격** Mac mini 2유저 기능·보안·기본 3분 정산·상점·미니룸·Monitor | PASS 7/7 | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | `tests/remote-report.json`, verification 10절 |
| **원격** 멱등·충돌·롤백, outbox 장애·재시작 복구 | PASS | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | `tests/remote-persistence.mjs`, `PIXELTOWN_REMOTE_OUTAGE=1` |
| **원격** 로컬 프런트 원격 모드 2유저 | PASS | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | `tests/remote-ui.mjs`, `docs/assets/remote-lobby-two-users.png` |
| 깊이·충돌·맵 AC-014/015 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 실제 클릭·방향키 이동 좌표와 앞/뒤 스크린샷 |
| 도트 스케일·4 뷰포트 AC-011/016 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | scroll=viewport, 정수 배율 3/6, smoothing false |
| 상시 별 이벤트·기본 3분 정산 AC-007/008/013 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 브라우저 기본값, 통합 단축값 |
| 상점·옷장·펫·미니룸 AC-017–019 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 통합 위조·동시 구매, 브라우저 2유저 |
| 클릭 이동·큰 채팅 AC-020 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 채팅 위 클릭·키 취소·막힌 곳 |
| 빌드 | PASS | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | `npm run build`, JS 501KB |
| 미니룸·정면 펫 가림 수정 | PASS | RECHECKED | 2026-10-02 | `5899605`+재개 수정 | CURRENT | UI `petFacingDown` dx −14, 스크린샷 |
| npm audit(루트·colyseus·원격 app) | PASS | RECHECKED | 2026-10-02 | `576b261`+PLAN-004 | CURRENT | 0건 |
| 100명 로컬 채널 분할 | PASS | RECHECKED | 2026-10-02 | `5899605`+재개 수정 | CURRENT | `PIXELTOWN_LOAD_100=1`, `tests/report.json` load100 |
| launcher 종료 시 포트 해제 | PASS | RECHECKED | 2026-10-02 | `5899605`+재개 수정 | CURRENT | SIGTERM 후 launcher 종료 시점에 3포트 비어 있음 |
| 캐릭터 만들기·닉네임 유일성(로컬 단위·통합·UI) | PASS | RECHECKED | 2026-10-02 | PLAN-005 커밋 | CURRENT | verification 11절: 단위 20, 통합 17(+PB 0.39.7 16), UI 8 |
| **원격** 캐릭터·닉네임·기능 전체 | PASS 8/8 | RECHECKED | 2026-10-02 | PLAN-005 커밋 | CURRENT | `tests/remote-report.json`, `tests/remote-ui.mjs` |
| 원격 별 회수 실패(경로 탐색 버그) 수정 | PASS | RECHECKED | 2026-10-02 | PLAN-005 커밋 | CURRENT | 원격 걷기 진단 10/10, 단위 회귀 테스트 |
| 남은 문제 1·2·3(셋업 실패 원인, 원격 클릭 지연, 닉네임 띄어쓰기) | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | verification 12절, 원격 클릭 20/20 |
| 게스트 자동 가입·첫 화면(PLAN-006) 로컬·원격 | PASS | RECHECKED | 2026-10-02 | PLAN-006 커밋 | CURRENT | verification 13절 |
| 게스트 남용 방지(발급 제한·기본 rate limit·30일 정리) 로컬·원격 | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | verification 14절 |
| 주소 이전(PB→pixeltown-pb)·Cloudflare Pages 배포(pixeltown.fastmake.net) | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | verification 15절, SERVER_OPERATIONS 10절 |
| 부드러운 이동(예측·보간·카메라 고정) | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | `tests/motion-check.mjs` 원격 화면 위치 5–6개 → 1개 |
| 운영 정리(원격 백업 통합·불필요 파일·테스트 데이터, 로컬 정리, 검사 자동 정리) | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | SERVER_OPERATIONS 11절, 재배포 후 health·원격 UI·원격 검사 8/8 |
| 검증용 관리자로 Monitor 관리자 로그인 | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | `tests/remote-check.mjs` monitor_admin_only |
| 별 수집 히트박스·서버 자동 수집·화면 즉시 숨김 | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | verification 17절: 단위24·통합17·UI8·원격8/8·원격 수집 5/5(서버 확인 160–297ms)·배포 주소 수집 5/5 |
| 연결 끊김 차단·자동 재접속·불안정 연결 떨림(입력 대기열 20) | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | verification 18절: 단위26·통합17·UI8·원격8/8, `offline-check` 4경우 PASS(로컬·배포 주소), `JITTER=0/300/600 motion-check` 보정 0 |
| 이동 위치 롤백(시간 기반 크레딧 상한 1초·장소 이동 시 이전 방 메시지·맵·연결 멈춤 시 예측 중지) | PASS | RECHECKED | 2026-10-02 | `abebbb7` | CURRENT | verification 19절, `rollback-check` 배포 주소 오락실 60초 0·0, 지연 300ms 0, 로컬 지연 1.5·3초 0 |
| 지갑 즉시 반영·정산 대기 표시·+1 | PASS | RECHECKED | 2026-10-02 | `323faf7` | CURRENT | verification 20절, `wallet-check` 로컬·배포 주소 |
| 핑 표시·끊김 기록·외부 감시 | PASS | RECHECKED | 2026-10-02 | 해당 커밋 | CURRENT | 단위 29/29(끊김 집계), 로컬 offline-check 로그·`/health`, UI 8/8, Actions 수동 실행 |
| 디자인 승인 | PASS | USER | 2026-10-02 | `b69fbcb` | CURRENT | 사용자 승인(배포 주소 화면 기준) |
| 실제 모바일 기기·키보드 | NOT_RUN | NONE | - | - | UNKNOWN | 에뮬레이션만 |
| 공개 경로 부하·인터넷 지연·한 화면 100명·관리자 Monitor 로그인 | NOT_RUN | NONE | - | - | UNKNOWN | 정책상 금지 또는 관리자 암호 미사용 |

거절판(`9bc3d66`)의 화면 증거는 삭제했고 백엔드 검증은 위 재실행으로 대체했다.

2026-10-02 재개 재확인: main `965d266` 체크아웃에서 단위18·통합15(18191/12668)·UI7(기본 포트 5173/18090/12567, 기본값 6초·3분)·build를 직접 다시 실행해 모두 통과했다. 이전 기록(`a714104`)을 옮겨 적은 것이 아니다. 재개 중 발견한 실행 장애: 04:40에 시작된 구 `dev:all`이 병합 전 코드로 기본 포트를 점유하고 있었고, fast-forward 뒤 `galmuri` 미설치로 `npm run build`가 실패했다. 이 체크아웃 소유 프로세스만 종료하고 `npm install` 후 재시작해 해결했다. 개발 DB는 재시작 전에 `pocketbase/.local/pb_data.backup-20261002-1100`으로 복사했고 seed는 기존 데이터를 지우지 않는다. UI 검증은 개발 DB에 일회용 `ui-*@pixeltown.local` 상점 계정을 만들고 demo1/demo2 기록을 추가한다.

## 10. 재개 명령

```sh
npm install && npm --prefix colyseus install
npm run dev:remote   # 원격 모드: http://127.0.0.1:5173 → Mac mini (계정: pocketbase/.local/remote-accounts.json)
PIXELTOWN_PB_PORT=18190 PIXELTOWN_GAME_PORT=12667 PIXELTOWN_WEB_PORT=5273 npm run dev:all   # 독립 로컬 모드: http://127.0.0.1:5273, demo1/demo2
npm --prefix colyseus test
PIXELTOWN_TEST_PB_PORT=18191 PIXELTOWN_TEST_GAME_PORT=12668 npm run test:integration   # PIXELTOWN_LOAD_100=1, PIXELTOWN_PB_BINARY=…/pb-0.39.7/pocketbase 선택
CHROME_PATH=/path/to/chromium PIXELTOWN_WEB_PORT=5273 PIXELTOWN_PB_PORT=18190 node tests/ui-check.mjs   # UI_ONLY=shop 처럼 일부만
npm run build
node tests/remote-check.mjs                              # 원격 2유저 기능(약 4분, 기본 3분 정산)
CHROME_PATH=/path/to/chromium node tests/remote-click.mjs  # dev:remote 실행 중 실제 브라우저 클릭 이동 도착·반전 측정
CHROME_PATH=/path/to/chromium BASE=https://pixeltown.fastmake.net/ ACCOUNT=email:password node tests/motion-check.mjs  # 이동 중 화면 흔들림 측정
PIXELTOWN_REMOTE_OUTAGE=1 node tests/remote-check.mjs    # 원격 outbox 장애 복구(SSH, PB를 잠시 중단)
CHROME_PATH=/path/to/chromium node tests/remote-ui.mjs  # dev:remote 실행 중 브라우저 2유저
scripts/deploy-macmini.sh                                # 원격 코드 갱신(Colyseus만 재시작)
```
