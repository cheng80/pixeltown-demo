# 프로젝트 현황

갱신일: 2026-10-02 (Asia/Seoul). 기준 리비전 `965d266`(main, 재제작·PLAN-003 병합 완료). 개발은 main 체크아웃에서 계속한다. 최신 작업 PLAN-003.

## 1. 로드맵

| 단계 | 마일스톤 | 상태 |
|---|---|---|
| M1 | 원본 읽기 전용 조사·기획·PRD·기술 계약·개발 계획 | 완료 (`5fa022a`) |
| M2 | 1차 도트 게임·PocketBase/Colyseus 연동·3개 방 | 완료했으나 **사용자 거절** (`9bc3d66`) |
| M3 | 1차 보안·복구·20명 로컬·모바일 검증 | 백엔드 증거만 유효. 화면 증거는 거절판 기준 |
| M4 | 공개 GitHub 단계별 게시 | 완료 (`dc2e191`) |
| M5 | 싸이월드 도트 감성 재제작 (PLAN-002) | 구현·검증 완료, main 병합(`965d266`). **사용자 디자인 승인 대기** |
| M6 | 상시 별 이벤트·별 상점·옷장·펫·미니룸·클릭 이동·큰 채팅 (PLAN-003) | 구현·검증 완료, main 병합(`965d266`). 사용자 확인 대기 |

## 2. 계획

- `plans/PLAN-001.md` — DONE. 1차 로컬 멀티플레이 데모. 백엔드 계약은 유지, 화면·맵·충돌은 PLAN-002로 대체.
- `plans/PLAN-002.md` — DONE(구현·검증). 디자인 최종 승인은 사용자 판단.
- `plans/PLAN-003.md` — DONE(구현·검증). 2026-10-02 추가 피드백(별 얼굴, 상시 이벤트, 상점·꾸미기·미니룸, 채팅·마우스 이동).

## 3. 현재 작업 (PLAN-003)

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

- `nanoid 2.x` 전이 의존성 관련 audit 3건(2 moderate, 1 high). 실제 서버에서 ID 크기는 상수로 지정한다. Colyseus 0.16/클라이언트 호환성 때문에 무리한 override를 하지 않았다. 공개 인터넷 서비스 전 최신 호환 client/server 업그레이드와 재검증 필요. 개발 전용 loopback 서버에 한정한다.
- 실제 iPhone/Android 가상 키보드·성능, 외부 배포·TLS·지속 운영, 100명은 미검증이다.
- 클라이언트 예측 없이 서버 50ms snapshot을 보간한다. localhost에서는 자연스러웠으나 인터넷 지연 조작감은 미측정이다.
- 그래픽은 절차 도트다. 사용자 디자인 승인 전이며 피드백에 따라 팔레트·소품을 조정한다.
- 이미 열려 있던 구 버전 탭이 제거된 `startGame`을 보내면 Colyseus가 연결을 끊는다. 새로고침하면 된다.
- 미니룸은 본인만 본다. 다른 사람 방문·방명록·선물은 후속 범위다.
- 진행 중 경기는 서버 프로세스 강제 종료 시 복원하지 않는다. 디스크 outbox에 완료 기록된 경기는 재시작 후 저장한다.

## 6. 다음 작업

1. 사용자 디자인 검토 피드백을 반영하고, 승인되면 PR·merge를 별도 요청으로 진행한다.
2. 초기 데모 완료 후 100명 요구가 확정되면 delta snapshot·방 분할·관심 영역과 실제 인터넷 지연을 측정한다.
3. 외부 배포 전 서버/클라이언트 버전 업그레이드와 실기기 키보드 검증을 수행한다.
4. PWA·앱 포장은 웹 핵심 플레이 검증 후 별도 계획으로 다룬다.

## 7. 인수인계

변경하면 안 되는 경계: 운영 PocketBase·Oracle 작업·외부 브로커·클라우드 인증에는 접근하지 않는다. 개발 launcher는 기본 18090/12567/5173(환경변수로 변경 가능)을 loopback으로만 사용하고 포트 점유 시 시작을 거부한다. 재제작 브랜치 worktree 검증은 5273/18190/12667을 썼다. 병합 후 main 체크아웃은 기본 5173/18090/12567로 실행하고, 통합은 18191/12668을 쓴다. main을 fast-forward한 뒤에는 `npm install && npm --prefix colyseus install`(병합으로 `galmuri` 추가)을 하고 개발 서버를 재시작해야 한다. 구 실행이 남아 있으면 이전 코드를 서비스한다. `.env.local`, `.local`, DB, 다운로드 바이너리와 node_modules를 공개 저장소에 넣지 않는다.

주요 파일은 `shared/world.js`(맵·충돌·미니룸 정본), `shared/catalog.json`(상점 정본), `pocketbase/pb_hooks/shop.pb.js`·`shop_lib.js`, `game/src/main.jsx`, `game/src/render.js`, `game/src/sprites.js`, `colyseus/town.js`, `colyseus/outbox.js`, `pocketbase/pb_hooks/matches.pb.js`, `scripts/init-pocketbase.mjs`, `tests/integration.mjs`, `tests/ui-check.mjs`다. 실제 명령은 루트 README에 있다. 맵을 고치면 `npm --prefix colyseus test`가 연결성·footprint 규칙을 자동 검사한다. Colyseus는 `shared/`를 import하므로 맵 수정 후 서버를 재시작해야 프런트와 판정이 일치한다.

UI에서 `sort:-created` 조회가 400인 문제를 발견했다. 신규 PocketBase collection에 날짜 필드가 없었던 원인으로, seed가 기존/신규 schema의 created/updated autodate를 보완하도록 수정했다. 재seed 후 프로필 조회·기록 패널 오류 0을 확인했다. 이전 실패 증거는 최종 검증의 성공으로 덮어 쓰지 않고 이 원인과 수정을 보존한다.

## 8. 변경된 계약

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
| 단위 18개(맵·깊이·충돌 9, 상점·미니룸 4 포함) | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | `npm --prefix colyseus test` |
| 통합 15개(별도 포트 18191/12668, 상점 2) | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | `tests/report.json` |
| 브라우저 UI 7개 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | `tests/ui-report.json`, `docs/assets/`, verification.md |
| 깊이·충돌·맵 AC-014/015 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 실제 클릭·방향키 이동 좌표와 앞/뒤 스크린샷 |
| 도트 스케일·4 뷰포트 AC-011/016 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | scroll=viewport, 정수 배율 3/6, smoothing false |
| 상시 별 이벤트·기본 3분 정산 AC-007/008/013 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 브라우저 기본값, 통합 단축값 |
| 상점·옷장·펫·미니룸 AC-017–019 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 통합 위조·동시 구매, 브라우저 2유저 |
| 클릭 이동·큰 채팅 AC-020 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | 채팅 위 클릭·키 취소·막힌 곳 |
| 빌드 | PASS | RECHECKED | 2026-10-02 | `965d266` | CURRENT | `npm run build` |
| 디자인 승인 | PENDING | NONE | - | - | UNKNOWN | 사용자 판단 |
| 실제 모바일 기기·키보드 | NOT_RUN | NONE | - | - | UNKNOWN | 에뮬레이션만 |
| 인터넷 성능·100명·운영 배포 | NOT_RUN | NONE | - | - | UNKNOWN | 범위 밖 |

거절판(`9bc3d66`)의 화면 증거는 삭제했고 백엔드 검증은 위 재실행으로 대체했다.

2026-10-02 재개 재확인: main `965d266` 체크아웃에서 단위18·통합15(18191/12668)·UI7(기본 포트 5173/18090/12567, 기본값 6초·3분)·build를 직접 다시 실행해 모두 통과했다. 이전 기록(`a714104`)을 옮겨 적은 것이 아니다. 재개 중 발견한 실행 장애: 04:40에 시작된 구 `dev:all`이 병합 전 코드로 기본 포트를 점유하고 있었고, fast-forward 뒤 `galmuri` 미설치로 `npm run build`가 실패했다. 이 체크아웃 소유 프로세스만 종료하고 `npm install` 후 재시작해 해결했다. 개발 DB는 재시작 전에 `pocketbase/.local/pb_data.backup-20261002-1100`으로 복사했고 seed는 기존 데이터를 지우지 않는다. UI 검증은 개발 DB에 일회용 `ui-*@pixeltown.local` 상점 계정을 만들고 demo1/demo2 기록을 추가한다.

## 10. 재개 명령

```sh
npm install && npm --prefix colyseus install
npm run dev:all   # main 체크아웃: http://127.0.0.1:5173, PB 18090, Colyseus 12567 (첫 실행 시 PB·demo 계정 seed)
npm --prefix colyseus test
PIXELTOWN_TEST_PB_PORT=18191 PIXELTOWN_TEST_GAME_PORT=12668 npm run test:integration
CHROME_PATH=/path/to/chromium PIXELTOWN_WEB_PORT=5173 PIXELTOWN_PB_PORT=18090 node tests/ui-check.mjs   # UI_ONLY=shop 처럼 일부만
npm run build
```
