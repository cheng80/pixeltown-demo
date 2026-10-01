# PixelTown 기술 명세

기준: 2026-10-02의 로컬 소스. 이미 병렬 구현 중이며 아래 계약은 실제 코드에서 추출했다. 제품 요구는 [PRODUCT_SPEC](01_PRODUCT_SPEC.md)의 FR/BR를 참조한다. 실행 결과·현재 문제·인수인계는 메인 담당이 PROJECT_STATUS에 기록한다.

## 1. 기술 스택과 파일 경계

| 영역 | 기술 / 소스 | 제약 |
|---|---|---|
| 화면 | React 19, Vite 6, Canvas 2D; src/main.jsx, world.js, style.css | 자체 절차적 도트 렌더링, 전체 화면 게임·HUD |
| PB 브라우저 | pocketbase SDK; root package.json/package-lock.json | 로그인 authStore와 사용자별 조회 |
| 실시간 | colyseus.js 0.16 계열, @colyseus/core 0.16.26, @colyseus/ws-transport 0.16.5 | 설치 잠금파일 기준의 0.16 프로토콜 호환 |
| 서버 PB SDK | pocketbase 0.28.1; backend/config.js | 사용자별 클라이언트와 관리자 저장 클라이언트 분리 |
| DB·훅 | PocketBase 실행기 고정 0.40.4, backend/pb_hooks/matches.pb.js | 결과·보상 트랜잭션과 superuser 전용 커밋 |
| 실행·seed | scripts/dev.mjs, dev-backend.mjs, init-pocketbase.mjs | macOS/Linux, curl/unzip, 바이너리 SHA-256 확인, localhost 제한 |
| 검증 | tests/integration.mjs, tests/report.json | 별도 PB 데이터·outbox, 자기 프로세스만 관리 |

라이브러리의 최신 버전 안내가 아니라 이 저장소의 설치·구현 계약이다. Colyseus 0.16 호환성에 따른 dependency 취약점 설명은 메인 담당의 루트 README를 확인하고 공개 배포 판단 전에 실제 audit 결과를 검토한다. 이 문서는 audit 통과를 주장하지 않는다.

## 2. 아키텍처

```text
React / Canvas
  ├─ PB 로그인·자기 프로필/결과/인벤토리 읽기 → PocketBase
  └─ joinOrCreate('town', {token, zone}) → Colyseus Town
       ├─ per-user PB authRefresh + 자기 프로필 읽기
       ├─ 입력 → 서버 이동·충돌 / 채팅·presence / 게임·점수
       └─ 라운드 종료 → 디스크 outbox
            → 관리자 POST /api/pixeltown/commit-match
            → PB transaction: 모든 참가자의 results + inventory
            → 성공 시 outbox 삭제
```

`world.js`는 표시용 960×640 월드·지형·캐릭터·별을 그린다. 충돌 정본은 `backend/town.js`의 OBSTACLES와 blocked 함수다. 표시 지형과 서버 장애물 위치를 변경할 때 함께 확인한다. Canvas 보간은 서버 위치 사이를 부드럽게 그릴 뿐 권한 위치를 갱신하지 않는다.

`server.define('town',Town).filterBy(['zone'])`로 장소별 방을 만든다. 각 방 maxClients=32, maxMessagesPerSecond=40이며 메시지 snapshot은 100ms tick마다 전체 상태를 전송한다. 32명 제한은 32명 성능 검증을 의미하지 않는다.

## 3. 인증·권한·보안

관련: FR-001/006, BR-001/007.

브라우저는 `users.authWithPassword(email,password)`로 PB 로그인하고 토큰을 방 입장에 전달한다. 서버는 입장마다 새 PB 인스턴스를 생성해 `authStore.save(token)` 후 `users.authRefresh()`를 호출한다. 사용자 ID는 응답 record.id, 이름·색은 자기 profiles 조회에서 확정한다. 인증 저장소를 여러 사용자 간 공유하지 않는다. PB 요청은 5초 타임아웃이다.

토큰·프로필 검증 실패는 401, 허용하지 않은 장소는 400, 같은 사용자의 같은 방 중복 입장은 409다. 전체 장소에 걸친 하나의 세션 제한이나 서버 자동 재접속을 보장하지 않는다. 클라이언트는 연결 끊김 UI에서 명시적 재연결을 제공한다.

users는 자신의 record만 list/view, profiles/results/inventory는 `user = @request.auth.id`에 한해 list/view한다. create/update/delete 규칙은 `null`로 일반 사용자 쓰기를 잠근다. 회원가입은 제외되며 공개 등록 API가 없다. 서버 저장은 별도 관리자 클라이언트가 `_superusers.authWithPassword` 후 수행한다.

개발 seed 계정은 demo1/demo2@pixeltown.local, 공개 데모 비밀번호는 PixelTown123!다. 관리자 인증정보는 최초 실행 시 무작위 생성해 backend/.env.local(mode 0600)에 저장한다. 실제 값을 문서·로그·VITE_ 변수·Git에 넣지 않는다. PB 데이터·outbox·바이너리·node_modules는 공개 대상에서 제외한다.

## 4. 데이터 모델

seed가 관리하는 사용자 데이터 collection은 profiles/results/inventory다. 장소는 PB collection이 아닌 서버 상수·방 metadata다. PB rooms collection을 이미 구현한 것처럼 기록하지 않는다.

| 엔터티 | 필드·제약 |
|---|---|
| users | PB auth collection, email/password 등 PB 인증 필드, name text max40; 사용자 ID 15자리 |
| profiles | user relation(users, required, cascadeDelete), name required text max40, color required text; unique(user) |
| results | user relation, match_id required text, zone required text, score number min0, ended_at required date; unique(match_id,user) |
| inventory | user relation, match_id required text, item required text, quantity number min0; unique(match_id,user) |
| 공통 | profiles/results/inventory에 created autodate(onCreate), updated autodate(onCreate/onUpdate) |

현재 초기화 스크립트는 기존 collection에 누락된 created/updated 필드를 추가한다. 신규 schema 정의만 바꾸는 것으로 기존 데이터베이스의 `sort:'-created'` 오류가 해결되었다고 판단하지 않는다. 실제 초기화 재실행과 UI 조회 400 해소를 별도로 확인한다. 기존 collection의 모든 rule/index를 강제 재구성하는 일반 마이그레이션 도구는 아니다.

DB number min0 제약 외에 commit 훅은 개인 점수 정수 0–64와 전체 점수 합계 0–64를 검증한다. 매치당 0점도 결과와 quantity=0 인벤토리 원장을 저장한다. 인벤토리는 매치별 원장이며 사용자의 전체 별 수는 quantity 합계다. 프로필 색은 서버에서 조회하고 프런트가 보낸 외형 주장으로 덮어쓰지 않는다.

## 5. API·실시간 계약

### API-001 PB 로그인과 자기 기록 읽기

관련: FR-001/006, BR-001/007.

`POST /api/collections/users/auth-with-password` 요청 `{identity,password}` → PB `{token,record}`. Colyseus 내부 검증은 `POST /api/collections/users/auth-refresh`를 SDK로 호출한다. SDK의 `getFullList({filter:pb.filter('user = {:id}',{id:user.id}),sort:'-created'})`로 profiles/inventory/results를 읽는다. PB list 응답을 SDK가 배열로 모은다. 다른 사용자 필터는 빈 목록, 직접 view는 404가 될 수 있다. 결과·보상 일반 사용자 쓰기는 400/403/404 중 거부 응답이 가능하다.

### API-002 방 입장

`joinOrCreate('town', {token,zone})`, zone은 lobby/garden/arcade. 반환 room의 sessionId는 연결 식별자이며 플레이어 id는 인증된 PB 사용자 ID다.

| 방향 | 메시지 | payload / 서버 규칙 |
|---|---|---|
| C→S | input | `{dx,dy}` finite number, 각각 -1..1 clamp, 길이>1 정규화; 좌표·user ID는 받지 않음 |
| C→S | chat | `{text}` 문자열, 제어문자 제거·trim·240자 제한, 사용자별 700ms cooldown; 프런트 입력 제한 200자 |
| C→S | emote | `{}`; 서버 wave 이벤트, 1000ms cooldown |
| C→S | startGame | `{}`; 진행 중 무시, 2000ms cooldown; 클라이언트 score/endsAt 무시 |
| C→S | collect | `{id}` 별 ID; 진행·시간·존재·인증 위치 거리≤32 검증 |
| S→C | snapshot | `{players,zone,game,persistence}` 전체 snapshot |
| S→C | chat | `{id,name,text,at}` 서버 확정 발신자 |
| S→C | emote | `{id,emote:'wave',at}` |
| S→C | gameEnded | `{match_id,zone,ended_at,scores}`; 디스크 outbox 커밋 뒤 알림, PB 저장 완료 신호는 아님 |

player는 `{id,name,x,y,color}`. game은 `{active,endsAt,stars:[{id,x,y}],scores:{[userId]:integer}}`. persistence는 `{status:'pending'|'saved',pending,lastError}`이며 전체 outbox 상태이므로 특정 매치만의 상태는 아니다.

서버는 100ms마다 방향×18 단위를 적용하며 입력이 300ms보다 오래되면 움직이지 않는다. 월드 경계는 x=16..944, y=16..624. 장애물 사각형에 기본 pad14를 적용해 x/y 축을 따로 판정한다. 시작 위치는 (480,400). 별은 장애물 여유 pad40을 피한다. 현재 소스는 초기 5개, 미회수 상한 12개, 1500ms마다 상한 미만이면 1개 생성이다. 회수 후 후속 주기에만 1개를 보충하고 별 0개 조기 종료를 제거한다. 마지막 소스 재대조에서 주기 생성·상한·별 0개 진행을 확인했다. 방의 전원 이탈·dispose에서는 저장을 위한 종료 처리가 별도로 있다. solo도 초기5·상한12·1500ms·30초와 충돌을 적용하며 DB 보상은 없다. default 30000ms, GAME_DURATION_MS override는 1000..60000 clamp다. 현재 참가자와 진행 중 합류자를 scores에 등록하고 이탈자의 점수는 유지한다.

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

### API-004 건강 상태

`GET http://127.0.0.1:12567/health` → 200 `{ok:true,persistence:{status,pending,lastError}}`. PB 장애에도 프로세스 health는 200일 수 있으므로 persistence를 함께 읽는다. PB health는 `GET http://127.0.0.1:18090/api/health`다.

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
| 구현 후 검증 필요 | 상위3 scoreboard·동점 순위·남은 별/상한은 최신 프런트 소스에 추가됨 | 종료 결과·동점 표시의 브라우저 확인 |
| 구현 후 검증 필요 | 초기5·1500ms 주기·상한12·별0개 진행·개인/전체 score64를 최신 서버·훅에서 확인 | cap/재생성/30초·원장 점수 검증과 최신 증거 확인 |
| 검증 후 재확인 | UI records 400 대응으로 created/updated 추가·기존 collection 보완 중 | 최종 schema 초기화 후 브라우저 조회 재확인; 통합 리포트로 UI 수정을 대신하지 않음 |

## 8. 실행·검증·확장

프로젝트 루트 실행:

```sh
npm ci
npm --prefix backend ci
npm run dev:all
npm run build
npm run test:integration
```

macOS start.command도 로컬 실행 진입점이다. dev:all은 PB 18090, Colyseus 12567, Vite 5173을 loopback에 실행하며 점유 포트를 임의 종료하지 않는다. 초기화는 localhost PB만 허용하고 공식 고정 버전 바이너리의 SHA-256을 확인한다.

| 환경변수 | 실제 용도·기본값 |
|---|---|
| VITE_PB_URL | 브라우저 PB, http://127.0.0.1:18090 |
| VITE_GAME_URL | 승인된 브라우저 게임 URL 계약, ws://127.0.0.1:12567; 예제와 동일한 변수 |
| PB_URL | 서버 PB URL, http://127.0.0.1:18090 |
| SERVER_HOST / SERVER_PORT | Colyseus bind, 127.0.0.1 / 12567 |
| PIXELTOWN_LOCAL_DIR | 바이너리·로컬 자산, backend/.local |
| PIXELTOWN_ENV_FILE | 비공개 관리자 파일, backend/.env.local |
| PB_DATA_DIR | 로컬 PB 데이터, backend/.local/pb_data |
| OUTBOX_PATH | 영구 outbox 디렉터리, backend/.local/outbox |
| GAME_DURATION_MS | 게임 기본 30000; 통합 검증은 12000으로 단축 |

`tests/report.json`을 읽어 12 passed / 0 failed를 확인했다. 리포트 범위는 서버 인증·동기화·방 격리·게임 저장·권한·중복·rollback·장애 재시작·20명 로컬 smoke이며, 이 문서 담당이 직접 재실행한 결과가 아니다. 상세 날짜·리비전·유효성·최신 UI 공백은 PROJECT_STATUS에 남긴다. 특히 UI records 400 수정 및 별 주기 생성·점수 상한 변경 이후에는 해당 리포트의 유효성을 재확인해야 한다. 기존 12개 통과는 신규 cap/no accumulation 규칙 통과의 증거가 아니다.

20명 smoke는 약 3초 입력 workload·10Hz 목표·단일 로컬 머신 기능 점검이다. 100명이나 인터넷 지연·실제 모바일 FPS를 보증하지 않는다. 이후 규모 확대는 schema delta/관심 영역, 방 분할, PB 저장량, 네트워크·CPU·모바일 렌더링 측정 후 결정한다. 공개 GitHub source push와 운영 배포를 구분한다.
