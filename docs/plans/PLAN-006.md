# PLAN-006 — 첫 화면 캐릭터 만들기 + 게스트 자동 가입 (로그인·연습 모드 제거)

- 상태: `DONE` — 구현·로컬·원격 검증(2026-10-02)
- 브랜치: `main`
- 관련: PRODUCT_SPEC FR-001·FR-014, SCREEN-001·008, AC-001·002·021. PLAN-005(캐릭터 만들기) 후속

## 1. 결정 (2026-10-02 사용자)

사용자는 첫 화면이 원본처럼 캐릭터 만들기여야 한다고 보고, 로그인 화면과 "혼자 둘러보기"를 없애라고 했다. PLAN-005의 A안(관리자 발급 계정 + 로그인)은 이 기대와 달랐다. 선택:

| 질문 | 선택 |
|---|---|
| 진입 방식 | 게스트 자동 가입: 첫 화면 캐릭터 만들기 → 서버가 계정 발급 → 브라우저 보관 → 재방문 자동 입장 |
| 이메일 로그인 | 화면에서 완전히 제거(시드·Tester 계정은 자동 테스트 전용) |
| 남용 방지 | 처음에는 보류했다가 같은 날 사용자 지시로 적용(5절) |

## 2. 설계

- `POST /api/pixeltown/guest`(`pocketbase/pb_hooks/guest.pb.js`, 인증 없음): 닉네임·외형 검사는 `cleanProfile` 그대로, 비밀번호는 브라우저가 만든 48자 hex(서버는 32–128자만 허용). users(`guest-<무작위 20자>@guest.pixeltown.local`, verified)와 profile을 한 트랜잭션으로 만든다. 닉네임 unique 위반이면 400 `{data:{name:'taken'}}`이고 사용자도 남기지 않는다. 응답은 PB 인증 응답(`$apis.recordAuthResponse`).
- 공개 `users` 직접 생성(createRule null)은 계속 막는다. 가입 경로는 이 훅 하나다.
- 클라이언트: `localStorage` `pixeltown.guest`에 `{email,password}`. PB SDK의 토큰이 유효하면 바로, 만료됐으면 보관 자격증명으로 다시 로그인한다. 서버가 400(계정 없음)이면 보관값을 지우고 캐릭터 화면, 연결 실패면 안내만 하고 보관값은 지우지 않는다.
- 화면: 첫 화면 = PIXEL TOWN 로고 + 캐릭터 만들기. 로그인 폼·데모 계정 버튼·연습 모드·로그아웃 제거. 수첩은 "이 브라우저에 저장된 내 캐릭터".
- 이전 계정(Tester·demo)은 그대로 쓸 수 있다. 자동 테스트는 `localStorage`에 자격증명을 넣어 재방문처럼 들어간다.

## 3. 알려진 한계

- 브라우저 저장소를 지우거나 다른 기기에서는 이어 할 수 없다(계정 연결 없음).
- 자격증명이 `localStorage`에 평문으로 있다(같은 브라우저의 스크립트가 읽을 수 있음). 원본의 UUID 보관과 같은 수준이다.

## 4. 검증

통합(게스트 발급·재로그인·입장, 중복·짧은 비밀번호·사칭 단어 400, 거부 시 사용자 미생성), 로컬 UI(첫 화면에 로그인·연습 없음, 저장 후 입장, 새로고침 같은 캐릭터), 원격 UI(실제 게스트 생성·상대 반영·재방문), 원격 기능 8/8, 클릭 이동 측정. 반영 전 원격 백업 `/Users/cheng80/Servers/backups/pixeltown-guest-20261002/`(DB·`pb_hooks`). 되돌리기: `pb_hooks/guest.pb.js` 삭제(PB 자동 재시작) 후 이전 커밋 배포.

## 5. 남용 방지 (2026-10-02 사용자 지시로 적용)

| 항목 | 내용 |
|---|---|
| 게스트 발급 제한 | PocketBase 내장 rate limiter 규칙 `POST /api/pixeltown/guest`: 방문자 IP당 1시간에 20회(잘못된 요청 포함). 초과하면 429, 화면 안내 "이 곳에서 새 캐릭터를 너무 많이 만들었어요. 한 시간쯤 뒤에 다시 시도해 주세요." |
| 방문자 IP | Cloudflare 터널 뒤라 PB에는 모두 127.0.0.1로 보인다. `trustedProxy.headers = ["CF-Connecting-IP"]`로 실제 IP를 쓴다. PB는 loopback에만 열려 있어 터널을 거치지 않고는 이 헤더를 넣을 수 없다 |
| 게임 서버 제외 | `excludedIPs: 127.0.0.1, ::1`. Colyseus가 입장마다 하는 authRefresh와 outbox 저장이 제한에 걸리지 않게 한다 |
| PB 기본 규칙 | 함께 켰다: 인증 `*:auth` 3초에 2회, 생성 `*:create` 5초에 20회, `/api/batch` 1초에 3회, `/api/` 10초에 300회(방문자 IP 기준). 재방문 자동 로그인이 429를 받으면 클라이언트가 3초 뒤 최대 5회 다시 시도한다 |
| 활동 기록 | `profiles.last_seen`(date). 로그인·토큰 갱신(게임 입장 포함) 때 1시간에 한 번만 갱신한다(`onRecordAuthRequest`) |
| 미접속 정리 | 매일 04:17 cron `pixeltown_guest_cleanup`: `@guest.pixeltown.local` 계정 중 `last_seen`(없으면 생성 시각)이 30일 넘은 것을 삭제한다. 프로필·결과·별 보상·구매는 relation cascade로 함께 지운다. 일반 계정(Tester 등)은 건드리지 않는다. 즉시 실행: superuser `POST /api/pixeltown/guest-cleanup {days}` |
| 설정 적용 | `scripts/init-pocketbase.mjs` `applyAbuseLimits()`, 원격 시드(`seed(_, {remote:true})`, 배포 스크립트가 실행)만 적용한다. 로컬 개발 PB는 테스트 반복을 위해 끈다 |

상향(같은 날 사용자 지시): 같은 공유기·회사 IP를 여러 사람이 쓰는 경우를 위해 5회 → 20회(`GUEST_PER_HOUR`). 통합에서 같은 IP 21번째 요청이 429, 원격 규칙 `maxRequests: 20` 확인.

한계: rate limiter 카운터는 PB 메모리에만 있어 PB를 재시작하면 초기화된다. 같은 공유기·회사 IP를 쓰는 여러 사람은 한도를 나눠 쓴다. 채팅 신고는 아직 없다.

검증: 통합 `guest_abuse_limits_and_cleanup`(0.40.4·0.39.7). 같은 프록시 IP 6번째 429(상향 후 21번째), 다른 IP와 loopback은 통과, 로그인 시 `last_seen` 기록, 40일 묵은 게스트만 삭제되고 활동 게스트·일반 계정은 남음, 미인증 정리 요청 401. 원격: 설정 적용 확인, 로그에 실제 방문자 IP 기록, Tester `last_seen` 기록, 정리 0건, 이 PC IP에서 5번째 요청 뒤 429, 다른 API 200. 확인 뒤 원격 PB를 재시작해 카운터를 비웠다. 반영 전 백업 `pixeltown-abuse-limits-20261002`(DB·`pb_hooks`). 되돌리기: superuser로 `rateLimits.enabled=false`, `trustedProxy.headers=[]`.

