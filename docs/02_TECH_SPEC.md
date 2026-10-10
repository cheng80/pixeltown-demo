# PixelTown 기술 명세

기준: 2026-10-02 재제작(PLAN-002) 로컬 소스. 아래 계약은 실제 코드에서 추출했다. 제품 요구는 [PRODUCT_SPEC](01_PRODUCT_SPEC.md)의 FR/BR를 참조한다. 실행 결과·현재 문제·인수인계는 메인 담당이 PROJECT_STATUS에 기록한다.

## 최소 게임 계약 (2026-10-08)

기본 로컬 실행은 기존 게임과 격리된 최소 게임이다. 아래 1절 이후는 **기존 게임 계약**으로 보존하며, 최소 게임에는 아래 계약을 적용한다.

| 경계 | 최소 게임 계약 |
|---|---|
| 화면·맵 | `minimal/game/`, `minimal/shared/world.js`; `vite.minimal.config.js` → `dist-minimal/` |
| 실시간 | `colyseus/minimal/server.js` 접속 계층 + `WorkerHost`/`simulation-worker.js`; 단일 `minimal-town` 로비, 정원 100 |
| 저장 | `pocketbase/minimal/pb_hooks/`; `users`, `profiles`, `results`, `inventory`만 사용 |
| 환경 | localhost 5270 / Colyseus 12620 / PB 18120, `.local/minimal/`에 전용 DB·관리자·outbox |
| 계정 | `POST /api/minimal/guest`; 별도 `pixeltown.minimal.*` 인증·게스트·대기 저장소 |
| 지갑 | 인증 사용자 `GET /api/minimal/wallet`; 한 트랜잭션에서 `{balance, settledMatchIds, profile:{name}}` |
| 정산 | 관리자 `POST /api/minimal/commit-match`; 양수 점수만·합계≤64, 전체 매치 동일 재전송만 성공 |
| 입력 | `move {x,y,seq,fix}`; 서버 이동 거리·충돌 검사, 50ms `snapshot` |
| 통지 | `gameEnded`는 outbox 기록 완료. 개인 DB 저장 완료는 wallet의 매치 ID로 확인 |
| 보류 | 상점·옷장·펫·외형 변경·미니룸·채팅·장소 이동. 변경 API 거절, 메시지는 안내 후 연결 유지 |
| 장애 | 지갑 실패 시 마지막 값·미확인 표시, 정적 `/unavailable.html`은 PB/Colyseus 요청 없음 |

[최소 게임 실행/API](../minimal/README.md)에 설정과 상세 계약을 둔다. 기존 `.env`의 원격 PB/Colyseus 설정을 새 서버 설정으로 해석하지 않는다. 기존 데이터 이관·삭제는 하지 않는다. 최소 서버는 별도 DB와 주소로 도입하며 최신 운영 검증은 PROJECT_STATUS를 따른다. PB의 localhost rate-limit 제외는 격리 시험용이며 공용 IP 운영 입장 제한 해결의 검증이 아니다. 공개 최소 모드는 trusted proxy의 CF-Connecting-IP를 방문자 IP로 사용하고 게스트 발급을 IP당 20회/시간으로 제한한다. 내부 초기화 확인은 forwarding header를 거절한다. 공개 API 상태/제어 거절 계약은 `tests/contracts/minimal-public.postman_collection.json`으로 검사한다.

정산 파일은 디스크 기록을 마친 뒤 통지하고 파일별로 재시도한다. 실패 매치는 증거를 남기며 다음 매치를 막지 않는다. 전체 매치의 사용자·점수·시각·원장 행 일치를 검사해 재전송 중복 지급을 막는다. 일반 사용자의 계정/원장 쓰기는 잠그고 자동 계정 삭제를 두지 않는다.

`Simulation`은 Node worker thread에서 실행한다. 접속 계층은 room/session/WebSocket·입력 순서·최신 확정 상태·단일 outbox를 보유한다. worker의 시각·난수 seed·UUID는 접속 계층의 순서 이벤트로 결정한다. schema 1 체크포인트에는 players, 이동 예산/시각, ack/fix, 퇴장자 점수, 별/카운터/다음 생성 시각, matchId/endsAt, pendingMatch와 timing을 포함한다.

후보는 체크포인트 이후 이벤트를 재생한다. 같은 순서의 상태·정산 제안·입장 결과 hash가 일치하고, 최소 1개 이벤트를 추격한 틱 경계이며 활성 응답이 처리 중이 아닐 때만 권한을 전환한다. 후보 실패/불일치/3초 추격 제한 초과는 기존 worker를 유지한다. 이전 worker의 늦은 응답은 인스턴스 권한과 순서로 차단한다. 정산 제안은 접속 계층이 디스크에 기록한 뒤 매치 ID로 한 번 통지하며, 다음 이벤트의 확인으로 worker가 판을 진행한다. 디스크 실패는 pendingMatch를 유지한다.

활성 worker 오류/1.5초 무응답은 최신 **확정** 상태와 처리 중 이벤트를 마지막으로 검증된 활성 artifact의 실제 경로로 재생한다. 다음 후보를 가리키는 managed link를 복구 파일로 사용하지 않는다. 연속 복구 실패 시 health/ready 503으로 실제 장애를 표시한다. 이는 접속 프로세스·호스트·메모리 손실 복구 보장이 아니다. `GET /health`는 `hotSwap:true`와 worker의 generation/sequence/revision/교체 통계를 제공한다. health 200은 전체 정산 성공을 뜻하지 않으며 `persistence.pending/failed`도 확인한다.

`POST /internal/worker/swap`: loopback 전용 서버, Origin 및 CF-Connecting-IP/X-Forwarded-For/Forwarded 요청 거절, 별도 32자 이상 `MINIMAL_SWAP_TOKEN` Bearer 인증, 요청 경로 입력 없음. 시작 시 고정한 `MINIMAL_WORKER_ENTRY`를 새 worker에서 읽는다. 준비·전환 성공은 200(revision/generation/sequence/replayed/시간), 후보 실패·동시 교체·로비 없음은 409, 인증 거절은 403. 배포 상태는 아래 별도 표시 계약으로 제공한다. 50ms snapshot·seq/fix·장애 콜백·재시도 0 설정을 유지한다. 현재 프런트는 `6e7134b`부터 타인의 확인된 걸음을 `playback.js`로 재생하며, 초기 100ms 보간 검사와 구분한다.

`deployment` 메시지와 `snapshot.deployment`는 `{phase,eventSeq,updatedAt,revision,generation}`을 제공한다. phase는 idle/preparing/catching-up/applied/cancelled이고 방 안에서 eventSeq가 증가한다. 상태 표시만을 위한 정보이며 이동 seq/fix·상태 hash·게임 입력과 독립이다. 준비/추격 동안 revision은 활성 버전이며 승격 뒤 새 버전을 노출한다. [상단 표시 계약](handoffs/2026-10-08-deployment-indicator.md)을 따른다.

[무중단 배포 인계](architecture/zero-downtime.md), [구조와 교체 순서](diagrams/worker-hot-swap.html), [Claude 전달 계약](handoffs/2026-10-08-worker-contract.md), [배포 도식](diagrams/zero-downtime.html), [실행 절차](../minimal/README.md)를 참조한다. 같은 상태/이동 규칙/wire protocol을 유지하는 게임 로직 교체만 대상이며, 맵·속도·브라우저 입력 계약 변경은 버전을 올리고 별도 이행해야 한다. 최초 접속 계층 도입·접속 프로세스 재시작은 별도 전환이다. 초기 검증은 별도 12622에서 진행했다. 이전 로컬 프로세스가 사라진 뒤 기존 DB의 행 내용 일치를 확인하고 12620에 새 구조를 시작했다. 기존 운영 서버는 유지하고 최소 서버는 13620/PB 18820에 따로 도입했다. 현재 실행 상태와 검증 결과는 PROJECT_STATUS를 따른다.

### 미니멀 화면·리소스 교체 계약 (2026-10-08)

> 2026-10-11 로컬 코드에서는 아래 [전체 프런트 OTA 계약](#frontend-ota-contract)이 이 renderer 전용 15초 계약을 대체했다. 운영 공개 화면과 기존 탭은 게시 전까지 이 절의 schema1 계약으로 동작한다. 과거 schema1 release와 이력 보존 규칙은 그대로 유지한다.

`GET /visual/current.json`(인증 없음, no-store)은 `{schema:1,revision,compatibility,entry,styles,fonts,images,files}`를 제공한다. SHA-256 버전 경로는 같은 origin의 `/visual/releases/<revision>/` 아래이며 내용을 덮어쓰지 않는다. `/visual/releases.json`과 각 manifest의 파일 해시 목록으로 다음 빌드에도 과거 버전을 보존한다. 버전 파일은 immutable, 누락 파일은 404다.

브라우저는 15초마다 확인하고 같은 compatibility일 때만 renderer·CSS·글꼴·이미지를 준비한다. `createRenderer({canvas,engine,view,fontFamily,resources})`의 draw를 기존 rAF에서 교체한다. room·입력 타이머·seq/fix·내 위치·점수·보류 입력을 초기화하지 않는다. 첫 그리기를 복제 상태로 확인한다. 준비 실패는 기존 화면 유지, 전환 후 draw 실패는 직전 화면 복구이며 입력 차단을 만들지 않는다.

React 화면 구성·인증·이동/충돌 계약 변경은 호환성 값을 바꿔 열린 탭에 적용하지 않는다. 기능 도입 전 탭은 처음 한 번 새로고침이 필요하다. 서버 worker의 배포와 화면 revision은 독립이다. 상세 소스 경계·게시·리소스 계약은 [화면 교체 인계](handoffs/2026-10-08-frontend-live-update.md), 설명 그림은 [HTML](diagrams/frontend-live-update.html), 실제 결과와 한계는 PROJECT_STATUS 7절을 따른다.

### 미니멀 접속 복구와 연결 검사 (2026-10-09)

정상 worker/PB 배포는 기존 WebSocket을 유지한다. 외부 경로가 연결을 닫았을 때는 `api.js`의 `createGameConnection`이 같은 방·세션의 복구 토큰으로 다시 연결한다. SDK 자동 재시도는 끄고 연결 객체에서 최대 12초·10회까지 시도한다. 방 소멸(522)·복구 토큰 만료(524)·인증 실패(525)는 즉시 실패 처리한다. 이 값은 설치된 SDK의 `ErrorCode`를 사용한다. 새 방 입장·새 게스트 발급으로 복구를 대신하지 않는다.

서버는 `allowReconnection(client, 20)`으로 위치·진행 점수·ack/fix·이동 허용량을 보관하고 복귀 시 최신 snapshot을 보낸다. 프런트는 끊긴 뒤 최대 3초까지 이동을 예측하고, 이후 위치를 고정하되 키·목적지·미확인 입력을 보존한다. 미확인 입력 상한은 240개다. 2026-10-09 공개 재검사에서 열린 소켓의 확인 응답 정체로 교정66개를 발견해, 연결 상태와 관계없이 미확인 예측을 3초 분량(50ms 틱의60걸음)에서 멈추도록 보완했다. 정상 상태에서 이 한도에 닿으면 같은 세션 복구를 시작하고, 끊기기 전에 남은 입력과 복구 중 입력이 같은 한도를 공유한다. 240개는 저장 큐의 최종 방어 상한이다. 복귀 첫 snapshot에서 ack 이하 입력은 확인 처리하고, 같은 fix의 나머지만 seq 순서대로 최대 80개/초로 다시 보낸다. 재전송이 끝나고 모두 확인될 때까지 새 걸음이 이를 추월하지 않는다. fix가 올랐다면 서버 위치로 보정하고 교정한 입력 수를 기록한다. 복구 중 화면은 작은 연결 확인 문구를 표시하며, 실패 시 기존 장애 안내로 전환한다.

heartbeat는 3초마다 ping을 보낸다. pong 대기는 송신 완료 뒤 6초이며, 송신 자체가 6초 동안 끝나지 않으면 별도 전송 장애로 종료한다. ping 요청 뒤 받은 pong 또는 서버가 새로 승인한 이동도 연결의 생존 증거로 인정한다. 중복 seq·잘못된 fix·거절된 위치·가공하지 않은 수신 프레임은 생존 증거로 쓰지 않는다. 이는 검증된 이동이 계속 오는데 pong만 없다는 이유로 연결을 종료하는 상황을 막는다. 이전 공개 끊김 244건의 원인이 모두 확인됐다는 뜻은 아니다.

메시지는 고정된 초당 제한 대신 90개/초로 허용량을 채우고 최대 240개를 모아 둘 수 있는 방식으로 검사한다. 지연된 정상 입력과 재전송은 받되, 허용량을 넘긴 송신은 `4002/message-rate-limit`으로 종료하고 복구를 거절한다. SDK가 기존 소켓을 정리하기 위해 보내는 4002와는 서버 내부의 과다 송신 표시로 구분한다. 한 걸음 거리·충돌·이동 속도 검사는 그대로다. 4.5초 분량을 넘는 이동 정체는 여전히 서버 보정을 받을 수 있다.

진단은 `MINIMAL_CONNECTION_OBSERVER=1`로 켠다. 기본 파일은 `STATE_DIR/diagnostics/connections.jsonl`이며 4MiB×4개·0600으로 보관한다. `X-Minimal-Socket-Id`로 ping 요청/송신 완료/pong 수신·종료 주체·전송 큐·이벤트 루프·메시지 수/seq 범위를 잇는다. health에는 기록 누락과 로그 오류 집계만 노출한다. 토큰·이름·계정 정보는 기록하지 않는다. 압축 비교용 `MINIMAL_COMPRESSION=off`는 기본 동작을 바꾸지 않는 시험 설정이다.

화면 교체용 JavaScript는 배포할 때 의존 모듈을 하나의 파일로 묶는다. 첫 import 실패 후에는 같은 파일에 내부 재시도 query를 붙여 브라우저의 실패 캐시를 피하고, 최대 3회까지만 import한다. 준비 실패는 기존 화면을 유지한다. 서버에 저장한 파일·SHA·manifest 경로는 바꾸지 않는다. 게시 도구의 이력 다운로드와 게시 전후 버전 확인은 GET 최대 3회·본문 포함 시도당 20초·주소별 연결 대기 2초를 사용하며, 기존 SHA·게시 충돌 검사를 유지한다.

50ms snapshot, 타인의 확인된 걸음 재생(`playback.js`), seq/fix 이동 규칙과 PB 정산은 유지한다. 접속 프로세스 재시작으로 방이 사라진 경우의 상태 복원은 구현하지 않았다. 이번 복구 기능과 updater 변경은 기존 탭의 화면 교체만으로 주입할 수 없으므로 최초 한 번 새 프런트로 입장해야 한다. 상세 계약과 검증은 [접속 복구 인계](handoffs/2026-10-09-session-recovery-contract.md), [수정 검증 보고서](reviews/2026-10-09-disconnect-recovery.md)를 따른다.

<a id="frontend-ota-contract"></a>
### 전체 프런트 OTA 계약 (2026-10-11, 로컬 구현·운영 미적용)

이 절은 사용자 요청에 따른 목표 계약이며, 2026-10-11 로컬 코드에 구현했다. 운영 게시·활성화는 하지 않았다. 구현에서 구체화한 계약은 절 끝의 [로컬 구현 계약](#frontend-ota-implemented)에 두고, 실제 검사와 대기 항목은 [로컬 결과](reviews/2026-10-11-frontend-ota.md)를 따른다. 결정 이유는 [ADR-007](decisions/ADR-007.md), 전달 자료는 [인계](handoffs/2026-10-11-frontend-ota.md)다.

#### 실행 수명과 상태

| 소유자 | 책임 | UI 교체 때 금지 |
|---|---|---|
| 탭 실행부(runtime) | 게스트·인증·connection/room·engine·50ms 이동·복구·지갑 요청/재시도·원장·UI 보존 상태·구독 | dispose, 재입장, pending/seq/fix 초기화, 완료된 요청 취소/반복 |
| 영구 월드 표면 | canvas DOM·그리기 rAF·키보드/blur/visibility·포인터 입력 소유 | canvas 제거·capture 중 DOM 교체·이동 루프 복제 |
| UI release | 입장·광장·메뉴·표시 컴포넌트·renderer·CSS·글꼴·이미지 | SDK 연결 생성, 인증 자동 복원, 이동/지갑 타이머 소유 |
| updater 하나 | 알림·후보 준비·최신 목표·활성화·직전 UI 복구·오류 집계 | 화면별 updater·주기 manifest 확인 |

runtime은 `getSnapshot()`과 `subscribe(listener)`로 상태를 제공한다. 변경이 없으면 snapshot 참조를 유지하며 UI가 engine 내부를 직접 바꾸지 못하도록 한다. 명령은 기존 입장·지갑 갱신·목적지·방향패드·UI 상태 변경에 필요한 것만 노출한다. PB 토큰·비밀번호·raw room·복구 토큰은 표시 snapshot에 넣지 않는다. 새 상태관리 패키지나 모든 기능을 해석하는 범용 플러그인 계층은 추가하지 않는다.

닉네임 초안·열린 패널·선택값·복원할 스크롤/포커스는 runtime의 UI 상태에 둔다. 새 화면은 공통 상태 읽기/쓰기 방식을 사용하며 OTA별 저장 hook을 붙이지 않는다. 장식 애니메이션만 재시작 가능하다. 상태 schema가 다른 후보는 거절하며 이번에는 자동 migration 체계를 만들지 않는다. 후속 기능의 보존 상태가 바뀌면 기본값으로 읽을 수 있는 호환 추가인지, 기존 상태를 변환해야 하는 변경인지 먼저 분류한다. React의 component type 변경·제거가 내부 상태를 초기화하는 동작은 [공식 상태 보존 설명](https://react.dev/learn/preserving-and-resetting-state)을 따른다.

기존 `WalletState`, 인증 요청 세대, connection의12초 복구·3초 예측·ack/fix 재전송은 재사용한다. 요청/복구의 수명과 UI release 세대를 분리한다. 이미 시작된 실제 요청은 한 번 완료되어 최신 화면에 반영하고, 종료된 UI의 늦은 callback이 새로운 명령을 시작하는 것은 차단한다.

#### UI entry와 빌드

부팅/runtime은 React를 import하거나 React root를 소유하지 않는다. UI release 한 JS에 React·ReactDOM·전체 App·renderer를 묶는다. 각 후보는 같은 release의 React로 별도 root를 mount한다. 다른 release 사이로 React component·element·context·hook을 넘기지 않는다. 이 조건 없이 서로 다른 React 인스턴스를 혼용하면 안 된다.

entry는 `mountUI({root,runtime,resources,signal})`와 `createRenderer`를 제공한다. `mountUI`는 최초 React commit 완료를 확인한 뒤 `{setActive(active),dispose()}`를 반환한다. 준비 중 facade는 상태 읽기만 허용하고 명령은 거절한다. 활성화된 release만 명령을 보낼 수 있다. `dispose`는 구독·UI 타이머·root를 정리하되 runtime/connection/input을 종료하지 않는다. renderer는 영구 canvas에 연결되며 프레임당 한 번 계산된 표시 상태로 그린다. 후보 그리기는 복제 표시 상태·별도 canvas를 사용한다. 타인 재생·방향·view를 두 번 진행하거나 게임 상태를 되돌리지 않는다.

레이아웃을 바꿀 수 있도록 UI와 renderer/CSS를 함께 준비하지만 canvas DOM과 입력 소유자는 runtime에 유지한다. 기존 root·canvas를 React의 후보 트리에 넣었다가 unmount로 제거하지 않는다. 후보 CSS는 후보 영역에만 적용하고, 활성화 전에 전역 body/호스트/기존 UI를 바꾸지 않는다. bootstrap CSS와 release CSS를 분리한다. 버전별 글꼴 이름과 기존 이미지 decode 확인은 보존한다.

기존 `/visual/` 불변 이력을 재사용한다. 새 manifest는 `schema:2`이며 기존 `revision`, `compatibility`, `entry`, `styles`, `fonts`, `images`, `files`에 `uiApiVersion:1`, `uiStateSchema:1`을 추가한다. `compatibility`는 runtime·공용 게임 규칙·UI 경계의 호환성이고 UI component 목록의 해시가 아니다. UI 의존 그래프 전체와 public 리소스는 revision에 포함한다. runtime 의존 그래프 변경·게임 URL/프로토콜/이동 규칙 변경은 compatibility를 바꾼다. UI 전용 React/CSS 변경 때문에 runtime hash가 불필요하게 바뀌지 않도록 빌드로 검증한다.

이전 schema1 릴리스와 파일 내용은 보존한다. 새로운 schema2를 구 탭에 강제로 적용하지 않는다. 최초 새 runtime 진입이 필요함을 안내한다. 같은 origin의 `/visual/releases/<revision>/`만 허용하며 임의 URL·query·경로 탈출·HTML SPA fallback·누락 파일을 거절한다. mutable current/index는 no-store, release는 immutable이다. 빌드·게시의 전체 파일 SHA 검사와 과거 릴리스 보존을 유지한다. 새 entry도 static/dynamic JS import0개인 단일 모듈로 검증한다.

#### 후보 준비·전환·복구

새 후보 준비 동안 기존 UI·renderer·입력이 계속 동작한다. 현재 활성 UI와 직전 UI는 최대 두 개까지만 유지하고 후보는 하나만 준비한다. 이전보다 새로운 목표가 오면 기존 후보를 취소한다. 취소된 import의 늦은 완료는 상태·활성 revision을 바꾸지 못한다.

모듈·CSS·글꼴·이미지·첫 React commit·첫 그리기를 확인한 뒤 안전한 프레임에 UI/renderer/스타일을 함께 전환한다. IME 조합·입력 영역 선택 복원·패드 pointer capture가 진행 중이면 기존 UI를 유지하고 최신 후보만 기다린다. 강제로 blur나 입력 취소를 하지 않는다. 키보드 키와 클릭 목적지는 영구 실행부에서 유지한다. 화면만 바꾸는 동안 서버 snapshot과 입력 실행은 계속한다.

준비 실패는 기존 UI 유지, 전환/실행 오류는 직전 UI를 **현재 runtime 상태로** 복구한다. 이전 위치·원장·완료된 명령으로 되감지 않는다. React 오류 경계 외에 이벤트 handler·비동기 callback·renderer 호출에도 필요한 오류 처리를 둔다. 실행 오류가 난 revision은 해당 탭에서 격리하여 계속 재적용하지 않는다. 다운로드 실패의 최대3회 import와12초 준비 한도는 기존 정책을 재사용한다. 교체를 안전한 순간까지 기다리는 시간은 네트워크 준비 기한과 구분한다.

JS module cache는 Map에서 삭제해도 브라우저에서 강제로 해제되지 않는다. 실제 renderer/root/subscription/style 해제와 장시간 module 메모리 증가는 구분해 측정한다.

#### 버전 알림과 순서

접속 서버는 worker와 별개로 현재 프런트 상태를 소유한다. 예시 메시지 이름은 `frontendRevision`이며, 현재 버전 요청은 `frontendCurrent`다. payload는 `{schema:1,generation,revision,compatibility,uiApiVersion,uiStateSchema}`다. generation은 안전한 비음수 정수이며 활성 버전 변경마다 증가하고 디스크에 보존한다. 파일이 없는 최초 상태는 generation0·current null이고 첫 활성화는 generation1이다. 아직 확인한 버전이 없으면 hint는 null이다. 손상 파일은 최초 상태가 아니다. worker generation·deployment.eventSeq·move.seq/fix를 재사용하지 않는다.

활성 버전 변경 시 기존 방에 broadcast한다. 최초 입장·같은 세션 복귀에는 현재 hint를 별도 전달한다. 탭 복귀 때 연결된 클라이언트는 기존 WebSocket으로 현재 hint를 한 번 요청한다. 과도한 요청은 기존 메시지 제한 안에서 다루고 새 입장을 만들지 않는다. 매50ms snapshot에 전체 manifest/hint를 반복해서 붙이지 않는다. 같은 소켓의 정상 TCP 메시지는 순서대로 오며, 연결 유실은 복귀 때 현재 버전 대조로 보완한다.

낮은 generation은 무시한다. 같은 generation의 다른 payload는 오류다. 같은 target의 반복 hint는 HTTP 요청·준비를 반복하지 않는다. `A → B → A`는 증가한 generation으로 허용하는 명시적 롤백이다. 시간·SHA 문자열·처음 본 revision만으로 신구를 판정하지 않는다. 서버 저장 상태가 손상돼 generation을 확인하지 못하면0으로 초기화하거나 기존 파일을 덮어쓰지 않고 프런트 활성화를 보류한다. 게임은 기존 상태로 계속하고 운영 진단에 오류를 남긴다.

브라우저는 새 hint에 대해 immutable `/visual/releases/<revision>/manifest.json`을 읽는다. 메시지의 `schema:1`과 manifest의 `schema:2`는 각각 검증하며 서로 같다고 비교하지 않는다. 둘 사이에서는 revision·compatibility·uiApiVersion·uiStateSchema 일치를 확인한다. mutable current를 읽다가 다른 배포의 파일을 섞지 않는다. 미입장 화면에서는 최초 로드·탭 복귀·입장 직전에만 `/visual/current.json`을 확인하고 겹친 확인을 하나로 합친다. 입장 후에는 hint 경로로 전환한다. 안정적인 접속에서 주기 버전 HTTP 요청은 없다. welcome 상태에서 아무 상호작용도 없이 열린 탭의 즉시 OTA는 보장하지 않는다.

#### 내부 활성화와 게시

`POST /internal/frontend/activate`를 별도 경로로 추가한다. 기존 worker swap 경로에 화면 배포 action을 섞지 않는다. 같은 loopback·별도 관리자 토큰·Origin/CF-Connecting-IP/X-Forwarded-For/Forwarded 거절·timingSafeEqual 인증 정책을 재사용한다. 브라우저/PB 사용자 토큰은 허용하지 않는다. 인증 후 최대4KiB JSON을 읽고 허용 필드만 받는다. 요청은 `{expectedGeneration,revision}`이다. generation과64자리 SHA를 검증하며 임의 URL·파일 경로는 받지 않는다.

서버는 운영에서 고정한 게임 origin의 `/visual/current.json`을 한 번 확인해 요청 revision과 일치하는 검증된 metadata를 사용한다. 리다이렉트·크기 초과·잘못된 schema·본문 포함 시간 초과를 거절한다. 테스트는 별도 loopback origin으로 고정한다. 게임 실행과 입장·이동은 외부 GET 완료를 기다리지 않는다. 활성화 요청은 직렬화하고 검사 후 임시 파일·flush·rename·디렉터리 fsync로 `STATE_DIR/frontend-current.json`을 저장한다. **저장 성공 뒤** 메모리 상태와 알림을 변경한다. 로비0명에서도 저장·수락 가능하다. 시작 시 저장 상태를 복원한다.

rename 전 저장 실패는 이전 상태를 유지한다. rename 뒤 fsync 등에서 오류가 나면 디스크가 이미 바뀌었을 수 있으므로 “미적용”으로 단정하지 않는다. 이때 저장 결과 불명·상태 대조 필요로 기록하고 추가 활성화를 차단한다. 파일을 검증하고 내구성 기록을 다시 완료해 디스크/메모리 generation을 일치시킨 뒤 같은 버전 알림을 재전송한다. 이전 파일을 자동으로 덮어쓰거나 generation0으로 재시작하지 않는다.

기존 `/health`에 no-store와 `frontend:{state,generation,current,notification}`을 추가한다. current는 공개 버전 metadata만이며 파일 경로·토큰을 포함하지 않는다. state는 uninitialized/ready/reconcile-required/error다. 게시 도구는 이 값으로 빈 로비에서도 expectedGeneration을 얻는다. 브라우저 OTA는 health를 폴링하지 않는다. 프런트 활성화 오류만으로 게임의 기존 health를 자동503으로 바꾸지는 않는다.

이미 같은 revision과 metadata가 활성화된 요청은 generation을 증가시키지 않고 **같은 hint를 다시 broadcast**한다. 저장 직후 알림이 실패한 경우나 응답 유실을 이 재시도로 보완한다. 중복 hint는 브라우저가 요청/준비를 반복하지 않는다. 다른 revision이면 expectedGeneration 일치가 필요하다. 공개 current가 다른 버전이면 이전 게시의 지연 요청으로 덮어쓰지 않는다.

결과는200(활성화·알림 큐 등록),202(저장/활성화 확인·일부 또는 전체 알림 큐 등록 실패),400(본문),403(인증),409(순서/버전 충돌),502(공개 파일 검증),503(저장/상태 오류)로 구분한다. broadcast 실패는 이미 저장한 버전을 되돌리지 않는다. 응답에 activation과 notification을 구분하고, notification은 queued/partial/failed/not-attempted와 대상/실패 건수를 제공한다. queued는 서버 송신 큐 수락이지 브라우저 수신/적용 증거가 아니다. rename 후 저장 불명은503·activation unknown이며 앞의 상태 대조 규칙을 따른다.

게시 순서는 기존 잠금/충돌/이력/SHA 검사 → Pages 게시 → 공개 current와 실제 파일/SHA 확인 → SSH를 통한 원격 loopback 활성화 → 서버 수락 확인이다. 토큰은 원격의 비공개 파일에서 읽고 SSH 명령·로그·브라우저로 전달하지 않는다. 이 경로의 실제 운영 실행은 별도 승인 대상이다.

수동 게시와 Git 자동 Pages 게시 모두 같은 활성화 종료 조건이 필요하다. Git 자동 빌드만 성공했다고 이미 열린 탭의 OTA 성공으로 기록하지 않는다. Git/Cloudflare 자동 게시의 활성화 연결은 코드·문서·로컬 가짜 pipeline으로 준비하고 실제 secret·webhook·운영 CI 설정은 변경하지 않는다. 최신 상태를 주기적으로 읽는 서버 폴링도 이번에는 추가하지 않는다. 게시됐지만 활성화 호출이 누락되면 기존 접속자의 즉시 갱신은 보장되지 않으며 활성화 재실행이 필요하다.

게시 receipt에는 `revision`, `publication`(confirmed/failed/unknown), `activation`(confirmed/failed/unknown/not-attempted), `notification`(queued/partial/failed/unknown/not-attempted), `generation`을 따로 남긴다. 알림 실패 때 재게시나 다른 배포의 자동 롤백을 하지 않는다. 같은 revision 활성화만 제한 재시도하고 재시도 종료 후 부분 실패를 명시한다. 서버 수락은 브라우저 적용 완료가 아니며 실제 적용은 별도 진단으로 확인한다.

최소 수용 검사와 콜러·fixture 영향은 [PLAN-008](plans/PLAN-008.md#5-검증-계획)에 둔다. HTTP 계약 검사는 로컬 Postman 또는 기존 실제 HTTP 시험으로 확인하고 WebSocket·UI 수명·입력 보존은 실제 SDK/브라우저로 검사한다. Postman workspace push·원격 모니터를 이번에 만들지 않는다.

<a id="frontend-ota-implemented"></a>
#### 로컬 구현 계약 (2026-10-11)

- 부팅: `index.html` → `bootstrap.js`(React 없음). `runtime.js`가 상태·명령, `surface.js`가 body의 영구 `canvas.world`·50ms tick·rAF·키보드/blur/visibility·canvas pointer를 소유한다. production은 `visual-update.js` updater 하나로 UI를 준비하고, 첫 UI가 활성화된 뒤 `runtime.start()`로 저장된 입장을 복원한다. dev는 Vite로 `ui-entry.jsx`를 직접 mount하며 OTA 통과 근거로 쓰지 않는다.
- facade: `getSnapshot()`, `subscribe()`, `enter()`, `refreshWallet()`, `setUI(patch)`, `setPad(x,y)`, `nudge(x,y)`(방향패드 버튼 키보드 한 칸), `setInteraction(kind,active)`(`composition`·`pad`·`world` 중이면 교체 보류), `bindWorldSlot(element)`, `reportUIError(error)`. release마다 `createUIFacade` lease를 주며 비활성·폐기 lease의 명령은 `Inactive UI command`로 거절한다. UI 보존 상태는 snapshot의 `ui`(예: `name`, `panel`, `otaDraft`, `otaChoice`)다. 포커스·선택·스크롤은 교체 순간 shadow root에서 `id`/`name`으로 복원한다.
- release: 각 UI는 `#root` 아래 `.ui-release` host의 open shadow root에 자기 React root로 mount한다. release CSS는 그 shadow root에만 넣고, 페이지·canvas CSS는 `bootstrap.css`가 가진다. 글꼴은 `PixelTown_<revision>` FontFace로 활성 UI와 직전 UI만 등록한다. entry JS는 manifest SHA를 확인한 바이트를 Blob URL로 import한다.
- 빌드: compatibility = `bootstrap.js` 의존 그래프(esbuild metafile의 실제 입력 파일·node_modules 경로와 내용) + PB/game URL. revision = compatibility + `ui-entry.jsx` 의존 그래프 + `VITE_OTA_TEST_SCREEN` + 빌드 스크립트·public 파일. runtime 그래프에 React가 들어가면 빌드를 실패시킨다. 게시 entry는 standalone 단일 모듈이다. 영구 부팅·장애 안내 HTML은 정적 사이트에 유지하며 UI release 파일 목록에는 넣지 않는다(Pages의 HTML 정규 URL 308을 피하고 모든 release 파일을 직접 SHA 검증한다).
- 알림: 연결 직후 클라이언트가 `frontendCurrent`를 한 번 요청하고, 서버는 입장·같은 세션 재접속·요청에 `frontendCurrent`, 활성화에 `frontendRevision`을 보낸다. 입장 중 탭 복귀는 `frontendCurrent` 요청, 미입장 탭 복귀·첫 UI 준비 후·입장 직전은 `/visual/current.json` 단발 확인이다. hint를 받은 뒤에는 단발 확인이 목표를 바꾸지 않는다.
- 실패: 준비 실패는 1초·2초 뒤 최대 2회 재시도(같은 entry import 최대3회), 12초 준비 기한. 첫 UI가 없는 상태의 실패는 `#root`에 `role="alert"` 안내를 띄우고 첫 UI 활성화 때 제거한다. 활성화 뒤 실행 오류는 직전 UI로 복구하고 해당 revision을 그 탭에서 격리한다.
- 진단: production `window.__minimal`(snapshot 복사본, `room:{roomId,sessionId}`, `userId`, connection 상태)과 `window.__minimalVisual`(`status`, `movement`)은 읽기 전용이다. 실제 engine·room은 dev의 `window.__minimalDebug.engine`만 제공한다.
- 서버 환경: `MINIMAL_FRONTEND_ORIGIN`(활성화 때 current를 읽을 origin, 기본 `http://127.0.0.1:<MINIMAL_WEB_PORT>`), `MINIMAL_FRONTEND_TOKEN`(32바이트 이상). 상태 파일은 `STATE_DIR/frontend-current.json`이다.

## 1. 기술 스택과 파일 경계

| 영역 | 기술 / 소스 | 제약 |
|---|---|---|
| 화면 | React 19, Vite 6, Canvas 2D; game/src/main.jsx(UI·입력), render.js(3계층 렌더러), sprites.js(도트 스프라이트), style.css; Galmuri11(OFL, npm `galmuri`) | 미니홈피 프레임, 정수배 도트 렌더링 (ADR-003) |
| 공용 맵·충돌 | shared/world.js (의존성 없음) | 게임·서버·테스트가 같은 파일 import (ADR-002) |
| PB 브라우저 | pocketbase SDK; root package.json/package-lock.json | 로그인 authStore와 사용자별 조회 |
| 실시간 | @colyseus/sdk 0.18.4, @colyseus/core 0.18.18, ws-transport 0.18.4, schema 5.0.35, monitor 0.18.6, express 5.2.1 | Mac mini 설치와 같은 버전(PLAN-004) |
| 서버 PB SDK | pocketbase 0.28.1; colyseus/config.js | 사용자별 클라이언트와 관리자 저장 클라이언트 분리 |
| DB·훅 | PocketBase 실행기 고정 0.40.4, pocketbase/pb_hooks/matches.pb.js | 결과·보상 트랜잭션과 superuser 전용 커밋 |
| 실행·seed | scripts/dev.mjs, dev-backend.mjs, init-pocketbase.mjs | macOS/Linux, curl/unzip, 바이너리 SHA-256 확인, localhost 제한 |
| 검증 | tests/integration.mjs, tests/report.json | 별도 PB 데이터·outbox, 자기 프로세스만 관리 |

라이브러리의 최신 버전 안내가 아니라 이 저장소의 설치·구현 계약이다. Colyseus 0.18은 패치된 `nanoid 3.3.19`를 쓴다. 2026-10-02 기준 루트·colyseus `npm audit` 0건이며, 배포 전에는 audit을 다시 실행한다. PocketBase는 로컬 0.40.4, Mac mini 0.39.7이며 같은 훅으로 두 버전 모두 통합 15개를 통과했다.

## 2. 아키텍처

프로젝트 루트 바로 아래 `game/`, `pocketbase/`, `colyseus/`, `docs/`를 형제로 둔다. 게임과 서버가 함께 쓰는 순수 맵·충돌 모듈은 형제 `shared/`에 둔다. 게임은 루트 Vite 설정에서 `game`을 root로 사용하며 환경변수는 프로젝트 루트에서 읽는다. PocketBase 바이너리·DB·관리자 파일은 pocketbase 안에, 게임 서버·outbox는 colyseus 안에 둔다. `scripts/dev.mjs`가 세 프로세스를 localhost에 함께 시작한다.


```text
React / Canvas
  ├─ PB 로그인·자기 프로필/결과/인벤토리 읽기 → PocketBase
  └─ client.auth.token=PB 토큰, joinOrCreate('town', {zone}) → Colyseus Town
       ├─ per-user PB authRefresh + 자기 프로필 읽기
       ├─ 입력 → 서버 이동·충돌 / 채팅·presence / 게임·점수
       └─ 라운드 종료 → 디스크 outbox
            → 관리자 POST /api/pixeltown/commit-match
            → PB transaction: 모든 참가자의 results + inventory
            → 성공 시 outbox 삭제
```

맵·충돌 정본은 `shared/world.js`다(ADR-002). 장소별 40×26 타일(16도트, 월드 640×416) 타일맵, 소품 배치와 정의(`w,h,ax,ay` 그림, `foot` 바닥 충돌, `layer` sort/fg/ground), 입구·출입구, `blocked`·`moveActor`·`findPath`·`starSpots`를 담는다. `game/src/render.js`가 ground(굽기) → 발밑 y 정렬(소품·별·아바타) → fg → 화면 해상도 글자 순서로 그린다. Canvas 보간은 서버 위치 사이를 부드럽게 그릴 뿐 권한 위치를 갱신하지 않는다. `?debug=collision`은 visual bounds(파랑)와 footprint·막힌 타일(빨강)을 겹쳐 그린다. 걷기 프레임은 몸 높이가 같고 다리·팔만 바뀐다(1px 들썩임이 8Hz로 화면을 떨게 했다).

`server.define('town',Town).filterBy(['zone'])`로 장소별 방을 만든다. 각 방 maxClients=100(`shared/world.js`의 `ROOM_CAPACITY`), maxMessagesPerSecond=120이며 메시지 snapshot은 50ms tick마다 전체 상태를 전송한다. 100명 제한은 운영 환경의 100명 성능 보장을 의미하지 않는다.

## 3. 인증·권한·보안

관련: FR-001/006, BR-001/007.

브라우저는 첫 방문 때 `POST /api/pixeltown/guest`로 게스트 계정을 만들거나, 저장된 게스트 자격증명(`localStorage` `pixeltown.guest`)으로 `users.authWithPassword(email,password)`를 해서 받은 토큰을 `client.auth.token`으로 방 입장에 전달한다(서버 `onAuth`의 `context.token`). 서버는 입장마다 새 PB 인스턴스를 생성해 `authStore.save(token)` 후 `users.authRefresh()`를 호출한다. 사용자 ID는 응답 record.id, 이름·색은 자기 profiles 조회에서 확정한다. 인증 저장소를 여러 사용자 간 공유하지 않는다. PB 요청은 5초 타임아웃이다.

토큰·프로필 검증 실패는 401, 허용하지 않은 장소는 400, 같은 사용자의 같은 방 중복 입장은 409다. 전체 장소에 걸친 하나의 세션 제한은 없다. 끊긴 세션은 15초 동안 자동 재접속을 기다리고, 그 사이 같은 사용자가 새로 들어오면 기다리던 세션을 정리하고 받는다. 마지막 절 참고.

users는 자신의 record만 list/view, profiles/results/inventory는 `user = @request.auth.id`에 한해 list/view한다. create/update/delete 규칙은 `null`로 일반 사용자 쓰기를 잠근다. 공개 `users` 생성은 막혀 있고(createRule null), 가입 경로는 게스트 훅 하나다. 서버 저장은 별도 관리자 클라이언트가 `_superusers.authWithPassword` 후 수행한다.

개발 seed 계정은 demo1/demo2@pixeltown.local, 공개 데모 비밀번호는 PixelTown123!다. 관리자 인증정보는 최초 실행 시 무작위 생성해 pocketbase/.env.local(mode 0600)에 저장한다. 실제 값을 문서·로그·VITE_ 변수·Git에 넣지 않는다. PB 데이터·outbox·바이너리·node_modules는 공개 대상에서 제외한다.

## 4. 데이터 모델

seed는 users/profiles/rooms/results/inventory/purchases를 준비한다. rooms는 영구 장소 메타데이터이며 Colyseus의 실시간 방 인스턴스와 분리한다. 인증 후 rooms 조회로 장소 등록을 확인한다. rooms는 로그인 사용자만 읽고 일반 사용자 쓰기는 금지한다.

| 엔터티 | 필드·제약 |
|---|---|
| users | PB auth collection, email/password 등 PB 인증 필드, name text max40; 사용자 ID 15자리 |
| profiles | user relation(users, required, cascadeDelete), name required text max40, color required text, outfit json(max 2000, `{hat,top,pet}`), room json(max 8000, `[{item,c,r}]`), avatar json(max 200, `{skin,hair,style}` 카탈로그 색인), last_seen date(로그인·토큰 갱신 때 1시간에 한 번 갱신); unique(user). outfit/room은 shop 훅, name/color/avatar는 profile 훅만 쓴다. unique `lower(replace(replace(replace(name,' ',''),'_',''),'-',''))`(+ 이전 DB에는 `name COLLATE NOCASE`도 남아 있음) |
| purchases | user relation, item required text max40, price required number min0; unique(user,item). 일반 사용자 읽기는 본인만, 쓰기는 shop 훅만 |
| rooms | zone required text unique(zone), title required text max80, max_players required number 1..100; 3개 장소 seed |
| results | user relation, match_id required text, zone required text, score number min0, ended_at required date; unique(match_id,user) |
| inventory | user relation, match_id required text, item required text, quantity number min0; unique(match_id,user) |
| 공통 | profiles/rooms/results/inventory/purchases에 created autodate(onCreate), updated autodate(onCreate/onUpdate) |

현재 초기화 스크립트는 기존 collection에 schema에 새로 생긴 필드(created/updated, profiles.outfit/room)를 추가한다. 신규 schema 정의만 바꾸는 것으로 기존 데이터베이스의 `sort:'-created'` 오류가 해결되었다고 판단하지 않는다. 실제 초기화 재실행과 UI 조회 400 해소를 별도로 확인한다. 기존 collection의 모든 rule/index를 강제 재구성하는 일반 마이그레이션 도구는 아니다.

DB number min0 제약 외에 commit 훅은 개인 점수 정수 0–64와 전체 점수 합계 0–64를 검증한다. 게임 서버는 점수가 1 이상인 참가자만 정산에 넣는다(0점 행 없음). 훅 자체는 0점도 받는다. 인벤토리는 정산 기간별 원장이며 사용자가 모은 별은 quantity 합계, 지갑은 그 합계 − purchases.price 합계다(ADR-004). 프로필 색은 서버에서 조회하고 프런트가 보낸 외형 주장으로 덮어쓰지 않는다.

## 5. API·실시간 계약

### API-001 PB 로그인과 자기 기록 읽기

관련: FR-001/006, BR-001/007.

`POST /api/collections/users/auth-with-password` 요청 `{identity,password}` → PB `{token,record}`. Colyseus 내부 검증은 `POST /api/collections/users/auth-refresh`를 SDK로 호출한다. SDK의 `getFullList({filter:pb.filter('user = {:id}',{id:user.id}),sort:'-created'})`로 profiles/inventory/results를 읽는다. PB list 응답을 SDK가 배열로 모은다. 다른 사용자 필터는 빈 목록, 직접 view는 404가 될 수 있다. 결과·보상 일반 사용자 쓰기는 400/403/404 중 거부 응답이 가능하다.

### API-002 방 입장

`joinOrCreate('town', {zone,entry?})`(토큰은 `client.auth.token`), zone은 lobby/garden/arcade. `entry`는 장소의 고정 입구 이름(`default`, lobby `west`/`east`, garden `west`, arcade `door`)만 쓰고 그 외 값은 `default`로 바꾼다. 같은 입구에 이미 사람이 있으면 서버가 16도트 이내 빈 자리로 비켜 세운다. 클라이언트는 409(이전 소켓 정리 전 재접속)를 700ms 간격 최대 6회 재시도한다. 반환 room의 sessionId는 연결 식별자이며 플레이어 id는 인증된 PB 사용자 ID다.

| 방향 | 메시지 | payload / 서버 규칙 |
|---|---|---|
| C→S | move | `{x,y,seq,fix}` — **로컬 우선 이동(ADR-005)**. 브라우저가 `stepInput`으로 한 걸음 움직인 뒤 그 위치를 보낸다(움직인 틱마다 하나). 서버는 `fix`가 지금 값과 같고, 이전 위치에서 `MAX_HOP`(6도트) 이하이며, 막히지 않은 자리이고, 속도 허용량(걷기 속도 × `MOVE_SLACK` 1.5, 최대 `MOVE_BURST_MS` 3초 저축) 안이면 받아들이고 `seq`를 player `ack`로 돌려준다. 아니면 player `fix`를 1 올리고 위치를 그대로 둔다. user ID·다른 필드는 무시한다. 6도트는 발 상자 높이(6)보다 작아서, 막힌 자리로 끝나지 않는 한 걸음은 장애물을 넘을 수 없다 |
| C→S | chat | `{text}` 문자열, 제어문자 제거·trim·240자 제한, 사용자별 700ms cooldown; 프런트 입력 제한 200자 |
| C→S | emote | `{}`; 서버 wave 이벤트, 1000ms cooldown |
| C→S | look | `{}`(내용 무시); 500ms cooldown. 서버가 사용자 토큰으로 자기 프로필을 다시 읽어 `look` 갱신 |
| C→S | collect | `{id}` 별 ID; 진행·시간·존재·히트박스(`touchesStar`) 검증. 서버가 매 틱 자동 수집하므로 현재 클라이언트는 보내지 않는다(구 버전 호환) |
| S→C | snapshot | `{players,zone,game,persistence}` 전체 snapshot |
| S→C | chat | `{id,name,text,at}` 서버 확정 발신자 |
| S→C | emote | `{id,emote:'wave',at}` |
| S→C | gameEnded | `{match_id,zone,ended_at,scores}` 정산 알림(점수 있는 사람만); 디스크 outbox 커밋 뒤 알림, PB 저장 완료 신호는 아님. 직후 다음 기간이 시작된다 |

`startGame` 메시지는 제거했다. Colyseus는 등록되지 않은 메시지를 보낸 클라이언트의 연결을 끊는다.

player는 `{id,name,x,y,color,look:{hat,top,pet,skin,hair,style}}`(look은 카탈로그 슬롯이 맞는 값과 `avatar` 범위 안의 색인만, 나머지 null. null 외형은 클라이언트가 ID 해시로 그린다). `look` 메시지는 프로필을 다시 읽어 이름·옷 색·외형을 갱신한다. 펫은 화면에서만 주인을 따라가며, 주인이 아래(정면)를 볼 때는 몸에 가리지 않도록 옆(-14,-3도트)에 선다. game은 `{id,active,endsAt,stars:[{id,x,y}],scores:{[userId]:integer}}`, `id`는 현재 정산 기간 match_id, `endsAt`은 다음 정산 시각. persistence는 `{status:'pending'|'saved',pending,lastError}`이며 전체 outbox 상태이므로 특정 매치만의 상태는 아니다.

서버는 50ms마다 `moveActor(map,x,y,dx,dy,3)`을 적용하며 입력이 300ms보다 오래되면 움직이지 않는다. 이동은 1.5도트 이하로 쪼개 축별로 미끄러지고, 한 축만 막히면 수직 방향 6도트 이내 빈틈으로 비켜 간다. 플레이어 발 상자 10×6이 막힌 타일·소품 footprint·맵 경계와 겹치면 막힌다. 별은 `spreadSpot`이 `starSpots`(시작점에서 닿고 sort 소품 그림에 가리지 않은 타일 중심) 후보 24개 중 기존 별·플레이어와 가장 먼 곳을 고른다. 이벤트는 첫 입장 때 시작해 계속된다. 최소 5개를 채우고, `STAR_SPAWN_INTERVAL_MS`(기본 6000, 1000..60000)마다 상한 12 미만이면 1개 생성한다. `GAME_DURATION_MS`(기본 180000, 1000..300000)마다 `settle`: 점수 1 이상인 사람만 outbox에 넣고 `gameEnded`를 보낸 뒤, 별을 유지한 채 새 match_id·0점으로 다음 기간을 시작한다. 기간 합계가 64(`MAX_MATCH_SCORE`)에 닿으면 즉시 정산하고, 정산 대기 중 64를 넘는 수집은 거부한다. 전원 이탈·dispose 때 정산하고 멈춘다. 진행 중 합류자를 scores에 등록하고 이탈자의 점수는 정산까지 유지한다. solo 연습도 최소5·6초·상한12와 충돌을 적용하며 DB 보상은 없다.

클릭 이동: `findPath`는 8도트 걷기 격자 BFS(모서리 자르기 없음) 뒤 `clearWalk`(2도트 간격 발 상자 검사)로 막히지 않는 가장 먼 점까지 이어 붙인다. 각 구간은 키보드와 같은 8방향(45° 부분 + 직선 부분, 대각 먼저 안 되면 직선 먼저)으로 나눈다. 임의 각도 구간은 정수 픽셀 카메라가 두 축을 서로 다른 박자로 움직여 화면이 계단처럼 떨렸다. 클라이언트는 틱마다 `routeStep`으로 한 걸음(4도트)을 걷고, 꺾는 점에서 남은 걸음을 다음 구간에 이어 쓴다. 막힌 곳을 누르면 목표와 가장 가까운 도달 가능 칸이 끝점이다.

### API-003 원자적 결과 커밋

관련: FR-006, BR-005/006. `POST /api/pixeltown/commit-match`는 게임 서버의 PB superuser 인증만 허용한다. body limit 16384바이트.

```json
{
  "match_id": "12345678-1234-1234-1234-123456789abc",
  "zone": "arcade",
  "ended_at": "2026-10-02T00:00:00.000Z",
  "scores": {"abcdefghijklmno": 3}
}
```

성공: 200 `{ok:true,match_id}`. 훅은 match_id 36자리 소문자 hex/하이픈 패턴, 장소 allowlist, ended_at 문자열, scores object와 참가자 1–64명, 사용자 ID 15자리 소문자 영숫자·사용자 존재, score 정수 0–64와 전체 점수 합계 0–64를 검증한다. ended_at의 날짜 유효성은 PB date 필드 저장에서 추가 검증된다. UUID 정규형 전체를 검증하는 패턴은 아니므로 서버 randomUUID 생성값을 사용한다.

`$app.runInTransaction` 내에서 모든 사용자에 results(score,zone,ended_at)와 inventory(item='star',quantity=score)를 기록한다. 이미 존재하면 results의 score/zone, inventory의 quantity/item 일치를 확인하고 동일 데이터는 건너뛴다. 현재 ended_at 일치 자체는 재전달 비교 항목이 아니다. 다른 점수·장소·보상은 400, 없는 사용자는 404 가능, 일반 사용자·미인증은 401/403이다. 참가자 중 오류면 전체 transaction을 rollback한다.

### API-005 별 상점·옷장·미니룸 (PB 훅, ADR-004)

모두 `$apis.requireAuth("users")`, 본인 `e.auth.id`만 대상. 가격·슬롯·가구 크기·미니룸 범위는 `shared/catalog.json`(`pocketbase/pb_hooks/shop_lib.js`가 `$os.readFile`로 읽음)에서만 가져온다. 실패는 400과 한국어 메시지.

| 경로 | 요청 | 처리 |
|---|---|---|
| `POST /api/pixeltown/shop/buy` | `{item}` | 트랜잭션: 이미 보유면 거부 → purchases 행 저장 → 지갑 재계산, 음수면 "별이 부족해요" 롤백. 응답 `{ok,item,balance}` |
| `POST /api/pixeltown/guest` | `{name,color,avatar,password}` | 인증 없음(PLAN-006). profile과 같은 닉네임·외형 검사, password 32–128자(브라우저 생성). users(`guest-<무작위>@guest.pixeltown.local`, verified)와 profile을 한 트랜잭션으로 만들고 PB 인증 응답 `{token, record}`. 닉네임 중복이면 400 `{data:{name:'taken'}}`이고 사용자도 만들지 않는다. 원격은 방문자 IP당 시간당 20회(초과 429, PB rate limiter) |
| `POST /api/pixeltown/guest-cleanup` | `{days?}`(기본 30) | superuser 전용. `last_seen`(없으면 created)이 days일 넘은 `@guest.pixeltown.local` 계정과 그 기록 삭제, `{deleted}`. 같은 작업을 cron `pixeltown_guest_cleanup`이 매일 04:17 실행 |
| `POST /api/pixeltown/profile` | `{name,color,avatar:{skin,hair,style}}` | 로그인 본인만(FR-014). 닉네임 2–12자·한글/영문/숫자/공백/_/-, color는 `avatar.shirts`, 색인은 카탈로그 범위, 운영진 사칭 단어(`avatar.reserved`) 400, 다른 사용자와 같은 닉네임(공백·_·-·영문 대소문자 무시, DB unique 식 인덱스 `idx_profiles_name_key` 위반) 400 `{message, data:{name:'taken'}}`. 응답 `{ok,profile}` |
| `POST /api/pixeltown/shop/equip` | `{hat,top,pet}` 각 id 또는 null | 슬롯이 맞고 보유한 아이템만, profiles.outfit 저장. 응답 `{ok,outfit}` |
| `POST /api/pixeltown/shop/room` | `{placements:[{item,c,r}]}` | 보유 가구·하나씩·최대 24·바닥 `floor` 안·`door` 칸 제외·flat(러그) 아닌 가구끼리 겹침 없음, profiles.room 저장 |

미니룸 맵은 `homeMap(placements)`(shared/world.js)이 만든다. 가구 앵커 = 칸 묶음의 아래 가운데, footprint는 칸 안에 들어간다. 맵에 `frame`이 있어 화면은 방 전체가 들어가는 가장 큰 정수배로 확대한다. 미니룸은 Colyseus 방 없이 브라우저에서 같은 `moveActor`로 걷는다. 화면용 `roomProblem`과 훅 `validateRoom`은 같은 규칙이며 단위 테스트가 같은 사례로 대조한다.

### API-004 건강 상태

`GET http://127.0.0.1:12567/health` → 200 `{ok:true,service,persistence:{status,pending,lastError}}`. `/health/pocketbase`는 서버→PB 연결, `/me`는 Bearer 사용자 토큰 검증, `/monitor/`는 PB superuser Basic 인증 전용이며 outbox 서비스 계정(`PB_ADMIN_EMAIL`)은 거부한다. HTTP·WebSocket 모두 `ALLOWED_ORIGINS`의 정확한 Origin만 허용한다(Origin 없는 요청은 통과, 인증은 별도). PB 장애에도 프로세스 health는 200일 수 있으므로 persistence를 함께 읽는다. PB health는 `GET http://127.0.0.1:18090/api/health`다.

## 6. 상태·저장·동기화

React state는 HUD·로그·수첩, refs는 room/입력/렌더 snapshot/카메라에 사용한다. 브라우저 PB SDK 기본 authStore는 로컬 인증을 보관하고 로그아웃에서 clear한다. 서버는 그 로컬 유효성만 신뢰하지 않고 입장 시 authRefresh한다.

채팅 overlay는 배경 `rgba(...,chatOpacity/100)`만 적용한다. `pixeltown.chatOpacity` localStorage 값을 20–95 범위로 복원하고 기본값은 82다. 메시지는 화면 세션에 최대 100개 유지한다. 접힌 상태에서 append된 메시지에 unread를 누적하고 펼치면 0으로 초기화한다. 방 이동에서는 로그·입력·이모트·수집 요청 상태를 정리한다. 채팅은 영구 DB 저장 대상이 아니다.

outbox는 `.json.tmp`에 mode0600 동기 write(flush=true), 최종 `.json`으로 rename한 후 전송 가능 상태로 노출한다. PB 성공 후 unlink, 실패면 파일 유지·lastError 표시·2초마다 재시도한다. 시작 시 기존 파일을 flush하며 동일 프로세스 busy flag로 중복 flush를 막는다. 종료 때도 flush를 시도한다. 디스크 쓰기 실패면 game.active를 유지하고 다음 tick에서 재시도하므로 거짓 종료 성공을 보내지 않는다.

진행 중인 라운드 전체 상태는 메모리다. 서버 재시작 복구 보장은 완료되어 outbox에 기록된 매치에 한한다. 파일 디스크 자체의 손실·다중 서버 공유 outbox는 보장하지 않는다.

## 7. 오류와 최종 검증 항목

UI는 인증 실패 alert, 방 연결 실패·재연결, 저장 pending/재시도/완료 toast, 기록 조회 실패와 빈 상태를 구분한다. 서버는 메시지 권한·범위를 검증하며 부정 입력은 대부분 조용히 무시한다. 로그에는 토큰·비밀번호·관리자 값·채팅 원문을 남기지 않는다.

계약 불일치를 보완하고 실제 소스와 대조했다. 최종 회귀 결과는 PROJECT_STATUS에 기록한다.

| 분류 | 요구와 현재 소스 | 처리 |
|---|---|---|
| 해결 완료 | 브라우저와 `.env.example`은 모두 `VITE_GAME_URL` 사용 | 설정 예제와 실제 소스 대조 |
| 해결·검증 완료 | 상시 이벤트·6초 주기·상한12·3분 정산·0점 미기록·score64 | 단위 tick/정산, 통합(1.5초·30초 단축), 브라우저 기본값 3분 정산 |
| 해결·검증 완료 | 별 상점 지갑·구매·장착·미니룸 배치 | 통합(위조·잔액 부족·동시 구매·배치 규칙), 브라우저 2유저 |
| 해결·검증 완료 | UI records 400 대응으로 created/updated 추가·기존 collection 보완 | 재seed 후 브라우저 프로필·결과 조회 성공, 오류0 |

## 8. 실행·검증·확장

프로젝트 루트 실행:

```sh
npm ci
npm --prefix colyseus ci
npm run dev:all
npm run build
npm run test:integration
```

macOS start.command도 로컬 실행 진입점이다. dev:all은 기본 PB 18090, Colyseus 12567, Vite 5173을 loopback에 실행하며 점유 포트를 임의 종료하지 않는다. `PIXELTOWN_PB_PORT`·`PIXELTOWN_GAME_PORT`·`PIXELTOWN_WEB_PORT`로 바꾸면 브라우저 `VITE_*` URL도 함께 맞춘다. 통합 테스트는 `PIXELTOWN_TEST_PB_PORT`·`PIXELTOWN_TEST_GAME_PORT`(기본 18090/12567)를 쓴다. 브라우저 검증 `tests/ui-check.mjs`는 실행 중인 dev 서버(`PIXELTOWN_WEB_PORT`)와 `CHROME_PATH`의 Chromium을 쓴다. 초기화는 localhost PB만 허용하고 공식 고정 버전 바이너리의 SHA-256을 확인한다.

| 환경변수 | 실제 용도·기본값 |
|---|---|
| VITE_PB_URL | 브라우저 PB, http://127.0.0.1:18090 |
| VITE_GAME_URL | 승인된 브라우저 게임 URL 계약, ws://127.0.0.1:12567; 예제와 동일한 변수 |
| PB_URL / POCKETBASE_URL | 서버 PB URL, http://127.0.0.1:18090 (Mac mini 8091) |
| SERVER_HOST / SERVER_PORT / PORT | Colyseus bind, 127.0.0.1 / 12567 (Mac mini 2567) |
| ALLOWED_ORIGINS / MONITOR_ORIGINS | 정확한 브라우저 Origin 목록, wildcard 없음 |
| PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD | outbox superuser(Mac mini `.env` 0600). 로컬은 PIXELTOWN_ENV_FILE |
| `.env.remote` (VITE_PB_URL / VITE_GAME_URL) | `npm run dev:remote`·`npm run build:remote`(Pages): https://pixeltown-pb.fastmake.net / wss://pixeltown-rt.fastmake.net |
| PIXELTOWN_LOCAL_DIR | 바이너리·로컬 자산, pocketbase/.local |
| PIXELTOWN_ENV_FILE | 비공개 관리자 파일, pocketbase/.env.local |
| PB_DATA_DIR | 로컬 PB 데이터, pocketbase/.local/pb_data |
| OUTBOX_PATH | 영구 outbox 디렉터리, colyseus/.local/outbox |
| GAME_DURATION_MS | 별 이벤트 정산 주기, 기본 180000; 통합 검증은 30000 |
| STAR_SPAWN_INTERVAL_MS | 별 생성 주기, 기본 6000; 통합 검증은 1500 |
| PIXELTOWN_PB_PORT / PIXELTOWN_GAME_PORT / PIXELTOWN_WEB_PORT | dev:all 포트, 기본 18090 / 12567 / 5173 |
| CHROME_PATH | ui-check용 Chromium 실행 파일, 없으면 시스템 Chrome |

테스트 날짜·리비전·결과·미실행 공백은 PROJECT_STATUS와 verification.md에서 관리한다.

20명 smoke는 약 3초 입력 workload·10Hz 목표·단일 로컬 머신 기능 점검이다. `PIXELTOWN_LOAD_100=1`이면 100명을 한 장소에 넣어 `filterBy(['zone'])`·`maxClients=100`에 따른 100명 단일 방 입장·snapshot·채팅 및 101번째 사용자의 별도 방 배정을 측정한다. 다른 채널 방의 사용자는 서로 보이지 않는다. 인터넷 지연·실제 모바일 FPS·운영 수용량은 보증하지 않는다. 이후 규모 확대는 schema delta/관심 영역, 방 분할, PB 저장량, 네트워크·CPU·모바일 렌더링 측정 후 결정한다. 공개 GitHub source push와 운영 배포를 구분한다.

## 경로 탐색과 이동 보정 (2026-10-02 수정)

`findPath`는 8도트 격자 BFS 후 직선 구간으로 당긴다. 시작 칸은 플레이어가 직진할 수 있는 가장 가까운 걷는 칸이다(2칸 이내, 없으면 가장 가까운 걷는 칸). 이전에는 소품 가장자리처럼 실제 위치는 비었지만 칸 중심이 막힌 곳에서 빈 경로를 돌려줘 클릭 이동이 반응하지 않거나 직진하다 끼었다. `moveActor`의 모서리 비켜가기(최대 6도트)는 거의 축 방향(다른 축 성분이 25% 미만)일 때도 동작한다. 반올림으로 생긴 0.03도트 어긋남이 비켜가기를 끄던 문제를 막는다. 단위 테스트가 세 장소의 막히지 않은 위치에서 입구까지 경로를 서버 이동으로 따라가 도착하는지 검사한다.

원격 지연 보정: 클라이언트는 늦은 snapshot으로 도착을 판정하므로 원격(왕복 약 100–200ms)에서 목표를 6–7도트 지나쳐 멈추거나 왕복했다. 마지막 구간에 `to`를 보내 서버가 실제 위치 기준으로 목표에 정확히 멈춘다. 클릭 이동 중 0.5초 동안 움직이지 않으면 클라이언트가 경로를 다시 찾는다. `tests/remote-click.mjs`가 실제 브라우저 클릭의 도착·반전·끝 오차를 측정한다.

## 부드러운 이동 (2026-10-02)

원격에서 이동할 때 화면이 흔들렸다. 내 아바타를 늦고 불규칙하게 도착하는 snapshot 쪽으로 보정했고, 카메라가 따로 지연·반올림돼 아바타가 화면에서 1도트씩 떨렸다. 수정:

- 내 아바타는 브라우저가 정한다(2026-10-03부터 로컬 우선, 아래 "로컬 우선 이동"). 화면에는 틱(50ms) 동안 고르게 미끄러지듯 그린다.
- 다른 사람은 걸음 단위로 재생한다(`game/src/playback.js`, 아래 "로컬 우선 이동"). 이전의 서버 시각 `t` 기준 100ms 지연 보간은 없앴다.
- 카메라는 아바타에 정수 도트로 고정한다. 둘 다 `floor`와 정수 오프셋을 쓰고, 지연 보간은 없앴다. 맵 가장자리에서만 멈춘다.
- 스프라이트 방향은 최근 프레임 평균 이동 방향으로 정한다. 가로·세로가 2:1 안쪽인 대각선은 좌·우(옆모습)로 고정한다(`facing`, shared/world.js). 대각선으로 걸을 때 방향이 매 프레임 뒤집히지 않는다.
- 측정은 `tests/motion-check.mjs`로 한다(직선 2방향 + 대각선 2방향, 방향 바뀐 횟수 포함). 방향키를 누른 채 프레임마다 화면 위 아바타 위치와 이동량을 잰다.


## 별 수집 히트박스 (2026-10-02)

- 판정: 아바타 몸 상자 `BODY_BOX`([-7,-25,14,25], 발밑 기준)와 별 그림 상자 `STAR_BOX`([-7,-16,13,13], 별 기준점 기준)가 겹치면 수집한다(`touchesStar`, shared/world.js). 이전 판정은 발밑과 별 기준점 사이 거리 16도트였다. 별 그림은 기준점보다 3–16도트 위에 그려져 몸이 닿아 보여도 거리가 멀 수 있었다.
- 서버: 매 틱(50ms) 이동을 적용한 뒤 `pickUpStars`가 모든 플레이어와 별을 겹침 검사해 수집한다. 클라이언트 요청이 필요 없다. `collect` 메시지는 같은 `takeStar` 검사를 거치며 구 버전 탭 호환용으로 남긴다.
- 이전 문제: 클라이언트는 예측 위치(화면)로 범위 안이라고 판단해 `collect`를 보냈다. 서버 위치는 원격 지연만큼 뒤에 있어 거절했고, 클라이언트는 600ms 뒤에야 다시 보냈다. 그래서 별 중심까지 걸어가야 먹히는 것처럼 느껴졌다.
- 화면: 그려진 내 아바타가 별에 닿는 프레임에 별을 숨기고 노란 점 4개가 퍼지는 효과(0.4초)를 그린다. 서버가 1초 안에 별을 지우지 않으면 다시 보인다. 점수와 맵 별 개수는 서버 snapshot만 따른다.

## 연결 끊김·재접속과 입력 대기열 (2026-10-02)

- 이전 문제: 서버가 재접속을 허용하지 않는데 SDK는 끊긴 뒤 약 50초 동안 15번 재시도했다. 그동안 화면은 "접속 중"이라 캐릭터가 혼자 예측 이동했다.
- 서버: `onDrop`이 끊긴 플레이어를 `RECONNECT_SECONDS`(15초) 동안 남긴다(제자리, 대기 입력 삭제). 돌아오지 않으면 `onLeave`가 평소처럼 지운다. `onJoin`에서 거절된 입장(409 등)도 `onDrop`으로 오므로, 입장한 적 없는 세션은 붙잡지 않는다(거부된 `allowReconnection`이 처리되지 않으면 서버 프로세스가 종료됐다). 기다리는 중 같은 사용자가 새로 들어오면(새로고침·새 탭) 기다리던 세션을 정리하고 받는다. 살아 있는 세션이 있으면 여전히 409다.
- 클라이언트 복구 순서: (1) SDK `onDrop`이면 방 참조를 끊고 입력·경로·대기 입력을 비운 뒤 "다시 연결하는 중" 대화상자로 화면 전체를 막는다. SDK가 같은 서버 세션으로 재접속한다(재시도 6번, 약 11초). `onReconnect`면 그대로 이어 간다. (2) 재접속이 거절되거나(세션 만료 4003, 소켓 거부) 재시도 소켓이 15초 동안 열리지도 닫히지도 않으면(네트워크가 사라진 경우) 버튼 없이 자동으로 새로 입장한다. 로그인 토큰은 그대로 유효하다. 이전 방의 남은 재시도는 멈춘다. (3) 자동 입장마저 실패하면(서버에 닿지 않음) "다시 연결" 버튼(초점)을 보인다. 자동 입장은 10초에 한 번까지라, 서버가 계속 닫아도 반복하지 않고 버튼으로 넘어간다. 대화상자가 떠 있는 동안 키 입력·클릭 이동·장소 탭·상점이 동작하지 않는다. 서버 대기 시간(`RECONNECT_SECONDS`, 기본 15, 환경변수로 변경)과 클라이언트 재시도 횟수는 서로 맞출 필요가 없다. 어긋나도 (2)로 복구한다.
- 입력 대기열: 서버 대기열 상한을 6에서 20(`MAX_QUEUED_INPUTS`, 1초)으로 늘렸다. 불안정한 연결에서는 입력이 몰려 도착한다. 6개를 넘으면 버려져서 서버가 예측보다 뒤처졌고, 예측 위치가 되돌려지면서 고정 카메라와 함께 화면 전체가 흔들렸다. 속도 제한은 크레딧이 맡으므로 상한을 늘려도 빨라지지 않는다.
- 카메라는 원본과 같이 아바타에 바로 고정한다(데드존·댐핑을 시험했으나 사용자 결정으로 쓰지 않는다).
- 측정: `tests/offline-check.mjs`(페이지 안에서 게임 소켓만 끊거나 거부·무응답으로 만들기: 짧은 끊김, 무응답 재시도, 세션 만료(`STALE_AFTER`, 서버 `RECONNECT_SECONDS` 단축), 서버 불가), `JITTER=300 tests/motion-check.mjs`(페이지 안에서 게임 메시지를 순서대로 40ms+무작위 지연). 화면 밖 보정 기록은 `window.__pixeltown.corrections`.

## 이동 위치 롤백 (2026-10-02)

- 이동 크레딧을 틱 횟수로 주면, 서버 타이머가 50ms보다 조금씩 늦게 도는 만큼(51–52ms) 걷는 클라이언트보다 1분에 약 1초씩 뒤처졌다. 대기열이 차서 입력이 버려지면 아바타가 크게 되돌아갔다(배포 주소 60초 측정: 보정 100회, 최대 106도트, 미확인 입력 40개). 크레딧을 실제 흐른 시간으로 준다(`entry.at`). 또 인터넷에서는 입력이 몇백 ms 멈췄다 한꺼번에 도착하는데, 크레딧 상한 2로는 그 몰림을 끝내 따라잡지 못해 밀림이 쌓였다(배포 주소 재측정: 미확인 입력 40개, 보정 40·88회). 상한을 대기열 크기(20, 1초)로 올렸다. 오래 보면 속도 상한은 50ms당 1걸음으로 같다(1초 이상 쉰 뒤 최대 20걸음 몰아 쓰기만 허용).
- 장소를 바꾸면 렌더에서 `mapRef`가 먼저 다음 장소 맵으로 바뀌고 이전 방 effect 정리는 뒤에 실행된다. 그 사이 도착한 이전 방 snapshot의 재적용이 다음 장소 맵으로 계산돼 문 앞에서 6.7도트 보정이 생겼다. 방 연결은 자기 장소 맵(`roomMap`)을, 입력 tick은 `getMap(zone)`을 쓴다.
- 떠나는 방이 정리 후 보낸 snapshot·채팅·인사는 무시한다(`cancelled`). 마지막 snapshot이 다음 장소의 예측 위치가 되어 도착 직후 맵을 가로질러 미끄러지던 문제(346도트 보정)다.
- 측정: `tests/rollback-check.mjs`(장소 안에서 무작위 클릭·방향키를 섞어 `SECONDS` 동안, `HOPS`로 장소 이동 반복, `JITTER` 가능). 보정(0.5도트 초과) 0회가 기준이다.
- 연결이 1–2초씩 멈추는 환경(배포 주소 측정에서 미확인 입력 40개)에서는 서버가 아무리 빨리 따라잡아도, 클라이언트가 멈춘 동안 계속 앞서 예측하면 대기열 한도를 넘어 롤백이 난다. 클라이언트는 서버가 확인하지 않은 입력이 `MAX_QUEUED_INPUTS - 4`(16, 0.8초)에 이르면 입력 전송과 예측을 멈추고 제자리에서 기다린다. 확인이 오면 다시 움직인다. 연결이 멈추면 캐릭터가 잠깐 서고 뒤로 튀지 않는다. `MAX_QUEUED_INPUTS`는 `shared/world.js`에 두고 서버·클라이언트가 같이 쓴다.

## 지갑 즉시 반영 (2026-10-02)

- 저장 구조는 그대로다. 서버는 3분마다 그 주기 점수를 결과·보상(inventory, `match_id`)으로 한 번에 저장한다.
- 화면: 클라이언트가 snapshot과 `gameEnded`에서 주기별 내 점수를 기록한다(`ledger`, 주기 id → 점수). 지갑 표시 = 저장된 지갑 + inventory에 아직 없는 주기 점수의 합이다. 그래서 별을 먹는 즉시 지갑이 오르고, 정산·저장 뒤에도 숫자가 그대로다(같은 `match_id` 행이 생기면 대기분에서 빠진다).
- 정산 대기분은 "(정산 대기 n)"으로 표시한다. 상점은 쓸 수 있는 별(저장분)만 쓰고, 대기분은 따로 안내한다.
- 이미 떠난 장소에서 정산될 별도 있으므로, 대기분이 있는 동안 20초마다 기록을 다시 읽는다.
- 별을 먹는 순간 노란 점 효과와 함께 "+1"이 0.8초 동안 떠오른다.
- 측정: `tests/wallet-check.mjs`(짧은 `GAME_DURATION_MS` 서버 권장, 배포 주소는 `SETTLE_MS=200000`).

## 핑·끊김 기록·외부 감시 (2026-10-02)

- 화면: 방 제목줄 접속 인원 옆에 게임 서버 왕복 시간을 2초마다 표시한다(SDK `room.ping`, 150ms 미만 초록·400ms 미만 노랑·그 이상 빨강).
- 서버: 끊김(`drop`)·같은 세션 복귀(`reconnect`)·복귀 실패(`lost`)를 서비스 로그(`server.out.log`)에 한 줄씩 남긴다(시각·장소·사용자 id·방 인원·종료 코드). 페이지를 떠난 종료(1001, 탭 닫기·새로고침)는 끊김으로 세지 않는다. `/health`의 `connections`에 최근 1시간 횟수(`drop1h`·`reconnect1h`·`lost1h`)를 둔다. 같은 시각 여러 사람이 끊기면 서버·터널, 한 사람만이면 그 사람의 네트워크다.
- 외부 감시: `.github/workflows/health.yml`이 GitHub에서 10분마다 배포 주소·게임 서버 health·PocketBase health를 확인한다(3번 재시도). 실패하면 실행이 실패로 남고 GitHub가 저장소 소유자에게 메일을 보낸다. 실행 요약에 health 응답(끊김 집계 포함)이 남는다. GitHub 예약 실행은 몇 분 늦을 수 있고, 저장소에 60일 동안 활동이 없으면 멈춘다.

## 로컬 우선 이동 (2026-10-03, ADR-005)

- 이전 절들의 입력 대기열·이동 크레딧·예측 대기(`MAX_QUEUED_INPUTS`)와 `input` 메시지는 이 방식으로 대체되어 코드에서 제거됐다. 그 절들은 경위 기록으로 남긴다.
- 클라이언트: 방향키·패드·클릭 경로로 틱마다 `stepInput` 한 걸음을 계산해 바로 그리고, 움직였으면 `move {x,y,seq,fix}`를 보낸다. 내 위치를 서버 snapshot으로 바꾸는 것은 입장 직후와 `fix`가 바뀌었을 때(서버가 걸음을 거절)뿐이다. 그때 `window.__pixeltown.corrections`에 기록한다. 장소 문 판정도 자기 위치로 한다.
- 서버: `Town.move`가 검사한다(표의 `move`). 이동 처리는 메시지가 올 때 하고, 틱은 별 줍기·생성·정산·snapshot만 한다. 허용량은 세션별 `moves`에 두고 끊기면 지운다. 별은 받아들인 위치로 줍는다.
- 메시지 상한: 연결이 멈추면 그동안의 걸음 보고(초당 20개)가 한꺼번에 온다. Colyseus는 1초에 `maxMessagesPerSecond`를 넘게 받으면 연결을 끊으므로 40 → 120으로 올렸다(허용량 4.5초 정체분 약 90개).
- 다른 플레이어 재생(`playback.js`): `ack`는 그 사람의 걸음 수다(걸음 하나 = 50ms). snapshot이 몇 걸음씩 몰려 와도 걸음 순서대로 걷는 속도로 재생한다. 처음 정체에서 한 번 기다린 뒤에는 그만큼 뒤에서 따라간다. `want`(최근 가장 큰 몰림 + 2걸음)보다 더 뒤처지면 최대 3배로 따라잡고, 60걸음을 넘게 뒤처지면(숨긴 탭) 건너뛴다. `want`는 30초에 1걸음씩 줄어든다. 처음 보이거나 다시 들어오거나(ack 감소) 서버가 위치를 바꾸면(ack 그대로, 위치 변경) 그 자리에 바로 그린다.
- 장소 입장(2026-10-03): 방 연결(매칭 HTTP + WebSocket + 첫 snapshot, 핑 300ms에서 약 1.9초)을 기다리지 않는다. 장소가 바뀌면 그 장소의 입구(`entryPoint`)에 내 아바타를 바로 그리고 카메라도 거기 둔다. 연결 중에도 걸을 수 있고, 그 걸음(최대 60걸음 = 3초, 서버 저축 허용량 안)은 입장하자마자 한꺼번에 보낸다. 걷지 않은 채 첫 snapshot이 오면 서버가 놓은 자리(누가 서 있으면 한 칸 옆)로 옮긴다. 걸었는데 서버 자리가 달랐다면 첫 걸음이 거절되어 `fix`로 맞춰진다. 연결 중에는 문으로 다른 장소에 가지 않는다(연결되면 간다).
- 걷기 속도 `STEP_PER_TICK` 3 → 4도트/틱(60 → 80px/s, 2026-10-03 사용자 요청). 모서리 미끄러짐을 포함한 한 걸음 최대 5.5도트로 `MAX_HOP` 6 안이다(세 장소 무작위 80만 걸음으로 확인).
- 측정 도구의 지연 흉내(`JITTER`, rollback·motion·others-check)는 보낼 데이터를 즉시 복사한다. SDK가 인코딩 버퍼를 재사용해, 늦게 보낸 메시지가 나중 메시지 내용으로 덮여 입장 확인이 사라졌다(이전 인계의 "큰 JITTER 입장 시간 초과" 원인).


공개 최소 실시간 전송은 WebSocket permessage-deflate를 사용한다. 작은 입력은 압축하지 않고, 1024byte 이상 메시지에 level 1·동시 zlib 4개·context takeover 없음으로 적용한다. 50ms snapshot과 이동 payload는 유지한다. 타인 표시는 현재 `playback.js`의 걸음 재생이며, 초기 100ms 보간 검증과 구분한다. 압축은 host 설정이며 worker 교체 대상이 아니다.

## 최소 게임: PB 배포와 게임 연결의 분리 (2026-10-08)

- PB는 `scripts/minimal-pocketbase.mjs`, Colyseus는 `scripts/start-minimal-game.mjs`로 각각 실행한다. 운영 launchd label도 `.pocketbase`와 `.colyseus`로 분리한다. 로컬 `dev:all`은 PB 종료 시 PB만 재기동한다. 전체 런처 종료는 게임 정산 후 PB 종료 순서다.
- PB 중단은 기존 WebSocket·room/session·이동 `seq/fix`·snapshot·worker 교체를 종료하지 않는다. 위치와 진행 점수는 살아 있는 접속 호스트에서 유지한다. 정산은 기존 단일 디스크 outbox에 기록하고 PB 복구 후 같은 매치 ID로 재전송한다.
- 지갑 조회 실패는 마지막 성공 잔액을 미확인으로 유지한다. PB 저장 확인 없이 정산 대기를 제거하거나 저장 완료로 표시하지 않는다. 게임 장애 덮개와 이동 차단을 유발하지 않는다.
- 새 게스트 발급·입장은 PB 인증을 요구하므로 중단 중 실패할 수 있다. PB 불가 시 게임 `/health`는 호스트가 정상이면 200, `/ready`는 503이다. ready 503을 이미 연결된 플레이어 퇴장 조건으로 사용하지 않는다.
- PB hooks의 자동 감지와 자동 migration은 계속 끈다. 호환 hooks만 `scripts/deploy-minimal-pb.py --hooks-source <완성된 디렉터리>`로 배포한다. DB online 백업·PB 단독 종료·hooks 배치·PB 단독 시작을 수행하고 게임 PID 유지 여부를 확인한다. 실패 시 이전 hooks로 복구하며 DB를 자동 덮어쓰지 않는다.
- 기존 통합 서비스의 최초 분리는 기본적으로 정상 상태의 빈 로비·outbox 0/0에서 실행한다. 초기 끊김을 사용자가 허용한 경우에만 `--allow-connected`를 사용한다. 기존 서버·DB·로컬 개발 실행은 건드리지 않는다. 비호환 DB 변경, PB 실행 파일 업그레이드, Colyseus 프로세스 교체·호스트 재부팅의 무중단은 별도 범위다.

절차와 한계는 [PB 배포 인계](handoffs/2026-10-08-pb-deployment.md), 실제 로컬·공개 검증과 운영 적용 여부는 PROJECT_STATUS 7절을 따른다.
