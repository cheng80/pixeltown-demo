# PB 배포 중 기존 플레이 유지

## 동작 계약

게임 연결은 Colyseus가, 계정·저장된 별은 PB가 맡는다. PB 코드 배포 때문에 Colyseus를 재시작하지 않는다. 게임 worker 교체 계약은 그대로 유지한다.

| 상황 | 처리 |
|---|---|
| PB가 내려간 동안 이미 입장한 사람 | 같은 room/session과 WebSocket으로 이동·별 획득·snapshot을 계속 처리한다 |
| 판 정산 또는 퇴장 | Colyseus가 정산을 디스크 outbox에 기록한다. PB 저장 완료로 표시하지 않는다 |
| PB 복구 | outbox가 재전송한다. 동일 매치 재전송은 중복 지급하지 않는다 |
| 지갑 조회 실패 | 마지막 확인 잔액과 미확인 상태를 유지한다. 게임 연결 장애 화면을 띄우지 않는다 |
| 새 게스트 발급·입장 | PB가 필요하므로 실패하거나 재시도가 필요하다. 기존 접속자 유지와 구분한다 |
| PB와 호환되지 않는 DB 구조 변경 | 이 절차로 무중단을 보장하지 않는다. 신구 코드 호환·백업·이행 검증이 먼저다 |

`GET /health`는 게임 프로세스의 생존 상태다. PB 중단 중에도 게임이 정상이라면 200이다. `GET /ready`는 새 입장에 필요한 PB도 확인하므로 그동안 503이다. ready 503을 기존 WebSocket 강제 종료 조건으로 쓰면 안 된다. API payload와 이동 `seq/fix`는 바꾸지 않는다.

## 실행 분리

- PB 전용 실행: `npm run start:minimal:pb` (`scripts/minimal-pocketbase.mjs`). DB 잠금과 초기화 검증은 기존 방식을 유지한다.
- 게임 전용 실행: `npm run start:minimal:game` (`scripts/start-minimal-game.mjs`). PB를 시작·종료하지 않는다. 최초 실행 전에 PB 관리자 준비가 필요하지만 이후에는 PB가 꺼져 있어도 게임 프로세스를 시작할 수 있다.
- 로컬 `npm run dev:all`은 위 두 실행기를 각각 관리한다. 실행 중 하나가 종료되면 그 구성만 다시 시작한다. 사용자가 전체 런처를 종료할 때는 게임 정산 후 PB를 종료한다.
- 운영은 `com.fastmake.pixeltown.minimal.pocketbase`와 `com.fastmake.pixeltown.minimal.colyseus` 두 launchd 서비스로 나눈다. PB 업데이트는 PB 서비스만 재시작한다.

운영의 기존 통합 런처를 두 서비스로 처음 바꾸는 일은 별도 전환이다. 이미 실행 중인 런처는 파일 수정만으로 바뀌지 않는다. 최초 전환은 기존 런처를 종료하므로 기존 연결을 유지하지 못한다. 기본 도구는 빈 로비에서만 적용한다. 사용자가 이 초기 끊김을 허용한 경우에만 `--allow-connected`를 붙인다. 2026-10-08 운영 전환은 사용자의 허용을 받은 뒤 실행했으며, 실제 전환 시점의 접속자는 0명이었다. 이후 PB 단독 배포부터 기존 연결을 유지한다.

## 운영 명령

Mac mini의 최소 app에서 실행한다. 기존 게임 배포 스크립트는 사용하지 않는다.

```sh
python3 scripts/split-minimal-services.py         # 최초 분리 전 읽기 전용 검사
python3 scripts/split-minimal-services.py --apply # 빈 로비·outbox 0/0을 재확인한 뒤 최초 분리
python3 scripts/deploy-minimal-pb.py              # 분리 완료 후 PB만 재시작
python3 scripts/deploy-minimal-pb.py --hooks-source /완성된/최소/hooks
```

hooks 배포 도구는 최소 `api.pb.js`와 `bootstrap.pb.js`만 있는 별도 디렉터리를 받는다. DB online 백업과 이전 hooks를 `~/Servers/pixeltown-minimal/.backups/pb-deploy-*`에 보관한다. PB를 종료한 뒤 hooks를 바꾸므로 파일 복사 도중의 코드를 실행하지 않는다. 시작이 실패하면 이전 hooks를 다시 선택한다. 이전 코드로 복구해도 이미 바뀐 DB는 되돌리지 않는다.

실행 파일 버전 교체는 이 도구가 하지 않는다. 호환성 검사를 마친 실행 파일 경로를 PB 전용 환경에 반영하고 PB만 재시작하는 별도 작업이다. 이번 검사를 통과했어도 DB 구조 변경과 실행 파일 업그레이드는 따로 검증한다.

## 검증과 남은 일

운영 서비스 분리와 공개 경로 PB hooks 교체·원본 복구를 완료했다. SDK 1개와 실제 브라우저 1개가 계속 이동했고, 같은 room/session·게임 PID를 유지했다. SDK 입력 238개·snapshot 254개, 끊김/fix 0건이었다. 브라우저의 재접속 안내도 0건이었다. 보고서는 `.test-work/minimal-pb-public-a0dqvT/report.json`, 자세한 검증과 백업 위치는 [PROJECT_STATUS 7절](../03_PROJECT_STATUS.md#7-인수인계)에 있다. 85명 접속과 3분 반복 배포는 사용자 중지 상태를 유지하며 이 검증에 재사용하지 않는다. 검사는 별도 로컬 DB·포트·소수 시험 접속으로 수행한다.

`npm run test:minimal:pb-restart`는 18125/12625의 실제 PB와 SDK로 PB 중단·코드 변경·실패 복구·정산을 검사한다. 브라우저까지 확인하려면 `MINIMAL_PB_BROWSER=1`과 사용자 지정 `CHROME_PATH`를 함께 전달한다. macOS의 `npm run test:minimal:services`는 18127/12627, 시험 전용 launchd label로 최초 분리 거절·분리 적용·PB 코드 배포·실패 복구 도구를 실제 실행한다. 두 검사 모두 전용 DB와 자료를 `.test-work/`에 남기고 자기 프로세스만 종료한다.

실 서비스에서는 PB가 얼마나 오래 멈추는지, outbox를 저장할 디스크가 충분한지 확인한다. 입장 재시도 안내와 DB 이행·복구 절차도 추가로 검증한다. PB를 두 개 띄워 같은 SQLite 파일에 연결하는 방식은 사용하지 않는다.
