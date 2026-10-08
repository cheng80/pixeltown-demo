# 게임 worker 교체 로컬 검증 (2026-10-08, Codex)

결과: 접속 계층을 유지한 게임 worker 교체 구현과 로컬 검증을 완료했다. 프런트 화면/입장 위치는 변경하지 않았다. 운영 접근·배포·commit·push·개발 세션 종료는 하지 않았다.

## 구현과 검증 대상

- `colyseus/minimal/worker-host.js`: 연결 서버가 순서 이벤트, 최신 확정 상태, 후보 추격, 상태/효과 hash 비교, 틱 경계 권한 전환, 늦은 응답 차단, 복구를 소유한다.
- `worker-runtime.js`, `simulation-worker.js`: 기존 Simulation을 worker에서 실행하고 시각·난수·UUID를 결정적으로 재생한다. 후보는 정산 효과를 제안할 뿐 PB/outbox에 접근하지 않는다.
- `server.js`: 50ms 입력 배치/스냅샷, 기존 인증·room/session 유지, 단일 정산 처리. `POST /internal/worker/swap`는 loopback·별도 토큰·Origin 거절. `scripts/swap-minimal-worker.mjs`로 호출한다.
- 상태 인계에 이동 예산·시각·ack/fix, 진행 판, 별/생성 순서, 퇴장자 점수, pendingMatch를 포함한다. 프런트 wire protocol 1과 100ms 타인 보간을 유지한다.
- 권한 전환 시점의 host 소요 시간과 후보 준비 시간은 구분한다. 후보 준비 중에도 기존 worker가 계속 진행한다.

## 실제 100명 활동 중 교체

명령: `npm run test:minimal:swap`. 실제 격리 PocketBase/Colyseus, 포트 18122/12622, 정산 12초·별 생성 1초. 100명이 50ms마다 정상 이동을 보내며 별 수집 담당은 분수를 피해 별을 따라간다. 기준 구간 약 6초, 교체/후속 관찰 약 16초이며 전체 가입·정리 시간은 별도다.

최종 [보고서](../../.test-work/minimal-hotswap-1SyljF/report.json):

- 100명 단일 로비, **43,100 입력**, 8회 활동 중 교체 + 1회 강제 보정 뒤 교체.
- 릴리스는 실제 게임 코드의 점수 합산을 `reduce`와 동등한 `for` 구현으로 번갈아 바꾼다. 소스 revision과 generation 변경을 확인한다. 규칙을 바꾸는 배포를 검증한 것은 아니다.
- 연결 종료, 예상하지 않은 fix, 미확인 입력, 위치/ack 불연속, 같은 판의 점수 감소: **0건**. 100명 각각 250개 초과 입력 및 최종 ack 일치를 단언했다.
- 막힌 위치를 보내 발생시킨 fix=1이 교체 뒤에도 유지되고, 올바른 fix와 증가한 seq로 이동 재개 성공.
- 매치 통지 중복 0. 최종 results 4행/inventory 4행, 사용자별 지갑·매치 ID·원장 일치, outbox pending/failed 0.
- 권한 전환 최대 **1.83ms**, 후보 준비 최대 **79.76ms**. 후보 준비는 연결 중단 시간이 아니다.

| 측정(ms) | 기준 p95 / p99 / max | 교체 구간 p95 / p99 / max |
|---|---:|---:|
| snapshot 간격 | 53.97 / 61.42 / 111.67 | 54.47 / 60.88 / 80.94 |
| 입력 → ack | 60.03 / 69.59 / 120.66 | 49.66 / 54.42 / 76.81 |
| 별 접촉 입력 → 제거 snapshot | 59.64 / 59.64 / 59.64 | 51.21 / 51.21 / 51.21 |

별 지연 표본은 기준 4개/교체 14개로 적다. 앞선 동일 경로 교체 검사에서는 정산을 포함한 교체 구간 별 지연 최대 152.65ms도 관찰했다. 단일 로컬 컴퓨터의 짧은 검사이며 인터넷 경로·장시간 백분위·운영 100명·30분 보장이 아니다. 기준 구간에도 111.67ms snapshot 간격이 관찰됐으므로 50ms는 스케줄 주기이며 모든 전달 간격의 상한이 아니다.

## 실제 프런트 두 화면

- ego-browser task space 5에서 `127.0.0.1:5272`와 `localhost:5272` 두 사용자 입장·키보드 이동·서로 보기·화면을 확인했다. 명시적으로 검증용 소켓을 닫으면 “잠시 쉬어 가요”가 표시됨을 확인했다.
- ego의 비활성 탭은 첫 동시 계측에서 9프레임만 그렸고 키보드 입력도 받지 못했다. 두 페이지 동시 성능 검증으로 인정하지 않았다. [ego 관찰 기록](../../.test-work/minimal-hotswap-0uoaEw/ego-report.json)을 남겼다.
- 사용자 허용 경로 `CHROME_PATH=~/Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium`의 Playwright Chromium으로 `tests/minimal-hotswap-browser.mjs`를 실행했다. 실제 백엔드를 사용하며 모의 SDK/API가 아니다.
- [브라우저 보고서](../../.test-work/minimal-hotswap-0uoaEw/browser-report.json): 6회 교체, 두 화면 각각 221개 실제 키보드 이동 입력, room/session 동일, drop/error/장애 화면/예상하지 않은 fix/예측 좌표 불일치/3초 stale 0. pending 최대 1·종료 시 0.
- 실제 엔진의 `others.from/to/at`를 사용한 100ms 보간 구간이 두 화면에서 658/659프레임 관찰됐다(각 677프레임). 프런트 소스 수정 없이 테스트가 React 개발 엔진과 기존 DEV 진단을 읽었다.
- 브라우저 snapshot: 기준 p95 최대 51.9ms, 교체 p95 최대 52.7ms/p99 62.6ms/max 65.1ms. 입력 ack: 기준 max 52.2ms, 교체 max 51.6ms. 예측만 움직여 서버 정체를 숨긴 결과가 아니다.
- 화면: [ego 도입 전](../../.test-work/minimal-hotswap-0uoaEw/browser-before.png), [ego 확인 후](../../.test-work/minimal-hotswap-0uoaEw/ego-after.png), [동시 브라우저](../../.test-work/minimal-hotswap-0uoaEw/browser-after.png).

## 실패 주입·회귀

| 검사 | 결과 |
|---|---|
| 최소 단위 | 17/17. 후보 시작 실패·무응답·상태 불일치 취소, 250ms 준비 중 다중 이벤트 추격, 승격 후 활성 worker 실패/처리 중 입력 재생, 이전 worker 늦은 결과, 정산 디스크 실패·중복 제안, 입퇴장·중복 seq·fix 경계 |
| 실제 PB/Colyseus 회귀 | 6/6, `.test-work/minimal-integration-YI8qO5/report.json`: 100명/101번째 거절·정산·실패 outbox·DB 재시작 |
| 기존 서버 단위 | 32/32 |
| 최소 프런트 빌드 | `npm run build` 통과 |
| 실제 교체 예비 검사 | `.test-work/minimal-hotswap-0uoaEw/report.json` 통과: 42,300 입력·9회 교체. 브라우저 검사의 백엔드로 계속 사용 |
| 첫 부하 검사 실패 | `.test-work/minimal-hotswap-5hkEXq/report.json` 보존. 검사 봇이 낮은 별만 추적하고 왕복 전환 전 멈추는 잘못된 workload를 수정한 뒤 재검증. 제품 실패로 숨기거나 통과로 집계하지 않음 |

최종 검증 소유 서버는 종료했다. 기존 사용자 서버 PID **56557(PB 18120), 56558(game 12620), 56559(web 5270)**는 작업 시작과 종료에 동일했다. 이 프로세스는 새 worker host를 아직 로드하지 않아 `hotSwap:false`인 것이 정상이다. DB·메인 체크아웃·다른 개발 세션을 보존했다.

## 남은 경계

최초 접속 계층 도입, 접속 계층 자체 교체, 운영 검증/배포는 별도 지시 후 진행한다. 현재 TCP/WebSocket을 다른 서버 프로세스로 옮기는 구현은 아니다. 후보 코드가 상태 schema/이동 규칙을 바꾸는 경우에는 별도 계약·마이그레이션이 필요하다. PB 업데이트·호스트 재부팅·디스크/접속 프로세스 손실·전체 게임 기능의 무중단은 검증하지 않았다. 프런트의 재연결 계약 변경은 필요하지 않으며 [Claude 인계 계약](../handoffs/2026-10-08-worker-contract.md)을 따른다.

## 장시간 검사와 상단 표시 추가 확인

- 로컬 100명·30분: `.test-work/minimal-hotswap-ow3S5Q/report.json` PASS. 1,800,040ms, 3,530,400 입력, 31회 교체(의도한 fix 이후 교체 포함). 연결 종료·예상 밖 fix·입력 누락·위치/점수 되돌림 0. 원장/결과 각각 12건과 개인 지갑 일치.
- 교체 중 snapshot p95/p99/max 53.84/56.74/164.36ms, 입력 ack 56.97/63.92/161.51ms. 기존 짧은 검사보다 최대 지연은 커졌지만 프런트 장애·입력 차단 기준을 넘지 않았다.
- 공개 전송 압축을 추가한 새 로컬 100명/9회 검사도 PASS(`minimal-hotswap-mACdEz/report.json`, 42,800 입력).
- 상단 상태 메시지를 받은 실제 두 브라우저는 6회 교체 PASS(`minimal-hotswap-UpiiRu/browser-report.json`). 각각 219/220 입력, room/session 유지, 연결·error·cover·fix·예측 오류·stale 0, 보간 프레임 670/657. 단계와 현재 버전 변경을 수신·화면 모두에서 확인했다. 동시 프레임 측정은 ego 비활성 탭 렌더 제한 때문에 지정 Chromium 1193을 사용했다. ego에서도 실제 입장·이동·교체 직후 “새 버전 준비 중”·새 버전/회차·연결 유지·fix 0을 별도로 확인했다.
- 공개 100명 검사는 배포 이전 활동에서 연결 종료를 재현했고, 압축 적용 후 30분 재검사를 통과했다. 아래 결과와 PROJECT_STATUS를 따른다.

## 공개 최소 서버 100명·30분

`.test-work/minimal-hotswap-eT1IBb/report.json` PASS. 100개 합성 SDK, 1,800,003ms, 3,533,031 입력, 30회 교체. 연결 종료·예상 밖 fix·입력 누락·위치/점수 되돌림 0. 의도한 불법 이동의 fix=1과 이후 교체·정상 입력 ack도 확인했다. 지갑 100개와 원장/결과 20건이 일치하고 outbox 0/0이다. 검사 뒤 원본 호환 로직으로 다시 교체했다.

| 측정 | 배포 전 p95/p99/max | 교체 기간 p95/p99/max |
|---|---|---|
| snapshot 간격 | 121.63/137.13/427.69ms | 130.55/143.67/850.83ms |
| 이동 ack | 252.79/367.52/743.91ms | 266.37/346.89/1531.76ms |
| 별 접촉 확인 | 264.74/349.69/349.69ms(21개) | 247.47/313.14/393.41ms(329개) |

50ms는 서버 스케줄 주기이며 인터넷 도착 간격을 보장하지 않는다. 합성 SDK는 실제 프런트의 pending 20개 제한을 실행하지 않으므로, 이 결과만으로 100개 실제 브라우저의 입력 차단이 전혀 없었다고 단정하지 않는다. 공개 실제 브라우저·상단 표시 검사 결과는 게시 후 따로 기록한다.

압축 전 실패는 보존했다. 첫 입장 HTTP 실패 두 번(`YPoZ4U`, `tbNx4l`), 기본 활동 단계의 연결 종료(`93BT5T`, `HULefX`)를 운영 성공으로 덮어쓰지 않는다. 마지막 경우 ws 기반 생성기로도 32개 연결 종료(1006 및 후속 SDK 4003)를 재현했고, 같은 생성기에 서버 압축을 적용한 뒤 30분 검사가 통과했다. 전송량·heartbeat 지연이 원인이라는 설명은 추정이다. 원인을 네트워크 구간별로 계측한 검사는 아니다.
