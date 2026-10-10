# 전체 프런트 OTA 로컬 구현·검증 결과

2026-10-11 (Asia/Seoul). 이후 승인된 [운영 적용·공개 검증](2026-10-11-frontend-ota-production.md)은 별도 기록을 따른다. 아래는 로컬 구현 완료 당시의 상태다. [PLAN-008](../plans/PLAN-008.md) S0~S7의 로컬 구현 결과다. **운영 적용·게시·commit은 하지 않았다.** 아래 "통과"에는 실제 실행한 검사만 적었다. 승인된 로컬 구현·검증은 완료했다. 실제 기기·운영 검증의 한계는5~6절에 둔다.

## 1. 상태 요약

| 항목 | 상태 |
|---|---|
| runtime·surface·bootstrap 분리, 전체 UI entry | 로컬 구현 완료. 단위·실제 PB/game·복구·오프라인 UI 통과 |
| schema2 release·의존 그래프 hash·검증된 Blob JS | 로컬 구현 완료. 최종 소스 production 빌드·Ego 2페이지 짧은 재검증 통과 |
| WebSocket 버전 알림·내부 활성화·durable 상태 | 로컬 구현 완료. 실제 HTTP/SDK 활성화 검사 8개 통과 |
| 게시·공개 파일 확인·receipt | 로컬 가짜 pipeline 19/19 통과. 운영 SSH·Pages 미실행 |
| 2브라우저·20회 교체·worker 교체 | 최종 소스85명10+10분 통과(SFAvNp): SDK2,071,365입력·복구/drop/fix/pending0·seq=ack. 직전 소스 실패(QMbFGN)는4절에 보존 |
| 실패·상태·순서 검사 | 최종 소스 전체24개 검사 통과(초기 실패 회복·12초 본문 기한 포함). IME·pad는 합성 이벤트 |
| 운영 도입 | 미실행. 6절의 설정·결정이 필요 |

## 2. 구현 결과

실행부(브라우저 탭 수명)와 UI release(통째로 교체)를 나눴다. 파일 이름은 기존 패턴을 따랐다.

| 파일 | 역할 |
|---|---|
| `minimal/game/src/bootstrap.js`, `bootstrap.css` | React 없는 부팅 entry. runtime·surface·updater를 만들고 `#root` 아래 release host를 둔다. 페이지 배경·canvas 위치 CSS만 가진다. |
| `minimal/game/src/runtime.js` | 인증·게스트·connection·engine·지갑 재시도·원장·배포 표시·UI 보존 상태. `getSnapshot/subscribe`와 명령(`enter`, `refreshWallet`, `setUI`, `setPad`, `nudge`, `setInteraction`, `bindWorldSlot`, `reportUIError`)만 노출한다. `createUIFacade`가 release별로 회수 가능한 명령 lease를 만든다. |
| `minimal/game/src/surface.js` | 영구 canvas·50ms 이동 tick·rAF·키보드/blur/visibility·canvas pointer. UI의 `.world-slot` 위치를 따라간다. |
| `minimal/game/src/engine.js` | `advanceDisplay`: 타인 재생·방향을 프레임당 한 번 진행한다. renderer 인스턴스 수와 무관하다. |
| `minimal/game/src/visual-update.js` | updater 하나. hint 검증·순서, 단발 current 확인, 후보 준비(SHA 검증 후 Blob import, CSS·글꼴·이미지, 첫 commit, 복제 상태 preview), 안전 시점 교체, 직전 UI 복구·격리, 초기 실패 안내. |
| `minimal/game/src/ui-entry.jsx` | release entry. 자기 React root로 `mountUI`, `createRenderer` re-export. 비활성 상태 명령 차단, 오류 경계·window 오류 귀속. |
| `minimal/game/src/main.jsx`, `WorldCanvas.jsx`, `VisualStatus.jsx`, `style.css` | 화면만 담당. 입력 타이머·연결·canvas 소유를 제거했다. CSS는 release의 open shadow root 안에서만 적용된다. |
| `minimal/game/src/OtaTestScreen.jsx` | `VITE_OTA_TEST_SCREEN=1`일 때만 들어가는 시험 전용 두 번째 화면. updater·서버·배포 코드를 고치지 않고 추가했다. |
| `minimal/game/src/connection.js`, `api.js` | `frontendRevision/frontendCurrent` 수신, 연결 직후·`requestFrontend()` 단발 요청. |
| `scripts/minimal-visual-build.mjs` | schema2 manifest. compatibility = bootstrap 의존 그래프(esbuild metafile) + PB/game URL. revision = compatibility + UI entry 의존 그래프 + 시험 화면 flag + 빌드 스크립트·public 파일. runtime 그래프에 React가 있으면 빌드 실패. |
| `colyseus/minimal/frontend-current.js`, `server.js` | durable `frontend-current.json`, `/health.frontend`, `POST /internal/frontend/activate`, 입장·재접속·요청 시 hint. |
| `scripts/frontend-publication.mjs`, `deploy-minimal-frontend.mjs`, `activate-minimal-frontend.mjs` | 게시 → 공개 current·manifest·전체 파일 SHA 확인 → SSH loopback 활성화. receipt를 단계마다 원자 교체로 기록. |

목표 계약([TECH_SPEC](../02_TECH_SPEC.md#frontend-ota-contract))과 다르거나 구체화한 점:

- 후보 JS는 manifest SHA를 확인한 바이트를 Blob URL로 import한다. 같은 entry 재시도의 최대3회 제한은 유지한다.
- CSS 격리는 release마다 open shadow root를 쓴다. host는 `pointer-events:none`이고 패널만 포인터를 받는다. canvas는 shadow 밖 body에 있다.
- 키보드로 방향패드 버튼을 누를 때의 한 칸 이동은 `nudge(x,y)` 명령으로 추가했다.
- 진단: production에도 읽기 전용 `window.__minimal`(snapshot 복사본, `room:{roomId,sessionId}`, userId, connection 상태)과 `window.__minimalVisual`(updater status·movement)을 둔다. 실제 engine/room은 dev 빌드의 `window.__minimalDebug.engine`에서만 노출한다.
- 입장 후 hint를 하나라도 받으면 단발 current 확인은 목표를 바꾸지 않는다(서버 generation이 우선).
- 활성화 이후 실행 오류가 난 revision은 그 탭에서 격리한다. 같은 revision의 새 generation도 다시 적용하지 않는다.

## 3. 실제 통과한 검사

| 검사 | 결과·자료 |
|---|---|
| `npm run test:minimal:unit` | 60/60 (`.test-work/ota-20261011/final-unit.log`, 최종 runtime 인증 타이머 순서 포함) |
| `npm run test:minimal:frontend` | 실제 HTTP/SDK 활성화 8개 + 게시/네트워크 19/19 (`final-frontend.log`). 공개 확인 불가는 `publication:unknown`, 활성화 0회 |
| 빌드 의존 그래프 | 8/8 (`build-graph.log`) |
| S1 게이트(같은 기존 UI를 runtime으로) | 실제 PB/game 통합6, 복구8, 오프라인 UI(1280/390px) 통과 (`s1-*.log`, `minimal-integration-1rFGjf`, `minimal-recovery-JDRgbH`) |
| 짧은 실브라우저 OTA | `.test-work/frontend-ota-DOjtOW/report.json` PASS: production 빌드, Ego 2페이지 + SDK2명, A/B 20회 전체 UI 교체 + 10회째 worker 교체. 두 페이지 navigation1·drop/failure/cover0·pending0·seq=ack(124, 151)·canvas1·root≤2·applied21·rollback0. 무변경 baseline 1.5초 동안 버전 HTTP 0건 |
| UI entry 스모크 | 가짜 runtime·Chromium으로 candidate 명령0, 활성화 후 slot bind, 390px pad 순서, dispose 명령0, 오류 시 reject (`frontend-result.md`) |
| 최종 소스 회귀(cp2) | Grok 재실행 단위60/60·실제 활성화8·게시/네트워크19/19·오프라인UI PASS (`grok-unit.log`, `grok-frontend.log`, `grok-ui.log`) |
| 최종 소스 짧은 OTA·fault | `.test-work/frontend-ota-NBY0zb/report.json` PASS. SDK2명·Ego2페이지·20회 전체 UI 교체+worker 교체·전체24개 검사(초기 manifest503 회복·12초 본문 기한 포함). 최종 drops/failures/fix/pending/cover0·seq=ack, navigation1·canvas1·roots2, 입력 타이머/그리기 루프 각각1. 무변경2초 버전HTTP0 |
| PB 재시작+브라우저 | `.test-work/minimal-pb-restart-DhdmSh/report.json` PASS. hooks 교체·PB 강제 종료·잘못된 hooks 복구 각각13.107/12.136/12.319초, SDK794입력·850snapshot·drops/fix0. 브라우저 같은 room/session·ack793·drops/errors/fix/cover0·최대snapshot75.7ms |
| worker 교체 SDK100명 | `.test-work/minimal-hotswap-Tb6z20/report.json` PASS. 9회 교체·42,400입력·drops/예상 밖fix0. 별도 브라우저 재생 계측 단언은 실패했고 아래7절에서 caller 수정 후 YWJfHw로 재검증 통과 |
| 수정worker 브라우저 caller | `.test-work/minimal-hotswap-YWJfHw/browser-report.json` PASS. Chromium1193 두 페이지·6회 worker 교체·각221입력, 현재 playback 중간점633/638프레임·좌표오류0. drops/errors/fix/cover/pending0·같은 room/session, 교체 중 snapshot최대59.4ms·ack최대53ms |

짧은 실행의 무폴링1.5초/2초는 PLAN의10분 기준이 아니다. DOjtOW는 fault matrix를 포함하지 않았다. NBY0zb의 fault 검사는 정상교체의 실패 누계0과 구분한다(의도한 실패·rollback을 집계).

## 4. 85명 장시간 실행: 최초 실패·최종 통과

### 4.1. 최종 이전 소스: 실패

`.test-work/frontend-ota-QMbFGN/report.json`, 로그 `.test-work/ota-20261011/s6-full.log`. 02:07:21 시작. 사본 SHA 대조 결과 그 뒤 바뀐 `runtime.js`(인증 타이머), `visual-update.js`(초기 실패 안내), `minimal-visual-build.mjs`(그래프 hash), `frontend-publication.mjs`(unknown 구분)가 들어 있지 않다. 아래는 **직전 소스의 근거**다. 같은 이유로 12초 본문 기한·초기 manifest 실패 회복 검사는 이 실행에 없다.

| 항목 | 결과 |
|---|---|
| 무변경 10분(SDK85명+Ego2페이지) | 버전 HTTP 요청 0건 |
| 20회 전체 UI 교체 + 10회째 worker 교체 | 매 교체 단언 통과: 두 페이지 session·fix 유지, canvas 동일·1개, root≤2, 초안 유지 |
| 4-1 fault matrix 19개 | 통과: 초안·선택(2~4)·스크롤160 복원, 새 CSS·이미지 픽셀·글꼴4 loaded, manifest404/잘못된JSON/JS503/CSS·글꼴·이미지503/hash 불일치/후보 명령 거절/preview 오류/활성화 그리기 오류는 기존 UI 유지, 잘못된 JS는 3회 후 정지, 늦은 실행 오류는 현재 상태로 rollback·격리, compatibility 거절, IME·pad(합성 이벤트) 보류, 새 hint의 늦은 후보 취소, 같은 generation 재전송 무요청, dispose 오류 무중단 |
| 최종 단언 | **실패**. SDK85명 전원이 정확히 1회씩 `prediction-limit`(미확인 입력60개=3초) 같은 세션 복구를 했다. 브라우저 p2도 13~14번째 교체 기록 사이에 1회. 모두 fix0·보정0·pending0·seq=ack, navigation1·장애 덮개0, p1은 복구0 |

전원이 같은 횟수로 복구한 것은 한 시점에 서버 확인이3초 이상 멈춘 것과 맞는다. p2의 복구는13번째 교체 표본 뒤·14번째 표본 전이며10번째 worker 교체 직후는 아니다. 정확한 발생 시각과 서버 기록이 없어 원인은 **미확정**이다. `snapshot` 핸들러 미등록5499줄은 재접속 후 등록 전 도착한 메시지일 가능성이 있으며 최초 정체 원인으로 단정하지 않는다. 공개30분의 응답 정체2건과 같은 원인인지도 확인하지 않았다.

harness에 단계 시각(`timeline`), SDK 복구 시각·단계(`recoveries`), 시험 프로세스 지연(`lagMs`), 1초 loopback health 표본(`health`, 진행 중 요청 중복 금지·900ms 기한), `game.log`를 추가했다. 제품 코드와 판정 기준은 바꾸지 않았다. `MINIMAL_CONNECTION_OBSERVER=1`이면 서버 계측을 시험 state의 `diagnostics/connections.jsonl`에 남긴다.

### 4.2. 최종 소스 재검증(cp4): 통과

`.test-work/frontend-ota-SFAvNp/report.json` **PASS**, `grok-long-cp4.log`의 종료코드0. baseline은02:56:05 KST, UI교체는03:06:05, worker교체는03:10:36, fault는03:16:05, drain은03:16:41이다. runtime·worker·빌드 제품 코드는 최종 짧은 검사 이후 변경하지 않았으며, 시험계측·worker브라우저 caller만 보완했다. 실행 전후 `claude-checkpoint/cp4-code-sources.sha256`의39파일이 모두 같았다.

| 항목 | 최종 결과 |
|---|---|
| SDK85명+Ego2페이지, 무변경10분 | 버전 current/manifest HTTP0건 |
| 이어진10분, 전체 UI20회 교체+worker1회 | 각 회차 session·fix·canvas 동일/1개·root≤2·초안 보존. 정상교체와 의도한 실패 주입을 구분 |
| 전체 검사24개 | 초기manifest503 회복·12초 본문 기한·상태/리소스/실패/순서/합성IME·pad 포함 통과 |
| SDK 입력 | 2,071,365개. 전원 drops/recovered/failures/fix/pending0, 최종seq=ack, errors0 |
| 두 브라우저 | seq/ack5,265·19,468, drops/recovered/failures/fix/pending/cover0·navigation1·canvas1·roots2·입력timer1·drawloop1 |
| 원인 판별용 기록 | SDK recovery0, health1,258표본·요청오류0·worker recovery0. 시험event-loop 추가지연 baseline최대20ms·교체/worker/fault최대3ms. `game.log`·서버observer 기록 보존 |
| 자원 | heap은각16.6→23.7MB,20.9→26.0MB(기록만, 메모리 무증가 보장 아님). 시험포트5489/12740/18240 LISTEN없음 확인. DB·로그·최초 실패자료 보존 |

이번에는4.1의 정체가 재현되지 않았다. 통과 결과는 이 최종 소스·로컬 실행의 근거이며, 최초 정체 원인이나 과거 공개30분의2건이 해결됐다고 판단하지 않는다. Ego 비활성 탭은 이동tick을 쉬므로 두 탭이20분 내내 같은 양의 입력을 생성한 검사로 표현하지 않는다.

Grok의 최종 검증 인계는 `.test-work/ota-20261011/grok-validation.md`다. 서버observer의 drop2건은 drain 뒤 브라우저가 `about:blank`로 이동하며 생긴 code1001이고, 각 ack가 최종seq와 일치한다. 활동 중 복구/drop과 구분한다. 서버event-loop 표본최대37.8ms, 송신queue최대0, bufferedAmount최대7,444바이트였다.

Claude 구현 인수와 Grok 검증 Task는 모두 `succeeded`로 정산했다. 사용자 세션 보존 지시에 따라 두 terminal을 `worker-retain`했고 종료·archive하지 않았다. 최종 문서 참조156개·`git diff --check` 통과, 시험 소유 프로세스와 Ego space26만 종료했으며 자료·DB·main 변경은 보존했다.

## 5. 남은 검증 한계

- 실제 IME·실제 터치 장치는 검사하지 않았다. fault matrix의 IME·pad는 합성 이벤트다.
- 반복 교체의 heap은 기록만 한다(DOjtOW 24~29MB, QMbFGN 시작27.7~30.8MB·종료24.8~30.6MB, SFAvNp 시작16.6/20.9MB·종료23.7/26.0MB). JS module cache 해제나 무제한 교체의 메모리 무증가는 주장하지 않는다.

## 6. 운영 도입 전 경계

- 최초 runtime 도입은 기존 탭에 들어가지 않는다. 기존 탭의 15초 updater는 schema2 current를 `Invalid visual manifest`로 거절하고 기존 화면을 유지한다(그 탭의 15초 확인과 실패 집계는 새로고침 전까지 계속된다). 새로 입장/새로고침한 탭부터 OTA를 쓴다.
- 서버 환경: `MINIMAL_FRONTEND_ORIGIN`(운영 공개 origin, 미지정 시 `http://127.0.0.1:<WEB_PORT>`), 32바이트 이상 `MINIMAL_FRONTEND_TOKEN`. 게시 측 SSH·토큰 파일 설정은 [활성화 인계](../handoffs/2026-10-11-frontend-activation.md)를 따른다. Git 자동 Pages 게시 뒤 `activate:minimal:frontend` 연결은 운영에서 별도로 해야 한다.
- **NEEDS-DECISION**: 과거 공개 브라우저 검사(`minimal-public-browser`, `minimal-pb-operational`, `minimal-visual-public`, `minimal-walking-public`, `minimal-public-recovery`)는 React fiber로 canvas에서 engine을 찾는다. 새 runtime의 canvas는 React가 만들지 않고 production은 engine을 노출하지 않는다. 현재 운영(구 UI)에서는 그대로 유효하므로 수정하지 않았다. 새 runtime 게시 후 공개 재검사를 하려면 `__minimalVisual.movement`만으로 충분한 검사로 바꿀지, production 진단에 제한된 engine 접근을 둘지 정해야 한다.
- 공개 30분 재검사의 응답 정체 2건 최초 원인은 여전히 미확정이다([공개 복구 재검사](2026-10-09-public-recovery-recheck.md)). 이번 OTA 변경으로 해결됐다고 보지 않는다.

## 7. 검토에서 고친 점

- 읽기 전용 검토 P2 2건: 입장 전 current 확인이 길어지면 인증 타이머가 먼저 만료되던 문제(타이머를 `beforeEnter` 뒤로), 공개 확인 네트워크 실패를 `publication:failed`로 단정하던 문제(`unknown`). 단위·frontend 검사 통과.
- `tests/minimal-pb-restart.mjs`(브라우저 경로), `tests/minimal-hotswap-browser.mjs`: `window.__minimal.room`이 복사본이 되고 UI가 shadow root로 들어가 깨졌다. dev 진단 `__minimalDebug.engine`과 shadow 조회 helper로 바꿨다. PB 검사는 통과했다. worker 브라우저 검사는 옛 `others.from/to/at`100ms 보간 필드를 참조해 `interpolationFrames>60`에서 실패했다. 현재 `pb.pts/head`의 중간 재생 프레임을 세고 실제 `x/y`가 보간점과0.01 이내인지 확인하도록 caller만 수정했다. YWJfHw에서6회 교체·재생633/638프레임·오류0으로 통과했다.
- `tests/minimal-visual-update.mjs`: `test:minimal:visual`이 85명·20분 기본값을 물려받던 것을 SDK2명·짧은 기본값으로 바꿨다. 긴 실행은 `test:minimal:ota`.
- `tests/minimal-frontend-ota.mjs`: 초기 manifest503 회복 검사가 Ego 왕복 시간에 따라 재시도3회를 모두 소진할 수 있었다. fault를2회로 한정해 세 번째 시도에서 회복하도록 했다. 장시간 실패 판별용 `timeline`·`recoveries`·`lagMs`·`health`·`game.log`를 추가했다(판정 기준 불변). 코드39파일을 `claude-checkpoint/cp4-code-sources.sha256`에 동결했고 구문 검사6파일·SHA 대조를 통과했다. 서버 진단 회전은 실행 환경의 `MINIMAL_CONNECTION_LOG_MAX_BYTES=33554432`, `MINIMAL_CONNECTION_LOG_FILES=4`로 늘려20분 증거를 보존한다(제품 기본 설정 변경 없음).
- 기존 renderer 전용 `minimal-visual-retry/update` harness는 15초 폴링 전제를 검사하므로 전체 UI harness로 대체했다. 이전 실패·통과 자료는 그대로 둔다.

## 8. 권한

commit·push·PR·merge·운영 접근·게시·Cloudflare/secret 변경·세션/worktree 정리를 하지 않았다. 시험은 `.test-work/`의 격리 포트·DB만 사용했다.
