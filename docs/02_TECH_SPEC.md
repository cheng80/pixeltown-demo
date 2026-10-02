# PixelTown 기술 명세

기준: 2026-10-02 재제작(PLAN-002) 로컬 소스. 아래 계약은 실제 코드에서 추출했다. 제품 요구는 [PRODUCT_SPEC](01_PRODUCT_SPEC.md)의 FR/BR를 참조한다. 실행 결과·현재 문제·인수인계는 메인 담당이 PROJECT_STATUS에 기록한다.

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

`server.define('town',Town).filterBy(['zone'])`로 장소별 방을 만든다. 각 방 maxClients=32, maxMessagesPerSecond=40이며 메시지 snapshot은 50ms tick마다 전체 상태를 전송한다. 32명 제한은 32명 성능 검증을 의미하지 않는다.

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
| rooms | zone required text unique(zone), title required text max80, max_players required number 1..32; 3개 장소 seed |
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

20명 smoke는 약 3초 입력 workload·10Hz 목표·단일 로컬 머신 기능 점검이다. `PIXELTOWN_LOAD_100=1`이면 100명을 한 장소에 넣어 `filterBy(['zone'])`·`maxClients=32`에 의한 채널 방 자동 분할(32/32/32/4)과 방별 snapshot·채팅을 추가로 측정한다. 다른 채널 방의 사용자는 서로 보이지 않는다. 인터넷 지연·실제 모바일 FPS·운영 수용량은 보증하지 않는다. 이후 규모 확대는 schema delta/관심 영역, 방 분할, PB 저장량, 네트워크·CPU·모바일 렌더링 측정 후 결정한다. 공개 GitHub source push와 운영 배포를 구분한다.

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

