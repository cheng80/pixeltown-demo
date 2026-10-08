# 2026-10-08 개별 연결 끊김 7건 VM 분석

## 결론

**원래 7건의 최초 원인은 아직 확정할 수 없다.** 서로 다른 7개 소켓의 비정상 종료는 확인되지만, `1006` 자체는 종료를 일으킨 주체나 이유가 아니다. 서버 프로세스 재시작, worker 교체, Cloudflare, Node 버전 중 하나로 단정할 증거가 없다. 뒤따른 18:07:38 KST 검사 제어 사고는 별도 사건이다.

이 문서는 승인된 VM 전용 분석이다. 운영 서버·Mac·운영 DB·운영 인증·SSH·Tunnel에는 접근하지 않았다. 공개 부하, 재시작, commit/push/merge/deploy를 하지 않았다. 독립 loopback PB/game/proxy와 새 임시 테스트 계정만 사용했다. 현재 파일은 로컬 분석 산출물이며 공개 게시되지 않았다.

## 재현 환경과 무결성

- 소스: `94830650246d15be8ae82693da4882222dc319c4` detached checkout.
- VM: Linux x86_64, 기본 Node `v24.19.0`; 원래 검사 버전 `v24.11.1`은 공식 nodejs.org 배포와 SHASUMS256.txt 대조 후 별도로 확보했다.
- `npm ci --cache /tmp/pixeltown-npm-cache`, `npm --prefix colyseus ci --cache /tmp/pixeltown-npm-cache` 성공. 최초 기본 cache `/home/agent/.npm` 디렉터리 오류 뒤 쓰기 가능한 cache 경로로 정상 설치했으며 lockfile은 수정하지 않았다.
- root SDK `@colyseus/sdk 0.18.4`, 서버 core `0.18.18`, ws-transport `0.18.4`, schema `5.0.35`; 실제 전송 dependency `ws 8.22.0`.
- PocketBase `0.39.7`: 공식 GitHub release의 Linux amd64 zip. VM 전용 실행기와 독립 DB 사용.
- AGENTS 지정 순서대로 PROJECT_STATUS → PLAN-001 → 관련 PRODUCT_SPEC/TECH_SPEC → 코드/테스트를 확인했다. checkout 내 추가 AGENTS나 `.agents/skills`는 없었다.

| 입력 | SHA-256 |
|---|---|
| handoff README.md | `957be2bc2ec8a542071642d52eeea1b339aeb464b230fa4a8d0e23e53cb6d120` |
| evidence.json | `7c0f350f22bb601f47ee73839ddc83cdac7ca8bc13e0c9b11f987f389665e708` |
| package-lock.json | `c3dd38f9b8f79ea03c67fe9b9c45c56b68022de4c36e85b75a6d41b79083b10b` |
| colyseus/package-lock.json | `d5567901bd30d4653ac72d697eb81abfa2d20db0ddbc792b7ca156b90c4645d6` |
| PocketBase zip | `0fe09a4e1a8f6e5b53d206c2e6b94a5812febcb43082d66d69bc8ba4d8e8429c` |
| PocketBase executable | `dd6ebcb5a163e36b14454c45382fe8e17974aa9f4ffe3a6e4cca6d8528a26e29` |

첨부 zip 6,944 bytes를 경로 순회/심볼릭 링크 검사 후 추출했고 README/evidence는 manifest와 일치했다. manifest 자체의 서명 검증을 뜻하지 않는다.

## 검증 명령과 기초 회귀

모든 명령의 작업 디렉터리는 이 checkout이다. `PB`는 checkout 바깥 `../tools/pocketbase/pocketbase`의 절대 경로다.

```sh
npm ci --cache /tmp/pixeltown-npm-cache
npm --prefix colyseus ci --cache /tmp/pixeltown-npm-cache
npm run test:minimal:unit
npm --prefix colyseus test
MINIMAL_PB_BINARY="$PB" npm run test:minimal
MINIMAL_PB_BINARY="$PB" npm run test:minimal:swap
npm run build
```

| 검증 (VM Node24.19.0) | 결과 |
|---|---|
| 최소 단위 | 21/21 PASS |
| 기존 서버 단위 | 32/32 PASS |
| 실제 PB/게임 통합 | 6/6 PASS; `.test-work/minimal-integration-D6eajp/report.json` |
| 100명 worker 교체 | PASS; `.test-work/minimal-hotswap-riLG5H/report.json` |
| 로컬 최소 빌드 | PASS |

100명 검사는 활동 22,169ms, 입력 44,100, 교체 9회, drop/예상 밖 fix/입력 유실 0이었다. 교체 구간 snapshot 최대 71.77ms, ack 최대 66.45ms, 마지막 players 0/outbox 0/0. 9회 중 마지막 1회는 의도한 위치 보정 뒤 상태 유지 검사다. 초단기 회귀이며 한 시간 안정성·실제 브라우저·공개 프록시 검증이 아니다.


원래 검사 버전 Node24.11.1로도 `MINIMAL_PB_BINARY="$PB" ../tools/node24.11.1/node-v24.11.1-linux-x64/bin/node tests/minimal-hotswap.mjs`를 실행했다. `.test-work/minimal-hotswap-etDJ5U/report.json` PASS: 활동 22,152ms, 100명, 입력 44,100, 교체 9회, drop/fix 0. 교체 snapshot 최대 82.10ms, ack 최대 74.60ms. 따라서 이 짧은 비교에서 버전별 실패 차이는 관측하지 못했다. Node22 비교는 하지 않았다.

## 압축 FIFO와 heartbeat의 분리된 메커니즘 검사

`../tools/heartbeat-queue-repro.mjs`는 설치된 Colyseus heartbeat와 ws Sender FIFO를 호출한다. 네트워크/PocketBase/실제 zlib는 실행하지 않으며 socket write·pong 전달·압축 완료를 모의한다. heartbeat는 기본 3000ms 대신 20ms로 가속했다.

```sh
node ../tools/heartbeat-queue-repro.mjs > ../results/heartbeat-queue-repro-node24.19.0.json
../tools/node24.11.1/node-v24.11.1-linux-x64/bin/node ../tools/heartbeat-queue-repro.mjs > ../results/heartbeat-queue-repro-node24.11.1.json
```

두 Node에서 동일한 결과:

- 압축 완료 + pong 도착: 종료 안 됨.
- 압축 callback을 고의로 보류: ping 프레임은 한 번도 mock socket에 쓰이지 않았지만 pingCount 2, sender FIFO에 ping 2개가 남은 채 terminate 호출.
- 두 번째 heartbeat 전 압축을 풀면: 종료 안 됨.

이 검사는 **송신 대기 중인 ping도 미응답 횟수로 계산되는 경로**가 존재함을 보인다. 원래 7건에서 zlib가 보류됐다는 증거, 실제 전송망 재현, 실제 ws 종료코드 관측 또는 사건의 근본 원인 확정이 아니다. timer를 무조건 늘리거나 압축을 끄는 제품 수정의 근거로 쓰지 않는다.

## 7건의 시각과 복귀

모든 시각은 2026-10-08 UTC이며 KST는 +9시간이다. Δ배포는 `runner deployment-applied` / snapshot에 실린 서버 `deployment.updatedAt` 두 기준을 각각 표시한다. 두 호스트 시계의 동기화 증거가 없으므로 둘의 차이를 순수 전송 지연으로 보지 않는다. Δ복귀는 `bot-rejoined`까지이며 첫 snapshot까지의 시간은 아니다.

| 사건/bot | 종료 UTC | 기존 session → 새 session | snapshot 나이 ms | seq/ack (pending) | raw close 차이 ms | gen | Δ배포 초: runner / server | 재입장 UTC / Δ복귀 초 |
|---|---|---|---:|---|---:|---:|---:|---|
| 1 / 33 | 09:04:44.870 | MHVWg4Bop → el5jOx-BY | 576 | 70860/70844 (16) | 18 | 22 | 60.946 / 61.077 | 09:05:02.045 / 17.175 |
| 2 / 32 | 09:04:57.503 | 439baMf2g → s2eoIp8BZ | 598 | 70919/70902 (17) | 14 | 22 | 73.579 / 73.710 | 09:05:15.403 / 17.900 |
| 3 / 74 | 09:05:00.550 | y7X4odfh0 → jNh_qsdBC | 640 | 70891/70876 (15) | 7 | 22 | 76.626 / 76.757 | 09:05:17.829 / 17.279 |
| 4 / 7 | 09:05:31.111 | XUpa0XDiB → LV4e0YkIs | 475 | 71337/71325 (12) | 9 | 22 | 107.187 / 107.318 | 09:05:48.120 / 17.009 |
| 5 / 12 | 09:06:19.308 | wsPfSoPyd → t_3wB8FRs | 520 | 72437/72423 (14) | 14 | 22 | 155.384 / 155.515 | 09:06:36.955 / 17.647 |
| 6 / 51 | 09:06:46.762 | Ue-sGRZ8b → w6a3TA0kH | 440 | 72296/72284 (12) | 8 | 23 | 2.699 / 2.878 | 09:07:03.506 / 16.744 |
| 7 / 38 | 09:07:00.852 | Jt1mNc9vA → d05DiAg39 | 496 | 72778/72766 (12) | 11 | 23 | 16.789 / 16.968 | 09:07:18.318 / 17.466 |

배포 기준:
- 21번째 교체 → gen22: runner `09:03:43.924`, 서버 updatedAt `09:03:43.793`, 준비 46.452ms·권한 전환 0.139ms.
- 22번째 교체 → gen23: runner `09:06:44.063`, 서버 updatedAt `09:06:43.884`, 준비 47.213ms·권한 전환 0.157ms.
- “교체 약 2.9초 뒤”는 bot51의 서버 timestamp 기준 2.878초다. 같은 runner clock 기준으로는 2.699초다.
- `09:07:23.716` progress에서 connected 85, cumulative drops 7을 기록한다. `connected`는 열린 소켓과 자기 snapshot이 모두 있어야 증가하므로 이때는 7개 모두 snapshot 수신도 재개했다. 그 이전의 각 재입장 시각만으로 실제 이동/지갑의 연속성까지 증명하지 않는다.
- 기록된 ready 시각은 PROJECT_STATUS상 `08:00:42 UTC`(초 정밀도)다. 사건들은 전체 입장 완료로부터 약 64분03초–66분19초 후다. 첨부에는 runner `startedAt/activeAt`, 각 원래 연결의 생성/upgrade 시각이 없다. 기존 logger도 초기 session별 join 시각을 남기지 않으므로, 각 socket의 정확한 나이를 계산하거나 “정확히 1시간 TTL”로 단정할 수 없다. 09:03:23 progress의 cumulative drops는 0이었다.

## runner 복구 및 계측 의미

`tests/minimal-live-observe.mjs`:
- 61–66행: 새 `Client`로 `joinOrCreate`하고 `room.reconnection.maxRetries=0`으로 SDK 자동 재접속을 끈다. 매 재입장에서 pending·snapshot·position·seq·fix를 초기화한다. `bot-rejoined`는 `joinOrCreate` 반환 직후, 75–84행의 snapshot 대기보다 앞서 기록한다.
- 67–72행: `departed`와 `c.room===room` 보호로 SDK drop/leave를 1회만 `stats.drops`에 센다. 별도로 raw socket close를 기록한다. drop callback이 `c.snapshot=null`로 만든 뒤 raw close callback이 실행되므로, raw 행의 `position:null`·ack/fix 누락은 수집기 자체 처리 순서다. 서버가 해당 값을 잃었다는 증거가 아니다.
- 68·85·125·133행: 종료 또는 join 실패 뒤 16초 대기; 500ms polling 후 새 입장을 시도한다. PB 인증, matchmaking/upgrade 소요 시간이 더해져 관측값은 16.744–17.900초다. 일반 브라우저 복구 UX의 시험과 다르다.
- `colyseus/minimal/server.js` 60–67행은 끊긴 session을 15초 보존한다. runner의 16초 대기는 이를 넘기려는 구조다. 건강 조회의 players는 `game.players.size`(97행)로, 연결된 소켓 수가 아니며 재접속 대기자를 포함한다. 따라서 봇 1개가 끊겨도 health 86은 자연스럽다.
- 각 종료에서 `seq-ack==pending`; 합계 pending은 98개다. 이는 마지막 수신 snapshot에서 아직 확인하지 못한 입력 수일 뿐, 서버 입력 유실 98개를 증명하지 않는다. 재입장에서 이 pending은 지워지므로 최종 pending 0도 앞선 98개가 모두 ack되었음을 증명하지 않는다. continuity 검사는 session 사이 snapshot을 비교하지 않는다.
- 90행의 `eventLoopLagMs`는 마지막 50ms 이동 timer의 단일 지연값이다. 사건값은 0–0.683ms지만 그 이전의 runner stall, 서버 event loop, zlib queue, callback 처리 중 지연을 배제하지 않는다. RSS·최대 지연·종료 전 원본 status는 첨부에서 빠져 있다.
- `lastSnapshotAt`는 서버 전송시각이 아니라 클라이언트 snapshot callback 처리시각(76–77행)이다. snapshotAge를 RTT 또는 heartbeat 마지막 pong 나이로 바꾸어 읽으면 안 된다.
- public `health-after-drop` 중 bot12의 응답 기록은 종료 뒤 5.835초다(09:06:25.143). 같은 사건의 내부 diagnostics 시작은 약 0.319초 뒤이고 정상 worker였다. public 조회의 지연은 추가 조사할 단서지만 DNS/TCP/HTTP/서버 응답 단계별 시간이 없어 원인으로 특정할 수 없다.

## 서버/진단이 실제로 보여 주는 것

- 제공된 7개 diagnostics는 모두 game/PB/Tunnel PID `78495/78579/965`, running·loaded, outbox pending/failed `0/0`, `ok:true`, candidate false다. game/PB의 last exit는 never exited, Tunnel의 last exit code 1은 과거 종료 상태이며 이번 사건 timestamp가 없다. 이를 이번 재시작으로 해석하지 않는다.
- worker recoveries/cancelled/staleResults 모두 0, sequence는 126756에서 129476까지 증가한다. 진단 시점에서 전체 worker가 죽거나 교체에 실패했다는 징후는 없다. 전송 socket별 문제·짧은 일시 정지까지 배제하는 지표는 아니다.
- 7×6 로그 항목 모두 baseline false, truncated false, lines 0, from==to다. 해당 즉시 증분 구간에서 선택된 6파일에 새 바이트가 없었음을 확인한다. 전체 로그에 결함 기록이 없다는 뜻은 아니다.
- `minimal/server.js`에는 session별 onDrop/onLeave/heartbeat 소켓 원인 기록이 없다. TECH_SPEC의 기존 게임용 drop/reconnect/lost 로그 설명을 미니멀 서버에 그대로 적용하면 안 된다. 미니멀 health에도 기존 서버의 connections 집계가 없다.
- 설치 ws-transport는 기본 `pingInterval=3000`, `pingMaxRetries=2`를 사용하고, 해당 서버는 이를 덮어쓰지 않는다. 두 pong 미응답 뒤 heartbeat tick에서 `terminate()`하는 코드가 있다(`colyseus/node_modules/@colyseus/ws-transport/build/WebSocketTransport.mjs` 53–54,161–171행). 이는 code1006을 만들 수 있는 후보 경로지만 당시 ping/pong/terminate 증거가 없어 이번 원인으로 확정하지 않는다. 0.5초 전까지 snapshot을 받았다는 사실도 송신 방향 pong 전달이 정상이라는 증거가 아니다.

## diagnostics 수집의 사각지대

`tests/minimal-live-diagnostics.py`와 runner의 진단 호출 기준:
1. 첫 수집은 기존 파일 끝에서 시작한다(47행). 시작 이전 로그를 수집하지 않는다.
2. 경로별 마지막 64KiB와 마지막 100행만 보존한다(48·58행). 100행 초과 손실은 `truncated` flag로 표시되지 않는다. 파일 inode/rotation 식별자가 없어서 교체된 파일 크기가 같거나 커지면 앞부분을 놓칠 수 있다.
3. 공유 Tunnel 로그에서 `pixeltown-minimal`이 없는 일반 정보와 `originService=`/`ingressRule=`를 가진 공통 ERR/WRN을 걸러낸다(53–55행). loopback 주소만 찍힌 관련 오류도 걸러질 수 있다.
4. 매 실행이 cursor를 앞으로 이동시킨다. events에는 diagnostics 호출 20건이 있지만 첨부에는 disconnect 7파일만 있다. 앞선 periodic/before/after 수집이 소비한 로그는 이 증거에서 검사할 수 없다.
5. runner가 diagnosticsBusy이면 새 수집 요청을 조용히 버린다(43–44행). 30초 주기 상태는 순간 부하·전송 역압·socket heartbeat를 담지 않는다.
6. 진단 `at`는 순차적인 launchctl/health/log 읽기 전에 생성되고 `collectedAt`은 SSH 결과 수신 뒤 기록된다. 정밀한 동시 snapshot이 아니며 클라이언트/서버 간 clock offset도 없다.
7. `/health` 성공은 새 HTTP 경로가 그때 응답했다는 사실이다. 기존 WebSocket/Tunnel stream의 정상성, 최근 ping/pong 또는 각 socket의 pending send를 검사하지 않는다.
8. 로그 경로의 설정·실제 실행된 코드 hash·transport 버전·log level을 당시 런타임과 대조한 증거가 없다. 7개 진단의 동일 PID는 프로세스 유지의 강한 정황이지만 전송 경로나 tunnel 내부 connection 재연결을 배제하지 않는다.

### 3초 heartbeat 격자 비교(휴리스틱)

transport는 모든 socket을 도는 단일 3000ms timer를 사용한다. 최초 관측 close(bot33)를 임의 원점으로 놓으면 아래와 같다. 실제 서버 heartbeat phase를 알고 있는 것은 아니다.

| bot | 최초 close 이후 초 | 이전 close 이후 초 | 최초 기준 Δ mod 3초 |
|---|---:|---:|---:|
| 33 | 0.000 | — | 0.000 |
| 32 | 12.633 | 12.633 | 0.633 |
| 74 | 15.680 | 3.047 | 0.680 |
| 7 | 46.241 | 30.561 | 1.241 |
| 12 | 94.438 | 48.197 | 1.438 |
| 51 | 121.892 | 27.454 | 1.892 |
| 38 | 135.982 | 14.090 | 0.982 |

받은 시각의 위상 잔차가 0–1.892초로 퍼져 있어, 고정 3초 경계에 딱 맞는 일괄 heartbeat 종료 패턴을 입증하지 않는다. 서버 timer 지연, socket별 전송/close 전달 지연, 실제 시작 위상이 없으므로 이 비교만으로 heartbeat를 배제할 수도 없다. 특히 data 수신은 이 transport의 pingCount를 초기화하지 않고 pong만 초기화하므로, snapshot/입력 흐름과 pong 흐름을 각각 기록해야 한다.


## 원인 후보 판단

| 후보 | 증거와 한계 | 현재 판단 |
|---|---|---|
| worker 교체 실패/전체 game 프로세스 재시작 | PID·room 유지, recoveries/cancelled 0, 5건은 교체 사이, 빠른 전환 기록 | 지지되지 않음. 전송 계층 간접 영향은 미배제 |
| 09:07:38 inspector 오류 | 모든 개별 drop과 재입장 뒤에 발생; 오류와 runner exit가 별도 기록됨 | 7건과 인과적으로 분리 |
| 서버 heartbeat `terminate()` | 기본 3초/2회와 강제 종료 코드 경로 존재; raw 1006과 양립 | 유력 조사 경로 중 하나, 당시 pong/termination 로그 필요 |
| client↔edge↔Tunnel↔origin 전송 중단/프록시 세션 정책 | 흩어진 socket 종료, 프로세스 유지·재입장 가능, 1시간 이상 장기 연결 | 가능. per-connection 나이/edge 식별자/양방향 TCP 증거 부족 |
| runner 또는 server event loop·압축/송신 큐 부하 | 85개 snapshot 스트림·zlib 적용; 사건 직전 단일 runner lag는 낮음 | 가능성을 낮추거나 확정할 연속 지표 없음 |
| 토큰 수명 | 기존 연결은 입장 때만 authRefresh; 7건 재입장 성공, refresh는 runner 24시간 주기 | 단순 기존 JWT 만료로 socket을 끊는 코드 근거 없음 |

## 원인 확정에 필요한 최소 추가 자료

운영은 계속 종료 상태로 유지한다. 아래는 이후 승인된 VM 재현/계측 또는 이미 보관된 파일의 추가 제공을 위한 요구이며 운영 수집 실행 요청이 아니다.

1. 원본 runner `starting/ready`·전체 initial join/upgrade와 disconnect 전후 이벤트, status·stderr·runner Node/SDK/ws 버전. 원본 진단 baseline 및 168–187 전체(비밀정보 삭제). 가능한 경우 로그 offset 앞뒤 2분 구간과 파일 rotation/설정, 당시 앱 코드/lockfile/압축 협상 값.
2. socket별 공통 익명 connection ID, room/session, accept/open/drop/close/terminate 시각과 이유·호출 위치, ping 송신·pong 수신/미수신 횟수·마지막 시각, heartbeat timer 실제 경과 시간. 클라이언트와 origin 모두 같은 ID로 대조하고 JWT·auth/query는 저장하지 않는다.
3. 소켓별 `bufferedAmount`, TCP writableLength/bytesRead/bytesWritten, pending deflate/send queue·zlib 처리 지연, 실제 negotiated extensions, 서버/runner `monitorEventLoopDelay` 및 CPU/RSS/GC를 일정 간격과 종료 전 rolling buffer로 기록한다.
4. 경로별 시간·종료 주체: client↔edge와 cloudflared↔origin의 FIN/RST·재전송·idle 흐름, Cloudflare Ray/colo 또는 개인정보 없는 요청 correlation, tunnel connection/stream reset 및 재연결 원인. wall clock offset과 monotonic time을 함께 기록한다. 암호화 내용을 수집하거나 토큰을 출력할 필요는 없다.
5. 복귀 검증은 join 반환, 첫 자기 snapshot, 첫 새 입력 ack 시각을 각각 남긴다. 이전 세션 마지막 seq/ack/pending을 삭제 전 보존해 session 전환에 가려진 미확인 입력·위치/점수 변화와 지갑 정산을 분리 검증한다.
6. VM 최소 비교: 동일 workload·고정 시간에서 직접 WS/별도 VM 프록시 × worker 교체 on/off, 실제 압축 협상 on/off와 heartbeat pong 지연/유실을 통제한다. 장시간 연결 나이와 일정한 packet/drop 조건을 분리한다. VM 프록시는 운영 Cloudflare 경로의 재현이 아니며 짧은 테스트 통과를 장시간 안정성으로 확대하지 않는다.

## 별도 inspector 사고

`separateIncident.pauseAt=2026-10-08T09:07:38.088Z`, 실제 `deployment-paused` 로그는 09:07:38.101이다. 이 pause 시각을 오류 발생의 정확한 밀리초로 취급하지 않는다. 기록된 오류는 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`; 임시 inspector 종료 처리 중 runner가 종료되어 85개 합성 socket이 사라졌다. 앞선 마지막 개별 drop(09:07:00.852)보다 37.236초 뒤 pause, 마지막 재입장(09:07:18.318)보다 19.770초 뒤다. 사용자/운영 게임은 당시 유지됐고 이후 별도 사용자 지시에 따라 정상 종료됐다.


## 검사 전송 구현 차이

기존 `tests/minimal-hotswap.mjs`는 SDK를 정적 import하고 `globalThis.WebSocket`을 바꾸지 않는다. Node24에서는 SDK가 기본 WebSocket을 선택할 수 있다. 이 기존 회귀의 통과만으로 원래 `ws` 압축 workload를 재현했다고 보지 않는다. 원래 `tests/minimal-live-observe.mjs:7–10`은 `ws/wrapper.mjs`를 `globalThis.WebSocket`으로 지정한 뒤 SDK를 동적 import한다. 새 `tests/individual-disconnect-repro.mjs`는 이 순서를 보존하고 실제 `permessage-deflate` 협상 여부를 각 소켓에서 assert한다. 서버와 SDK도 별도 process로 실행해 ws의 process-global zlib limiter를 섞지 않는다.

## 확인한 사실과 근거

1. 최소 서버는 heartbeat를 override하지 않는다. `colyseus/minimal/server.js:114–119`에는 payload/Origin/permessage-deflate 설정만 있다. transport 기본은 3000ms, retries 2다(`colyseus/node_modules/@colyseus/ws-transport/src/WebSocketTransport.ts:105–111`). 전체 `wss.clients`를 하나의 interval에서 순회한다(`:260–275`). 카운터가 2이면 `terminate()`, 아니면 먼저 카운터를 올리고 `ping(noop)`를 부른다. 정상 타이머 조건에서 첫 미응답 ping 이후 약 6초, 마지막 정상 pong/연결의 위상에 따라 약 6–9초 수준의 미응답 기간이 관련된다. 타이머 지연 때문에 엄밀한 wall-clock SLA는 아니다.

2. 카운터 초기화는 pong 이벤트뿐이다(`WebSocketTransport.ts:13,281–282`). 앱 move 수신·snapshot 송신은 reset하지 않는다. 종료 로그는 `debugConnection` 한 줄이며 client ID도 빠져 있다(`:267–269`). debug namespace는 `colyseus:connection`이다(`colyseus/node_modules/@colyseus/core/src/Debug.ts:5–6`). 따라서 일반 로그에 새 오류가 없다는 관찰만으로 watchdog을 배제할 수 없다. 운영 DEBUG 환경은 이 검토에서 확인하지 않았다.

3. ws의 `terminate()`는 close frame을 교환하지 않고 underlying socket을 destroy한다(`colyseus/node_modules/ws/lib/websocket.js:505–516`). ws close code 초기값은 1006이다(`:58–61`). 이 때문에 동일 1006은 heartbeat와 외부 TCP 단절 모두에서 나올 수 있으며, 숫자 자체는 원인 식별자가 아니다.

4. ws `Sender.ping()`은 sender가 DEFLATING 등 비기본 상태일 때 FIFO에 추가된다(`colyseus/node_modules/ws/lib/sender.js:239–280`, 특히 `:276–279`). 압축은 완료 callback까지 DEFLATING이며 이후에만 FIFO를 drain한다(`:503–553`). 송신량 제한/제어 frame 우선순위는 이 경로에 없다. permessage-deflate jobs 역시 모듈 전역 limiter를 공유한다(`colyseus/node_modules/ws/lib/permessage-deflate.js:65–71,307–330`). concurrency 4는 **동시 실행 수**이며 backlog 총량 제한이 아니다(`colyseus/node_modules/ws/lib/limiter.js:17–50`).

5. 최소 서버는 50ms마다 worker tick을 dispatch하고 각 tick result를 snapshot broadcast한다(`colyseus/minimal/server.js:32,36–39`). Room은 메시지를 한 번 encode한 뒤 각 client의 enqueueRaw를 호출한다(`colyseus/node_modules/@colyseus/core/src/Room.ts:2063–2094`). JOINED client는 바로 raw 송신한다(`.../src/Transport.ts:435–454`), transport raw는 `ref.send(data, {binary:true}, cb)`뿐이다(`colyseus/node_modules/@colyseus/ws-transport/src/WebSocketClient.ts:8,50–56`). 이 앱 경로에는 bufferedAmount 한도, 오래된 snapshot 건너뛰기, send callback 지연 관측이 없다. 85명·20Hz에서는 약 1700개의 client별 snapshot 송신/초가 된다. 실제 압축 시간/바이트/큐 길이는 이 계산으로 알 수 없다.

6. 수신 측도 압축 해제 중 다음 frame parsing을 멈춘다(`colyseus/node_modules/ws/lib/receiver.js:192–194,517–519,542–567`). Node ws의 자동 pong은 ping frame이 parsing된 뒤 실행된다(`.../websocket.js:1262–1266`), 기본 autoPong은 true다(`:681–690`). 따라서 동일 Node runner 내 85개 연결의 수신/압축 해제 부하도 계측 대상이다. 이 메커니즘은 runner가 실제로 과부하였다는 증거는 아니다.

7. 서버의 `maxPayload:8192`는 서버 수신 메시지의 한도다. 서버가 보내는 85명 snapshot이 8192byte를 넘는 것 자체를 막는 설정은 아니다. Node ws client 기본 수신 한도는 100MiB다(`.../websocket.js:688`); payload 초과 경로는 1009를 생성한다(`.../receiver.js:548–556`).

8. 메시지 rate limit는 120이다(`colyseus/minimal/server.js:22`). core 초과 경로는 `CloseCode.WITH_ERROR`로 close한다(`colyseus/node_modules/@colyseus/core/src/Room.ts:2284–2291,2339–2352`), 값은 4002다(`colyseus/node_modules/@colyseus/shared-types/src/Protocol.ts:281`). 직접 rate-limit 종료는 raw 1006보다 4002와 맞는다. 다만 close frame 전달 자체가 실패한 복합 장애까지 배제하지 않는다. ack gap 12–17이라는 사건 요약은 단순히 수백 move가 한꺼번에 쌓였다는 가설의 근거가 아니다.

9. worker 교체는 socket을 넘기거나 닫지 않는다. 후보가 catch-up하고 tick 경계에서 active만 교체한 뒤 이전 **worker thread**를 terminate한다(`colyseus/minimal/worker-host.js:107–120,47`). worker 실패/1500ms 무응답은 active thread 복구를 시도하며 연속 실패 시 fatal/health503를 만든다(`:10,32,64,127–148`; `colyseus/minimal/server.js:97–110`). 이것은 raw WebSocket terminate와 다른 API/객체다. 정상 교체가 곧바로 1006을 내는 직접 경로는 발견하지 못했다. 호스트 CPU·메모리·I/O 경쟁에 의한 간접 영향은 별도 가설이다.

10. 사건 도구의 snapshotAgeMs는 `Date.now() - 마지막 수신시각`이다(`tests/minimal-live-observe.mjs:53,75–78`). 서버 생산 시각 또는 pong 시각이 아니다. 최근 snapshot 수신(440–640ms)만으로 heartbeat 이상을 배제할 수 없다. 다만 ack gap/runner 이동률/마지막 정상 pong까지 함께 봐야 다초 지연과의 정합성을 판단할 수 있다. 1006 직후 SDK `onLeave(4003)`는 retry 0이면 클라이언트에서 만들어질 수 있다(`node_modules/@colyseus/sdk/src/Room.ts:166–176,772–778`; runner retry 0 `tests/minimal-live-observe.mjs:64`).

11. **기존 게임의 connection 계측은 minimal에 없다.** 기존 `colyseus/town.js:17–22`는 drop/reconnect/lost 1시간 집계와 서비스 로그를 만들고 `:185–199`의 lifecycle에서 기록한다. 기존 `/health`는 `connections:connectionSummary()`를 노출한다(`colyseus/server.js:33`). 반면 minimal은 `onDrop(client)`/`onLeave(client)`에서 code 인자를 받거나 기록하지 않으며 reconnection pending Map과 worker leave만 처리한다(`colyseus/minimal/server.js:60–67`). minimal health에는 players/persistence/worker만 있고 connections 항목이 없다(`:97–110`). 따라서 기존 게임의 계측·회귀 시험 통과를 minimal의 서버 측 개별 disconnect 관측으로 해석할 수 없다. 또한 최소 onDrop의 held 세션은 최대 15초 유지되어 health의 game.players 수가 실제 open socket 수와 일시적으로 다를 수 있다(`:60–63,97`).


## 실제 loopback 장애 주입 대조 (원래 Node24.11.1)

`../results/repro-faults-node24.11.1.json`은 각각 독립 서버/3개 SDK 연결로 실제 PB·WebSocket·압축을 사용한 **의도적 장애 주입** 결과다. 원래 7건의 자동 재현이 아니다.

| 주입 | 대상 raw close | 종료 직전 snapshot 나이 | origin 판별 기록 | 복구 |
|---|---|---:|---|---|
| 대상 1개의 자동 pong만 억제 | 1006, 빈 reason | 37.20ms | terminate 1회, pingCount 2, ping 2/pong 0, 마지막 move 13ms 전, buffer 0 | 같은 room/새 session, 첫 snapshot 34.27ms, 첫 입력 ack 84.71ms |
| 대상 1개의 로컬 proxy TCP 절단 | 1006, 빈 reason | 13.94ms | terminate 호출 0회 | 같은 room/새 session, 첫 snapshot 61.07ms, 첫 입력 ack 112.03ms |

다른 2개 연결은 유지됐다. SDK는 raw1006에 대해 drop1006 후 leave4003을 만들 수 있다. 4003을 별도 서버 장애로 중복 계산하지 않는다. fresh join은 서버의 held-session replacement를 확인한 것이며 원래 runner의 16초 대기 스케줄과 같지 않다. 복구 지연 표는 새 입장 시도 기준이며 장애로부터 전체 복구 시간이 아니다.

**서로 다른 원인이 같은1006/빈reason을 만들고, heartbeat도 최근snapshot·move와 함께 발생할 수 있음을 확인했다.** 원래 사건을 분류하려면 적어도 origin의 terminate 이유/마지막 ping·pong 기록이 필요하다. 해당 원본 자료가 없으므로 timeout·압축·worker 코드를 추정만으로 수정하지 않았다.

## 실제 85명 direct/proxy × worker 교체 비교

Node24.19.0, 85개 새 SDK 계정, 20Hz 이동, 5개 별 추적·80개 결정적 순찰, 조건별90초로 실행했다. 원래80개 무작위 이동과 완전히 같은 workload는 아니다. 모든 socket이 실제 `permessage-deflate`를 협상했다. 각 조건은 새 게임 프로세스/연결로 시작한다. 교체 on 조건은90초 안에4회로 가속했고 원래3분 주기와 다르다.

| 조건 | 활동 ms | 입력 | 교체 | 고유 drop | snapshot 최대 ms | ack 최대 ms | 결과 |
|---|---:|---:|---:|---:|---:|---:|---|
| direct-no-swaps | 90060 | 152,830 | 0 | 0 | 79.75 | 90.94 | PASS |
| direct-swaps | 90039 | 152,745 | 4 | 0 | 85.71 | 94.57 | PASS |
| proxy-no-swaps | 90072 | 152,723 | 0 | 0 | 87.34 | 97.32 | PASS |
| proxy-swaps | 90088 | 152,830 | 4 | 0 | 92.91 | 103.01 | PASS |

네 조건에서 예상 밖fix/연속성 오류/열린 연결의 마지막 미확인 입력은 모두0이었다. 총611,128개 입력·8회 교체다. 서버/클라이언트 event-loop 최대는각 조건별17.22–28.85ms /20.63–34.21ms였으며 서버 지표에는 join/종료 구간도 포함한다. 100ms 간격으로 표본화한 client bufferedAmount/server writableLength 최대는0이었다. 서버 bufferedAmount 최대는6,758/6,763/12,590/13,098 bytes였고 client pending 입력 최대는2였다. 표본 사이 순간적인 큐 증가를 배제하지 않는다. 자세한 지표는 `../results/repro-matrix.json`이다.

프록시는 같은VM의 TCP pass-through이며 TLS, Cloudflare edge/Tunnel, 인터넷 경로, packet loss, 긴 연결 TTL을 모사하지 않는다. 각90초 결과로 한 시간 뒤의 7건을 재현·배제했다고 볼 수 없다. 정상90초×4조건에서 자연발생1006은 없었다. 뒤따르는 의도적 fault control의1006은 정상기준선의drop에 합치지 않는다.

실행명령은 `../results/repro-commands.txt`에 보존했다. 기본 명령은 `MINIMAL_PB_BINARY=../tools/pocketbase/pocketbase node tests/individual-disconnect-repro.mjs`이고, 원래 Node 버전의별도fault모드는 해당 명령파일의 `REPRO_MODE=faults`를 따른다.

## 수정 판단과 다음 단계

제품 수정은 하지 않았다. 증거로 확인된 것은 (a) 개별1006 7건, (b) 복구 runner의16초 대기, (c) heartbeat·압축FIFO의 가능한 종료 경로, (d) 서로 다른 주입 원인이 같은1006을 만드는 현상이다. 이 가운데 (c)/(d)가 원래 사건의 원인이라는 연결 고리는 없다. 추측으로 ping timeout을 늘리거나 압축을 끄면 원인을 가리고 장애 감지를 늦추거나 전송량을 늘릴 수 있으므로 수정안으로 채택하지 않았다.

가장 작은 다음 조치는 운영 재개가 아니라 **이미 보관된 전체 진단/runner 원본의 누락 구간 확보**다. 그 자료에서도 원인을 못 나누면, 별도 승인된 재현에서 익명 소켓별 termination reason·ping write/pong timestamp·송수신 큐와 event-loop를 동시에 수집한다. 필요할 때 그때의 정확한 socket 나이/부하/경로를 보존한 장시간 비교를 수행한다. 운영 서버를 켜거나 로그 수집·재배포할 권한을 이번 보고서로 추론하지 않는다.

새 파일은 이 보고서와 `tests/individual-disconnect-repro.mjs`이며, 앱/lockfile은 원본 그대로다. 별도 메커니즘 재현은 checkout 바깥 `../tools/heartbeat-queue-repro.mjs`에 있다. VM 상태·증거는 보존하며, 시험이 만든 서버·PB·프록시만 종료한다. 계정 암호/토큰/DB/관리자 파일은 전달용 묶음에서 제외한다.

## 최종 확인과 전달물

- Node24.19.0의 실제 fault control도 각각 PASS: pong 억제/TCP 절단으로 대상1명1006, 다른 연결 유지. 이때 snapshot 나이는18.82/14.42ms였다. 원래 버전과 동일한 종료코드 비특이성을 확인했다.
- `repro-matrix.json`과 `repro-faults-node24.11.1.json` 모두 `passed:true`, `ownedProcessesStopped:true`. 각 실행 exit0을 확인했다. fresh VM DB와 로그는 보존했다.
- 최종 하네스에는 초기 실행 이후 입장/인증 timeout과 복구 검증을 보강했다. 24.19.0 실행의 복구는 fresh join까지만 확인했고 첫 snapshot/ack 수치는24.11.1 별도 실행만 따른다. 마지막 timeout 보강 뒤 전체4조건을 다시 실행하지는 않았으며, 제품코드는 변경하지 않았다.
- 최종 하네스/모의재현 `node --check` PASS, 기존 추적 파일 `git diff` 변화0, 공백 검사 PASS. untracked 새 보고서/하네스의 공백도 별도 검사했다. UI/실제 브라우저/Cloudflare/Node22/1시간 이상 soak는 이번 작업에서 실행하지 않았다.
- 전달 묶음은 `../deliverables/pixeltown-disconnect-analysis.zip`, 새 파일 전체 patch는 `../deliverables/local-analysis.patch`다. 원본 첨부, 읽을 수 있는 보고서, 재실행 하네스, 주요 JSON/명령/로그와 SHA-256 manifest를 포함한다. 실제 실행기·의존성·DB·관리자/계정 자격증명은 제외한다.
