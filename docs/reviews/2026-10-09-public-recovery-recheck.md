# 접속 복구 수정의 공개 재검사

2026-10-09. 운영 접속 서버와 화면을 반영하고 기존 시험 계정으로 공개 경로를 검사했다. 첫30분에서 보정을 발견해 예측 한도를 수정했다. **두 번째30분 기준은 무손실 복구 통과·끊김 없는 기준 실패다. 최신 Claude 띠 화면도 별도 공개 검증 후 게시했다.**

## 첫 기준: 실패

03:35:46~04:05:46 KST, 활동1,800,171ms. SDK85명(전체 맵 이동80·별 추적5)과 실제 Chromium1명. 게임 worker·PB·리소스·화면 교체를 하지 않았다. 준비 단계의 의도적TCP절단1건은 활동 집계에서 제외한다.

| 항목 | 결과 |
|---|---|
| SDK 입력 | 2,803,641개 |
| SDK 복구 시작·완료 | 8·8건, 복구 실패0 |
| 브라우저 | 같은 room/session의 연결 객체 교체1회. drop알림2회는 같은 복구 사건의 중복 알림이며 끊김2건으로 세지 않는다 |
| 보정 | 1건, 미확인 입력66개 교정. 무손실 복구로 인정하지 않는다 |
| 종료 입력 | SDK85명 pending0·최종ack=seq, 브라우저pending0·ack=seq. 위66개를 처리 성공으로 소급하지 않는다 |
| 브라우저 장애 화면·보정·새로고침 | 0·0·0 |
| 서버 계측 | 활동 중 heartbeat-timeout·terminate-requested·rate-limit0. origin이벤트루프최대136.970ms·송신큐최대15,539bytes. 기록 파싱 실패0·계측/로그누락0 |
| 종료 | SDK·자체브라우저 종료, 운영game유지·players0·outbox0/0. 기존100명 개인 지갑·원장 대조 통과 |

자료: `.test-work/recovery-public-20261009/baseline-report.json`, `final-inputs.json`, `origin-summary.json`, `server-sockets.jsonl`, `ledger-final.json`. 실제로 관측한 종료·재연결 흐름이 있으며 최초 소켓 종료 원인은 미확정이다. 서버의4002는 복구 접속이 이전 활성 소켓을 정리하는 경로와 구분한다. SDK의복구8건에는 snapshot정체 후 시작한 복구도 포함하므로 원시외부소켓절단8건으로 동일시하지 않는다.

첫 검사기의 maxLoopLagMs는 입장 준비 시간을 포함했고 일부 최대값의delta도 활동 최대를 뜻하지 않는다. 표에서는 이 값을 사용하지 않았으며 별도 origin계측 값을 썼다. 브라우저drop중복과 구간최대 집계를 두 번째 검사기에 보완했다. 첫 검사 증거와 실행 소스는 그대로 보존했다.

## 발견한 문제와 추가 수정

소켓이 열린 채 확인 응답이 멈추면 기존 checkStale의8초 동안 이동이 쌓이고 복구 후3초 예측이 추가될 수 있었다. 한 접속에서 pending165개로 복구가 시작됐고 이후 서버fix가 올라66개를 교정했다. 서버 속도·충돌 규칙을 완화하지 않았다.

connection.js가 연결 상태와 관계없이 미확인 예측을3초 분량(기본50ms틱의60걸음)에서 멈추게 했다. 끊기기 전과 복구 중 입력이 같은 한도를 공유하고, 정상 상태에서 한도에 닿으면 같은 세션 복구를 시작한다. 키·목적지·pending은 보존하며 ack이후 입력만 재전송한다. 저장 큐240개는 최종 방어 상한으로 유지한다. 복구원인 lastCause/lastCode도 기록해 경로 끊김·예측한도·snapshot정체를 구분한다.

추가 검증: 단위47/47, 실제PB/game/TCP8항목, 오프라인UI 통과. `.test-work/minimal-recovery-jNSwtR/report.json`의 열린소켓 전달정체 검사는 pending최대60·4,105ms복구·재전송60개·seq/ack61·보정0이다. 첫 재현은 HTTP/WS공유 TCP프록시에서 연결 순서로 소켓을 골라 다른참가자를 정체시켰고 기대참가자 복구 시간초과로 실패했다(`minimal-recovery-QRGOKN`). TCP양단포트로 대상WS를 지정해 수정·재검증했으며 실패자료를 삭제하지 않았다.

수정본 화면revision5cecf79d…·compatibilitydde733df…·파일7개SHA 일치를 확인하고 `291c6189.pixeltown-4x2.pages.dev`로 게시했다. 접속 서버는 처음 반영 이후 재시작하지 않았으며 worker0f9aad19/generation1이다. 기존 탭에는 처음 한 번 새입장이 필요하다.

Claude의 비보안 origin 인계를 다시 대조했다. `visual-update.js`는 이미 `getRandomValues`와 최종 시간/난수 대체값을 사용한다. 운영 게시에 사용한 격리 사본과 현재 파일이 같으며, `.test-work/visual-retry-browser-MBgMnc/report.json`은 secureContext=false·randomUUID=undefined 환경의 시작/재시도8/8 통과를 기록한다. 이번 재확인에서 이 파일을 중복 수정하지 않았다.

## 두 번째 기준: 무손실 복구 통과, 끊김 없는 기준 실패

04:11:52~04:41:53 KST, 활동1,800,072ms. 같은85명SDK와 실제Chromium1명·전체맵이동80/별추적5·seed20261008·50ms틱. 준비 단계의 의도적TCP절단1건은 활동 집계에서 제외했다. Node24.11.1·ws8.22.0, 서버Node24.21.0이다.

| 항목 | 결과 |
|---|---|
| SDK 입력 | 2,804,624개 |
| SDK 복구 | 2건 시작·2건 완료·실패0. 모두 열린소켓의 확인응답 정체를 prediction-limit으로 복구 |
| 보정·입력 교정·위치/점수 연속성 오류 | 0·0·0 |
| 종료 입력 | SDK85명 pending0·ack=seq·모든 room/session 동일. 브라우저도pending0·ack=seq |
| 실제 브라우저 | 끊김·연결교체·복구표시·덮개·보정0, navigation1 |
| 별 획득·정산 통지 | 335·850. 통지 수를 새 원장행 수와 동일시하지 않는다 |
| origin 계측 | heartbeat-timeout·terminate-requested·rate-limit0. 이벤트루프최대95.027ms·송신큐최대7,995bytes·파싱실패0·계측/로그누락0 |
| 정산 검증 | 기존100명 개인 지갑/원장 모두 일치. inventory/results2,475/2,475, 고유match_id 확인 |
| 종료 | 04:42:03 KST 자체SDK·브라우저 정리, players0·outbox0/0·game유지. Postman공개계약4/4 |

무손실 복구 `recoveryPassed=true`, 끊김 없는 기준 `uninterrupted=false`, 전체기준 `passed=false`다. 기준 실패 때문에 PB·worker·리소스·화면 코드의 종류별30분 검사는 시작하지 않았다. 서버 worker0f9aad19/generation1은 검사 중 그대로였다. 정체의 최초 원인은 여전히 미확정이다.

04:30:16 KST bot65는 pending60·seq20813/ack20753에서 멈추고3,259ms후 ack=seq·pending0·fix0으로 돌아왔다. 04:39:30 bot75도 pending60·seq30514/ack30454에서 멈추고3,011ms후 같은 상태로 복구됐다. 두 사례 모두 서버가 이미 확인한3개를 제외한57개를 재전송했다. 서버 검증을 완화하지 않고 미확인 입력의 누적을 제한한 결과이며, 첫 검사에서 발견한66개 입력 교정이 이번 검사에서는 재발하지 않았다.

자료는 `.test-work/recovery-public-prediction-20261009/`의 `baseline-report.json`, `final-inputs.json`, `origin-summary.json`, `server-sockets.jsonl`, `ledger-final.json`, `postman-final.json`이다. 이전 시험 계정을 재사용했으며 DB·원장을 초기화하지 않았다. 익명 X-Minimal-Socket-Id만 추가 저장하고 인증·복구토큰 URL은 저장하지 않는다.

검사기 한계: 늦은 socket-closed 로그의 socketId는 당시 현재 room을 참조해 교체 소켓 ID로 표시될 수 있었다. 바인딩/복구시점과 origin자료로 이전163→새184, 이전173→새185를 구분했다. 종료 건수에는 영향이 없으며, 종료 정리의85개 close는 활동 집계2개와 분리했다. 향후 검사기는 이벤트를 낸WS의 ID를 읽게 보완했고 현재 실행 소스·원본 로그·SHA는 그대로 보존했다.

## 최신 Claude 화면 통합과 공개 게시

30분 검사본5cecf79d에는 제목 줄 복구 문구가 있었고, Claude의 최신 예측 정지 띠는 그 뒤 추가됐다. 최신 `main.jsx`/`style.css`로 단위47/47·오프라인UI를 다시 통과했다. 연결 로직·서버 소스는30분 검사와 동일하다. 띠를 포함한 화면 자체의30분 검사를 했다고 확대하지 않는다.

최신 공개revision `a7b45baf5e2a487e9303dc8645d4b4a5b359f9b5726be0654ab616502b0e3809`, compatibility `96a0a3a6aa9b98803ee22fd34e308aacefc7b5fea2e25169475e7bc97dc7c882`, Pages `https://35ade698.pixeltown-4x2.pages.dev`. 게시 도구의파일SHA검증을 통과했다. 새 접속 코드·화면은 처음 한 번 새입장이 필요하다.

공개 Chromium의 의도적오프라인/소켓종료 시험도 통과했다. 제목 줄 문구·예측 정지 띠·pointer-events:none·키/pending보존·같은room/session·ack=seq·보정0·덮개0·새로고침0을 확인했다. `.test-work/recovery-publish-20261009/public-ui-smoke.json`, `public-held.png`, `public-resumed.png`와 단위/UI로그를 보존한다. 짧은 의도적검사를 자연 끊김 없는 장시간 성공으로 세지 않는다.

## 이전 세션과 작업 보존

이전Codex세션01a1193e-3297-7642-9ee9-3e9df58a81b5를 실제프로세스·기록과 대조해 종료하고 해당Orca탭만 닫았다. 대화기록·main·미커밋 작업·다른세션은 보존한다. 이전 세션의 로컬 launcher도 종료돼 오래된 잠금을 확인·보존하고 같은DB로5270/18120/12620을 독립 재기동했다. 검사 소유 프로세스와 운영 서비스 수명은 구분한다. 앞선 기준 검사까지 commit·push는 하지 않았다. 이후 사용자 전달 지시에 따라 복구·화면 수정의 `7fc3f1e`를 main에 commit·push했다. Cloudflare자동빌드도 성공했고 production `https://2831bb8f.pixeltown-4x2.pages.dev`와 공개파일7개SHA일치를 확인했다. 작업트리는 깨끗하며 운영/로컬서버를 유지한다. PR·브랜치 병합·다른 세션 종료는 수행하지 않았다.
