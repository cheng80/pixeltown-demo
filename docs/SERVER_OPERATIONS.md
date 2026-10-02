# PixelTown 서버 관리

갱신일: 2026-10-02 (Asia/Seoul). Mac mini의 PocketBase·Colyseus 설치 구성과 게임 이전 작업을 관리한다. 비밀번호·토큰·개인키 내용은 이 문서에 기록하지 않는다.

## 1. 현재 상태

- 기존 대화: [게임 기술 스택 검토](codex://threads/01a0f7f4-e596-7630-8350-b16e7b87e148).
- Mac mini의 두 서비스와 Cloudflare 공개 경로는 설치되어 있다. 이번 조회에서 내부 PocketBase health, Colyseus health, Colyseus → PocketBase 연결은 모두 정상 응답했다.
- **게임 이전 완료(2026-10-02, PLAN-004).** Mac mini Colyseus가 게임 `town` 방(이동·채팅·장소 분리·상시 별 이벤트·3분 정산·outbox)을 서비스한다. PocketBase에 게임 컬렉션·훅·상점이 추가되었다. 이전 `lobby` 검증 방은 새 서버에 없다(롤백 시 복원).
- 이 컴퓨터의 Vite 프런트(`npm run dev:remote`, http://127.0.0.1:5173)가 공개 HTTPS/WSS로 원격 서버에 붙는다. 원격 2유저 기능·보안·저장·복구 검증 8/8 통과(9절).

## 2. 접속 주소

| 용도 | 주소 | 인증 / 설명 |
|---|---|---|
| Mac mini SSH | `cheng80@100.92.43.82` | Tailscale 연결과 등록된 SSH 키 필요 |
| **게임(배포)** | **https://pixeltown.fastmake.net** | Cloudflare Pages 프로젝트 `pixeltown`(GitHub `cheng80/pixeltown-demo` `main` 자동 배포). 기본 주소 https://pixeltown-4x2.pages.dev |
| PocketBase API | https://pixeltown-pb.fastmake.net | 2026-10-02 `pixeltown.fastmake.net`에서 이전. 일반 게임 사용자는 PocketBase 사용자 인증 |
| PocketBase 관리자 | https://pixeltown-pb.fastmake.net/_/ | 기존 관리자 계정 |
| PocketBase 상태 | https://pixeltown-pb.fastmake.net/api/health | 공개 상태 조회 |
| Colyseus HTTPS | https://pixeltown-rt.fastmake.net | HTTP matchmaking·상태 API |
| Colyseus WebSocket | `wss://pixeltown-rt.fastmake.net` | PocketBase 사용자 인증 후 방 입장 |
| Colyseus 상태 | https://pixeltown-rt.fastmake.net/health | 서버 상태 |
| Colyseus → PocketBase 상태 | https://pixeltown-rt.fastmake.net/health/pocketbase | 백엔드 연결 상태 |
| Colyseus Monitor | https://pixeltown-rt.fastmake.net/monitor/ | PocketBase 관리자 인증으로 보호 |
| 로컬 게임 화면 | http://127.0.0.1:5173 | 현재 컴퓨터의 Vite 프런트. 연결 대상은 실행 모드에 따라 다름 |

관리자 이메일은 `cheng80@gmail.com`이다. 비밀번호는 기존 관리자 자격증명을 사용하며 이전 작업에서 재설정하지 않는다. Monitor는 브라우저 로그인 창으로 관리자 여부를 확인하고 화면과 관리 API 모두 보호한다. 일반 사용자는 접근할 수 없다.

## 3. Mac mini 설치 경로와 자동 실행

| 서비스 | 설치 경로 | 내부 주소 | launchd label |
|---|---|---|---|
| PocketBase | `/Users/cheng80/Servers/pixeltown` | `http://127.0.0.1:8091` | `com.fastmake.pixeltown.pocketbase` |
| Colyseus | `/Users/cheng80/Servers/pixeltown-colyseus` | `http://127.0.0.1:2567` | `com.fastmake.pixeltown.colyseus` |

PocketBase 데이터는 `/Users/cheng80/Servers/pixeltown/pb_data`에 있다. Colyseus는 `runtime/bin/node --env-file=.env server.mjs`로 실행한다. `.env`에는 서버 설정만 안전하게 보관하며 파일 전체를 로그·문서에 출력하지 않는다.

서비스 등록 파일:

```text
/Users/cheng80/Library/LaunchAgents/com.fastmake.pixeltown.pocketbase.plist
/Users/cheng80/Library/LaunchAgents/com.fastmake.pixeltown.colyseus.plist
```

확인된 원격 버전:

| 구성 요소 | 버전 |
|---|---|
| PocketBase binary | `0.39.7` |
| `@colyseus/core` | `0.18.18` |
| `@colyseus/monitor` | `0.18.6` |
| `@colyseus/schema` | `5.0.35` |
| `@colyseus/sdk` | `0.18.4` |
| `@colyseus/ws-transport` | `0.18.4` |
| `express` | `5.2.1` |
| `pocketbase` JavaScript SDK | `0.28.1` |

저장소도 같은 Colyseus 버전으로 올렸다(서버 `colyseus/package.json`, 프런트 `@colyseus/sdk 0.18.4`). 게임 서버의 패키지는 원격 `app/colyseus/node_modules`에 따로 설치되어 있고, 기존 루트 `node_modules`(이전 `lobby` 서버용)는 롤백용으로 그대로 둔다. 로컬 PB는 0.40.4지만 같은 훅이 0.39.7 바이너리로도 통합 15개를 통과했다.

## 4. 연결 구조와 실행 모드

```text
로컬 브라우저 / Vite
  ├─ HTTPS → Cloudflare Tunnel → Mac mini PocketBase 127.0.0.1:8091
  └─ WSS   → Cloudflare Tunnel → Mac mini Colyseus 127.0.0.1:2567
                                      └─ 내부 HTTP → PocketBase 8091
```

외부 TLS는 Cloudflare에서 제공한다. Mac mini 서비스의 loopback 바인딩을 유지한다. 브라우저에는 공개 HTTPS/WSS 주소를 제공하고 서버 간 통신에는 내부 주소를 쓴다.

게임 이전이 끝난 뒤 프런트에 필요한 공개 환경변수:

```dotenv
VITE_PB_URL=https://pixeltown-pb.fastmake.net
VITE_GAME_URL=wss://pixeltown-rt.fastmake.net
```

`VITE_` 변수는 브라우저에 공개된다. 관리자 이메일·암호·서버 토큰을 넣지 않는다. 위 값은 저장소 루트 `.env.remote`에 있다.

| 실행 모드 | 명령 | 주소 |
|---|---|---|
| 배포(Cloudflare Pages) | `main` push 시 자동 빌드 `npm run build:remote` → `dist`, `NODE_VERSION=22` | https://pixeltown.fastmake.net |
| 원격 연동(프런트만 로컬) | `npm run dev:remote` | http://127.0.0.1:5173 → `https://pixeltown-pb.fastmake.net`, `wss://pixeltown-rt.fastmake.net` |
| 독립 로컬 백엔드 | `npm run dev:all` (5173을 원격 모드가 쓰면 `PIXELTOWN_PB_PORT=18190 PIXELTOWN_GAME_PORT=12667 PIXELTOWN_WEB_PORT=5273 npm run dev:all`) | http://127.0.0.1:5173 또는 5273 |

`dev:all`은 로컬 PocketBase·Colyseus를 시작하고 `VITE_*`를 로컬 주소로 덮어쓰므로 원격 연동에 쓰지 않는다. 두 모드는 포트만 다르면 동시에 실행된다.

Colyseus `ALLOWED_ORIGINS`(2026-10-02 Pages 추가 후): `https://pixeltown.fastmake.net`(게임 배포), `https://pixeltown-4x2.pages.dev`(Pages 기본 주소), `https://pixeltown-rt.fastmake.net`, `http://localhost:5173`, `http://127.0.0.1:5173`. Pages 미리보기 배포(`<hash>.pixeltown-4x2.pages.dev`)는 허용하지 않는다. 예전 설명: `ALLOWED_ORIGINS`에는 이미 `https://pixeltown.fastmake.net`, `https://pixeltown-rt.fastmake.net`, `http://localhost:5173`, `http://127.0.0.1:5173`이 정확히 들어 있어 이전 작업에서 바꾸지 않았다. wildcard는 쓰지 않는다. 원격 모드를 다른 포트로 띄우면 그 Origin을 추가해야 한다. PocketBase는 기본 CORS로 5173에서 동작함을 확인했다.

## 5. 접속과 일상 점검

현재 컴퓨터에서 SSH 접속:

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 \
  -i /Users/cheng80/.ssh/stonematch_macmini_ed25519 \
  cheng80@100.92.43.82
```

아래 명령은 Mac mini의 SSH 셸에서 실행한다:

```sh
launchctl print gui/501/com.fastmake.pixeltown.pocketbase
launchctl print gui/501/com.fastmake.pixeltown.colyseus
curl -fsS http://127.0.0.1:8091/api/health
curl -fsS http://127.0.0.1:2567/health
curl -fsS http://127.0.0.1:2567/health/pocketbase
```

서비스 상태·PID·실행 경로와 내부 health를 먼저 확인하고 외부 HTTPS/WSS를 확인한다. 내부 정상·외부 실패면 Tunnel/DNS/접근 정책을, HTTPS 정상·방 입장 실패면 SDK 버전·room 이름·토큰·origin을, 저장만 실패하면 PB 권한·훅·outbox를 조사한다.

원격 Colyseus 코드·환경변수 변경 후 해당 서비스만 재시작:

```sh
launchctl kickstart -k gui/501/com.fastmake.pixeltown.colyseus
```

PB 재시작이 필요한 변경은 다음 명령을 사용한다. 두 명령은 변경을 적용할 때만 실행하며 재시작 직후 health와 실제 사용자 흐름을 재확인한다.

```sh
launchctl kickstart -k gui/501/com.fastmake.pixeltown.pocketbase
```

로그 위치는 해당 plist의 `StandardOutPath` / `StandardErrorPath`에서 확인한다. PB 설치 당시 로그는 `pocketbase.out.log`, `pocketbase.err.log`였다. 로그를 공유할 때 토큰·암호·개인정보를 제거한다.

## 6. 게임 이전과 데이터 보존

### 6.1 실제 배치(2026-10-02)

| 위치 | 내용 |
|---|---|
| `pixeltown-colyseus/server.mjs` | `import "./app/colyseus/server.js"` 한 줄. launchd plist는 바꾸지 않았다 |
| `pixeltown-colyseus/app/colyseus/` | 저장소 `colyseus/`의 `server.js`·`town.js`·`outbox.js`·`config.js`·`monitor-auth.js`·package·lock, 독립 `node_modules`(`npm ci`) |
| `pixeltown-colyseus/app/shared/` | `world.js`, `catalog.json` |
| `pixeltown-colyseus/app/scripts/` | `init-pocketbase.mjs`(`seed(_, {remote:true})`), `provision-accounts.mjs` |
| `pixeltown-colyseus/outbox/` | 영구 outbox(0700). `.env`의 `OUTBOX_PATH` |
| `pixeltown-colyseus/server.lobby-20261002.mjs` | 이전 `lobby` 서버 진입점(롤백용) |
| `pixeltown/pb_hooks/` | 기존 `realtime.pb.js` 유지 + `matches.pb.js`, `shop.pb.js`, `profile.pb.js`(캐릭터, PLAN-005), `guest.pb.js`(게스트 가입, PLAN-006), `shop_lib.js`, `catalog.json` |

원격 `.env` 키(값은 기록하지 않음): `PORT`, `POCKETBASE_URL`, `ALLOWED_ORIGINS`, `NODE_ENV`(기존) + `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`, `OUTBOX_PATH`(추가). 파일 권한 0600. `PB_ADMIN_*`는 outbox 저장 전용 superuser `colyseus-outbox@pixeltown.local`이며 PocketBase CLI(`pocketbase superuser create`)로 만들었다. 암호는 원격에서 `openssl rand -hex 32`로 생성해 `.env`에만 썼고 출력하지 않았다. 기존 관리자 `cheng80@gmail.com`은 바꾸지 않았다. 이 계정은 superuser지만 Colyseus Monitor 보호가 `PB_ADMIN_EMAIL`을 거부한다(원격 확인: Monitor 401, PB 저장 인증 200). `.env` 0600 권한은 그대로 유지한다.

데이터 이전 내역:

- 스키마: `rooms`, `profiles`(outfit·room 포함), `results`, `inventory`, `purchases` 컬렉션과 unique 인덱스, `rooms` 행 3개(lobby/garden/arcade). `users`는 기존 필드와 본인 조회·수정·삭제 규칙을 그대로 두었다. 공개 가입은 이후 사용자 결정으로 차단했다(`createRule = null`, [PLAN-004](plans/PLAN-004.md) 10절).
- 사용자 데이터: 로컬 `pb_data`·로컬 데모 계정(`demo1/2`, 공개 암호)은 옮기지 않았다. 원격 사용자는 이전 시점에 0명이었다.
- 테스트 계정: `pixeltown-test1-…@fastmake.net`, `pixeltown-test2-…@fastmake.net`(이름 Tester 1/2). 24바이트 무작위 암호. 자격증명은 이 컴퓨터의 `pocketbase/.local/remote-accounts.json`(0600, git 무시)에만 있다. 계정은 다음 테스트를 위해 남겨 두었다. 검증으로 생긴 결과·별 보상·구매(리본 모자·의자)·미니룸 배치 행도 남아 있다.
- 게스트 자동 가입(PLAN-006): 첫 화면에서 캐릭터를 만들면 `POST /api/pixeltown/guest`가 `guest-…@guest.pixeltown.local` 사용자와 프로필을 만든다. 남용 방지(PLAN-006 5절): 방문자 IP당 게스트 발급 시간당 20회, PB 기본 rate limit 활성, `trustedProxy.headers=["CF-Connecting-IP"]`, `excludedIPs=127.0.0.1, ::1`(Colyseus·outbox 제외), 30일 미접속 게스트는 매일 04:17 자동 삭제. 카운터는 PB 메모리에만 있어 `launchctl kickstart -k gui/501/com.fastmake.pixeltown.pocketbase`로 초기화된다. 즉시 정리: superuser로 `POST /api/pixeltown/guest-cleanup {"days":30}`. 게스트 수 확인(`sqlite3 pb_data/data.db "select count(*) from users where email like '%@guest.pixeltown.local'"`). `users` 컬렉션 직접 가입은 여전히 막혀 있다(일반 요청 403).
- 이전 설명: 공개 가입은 막혀 있다(일반 요청 403). 새 사용자는 superuser 권한으로만 만들며, 게임 입장에 필요한 `profiles`까지 한 번에 만드는 `provision-accounts.mjs`를 쓴다. 관리 화면(`/_/`)에서 만들면 `profiles`도 직접 추가해야 한다. 서버 폴더의 옛 `verify.mjs`(lobby 검증)는 공개 가입에 의존하므로 더 이상 쓰지 않는다:

```sh
# 이 컴퓨터에서. 입력 JSON: [{"email","password","name","color"}]. 암호는 stdin으로만 전달
ssh … 'cd /Users/cheng80/Servers/pixeltown-colyseus/app && ../runtime/bin/node --env-file=../.env scripts/provision-accounts.mjs' < accounts.json
```

PocketBase는 `pb_hooks` 파일이 바뀌면 스스로 재시작하며, 그동안 약 2–3초 API 요청이 실패한다("Something went wrong.", status 0). 훅이 바뀌는 배포는 사용자가 적을 때 한다.

코드 갱신 배포: 저장소 루트에서 `scripts/deploy-macmini.sh`(app·게임 훅 복사, `npm ci`, 게임 스키마 추가분 반영(`seed` remote 모드, 추가만), Colyseus만 재시작, 내부 health 출력). 스키마 변경이 있으면 Mac mini에서 `cd …/pixeltown-colyseus/app && ../runtime/bin/node --env-file=../.env --input-type=module -e 'const m=await import("./scripts/init-pocketbase.mjs");await m.seed(undefined,{remote:true})'`.

### 6.2 백업과 롤백(실제 위치)

추가 백업: 가입 차단 직전 `…/backups/pixeltown-signup-close-20261002/data.db`, 캐릭터 기능(PLAN-005) 반영 직전 `…/backups/pixeltown-character-20261002/`(DB·`pb_hooks`·`app`), 닉네임 유니크 인덱스 직전 `…/backups/pixeltown-nickname-20261002/data.db`, 닉네임 비교 키 확장 직전 `…/backups/pixeltown-nickname-key-20261002/data.db`, 게스트 가입 직전 `…/backups/pixeltown-guest-20261002/`(DB·`pb_hooks`), 남용 방지 적용 직전 `…/backups/pixeltown-abuse-limits-20261002/`(DB·`pb_hooks`).

백업 `/Users/cheng80/Servers/backups/pixeltown-migration-20261002/`(0700): `data.db`·`auxiliary.db`(실행 중 DB의 SQLite online `.backup`, integrity_check ok, sha256 `c2294748…523b` / `2c5d66e3…d717`), `pb_hooks/`, `types.d.ts`, `colyseus/`(server·server.before-monitor·monitor-auth·verify·package·lock·README·.env), `launchd/`(plist 2개). 롤백 명령은 [PLAN-004](plans/PLAN-004.md) 5절.

### 6.3 이전 절차 원칙

1. 현재 원격 코드·훅·package lock·서비스 설정·DB의 백업과 복구 경로를 확보한다. DB는 PocketBase 지원 백업 또는 SQLite backup으로 일관된 사본을 만든다. 실행 중인 DB를 단순 복사하지 않는다.
2. 원격의 기존 관리자·사용자·token key·설정·Monitor를 보존하며 게임 스키마와 훅을 멱등 추가한다. 로컬 `pb_data` 전체를 원격에 덮어쓰지 않는다.
3. `profiles`, `rooms`, `results`, `inventory`, `purchases`와 공용 catalog·map·인증·결과 저장·상점 훅을 이전한다. 개발 데이터는 필요한 항목만 선택하고 사용자 ID 충돌을 처리한다.
4. 원격 전용 사용자별 인증과 서버 점수·결과 원자 저장·`match_id` 중복 방지·영구 outbox 재시도/복구를 유지한다. outbox 위치·backup 경로는 실제 배치 후 이 문서에 기록한다.
5. 2명 로그인·이동·채팅·방 이동·별 상한/회수/정산·상점/착용·미니룸 저장·재로그인을 원격 백엔드로 검증한다. 미인증·교차 사용자 접근·위조 차단과 Monitor 보호도 확인한다.
6. 원격 테스트 계정은 강한 무작위 자격증명을 사용한다. 공개된 로컬 데모 암호를 공개 서버에 그대로 적용하지 않는다. 시험 계정의 보존/삭제 내역은 검증 결과에 기록한다.

롤백은 백업한 코드·의존성·훅을 복원하고 해당 서비스만 재시작한 뒤 health·기존 인증·게임 연결을 확인한다. DB 복원은 서비스를 안전하게 중단하고 백업 이후의 사용자 데이터 변경을 확인한 후 수행한다. 배포 중 DB 쓰기를 줄이는 절차와 실제 백업 위치는 이전 담당이 기록한다.

## 7. 관리 경계와 기록 갱신

- 이번 승인 범위는 `pixeltown` / `pixeltown-colyseus` 게임 이전·연결·테스트다.
- `stonematch` 서비스·`8090`·기존 관리자 암호, Oracle A1 재시도 예약, 다른 launchd 서비스·Cloudflare 터널은 변경하지 않는다.
- 공개 Tunnel로 100명 부하 시험을 실행하지 않는다. 100명 검증은 독립 로컬 서버에서만 수행하며 원격은 소수 사용자 기능 테스트로 시작한다.
- Claude는 `main`에서 작업하고 자신의 터미널·대화를 닫지 않는다. 브랜치/worktree 정리는 메인 관리자의 별도 지시에 따른다.
- 게임 이전이 끝나면 이 문서의 실제 버전·실행 명령·백업 위치·데이터 이전 내역·outbox 경로를 갱신한다. 상세 검증은 `verification.md`, 진행 상태는 `03_PROJECT_STATUS.md`에 기록한다.

## 8. 이전 전 확인 근거(메인 관리자)

| 항목 | 이번 결과 |
|---|---|
| SSH 연결 및 원격 package 조회 | 성공 |
| PocketBase `--version` | `0.39.7` |
| 내부 PB `/api/health` | 정상 |
| 내부 Colyseus `/health` | `ok: true` |
| 내부 Colyseus `/health/pocketbase` | `pocketbase: connected` |
| 외부 HTTPS/WSS·Monitor 보호 | 이전 대화의 설치 검증 기록. 이번에는 미재검증 |
| 현재 게임 `town` 원격 이전 및 기능 테스트 | Claude에 요청, 작업 시작 확인. 완료 전 |

## 9. 이전 후 검증(2026-10-02, Claude)

원격 증거는 로컬 테스트 결과와 별개다. 상세 수치는 [verification.md](verification.md) 10절, 원본은 `tests/remote-report.json`.

| 항목 | 결과 | 방법 |
|---|---|---|
| 내부·공개 health, `/health/pocketbase` | 정상 | curl, outbox `pending 0` |
| Monitor 보호 | 미로그인·게임 사용자·오답 모두 401 | `tests/remote-check.mjs` |
| 공개 가입 차단(사용자 결정) | 가입 요청 403, 서버 측 발급 임시 계정 로그인·삭제 확인, 원격 검증 7/7 재통과 | `users.createRule = null` |
| 미허용 Origin | 403 | curl `Origin: https://unapproved.example` |
| 2유저 로그인·입장·이동·채팅(발신자 위조 무시)·장소 분리 | 통과 | 공개 HTTPS/WSS |
| 미인증·위조·교차 사용자(잘못된/없는 토큰, 프로필 수정, 결과·구매 위조, 사용자 토큰 commit, 타인 기록) | 모두 거부 | 같은 스크립트 |
| 별 5→12 상한 유지·10개 회수·새 ID 보충 | 통과 | 기본 6초 생성 |
| 기본 3분 정산·결과·별 보상 저장 | 측정 주기 179.8초, 점수 10 저장 | 같은 스크립트 |
| 상점 구매·중복·잔액 부족·장착·문 앞 배치 거부·미니룸 저장·재로그인 복원·상대 화면 반영 | 통과 | 같은 스크립트 |
| `match_id` 멱등·충돌 거부·부분 실패 롤백 | 재전송 200(행 1개), 충돌 400, 롤백 404·0행 | Mac mini에서 `tests/remote-persistence.mjs` |
| outbox 장애·재시작 복구 | PB 중단(공개 502) 중 정산 → 디스크 1건 → Colyseus 재시작 후 pending 1 → PB 복귀 후 저장 | `PIXELTOWN_REMOTE_OUTAGE=1`, 30초 단축은 끝에 제거 |
| 캐릭터 만들기·닉네임 유일성(PLAN-005) | 원격 검증 8/8, Tester 2명 첫 입장 화면 확인, unique 인덱스 적용(이름 변경 0건), outbox 계정 Monitor 401 | verification 11절 |
| `scripts/deploy-macmini.sh` 실제 실행 | 원격 파일이 커밋 `c056e01`과 sha256 일치, 실행 후 health·`/health/pocketbase` 정상, `realtime.pb.js` 보존, 브라우저 2유저 재통과 | 배포 스크립트 |
| 로컬 프런트(5173) 원격 모드 2유저 | 통과, 요청 대상 `https://pixeltown.fastmake.net`·`wss://pixeltown-rt.fastmake.net`, 페이지 오류 0 | `tests/remote-ui.mjs`, `docs/assets/remote-lobby-two-users.png` |

미검증·제약: 공개 경로 부하(정책상 하지 않음), 실제 모바일 기기, 관리자 계정으로의 Monitor 화면 로그인(관리자 암호를 다루지 않음), 진행 중 경기의 프로세스 강제 종료 복원(설계상 미지원). outbox 복구 시험은 세 번 실행했다. 1회차는 스크립트 오류로 원격 변경 없이 중단했다. 2회차는 PB 중단·재기동과 저장까지 끝났으나 끊긴 방의 `leave()`가 멈춰 보고서를 쓰지 못했다. 3회차는 통과했다. 그래서 Tester 1에게 1점 기록이 하나 더 있다. 매 회차 끝에 30초 단축값 제거와 PB 기동 상태를 확인했다.

## 10. 주소 이전과 Cloudflare Pages 배포 (2026-10-02, 사용자 승인)

| 단계 | 내용 | 결과 |
|---|---|---|
| 1 | 터널 `mac-mini`(ff0b41d3…)에 게시 경로 `pixeltown-pb.fastmake.net → http://127.0.0.1:8091` 추가(대시보드, DNS 자동) | Mac mini·외부에서 `/api/health` 200 |
| 2 | 코드 전환: `.env.remote` `VITE_PB_URL=https://pixeltown-pb.fastmake.net`, 원격 검증 스크립트 기본값, `npm run build:remote`. PB 설정 `appName=PixelTown`, `appURL=https://pixeltown-pb.fastmake.net` | 커밋 `8740186` |
| 3 | Pages 프로젝트 `pixeltown` 생성: GitHub `cheng80/pixeltown-demo`, 브랜치 `main`, 빌드 `npm run build:remote`, 출력 `dist`, `NODE_VERSION=22` | 첫 배포 성공(`https://pixeltown-4x2.pages.dev`), 빌드에 `pixeltown-pb`·`pixeltown-rt` 주소 확인 |
| 4 | Colyseus `ALLOWED_ORIGINS`에 `https://pixeltown-4x2.pages.dev` 추가 후 Colyseus만 재시작(직전 `.env` 사본 `backups/pixeltown-abuse-limits-20261002/colyseus.env.before-pages`) | Origin 검사 200 |
| 5 | 터널에서 `pixeltown.fastmake.net` 경로 삭제, Pages 사용자 지정 도메인 `pixeltown.fastmake.net` 추가(CNAME을 터널 → `pixeltown-4x2.pages.dev`로 교체) | `https://pixeltown.fastmake.net`이 게임 화면 제공 |

다른 터널 경로(stonematch·stonematch-pb·preview·pixeltown-rt)는 바꾸지 않았다. 되돌리기: Pages 사용자 지정 도메인을 지우고 터널에 `pixeltown.fastmake.net → http://127.0.0.1:8091` 경로를 다시 추가한다. `.env.remote`와 PB `appURL`도 되돌린다.

배포는 `main`에 push하면 Pages가 자동으로 빌드한다. 서버 코드(Colyseus·훅)는 계속 `scripts/deploy-macmini.sh`로 Mac mini에 배포한다. 게스트 캐릭터는 주소별로 브라우저에 저장되므로, 이전 주소(로컬 5173 등)에서 만든 캐릭터는 배포 주소에서 보이지 않는다.

