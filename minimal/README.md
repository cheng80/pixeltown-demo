# 최소 픽셀타운

메인 로비 하나에서 최대 100명이 걷고 별을 모은다. 닉네임·기본 캐릭터, 서버 이동 검증, 별 획득·정산, 개인별 저장 확인, 접속 불가 안내만 포함한다. 상점·채팅·꾸미기·다른 장소·미니룸은 제공하지 않는다.

## 실행

프로젝트 루트에서 Node.js 22.13 이상(검증은 24.11.1), 루트/Colyseus 의존성, 기존 `pocketbase/.local/pocketbase` 실행기가 필요하다. `MINIMAL_PB_BINARY`로 호환 실행기 경로를 지정할 수 있다. 기존 초기화·원격 배포 스크립트는 실행하지 않는다.

```sh
npm run setup
npm run dev:all
```

- 게임: http://127.0.0.1:5270
- 접속 불가 안내: http://127.0.0.1:5270/unavailable.html
- Colyseus health / readiness: http://127.0.0.1:12620/health /ready
- PocketBase: http://127.0.0.1:18120

포트를 쓰는 프로세스가 있으면 시작을 거절한다. 기존 프로세스를 종료하지 않는다. 정상 종료 시 게임의 정산 처리 후 PocketBase를 종료한다. 관리자 값·DB·정산 파일은 `.local/minimal/`에만 생성하고 Git에서 제외한다. 기존 DB나 연결된 경로를 지정하면 초기화 전에 거절한다. 관리자 파일은 `0600`이다.

PB와 게임은 각각 `npm run start:minimal:pb`, `npm run start:minimal:game`으로 실행할 수 있다. 최초에는 PB를 먼저 준비한다. `dev:all`도 두 실행기를 따로 관리해 PB가 종료되면 PB만 복구한다. PB 중단 중 기존 플레이는 계속되며 새 입장·지갑 조회는 실패할 수 있다. 정산은 디스크에 남았다가 복구 후 저장한다. [PB 단독 배포와 운영 서비스 분리](../docs/handoffs/2026-10-08-pb-deployment.md)

다른 최소 환경은 서로 다른 상태 폴더와 포트 세 개를 지정한다.

```sh
MINIMAL_STATE_DIR=.local/minimal/second MINIMAL_PB_PORT=18123 MINIMAL_GAME_PORT=12623 MINIMAL_WEB_PORT=5273 npm run dev:minimal
```

`npm run dev`는 프런트만, `npm run build`는 `dist-minimal/`을 만든다. 런처는 실제 포트에 맞는 `VITE_MINIMAL_PB_URL`·`VITE_MINIMAL_GAME_URL`을 전달한다. 브라우저 설정에는 관리자 비밀정보를 넣지 않는다. 공개 최소 빌드는 `.env.minimal-remote`의 공개 백엔드 주소를 사용하고 `npm run build:remote`로 `dist/`를 만든다. 기존 운영 화면 빌드는 `build:legacy:remote`다.

## 계약

| 경로 | 권한·동작 |
|---|---|
| `POST /api/minimal/guest` | 닉네임+32자 이상 임의 암호, 계정·프로필 원자 생성, PB 인증 응답 |
| `GET /api/minimal/wallet` | 사용자 인증, `{balance, settledMatchIds, profile:{name}}`를 같은 DB 트랜잭션에서 조회 |
| `POST /api/minimal/commit-match` | 관리자 전용, 양수 수령자·전체 점수≤64, 매치 전체 내용 동일 재전송만 멱등 성공 |
| 기존 `/api/pixeltown/*` 변경 API | 보류 응답, 기존 hooks를 로드하지 않음 |
| `minimal-town`, `{zone:'lobby'}` | 단일 프로세스에 단일 로비만 생성, 100명 초과 시 새 방을 만들지 않고 입장 거절 |
| `move {x,y,seq,fix}` | 서버 이동 거리·충돌·입력 중복 검증 |
| `snapshot` | 플레이어·현재 별·점수·정산 시각 |
| `gameEnded` | outbox 디스크 기록 완료. DB 반영 완료와 구분 |
| 보류 실시간 메시지 | `featureUnavailable` 응답, 연결 유지 |

위치와 진행 중 점수는 접속 계층의 최신 확정 메모리 상태로 보존하며 worker 교체 시 인계한다. 접속 계층 프로세스 종료까지 복원하는 저장소는 아니다. 정산은 초기 5개·6초당 1개·맵 상한 12개·3분 주기·총점 64 도달 시 조기 정산을 유지한다. 인원별 별 공급 확대는 아직 적용하지 않았다. 개발 검사에서만 `MINIMAL_SETTLE_MS`·`MINIMAL_SPAWN_MS`를 단축할 수 있다.

정산 대기열은 파일별로 처리한다. 없는 사용자 등의 실패 기록을 보존하면서 다른 매치는 계속 처리한다. 자동 계정 삭제 작업은 없으며 일반 사용자는 계정/원장을 직접 삭제하지 못한다. 지갑 실패 시 이전 성공값을 유지하고 미확인으로 표시한다. 브라우저의 대기 점수는 사용자별로 저장하지만 서버 원장을 대신하지 않는다.

## 검증과 배포 경계

```sh
npm run test:minimal:unit
npm run test:minimal
npm run test:minimal:swap # 별도 18122/12622, 실제 100명 활동·반복 교체
npm run test:minimal:ui # Chrome 설치 또는 CHROME_PATH 실행기 지정
npm run test:minimal:pb-restart # 별도 18125/12625, PB 배포·종료·실패 복구 중 실제 연결 유지
npm run build
```

통합 검사는 `.test-work/minimal-integration-*`의 실제 별도 PB·Colyseus와 18121/12621 포트를 사용한다. 100명 단일 로비·101번째 거절, 이동·정산·재전송·보류 기능·실패 파일 격리·DB 재시작 보존을 검사한다. `test:minimal:ui`는 백엔드를 대체한 오프라인 화면 검사이며 실제 통합 검사와 구분한다. 보고서와 실패 증거는 해당 디렉터리에 남는다. 운영 서버·운영 계정에는 접근하지 않는다.

## 로컬 worker 교체

접속 계층은 유지하고 `simulation-worker.js`만 새 Node worker에서 실행한다. 후보는 상태와 이후 입력을 따라잡아 같은 틱의 상태/효과 hash가 일치할 때 승격한다. 정산은 유지되는 단일 outbox가 기록한다. 브라우저의 room/session, 입력 seq/fix, 진행 중 점수는 바꾸지 않는다. health는 `hotSwap:true`와 worker revision/generation/sequence를 제공한다.

새 검증 환경을 시작할 때 32자 이상의 임의 `MINIMAL_SWAP_TOKEN`을 프로세스 환경에 제공한다. 토큰은 브라우저나 Git 파일에 넣지 않는다. `MINIMAL_WORKER_ENTRY`는 기본 `colyseus/minimal/simulation-worker.js`이며 다른 배치 경로를 시작 시 지정할 수 있다. 배치에는 `simulation-worker.js`, `worker-runtime.js`, `simulation.js`, 상대 경로의 `minimal/shared/world.js`가 함께 있어야 한다. 준비한 호환 릴리스를 고정 경로에 원자적으로 반영하거나 완성된 디렉터리를 가리키는 링크를 전환한 뒤, 같은 토큰과 해당 **로컬** 포트로 다음 명령을 실행한다.

```sh
npm run swap:minimal
```

이 명령은 localhost의 `POST /internal/worker/swap`만 호출한다. 실행 경로를 HTTP body로 받지 않으며 Origin이 있는 브라우저 요청은 거절한다. 후보 준비/추격/상태 검사가 실패하면 409와 이유를 반환하고 현재 worker가 계속 실행된다. 동일 상태 schema 1, `minimal-move-v1`, wire protocol 1 호환이 전제다. 맵·속도·입력 계약을 바꾸는 릴리스에는 쓰지 않는다.

`MINIMAL_BROWSER_HOLD=1 npm run test:minimal:swap`은 검증 뒤 5272 웹과 별도 백엔드를 유지한다(최대 30분). 출력된 `.test-work/minimal-hotswap-*` 폴더에서 browser-done 파일을 만들면 검사 소유 서버만 종료한다. 기본 브라우저 검증은 ego-browser이며, 동시 비활성 탭 렌더 계측이 불가능할 때만 다음 보조 검사를 사용한다.

```sh
CHROME_PATH=~/Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium MINIMAL_SWAP_STATE=/절대/경로/.test-work/minimal-hotswap-XXXX node tests/minimal-hotswap-browser.mjs
```

[기술 계약](../docs/02_TECH_SPEC.md)과 [프런트 인계](../docs/handoffs/2026-10-08-worker-contract.md)를 따른다. 최초 구조 도입과 접속 계층 자체 재시작, PocketBase 업데이트, 호스트 재부팅은 무중단 worker 교체 범위가 아니다. 최소 구조는 기존 운영 서버와 분리해 도입했다. 최신 검증·게시 결과는 [PROJECT_STATUS](../docs/03_PROJECT_STATUS.md)에 기록한다. 실 서비스용 추가 작업·정리 조건은 [인계](../docs/handoffs/2026-10-08-minimal-service.md)를 따른다.

## 버전별 worker 배포

런처는 worker 소스 4개를 SHA-256 버전별 폴더로 저장하고 고정 링크 `worker-current`를 선택한다. 실행 중에는 호스트/PB를 재시작하지 않고 `npm run deploy:minimal:worker`를 호출한다. 완성된 release를 선택한 뒤 기존 호스트에 교체를 요청한다. 후보 거절은 이전 링크를 선택한다. HTTP 응답 유실은 health로 결과를 확인하며, 결과가 불명확하면 재시작이나 무조건 이전 링크 복원을 하지 않는다. 같은 버전은 교체를 건너뛴다. 호스트 코드·DB 훅·맵·입력 규칙 변경은 이 명령의 무중단 대상이 아니다.

배포 상태 표시 계약은 [Claude 요청](../docs/handoffs/2026-10-08-deployment-indicator.md)에 있다. 공개 경로에서는 배포 제어 요청과 PB 초기화 확인이 거절된다. 공개 게스트 발급은 방문자 IP당 시간당 20회이며 시험용 계정은 내부 관리 경로에서 별도로 준비한다.

## 플레이 중 화면 코드·리소스 교체

`WorldCanvas.jsx`는 입력과 이동을 계속 처리하고 `visual-release.js`의 그림만 교체한다. `art.js`, CSS, 글꼴·이미지도 버전별로 준비한다. 화면 코드·그림을 수정한 뒤 승인된 범위에서 `npm run deploy:minimal:frontend`로 Pages에 게시한다. `npm run build:remote`만 실행하면 게시하지 않는다. 이전 공개 파일을 해시 대조해 다음 빌드에도 포함한다. 최초 한 번 기능을 받은 뒤에는 브라우저가 15초마다 확인해 새 화면으로 전환한다.

인증·접속·이동·충돌·React 화면 구성 변경은 열린 탭에 자동 적용하지 않는다. [쉽게 보는 그림](../docs/diagrams/frontend-live-update.html), [파일 계약·배포와 정리](../docs/handoffs/2026-10-08-frontend-live-update.md)를 따른다. `npm run test:minimal:visual`은 기존 로컬 PB/game을 유지한 실제 화면 교체·리소스 누락·오류 복구 검사다. `test:minimal:ui`는 SDK를 대체한 회귀 검사이며 실제 팔·다리 그림의 순환과 정지 복귀도 대조한다.

85명 관찰 도구는 `MINIMAL_DEPLOYMENT_PAUSED=1`로 시작하면 자동 worker 배포 없이 이동만 한다. 실행 폴더에 `PAUSE_DEPLOYMENTS` 파일을 만들면 배포만 중지한다. 지시 후 이 파일을 제거하면 3분 뒤부터 재개한다. `STOP`은 전체 시험 접속 종료와 자신이 배포한 worker의 조건부 원본 복구다. 두 제어를 혼동하지 않는다. 현재 실행과 사고 기록은 PROJECT_STATUS 7절을 따른다.
