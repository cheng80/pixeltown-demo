# PLAN-008 — 화면 전체 OTA와 배포 알림

- 날짜: 2026-10-11 (Asia/Seoul).
- 상태: S0~S7 승인된 로컬 구현·검증 완료(2026-10-11). 운영 적용·게시·commit은 하지 않았다. 단계별 결과는 8절, 실제 검사와 운영 도입 경계는 [로컬 결과](../reviews/2026-10-11-frontend-ota.md)를 따른다.
- 사용자 요청: 화면과 기능이 늘어도 화면마다 업데이트 처리를 만들지 않도록 구조를 바꾸고, 15초마다 새 버전을 확인하는 브라우저 폴링을 없앤다. 상세 기획과 계획을 먼저 준비한 뒤 새 세션에서 진행한다.
- 제품 정본: [PRODUCT_SPEC](../01_PRODUCT_SPEC.md#frontend-ota-product). 기술 정본: [TECH_SPEC](../02_TECH_SPEC.md#frontend-ota-contract). 결정 이유: [ADR-007](../decisions/ADR-007.md).
- 쉬운 설명과 그림: [전체 화면 OTA](../diagrams/frontend-ota.html). 시작 자료: [새 세션 인계](../handoffs/2026-10-11-frontend-ota.md).

## 1. 이번에 바꿀 것

지금은 월드 렌더러만 교체할 수 있다. `main.jsx`가 인증·방 연결·지갑·화면을 함께 소유하고, `WorldCanvas.jsx`의 React effect가 이동 타이머와 입력 리스너를 소유한다. 이 화면들을 없앴다가 다시 만들면 연결·입력도 함께 정리된다. 상점이나 메뉴를 추가할 때마다 별도 교체 방법을 만들면 관리할 코드가 늘어난다.

브라우저가 계속 유지하는 실행부(runtime)와, 한 번에 교체하는 프런트 묶음(UI release)을 분리한다. 실행부에는 연결·인증·게임 상태·입력 실행을 둔다. 프런트 묶음에는 입장 화면부터 광장·메뉴까지 모든 React 화면과 렌더러·리소스를 넣는다. 새 화면은 보통의 React 컴포넌트로 추가하고 공통 상태·명령을 사용한다. OTA 처리 코드는 한 곳에만 둔다.

신규 업데이트 서버, Service Worker, 화면별 플러그인 체계, 마이크로프런트, 새 상태관리 라이브러리는 추가하지 않는다. 기존 빌드·불변 릴리스·제한 재시도·해시 검사·오류 복구를 재사용한다. 서버 worker 교체와 PB 배포는 기존 경로를 유지한다.

## 2. 완료 결과

| 결과 | 통과 조건 |
|---|---|
| UI 추가·수정이 전체 묶음에 포함 | 일반 컴포넌트와 라우트/메뉴 수정만으로 빌드에 들어간다. 기존 runtime 기능을 사용하는 화면 때문에 updater·서버 알림·배포 도구를 고치지 않는다. |
| 전체 UI 교체 | 연결·게스트·room/session·좌표·점수·원장·seq/fix·미확인 입력이 유지된다. 화면 교체로 인증·입장·지갑 변경 요청을 다시 실행하지 않는다. |
| 폴링 제거 | 안정적인 접속에서 버전 변화가 없는 10분 동안 초기 준비 이후 최신 버전 HTTP 확인 요청0건. 지갑/게임 heartbeat 요청은 별도로 센다. |
| 상태 보존 | 열린 화면, 닉네임 초안, 검증용 입력 초안, 선택값·스크롤·포커스를 교체 후 복원한다. IME 조합과 터치 이동은 안전한 순간까지 교체를 기다린다. |
| 실패 시 플레이 유지 | 다운로드·호환성·준비·첫 그리기 실패 때 기존 UI와 입력이 유지된다. 활성화 오류는 직전 UI로 돌아간다. 실패 누계를 지우지 않는다. |
| 알림 누락 복구 | 입장·재접속 때 서버의 현재 버전을 받는다. 새 알림이 없어도 복귀 때 최신 버전을 알 수 있다. 게시 성공과 알림 성공을 각각 기록한다. |

새 서버 기능을 요구하는 화면은 그 기능의 runtime/API 계약도 구현해야 한다. 모든 미래 기능이 화면 코드만으로 생긴다는 약속은 아니다. 상점·채팅·미니룸 등 현재 보류한 제품 기능을 이번에 활성화하지 않는다.

## 3. 작업 순서와 게이트

앞 단계가 실패하면 먼저 고친다. 전체 UI 교체·알림·게시를 동시에 바꿔 실패 원인을 섞지 않는다.

| 단계 | 작업·담당 | 종료 조건 |
|---|---|---|
| S0 기준 확보 | 새 세션의 통합 담당. AGENTS 읽기 순서, 최신 diff·실행 포트·소스 해시·문서 상태 확인. 테스트 소유 포트/DB를 분리하고 기존 개발 서버와 세션을 보존. | 수정 전 동작과 알려진 실패를 분리한 기준 자료. 현재 생산 상태를 문서 기록만으로 단정하지 않음. |
| S1 실행 수명 분리 | Codex: runtime와 api/state/connection. 프런트 담당: React 상태·effect 연결. 기존 화면을 그대로 사용하며 연결·인증·지갑·입력 타이머를 React 밖으로 옮김. | 화면 mount/unmount 뒤 같은 실행부·소켓·입력 타이머가 남음. 기존 단위·UI·복구·PB/game 회귀 통과. |
| S2 프런트 묶음 만들기 | 프런트 담당: 전체 UI entry·mount/dispose·상태 저장. Codex: 빌드·업데이트 관리. 기존 불변 파일 경로와 이력 보존을 재사용. | 실제 production 빌드로 입장·게임 UI 전체 교체. UI 변경은 release revision만 바꾸며 runtimeCompatibility는 유지. runtime 변경은 자동 교체 거절. |
| S3 서버 알림 | Codex: 현재 프런트 버전 디스크 상태·내부 활성화 경로·입장/복귀 메시지·순서 검증. | 빈 로비에서도 현재 버전 저장. 중복·순서 역전·서버 재시작·인증 거절·롤백 검사 통과. 알림 때문에 worker 세대/게임 상태를 바꾸지 않음. |
| S4 공통 updater 전환 | 프런트 담당: UI 통지 표시. Codex: 알림 수신·중복 병합·준비·교체·롤백. 기존15초 interval 제거. | 10분 무변경의 반복 manifest GET0건. 갱신 알림·최초 확인·재접속·화면 복귀의 단발 확인과 제한 재시도를 구분해 기록. |
| S5 게시 도구 연결 | Codex: 빌드 → 게시 → 공개 파일 확인 → 내부 활성화의 순서. 로컬 가짜 게시 대상으로 검사. Git 자동 Pages 게시도 같은 활성화 단계가 필요함을 명시. | 게시 실패 때 알리지 않음. 파일 확인 실패 때 알리지 않음. 알림 실패 때 published/activated 결과를 나누고 같은 게시의 활성화만 재시도 가능. |
| S6 확장·통합 검사 | 통합 담당. 실제 2브라우저·85명 SDK·반복 화면 교체. 테스트 전용 두 번째 화면 추가로 확장 경계 검증. | 아래 수용 기준과 증거 파일을 완성. 기존 UI/별/지갑 기능·모바일·접근성 회귀. |
| S7 운영 도입 준비 | 통합 담당. 최초 runtime 도입, 공개 활성화 전달 방식, 복구 절차·기존 탭 영향·승인 범위 정리. | 로컬 구현 결과를 PROJECT_STATUS에 기록. 운영 접근·게시·commit/push는 이번 새 세션 작업에 포함하지 않음. |

## 4. 영향 범위

파일 이름은 구현 담당이 주변 패턴에 맞춰 최소한으로 정한다. 아래는 기능을 빠뜨리지 않기 위한 목록이다. 파일마다 새 계층을 추가하라는 뜻이 아니다.

| 위치 | 확인·변경할 내용 |
|---|---|
| `minimal/game/src/main.jsx` | 기존 App의 연결·인증·지갑 수명을 실행부로 이동. 화면 전체 entry를 구성. |
| `WorldCanvas.jsx`, `engine.js`, `playback.js` | 50ms 이동·키보드·blur/visibility·pad·pointer capture 수명. seq/fix·걷기·타인 재생을 보존. |
| `api.js`, `state.js`, `connection.js` | 기존 인증·원장·복구 로직을 재사용. 구독·화면 명령으로 연결하고 UI cleanup이 connection.dispose를 호출하지 못하게 함. |
| `visual-update.js`, `visual-release.js`, `VisualStatus.jsx`, `style.css` | 한 updater가 전체 release를 교체. 중첩 렌더러 updater·기존15초 timer 제거. CSS 준비·범위·버전 글꼴·취소·직전 화면 복구 보존. |
| `minimal/game/index.html`, `vite.minimal.config.js` | React를 사용하지 않는 부팅 entry와 하나의 UI entry. dev는 기존 Vite 사용. |
| `scripts/minimal-visual-build.mjs`, `build-minimal-frontend.mjs` | 전체 UI와 React/ReactDOM을 한 JS release로 묶고 runtime과 중복 번들되지 않도록 검사. 기존 이력·SHA·404·캐시 계약 유지. |
| `scripts/deploy-minimal-frontend.mjs`, 기존 실행/배포 설정 | 게시 후 파일 확인·활성화. 자동 Git 게시와 수동 게시의 동일 종료 조건. 실제 원격 설정은 변경하지 않음. |
| `colyseus/minimal/server.js`, 상태 저장 helper | 현재 프런트 버전과 내부 활성화. worker 상태·PB·outbox에는 프런트 버전을 섞지 않음. |
| `package.json`, 기존 unit/UI/visual/network/recovery/integration 검사 | 옮긴 export/import·mock SDK·fixture entry·테스트 명령을 함께 수정. 이전 테스트 삭제로 통과 처리하지 않음. |
| `tests/minimal-live-observe.mjs` | 기존 관측값과 새로운 UI/알림 진단을 호환되게 연결. 이번에는 운영 반복 검사 실행 안 함. |
| 정본·기존 인계·HTML | 구현 전 목표와 구현 후 실제 계약을 분리해 갱신. 이전 실패 증거 보존. |

## 5. 검증 계획

### 동작·확장

1. 테스트 전용 메뉴/두 번째 화면을 일반 React 컴포넌트로 추가한다. 입력 초안·선택·스크롤이 있는 화면A에서 새 UI B로 전환한다. updater/배포/서버 코드 변경이 필요 없음을 diff로 확인한다. 실제 상점이나 DB 기능은 추가하지 않는다.
2. 키보드를 누르고 걷는 동안 전체 UI20회 교체·서버 worker 교체를 각각 확인한다. 서버 승인 seq와 client pending을 함께 대조한다. 정상 UI 교체로 socket drop·재입장·장애 덮개·입력 유실·예상 밖 fix0건이어야 한다.
3. 터치패드를 누르는 중, pointer capture·IME 조합·입장/지갑 응답 대기·연결 복구와 겹치는 교체를 확인한다. 보류가 끝나면 최신 후보 하나만 적용한다. DOM 종료 이벤트로 원래 입력을 지우거나 두 번 보내지 않는다.
4. 기존 지갑 요청과 별 정산이 새 UI에 이어지며, 오래된 UI의 unsubscribe/dispose가 최신 상태·인증을 초기화하지 않음을 확인한다.
5. 실제2브라우저로 내/타인 움직임과 포커스·모바일390px·키보드 메뉴 조작을 확인한다. 85명 SDK는 10분 기준 + 10분 반복 UI 교체로 계측한다. 짧은 로컬 결과를 공개30분 안정성으로 표현하지 않는다.

### 실패·순서

6. manifest404/잘못된JSON·해시/경로 불일치·JS503/잘린응답·CSS/글꼴/이미지 실패·12초 준비 기한·preview 오류·활성화/그리기 오류·dispose 오류를 주입한다. 기존 화면 유지 또는 검증된 직전 화면 복구, 최대3회 import, 실패 누계 보존을 확인한다.
7. UI B 준비 중 C 통지, 중복 통지, 오래된 generation, 같은 revision의 새 generation(롤백), 취소 후 늦은 import를 확인한다. 최신 목표만 남기고 이미 취소된 후보를 활성화하지 않는다.
8. 게시됐지만 활성화 실패, 활성화 응답 유실, 최초 generation0→1, 로비0명에서 활성화, 저장 뒤 broadcast 실패와 동일 generation 재전송, rename 전 실패·rename 후 저장 불명, 서버 재시작 뒤 버전 복원, 알림을 놓친 뒤 재접속을 확인한다. 시각이나 revision 문자열 정렬로 순서를 추측하지 않는다. hint schema1과 manifest schema2는 각각 검사한다.
9. 공개/프록시/Origin/게임 토큰으로 내부 활성화를 시도해 거절됨을 확인한다. 잘못된 body·크기 초과·기대 generation 불일치·파일 저장 실패도 검사한다. 비밀은 로그와 UI에 노출하지 않는다.
10. 호환 runtime, 호환되지 않는 runtime, UI 상태 schema 불일치를 각각 검사한다. runtime 업데이트를 화면 교체 성공으로 보고하지 않는다.

### 기본 회귀와 증거

`npm run test:minimal:unit`, `npm run test:minimal:ui`, `npm run test:minimal`, `npm run test:minimal:recovery`, 관련 visual/network/swap 검사를 변경 범위에 맞춰 실행한다. UI는 ego-browser CLI 우선이며 필요할 때만 지정된 Chromium1193을 사용한다. production 빌드는 격리 outDir/store에 만들고 실제 release를 브라우저에 로드한다. Vite 개발 HMR만으로 OTA 통과를 선언하지 않는다.

각 보고서에는 소스/빌드 해시, runtime·UI revision, notification generation, room/session, navigation 수, socket drop/복구, seq/ack/fix/pending, 입력 타이머·리스너·renderer 수, 단계별 준비 시간·실패·롤백, 버전 확인 HTTP 요청수를 남긴다. 토큰·게스트 비밀번호·실제 사용자 정보는 제외한다. 반복 교체의 heap 변화도 관측하되 JS module cache를 Map 삭제만으로 해제했다고 보고하지 않는다.

## 6. 분담과 새 세션

새 세션이 통합을 책임진다. 화면·React·입력 UI는 프런트 담당에게, runtime/api/state/connection·server·build/deploy는 Codex 담당에게 맡긴다. 먼저 runtime 인터페이스와 파일 소유 범위를 합의한 뒤 독립 파일만 병렬 수정한다. 같은 `main.jsx`나 `visual-update.js`를 동시에 수정하지 않는다. 사용자가 허용한 지원 모델과 작업 난이도에 맞는 추론 수준을 사용한다.

현재 세션은 문서 준비와 전달을 끝내고 코드 구현을 새 세션에 맡긴다. main 체크아웃을 공유하므로 전달 이후 부모 세션은 구현 파일을 수정하지 않는다. 기존 Claude·메인 세션·worktree를 종료하거나 정리하지 않는다.

## 7. 범위와 알려진 한계

- 최초 runtime 도입은 기존 탭에 자동으로 들어가지 않는다. 한 번 새로 입장/새로고침한 뒤 전체 UI OTA를 사용할 수 있다. 실행부 자체·프로토콜·충돌 규칙의 비호환 변경도 같은 제한이 있다.
- UI 전체 교체는 React 내부 상태를 자동 보존하지 않는다. 보존할 초안·열린 화면은 실행부의 UI 상태에 두고, 효과·타이머의 소유자를 하나로 정해야 한다.
- 브라우저 JS module cache는 강제로 비울 수 없다. 반복 업데이트의 자원 해제와 메모리 증가를 실제로 측정한다. 무제한 업데이트의 메모리 무증가를 보장하지 않는다.
- 현재 공개 검사에서 응답 정체2건의 최초 원인이 남아 있다. OTA 변경으로 그 문제가 해결됐다고 보고하지 않는다. worker/PB/호스트 무중단 범위를 확대하지 않는다.
- 현재 명시 승인: 기획·플랜·새 세션 생성/전달·로컬 구현/검증. commit·push·PR·merge·운영 접근/배포·공개 부하 검사·세션 종료는 포함하지 않는다. 문서의 과거 Git/운영 승인을 이번 작업 권한으로 사용하지 않는다.

## 8. 단계별 로컬 결과 (2026-10-11)

실제 실행한 검사만 통과로 적는다. 근거 경로는 [로컬 결과](../reviews/2026-10-11-frontend-ota.md)에 있다.

| 단계 | 결과 |
|---|---|
| S0 | 기준 단위47·소스 해시 확보. 시험은 `.test-work/`의 별도 포트·DB 사용. |
| S1 | 같은 기존 UI를 runtime으로 구동. 단위·실제 PB/game6·복구8·오프라인 UI 통과. |
| S2 | 전체 UI entry·shadow CSS·schema2 release·의존 그래프 hash·검증된 Blob JS 구현. production 빌드로 A/B 전체 교체 통과(짧은 실행). 최종 그래프 hash 방식은 단위·빌드·production 실브라우저 재검증 통과(NBY0zb). |
| S3 | durable generation·내부 활성화·hint 구현. 실제 HTTP/SDK 8개 통과. |
| S4 | 15초 interval 제거, hint·단발 확인 구현. 최종소스85명 무변경10분 버전HTTP0건(SFAvNp). |
| S5 | 게시→공개 확인→활성화·receipt. 로컬 가짜 pipeline 19/19. 운영 SSH·Pages 미실행. |
| S6 | 최종 소스SFAvNp PASS: SDK85명10+10분·2,071,365입력·UI20회+worker교체·전체24개검사, 복구/drop/fix/pending0·seq=ack·canvas1·root≤2. PB브라우저·SDK100명worker 교체·수정worker브라우저 재생검사 통과. 최초QMbFGN 실패·원인미확정 기록은 보존하며 실제IME/터치기기는 제외. |
| S7 | 정본·인계·결과 문서 갱신. 운영 도입 설정과 공개 검사 진단 경로 결정(NEEDS-DECISION)은 남김. |

## 운영 적용 결과 (2026-10-11)

사용자 후속 승인으로 commit·push·운영 적용과 실제 공개 브라우저2개 전체UI 교체·원복/연결유지 검증을 완료했다. 현재 generation3·revision52c726b5, 입력4061개·drops/recovered/fix/pending0·seq=ack다. 최초 게임host 도입 재시작1회 뒤 UI 교체는 host/PB 재시작 없이 진행했다. [상세 운영 결과](../reviews/2026-10-11-frontend-ota-production.md). CI 후속 활성화 자동화·실제기기·공개장시간과 과거정체 원인은 남는다.
