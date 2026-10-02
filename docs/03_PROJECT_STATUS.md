# 프로젝트 현황

갱신일: 2026-10-03 (Asia/Seoul). 최신: 로컬 우선 이동 + 서버 검증 전환(ADR-005, 7절 맨 위). 기준 리비전 `576b261`(main). 개발은 main 체크아웃에서 계속한다. 최신 작업 PLAN-006(첫 화면 캐릭터 만들기 + 게스트 자동 가입, 로그인·연습 모드 제거). 직전 PLAN-005(캐릭터 만들기). 직전 PLAN-004(Mac mini 서버 이전, Colyseus 0.18). 서버 주소·배치·백업은 [SERVER_OPERATIONS](SERVER_OPERATIONS.md). **배포 주소 https://pixeltown.fastmake.net**(Cloudflare Pages), PB는 https://pixeltown-pb.fastmake.net.

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
- 실제 iPhone/Android 가상 키보드·성능, 외부 배포·TLS·지속 운영은 미검증이다. 100명은 로컬 단일 머신에서 채널 방 자동 분할(32/32/32/4)까지만 측정했다(통합 opt-in). 한 화면 100명 동시 표시는 지원하지 않는다.
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
3. 한 장소 32명 초과를 한 화면에 보여야 하는 요구가 확정되면 delta snapshot·관심 영역을 설계한다. 현재는 채널 방 자동 분할이다.
4. 실기기 키보드·인터넷 지연 측정은 실기기와 실제 사용자 환경이 필요하다. 원격 서버는 소수 기능 테스트만 하고 공개 경로 부하는 하지 않는다.
4. PWA·앱 포장은 웹 핵심 플레이 검증 후 별도 계획으로 다룬다.

## 7. 인수인계

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
- 로컬 개발 서버는 모두 꺼져 있다. 필요하면 10절 명령으로 띄운다. Mac mini 배포는 `scripts/deploy-macmini.sh`, Tailscale 경로가 빠졌으면 `PATH="$PWD/.test-work/bin:$PATH" scripts/deploy-macmini.sh`(`tailscale nc` ssh 래퍼, git 제외). Mac mini: `mac-mini.tailc386bf.ts.net`(100.92.43.82, LAN 192.168.0.204), 이 컴퓨터: `cheng80-macbookair15.tailc386bf.ts.net`(100.105.34.114). MagicDNS 이름은 known_hosts에 없어 IP로 접속한다.
- 자격증명은 git 밖 0600 파일에만 있다: `pocketbase/.local/remote-accounts.json`(Tester 1·2), `pocketbase/.local/remote-admin.env`(검증용 관리자). 출력·커밋 금지. 원격 SSH 키는 ssh 실행에만 쓰고 내용을 읽지 않는다.
- 금지 경계: `cheng80@gmail.com` 관리자 비밀번호 재설정, stonematch(8090)·Oracle A1 예약·다른 터널·`cloudflared` 설정, 원격 DB를 로컬 `pb_data`로 덮어쓰기, 공개 터널 부하 테스트. 원격 DB 변경 전에는 SQLite `.backup`으로 백업한다. 실제 방문자가 찍힌 스크린샷은 커밋하지 않는다.

변경하면 안 되는 경계: 운영 PocketBase·Oracle 작업·외부 브로커·클라우드 인증에는 접근하지 않는다. 개발 launcher는 기본 18090/12567/5173(환경변수로 변경 가능)을 loopback으로만 사용하고 포트 점유 시 시작을 거부한다. 재제작 브랜치 worktree 검증은 5273/18190/12667을 썼다. 병합 후 main 체크아웃은 기본 5173/18090/12567로 실행하고, 통합은 18191/12668을 쓴다. main을 fast-forward한 뒤에는 `npm install && npm --prefix colyseus install`(병합으로 `galmuri` 추가)을 하고 개발 서버를 재시작해야 한다. 구 실행이 남아 있으면 이전 코드를 서비스한다. `.env.local`, `.local`, DB, 다운로드 바이너리와 node_modules를 공개 저장소에 넣지 않는다.

주요 파일은 `shared/world.js`(맵·충돌·미니룸 정본), `shared/catalog.json`(상점 정본), `pocketbase/pb_hooks/shop.pb.js`·`shop_lib.js`, `game/src/main.jsx`, `game/src/render.js`, `game/src/sprites.js`, `colyseus/town.js`, `colyseus/outbox.js`, `pocketbase/pb_hooks/matches.pb.js`, `scripts/init-pocketbase.mjs`, `tests/integration.mjs`, `tests/ui-check.mjs`다. 실제 명령은 루트 README에 있다. 맵을 고치면 `npm --prefix colyseus test`가 연결성·footprint 규칙을 자동 검사한다. Colyseus는 `shared/`를 import하므로 맵 수정 후 서버를 재시작해야 프런트와 판정이 일치한다.

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
