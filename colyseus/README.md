# PixelTown 백엔드 계약

Node.js 20+ ES modules. 독립 패키지는 `colyseus/package.json`이다. 루트 프런트 패키지와 별도로 설치한다.

```sh
npm install --prefix colyseus
npm run init --prefix colyseus   # 다운로드, DB/schema/계정 초기화 후 PB 종료
npm run dev --prefix colyseus    # PB + Colyseus 함께 실행 (초기화도 자동 실행)
npm run test --prefix colyseus   # outbox 재시작/실패 복구와 지형 검사
```

`dev` 종료 시 자신이 생성한 프로세스만 종료한다. PB `127.0.0.1:18090`, Colyseus `127.0.0.1:12567`. 이미 PB 포트가 사용 중이면 기존 인스턴스를 수정하지 않고 실패한다. 운영 PB URL을 `init`/`dev`에 전달하면 거부한다.

## 초기화와 설정

`scripts/init-pocketbase.mjs`는 PocketBase **0.40.4** macOS/Linux arm64/amd64 ZIP을 공식 release에서 다운로드하고 공식 checksum과 SHA-256을 비교한다. `curl`, `unzip` 필요. `pocketbase/.local/pocketbase`, `pocketbase/.local/pb_data`, `colyseus/.local/outbox`와 `pocketbase/.env.local`은 각 폴더의 `.gitignore`로 제외된다. 랜덤 superuser 이메일과 32바이트 난수 비밀번호는 `.env.local`에 파일 권한 0600으로 저장하며 로그로 출력하지 않는다. 동일 경로 재실행은 데모 계정/프로필을 중복 생성하지 않는다. users/profiles/rooms/results/inventory 생성은 JS SDK collection API를 사용한다. 별도 migration 명령은 없다.

| 환경변수 | 기본값 / 용도 |
|---|---|
| `PB_URL` (또는 `POCKETBASE_URL`) | `http://127.0.0.1:18090`; 서버의 PB 연결 주소. Mac mini `.env`는 `POCKETBASE_URL=http://127.0.0.1:8091` |
| `SERVER_HOST` / `SERVER_PORT` (또는 `PORT`) | `127.0.0.1` / `12567`; 서버 바인드. Mac mini는 `PORT=2567` |
| `ALLOWED_ORIGINS` | 정확한 브라우저 Origin 목록(쉼표). 미지정 시 `https://pixeltown.fastmake.net`(게임 배포 주소)만. Origin 없는 요청(노드 클라이언트·curl)은 통과하고 인증은 그대로 적용. `dev:all`은 Vite 주소를 넣는다 |
| `MONITOR_ORIGINS` | `/monitor/` 관리 요청 허용 Origin. 기본 `https://pixeltown-rt.fastmake.net`과 서버 포트의 127.0.0.1/localhost |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | outbox 저장용 superuser. 지정하면 `PIXELTOWN_ENV_FILE`보다 우선(Mac mini `.env`, 0600) |
| `GAME_DURATION_MS` | 정산 주기 `180000`; 1000~300000. 통합 테스트는 `30000` |
| `PIXELTOWN_LOCAL_DIR` | `pocketbase/.local`; 테스트 데이터 격리 |
| `PIXELTOWN_ENV_FILE` | `pocketbase/.env.local`; 관리자 credential 파일, 반드시 gitignored 경로 사용 |
| `PB_DATA_DIR` | `${PIXELTOWN_LOCAL_DIR}/pb_data`; 개발 PB DB |
| `OUTBOX_PATH` | `${PIXELTOWN_LOCAL_DIR}/outbox`; 재시작 후 유지할 폴더 |

주소 변경은 독립 서버 실행에 적용된다. 개발 launcher는 `PB_URL`을 localhost:18090, `SERVER_HOST`를 loopback, `SERVER_PORT`를 12567로 제한한다. credential 파일은 config가 직접 읽으며 다른 환경변수는 프로세스 환경으로 전달한다. 프런트는 `VITE_PB_URL`, `VITE_GAME_URL`을 사용한다.

초기 계정:

- `demo1@pixeltown.local` / `PixelTown123!`
- `demo2@pixeltown.local` / `PixelTown123!`

## 인증과 데이터

각 접속마다 별도 PB client를 만들고 `users.authRefresh()`로 토큰을 검증한다. `rooms`에서 해당 zone 메타데이터를 조회하고 zone과 `max_players=32`를 확인한다. 초기화는 lobby/garden/arcade 메타데이터를 중복 없이 생성한다. 사용자 ID·이름·색은 검증된 users 및 profiles에서 읽고 클라이언트가 보내는 ID/이름/점수는 받지 않는다. 관리자 client는 저장 작업에만 사용하며 사용자 authStore와 공유하지 않는다.

| Collection | 필드 | 조회 규칙 / 고유 키 |
|---|---|---|
| `users` | PB auth 필드, `name` | 본인만 조회; 신규 가입 API 비활성 |
| `rooms` | `zone`, `title`, `max_players=32`, `created`, `updated` | 로그인 사용자 조회; unique `zone`; 일반 사용자 쓰기 금지 |
| `profiles` | `user` relation, `name`, `color` | `user = @request.auth.id`; unique `user` |
| `results` | `user`, `match_id`, `zone`, `score`, `ended_at` ISO 날짜 | 본인만 조회; unique `(match_id,user)` |
| `inventory` | `user`, `match_id`, `item` (`star`), `quantity` | 본인만 조회; unique `(match_id,user)` |

`profiles`/`results`/`inventory`는 `created`(autodate onCreate), `updated`(autodate onCreate/onUpdate)를 포함한다. `getFullList({sort:"-created"})`를 지원한다. 기존 개발 DB에 필드가 없으면 `seed()` 재실행 시 누락 필드를 추가한다. 기존 행의 과거 생성 시각은 복구하지 못한다.

모든 collection의 일반 사용자 create/update/delete는 잠겨 있다. `inventory`는 경기별 보상 원장이다. 보유 별 합계는 자신의 `quantity` 합계이며, 결과와 함께 점수 0인 보상 행도 기록한다.

## Colyseus 계약

설치 버전(Mac mini와 동일): `@colyseus/core 0.18.18`, `@colyseus/ws-transport 0.18.4`, `@colyseus/schema 5.0.35`, `@colyseus/monitor 0.18.6`, `express 5.2.1`, 프런트·테스트 `@colyseus/sdk 0.18.4`. 설치된 0.18 `Room` 소스에서 인스턴스 `onAuth(client, options, context)`와 `context.token` 전달을 확인했다. 토큰은 join 옵션에 넣지 않는다. 0.18의 `Room.inputs`는 입력 API 예약 이름이라 이동 입력은 `moveInputs`에 둔다.

```js
import { Client } from '@colyseus/sdk';
const client = new Client(VITE_GAME_URL);
client.auth.token = pb.authStore.token;
const room = await client.joinOrCreate('town', { zone: 'lobby' });
```

`server.js`는 express 위에 `/health`(outbox 상태 포함), `/health/pocketbase`, `/me`(Bearer 사용자 토큰), PocketBase `_superusers` Basic 인증으로 보호한 `/monitor/`(`monitor-auth.js`, outbox 서비스 계정 `PB_ADMIN_EMAIL`은 거부), Origin allowlist(HTTP·WebSocket)를 둔다. 로컬과 Mac mini가 같은 파일을 쓴다.

zone은 `lobby` / `garden` / `arcade`; `filterBy(['zone'])`로 분리. zone 변경은 기존 room을 leave한 후 새 zone으로 join한다. 동일 사용자의 같은 zone 중복 접속은 거부한다. 최대 32명, 서버 스냅샷 10Hz.

메시지 `snapshot`은 JSON 객체로 전달하며 Colyseus schema state를 사용하지 않는다.

```js
{
  players: [{id: 'PB_USER_ID', name: 'Demo 1', x: 480, y: 400, color: '#ffb347'}],
  zone: 'lobby',
  game: {active: false, endsAt: 0, stars: [{id: 'MATCH_UUID:0', x: 100, y: 100}], scores: {'PB_USER_ID': 0}},
  persistence: {status: 'saved', pending: 0, lastError: null}
}
```

| 수신 메시지 | Payload | 서버 동작 |
|---|---|---|
| `input` | `{dx,dy}` | 유한 숫자, 각 축 -1~1 clamp 후 벡터 정규화; 마지막 입력만 tick에서 적용 |
| `chat` | `{text}` | 제어문자 제거, trim, 최대 240자; 사용자별 700ms 간격 |
| `startGame` | `{}` | 진행 경기 없을 때 초기 5별 생성 및 서버 마감 시간 결정 |
| `collect` | `{id}` | 진행 여부/마감/별 존재/거리 ≤32px를 검증; 별 제거 후 점수 +1 |
| `emote` | `{}` | 사용자별 1000ms 간격으로 wave 전송 |

발신 `chat`: `{id,name,text,at}`; `emote`: `{id,emote:'wave',at}`; `gameEnded`: `{match_id,zone,ended_at,scores}`. `at`/`endsAt`은 epoch milliseconds. scores 키와 players.id는 PB user ID. 참가자는 나가도 결과 대상에 남으며 진행 중 신규 참가자는 0점으로 추가된다(경기 누적 참가자 최대 64명). 타이머 종료 또는 마지막 참가자 퇴장 시 경기를 완료한다. 별을 모두 수집해도 타이머까지 경기와 생성기를 유지한다.

world `960×640`, spawn `(480,400)`, 속도 `180px/s`, 경계 여백 16px, 충돌 반경 14px. input은 프런트에서 10Hz 보내며 300ms 동안 새 입력이 없으면 멈춘다. 충돌은 x/y 축별 slide를 적용한다. 건물과 분수 rect `[x,y,w,h]`:

```js
[[128,116,151,93], [664,119,148,94], [669,445,130,80], [158,450,123,78], [404,284,145,81]]
```

지역 room마다 초기 5개, 이후 1500ms마다 1개 생성하며 미회수 별은 `MAX_STARS=12`를 넘지 않는다. 상한에서 생성은 생략하고 수집 이후 다음 생성 주기에 보충한다. 늦어진 tick은 누락 주기를 몰아서 생성하지 않는다. ID는 경기 UUID와 증가 카운터로 구성되어 재사용하지 않는다. 60초 경기의 전체 생성 최대는 44개이며 PB commit은 사용자 점수와 전체 점수 합계를 각각 64 이하로 제한한다.

첫 번째 별은 spawn 근처 `(480,430)`에 고정하며 나머지 별은 장애물에 40px 여백을 두고 생성한다. 순간이동·클라이언트 점수·임의 경기 완료 메시지는 지원하지 않는다.

## 원자적 저장과 outbox 복구

`pocketbase/pb_hooks/matches.pb.js`의 `POST /api/pixeltown/commit-match`는 superuser만 접근할 수 있다. 일반 PB 사용자 토큰은 거부된다. 서버 내부 점수로 생성한 경기 결과만 이 endpoint에 전달한다. `$app.runInTransaction` 안에서 모든 참가자의 results+inventory를 저장하므로 중간 실패는 전체 롤백된다. 동일 `(match_id,user)` 재전송은 기존 점수/보상을 확인하고 중복 없이 성공한다. 같은 경기 키에 다른 점수는 거부한다.

완료 시 outbox JSON을 임시 파일에 fsync 후 rename하여 기록하고 저장을 시도한다. 실패 파일은 유지하고 2초마다 재시도한다. 서버 재시작 즉시 기존 JSON을 재처리한다. PB 응답 직후 서버가 중단되어도 고유 인덱스와 재전송 검증으로 이중 지급하지 않는다. 영구 실패 역시 삭제하지 않고 pending으로 보존한다. `gameEnded`는 디스크 outbox 기록 완료를 의미하며 PB commit 완료는 `persistence.pending === 0`으로 확인한다. persistence는 서버 전체 queue 상태다.

각 실행 폴더는 부모 프로젝트 루트에서 해석한다. PB를 직접 실행하는 경우 `--hooksDir=pocketbase/pb_hooks`를 반드시 지정한다. 독립 테스트는 임시 DB/env/outbox를 사용하고 자신이 만든 프로세스만 제어한다.

`GET http://127.0.0.1:12567/health` → `{ok:true,service:'pixeltown-colyseus',persistence:{status:'saved'|'pending',pending,lastError}}`.

별 생성·상한·정산은 루트 `npm run test:integration`이 별도 포트와 임시 DB로 검증한다.

## 확인 결과와 제한

실제 PocketBase/Colyseus에서 로그인, 잘못된 토큰 거부, 2명 WebSocket, 이동, chat/emote, 원거리 수집 거부, 게임 마감, results+inventory 저장, 같은 경기 재전송, 일반 사용자 write/endpoint 거부, transaction 롤백을 검증했다. `npm test`는 outbox 실패·재구성·단일 replay와 충돌 지형을 검증한다. 별도 통합 `tests/report.json`은 12/12 통과했으며 PB 장애→서버 재시작→복구, 사용자별 접근 격리, 양수 수집/보상, 중복 replay, 20명 10Hz 입력을 검증했다. 20명 검증은 단일 로컬 머신의 짧은 기능 부하 검사로 수용량 보장은 아니다.

Colyseus 0.18은 패치된 `nanoid 3.3.19`를 쓴다. 0.16 때 두었던 `vendor/nanoid` 대체 모듈은 0.18 전환(PLAN-004)으로 제거했다. 루트·colyseus `npm audit` 0건.

참고: [PocketBase custom routing](https://pocketbase.io/docs/js-routing/), [PocketBase records/transactions](https://pocketbase.io/docs/js-records/), [Colyseus room authentication](https://docs.colyseus.io/auth/room). 런타임 인증 규약은 설치된 0.18.18 소스를 기준으로 확인했다.
