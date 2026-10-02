# PLAN-004 — Mac mini PocketBase·Colyseus 이전과 원격 연동 검증

- 상태: `DONE` — 이전·원격 검증 완료(2026-10-02). 결과는 [verification](../verification.md) 10절과 [SERVER_OPERATIONS](../SERVER_OPERATIONS.md) 9절
- 날짜: 2026-10-02
- 기준 커밋: `576b261` (로컬 검증 완료판)
- 브랜치: `main` (사용자 지시. 별도 브랜치·worktree 없음)
- 관련: [SERVER_OPERATIONS](../SERVER_OPERATIONS.md), [ADR-001](../decisions/ADR-001.md)(서버 권위·원자 저장·outbox), [ADR-004](../decisions/ADR-004.md)(상점)
- 출처: Codex 대화 "게임 기술 스택 검토"에서 Mac mini에 설치한 PocketBase 0.39.7·Colyseus 0.18 서버로 로컬 게임을 옮겨 테스트하라는 사용자 요청

## 1. 목표와 범위

로컬에서 만든 게임(`town` 방·이동·채팅·별 이벤트·결과 저장·상점·미니룸)을 Mac mini 서버에서 동작하게 한다. 브라우저는 이 컴퓨터의 Vite(5173)에서 공개 HTTPS/WSS로 접속한다. 원격 호스트에 프런트엔드를 새로 공개하지 않는다.

범위 밖: 새 공개 서비스·터널 변경, 공개 경로 부하 시험(100명은 로컬만), `stonematch`·8090·Oracle A1 예약·다른 launchd 서비스, 기존 관리자 암호 변경.

## 2. 현재 상태(조사 결과)

| 항목 | 원격 | 로컬(이전 전) |
|---|---|---|
| Colyseus | `@colyseus/core 0.18.18`, monitor 0.18.6, schema 5.0.35, ws-transport 0.18.4, express 5.2.1. `lobby` 검증 방만 | core 0.16.26, `colyseus.js` 0.16 |
| 클라이언트 SDK | `@colyseus/sdk 0.18.4` | `colyseus.js` 0.16.22 |
| PocketBase | 0.39.7, 사용자 0명, 관리자 1명, `users` 공개 가입 허용, 게임 컬렉션 없음, 훅 `realtime.pb.js` | 0.40.4, 게임 컬렉션·훅 3개 |
| 서버 → PB 인증 | 사용자 토큰 authRefresh만(관리자 자격 없음) | outbox가 superuser로 `commit-match` 호출 |
| 허용 Origin | `pixeltown.fastmake.net`, `pixeltown-rt.fastmake.net`, `http://localhost:5173`, `http://127.0.0.1:5173` | 검사 없음 |

## 3. 호환 결정

1. **원격을 내리지 않고 저장소를 0.18로 올린다.** 서버 `colyseus/package.json`을 원격과 같은 버전으로 고정하고, 프런트·테스트는 `@colyseus/sdk 0.18.4`를 쓴다. 0.18은 패치된 `nanoid 3.3.19`를 쓰므로 0.16용 `vendor/nanoid` 대체 모듈을 제거한다.
2. **토큰 전달:** 0.18 SDK의 `client.auth.token`이 방의 `onAuth(client, options, context)`에 `context.token`으로 온다. 토큰을 join 옵션에 넣지 않는다. zone 검사·방 메타데이터·프로필 조회 때문에 인스턴스 `onAuth`를 유지한다. 사용자마다 독립 PocketBase SDK로 `authRefresh`한다.
3. **예약 필드:** 0.18 `Room.inputs`는 입력 API 예약 이름이므로 이동 입력 맵을 `moveInputs`로 바꾼다.
4. **서버 진입점 하나:** `colyseus/server.js`가 로컬·원격 공용이다. express 위에 기존 원격 기능(`/health`, `/health/pocketbase`, `/me`, Origin allowlist, PocketBase `_superusers` Basic 인증 Monitor)을 그대로 옮기고 `town` 방(`filterBy(['zone'])`)과 outbox를 붙인다. `/health`에 outbox 상태를 추가한다.
5. **outbox 저장 권한:** `commit-match`는 superuser 전용으로 유지한다. 기존 관리자 계정은 쓰지 않고 outbox 전용 superuser `colyseus-outbox@pixeltown.local`을 PocketBase CLI로 만든다. 암호는 원격 `.env`(0600)에만 둔다.
6. **스키마:** `seed(client, { remote: true })`로 게임 컬렉션·필드·rooms 행만 멱등 추가한다. 원격 `users` 규칙(공개 가입·본인 수정)과 기존 계정·관리자·토큰 설정은 바꾸지 않는다. 로컬 `pb_data`를 복사하지 않는다.
7. **훅:** PB 0.39.7에서 로컬 통합 15개를 같은 훅으로 통과시켜 호환을 확인한다. 원격 설치 위치에서는 `pb_hooks/catalog.json` 사본을 읽고, 저장소에서는 `shared/catalog.json`을 읽는다.
8. **프런트:** `.env.remote`(공개 주소만)와 `npm run dev:remote`(5173, `--mode remote`). 원격 Origin allowlist에 이미 정확한 5173 주소가 있어 변경하지 않는다.
9. **테스트 계정:** 공개 데모 암호를 쓰지 않는다. 무작위 암호 계정 2개를 서버 쪽 `scripts/provision-accounts.mjs`(stdin JSON)로 만들고, 자격증명은 로컬 `pocketbase/.local/remote-accounts.json`(0600, git 무시)에만 둔다.

## 4. 원격 배치

| 경로 | 내용 |
|---|---|
| `/Users/cheng80/Servers/pixeltown-colyseus/app/colyseus` | `server.js`, `town.js`, `outbox.js`, `config.js`, `monitor-auth.js`, 고정 package와 독립 `node_modules` |
| `…/app/shared` | `world.js`, `catalog.json` |
| `…/app/scripts` | `init-pocketbase.mjs`(remote seed), `provision-accounts.mjs` |
| `…/server.mjs` | `import "./app/colyseus/server.js"` (launchd plist 변경 없음) |
| `…/outbox` | 영구 outbox(0700) |
| `/Users/cheng80/Servers/pixeltown/pb_hooks` | 기존 `realtime.pb.js` + `matches.pb.js`, `shop.pb.js`, `shop_lib.js`, `catalog.json` |

## 5. 백업과 롤백

백업: `/Users/cheng80/Servers/backups/pixeltown-migration-20261002/` (0700)

- `data.db`, `auxiliary.db`: 실행 중 DB의 SQLite online `.backup`(integrity_check ok)
- `pb_hooks/`, `types.d.ts`, `colyseus/`(server·monitor-auth·verify·package·lock·README·.env), `launchd/` plist 2개
- 이전 진입점 사본: `pixeltown-colyseus/server.lobby-20261002.mjs`

롤백(코드):

```sh
cd /Users/cheng80/Servers/pixeltown-colyseus
cp server.lobby-20261002.mjs server.mjs          # 루트 node_modules는 그대로라 기존 lobby 서버가 다시 동작
launchctl kickstart -k gui/501/com.fastmake.pixeltown.colyseus
rm /Users/cheng80/Servers/pixeltown/pb_hooks/{matches.pb.js,shop.pb.js,shop_lib.js,catalog.json}
```

롤백(DB): PocketBase를 `launchctl bootout gui/501/com.fastmake.pixeltown.pocketbase`로 멈추고, 백업 이후 사용자 데이터 변경을 확인한 뒤 `pb_data/data.db`·`auxiliary.db`를 백업본으로 바꾸고 `-wal`/`-shm`을 지운 다음 `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.fastmake.pixeltown.pocketbase.plist`. 게임 컬렉션은 추가만 했으므로 코드 롤백만으로도 기존 기능은 복구된다. outbox 전용 superuser는 관리 화면에서 삭제하고 `.env`의 `PB_ADMIN_*`·`OUTBOX_PATH` 줄을 지운다.

## 6. 실행 단계

| 단계 | 내용 | 검증 |
|---|---|---|
| S1 | 원격 읽기 전용 조사, 백업 | integrity_check, 백업 목록 |
| S2 | 저장소 0.18 전환(서버·SDK·테스트), PB 0.39.7 호환 | 단위·통합(0.40.4와 0.39.7)·build |
| S3 | 원격 배치: app 업로드·npm ci, outbox superuser·.env, 훅·스키마, 진입점 교체·재시작 | 내부·공개 health, Monitor 401, 미허용 Origin 403 |
| S4 | 테스트 계정, `tests/remote-check.mjs`(2유저·보안·별·기본 3분 정산·상점·미니룸·재로그인·Monitor) | `tests/remote-report.json` |
| S5 | 서버 측 멱등·충돌·롤백(`tests/remote-persistence.mjs`), outbox 장애·재시작 복구(`PIXELTOWN_REMOTE_OUTAGE=1`, 30초 단축 후 원복) | 보고서, 원복 후 health |
| S6 | 로컬 프런트(`npm run dev:remote`) 브라우저 2유저 확인 | 스크린샷 |
| S7 | STATUS·verification·SERVER_OPERATIONS·TECH_SPEC·README 갱신, 한국어 commit/push | 문서·코드 대조 |

코드 갱신 배포는 `scripts/deploy-macmini.sh`(app·훅 복사, `npm ci`, Colyseus만 재시작)로 한다.
