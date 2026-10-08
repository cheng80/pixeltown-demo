# 접속 복구 계약 — 2026-10-09

사용자 승인: 끊김 후 상태 복구 구현을 진행한다. 정상 worker/PB 배포는 기존 연결을 유지한다. 외부 경로가 소켓을 닫으면 기존 세션의 복구 토큰으로 연결을 다시 만든다. 새 게스트 발급이나 새 방 입장으로 복구를 대신하지 않는다.

## 서버

- Colyseus의 기존 `allowReconnection`을 사용하고 보관 시간을 20초로 둔다. 위치, 진행 점수, 이동 ack/fix, movement budget은 같은 worker 상태에 남는다.
- 복귀는 같은 roomId/sessionId이며 새 접속에 최신 snapshot을 보낸다. PB 인증 호출 없이 기존 복구 토큰을 검증한다. 토큰은 로그·문서에 기록하지 않는다.
- 접속 프로세스가 재시작해 방 자체가 사라지면 복구하지 못한다. 호스트 장애 복원은 이번 범위에 추가하지 않는다.

## Codex `api.js` / `state.js`

`createGameConnection({engine,userId,token,onSnapshot,onGameEnded,onDeployment,onFeatureUnavailable,onFailure,onRecovery})`를 제공한다. 반환값은 `send(movement)`, `dispose()`, `checkStale()`, `status`이다. 입장·재연결·room 이벤트는 이 객체가 맡는다. SDK 자동 재시도는 끄고 이 객체에서 취소 가능한 제한 재시도를 한다.

- `onSnapshot(data)`는 기존 applySnapshot 및 UI 갱신을 실행하고 성공 여부를 boolean으로 반환한다. engine.room은 연결 객체가 관리한다.
- `onDrop`의 1001/1005/1006/4010과 송신 오류, snapshot 8초 무응답이면 복구한다. 1006만으로 배포라고 판단하지 않는다. 방 소멸522·토큰 만료524·인증 실패525/401/403·명시적 퇴장·과다 송신 거절은 바로 onFailure로 전달한다. SDK의 ErrorCode를 사용한다.
- 복구는 시작부터 최대 12초, 최대 10회다. 간격은 200ms부터 최대 1초까지 증가한다. 새 room/session으로 바뀌거나 서버 ack/fix가 되돌아가면 실패한다.
- 연결이 없는 동안 예측은 최대 3초, 미확인 입력 저장 큐는 최대240개다. 공개 재검사에서 확인 응답이 멈춘 열린 소켓의 교정66개를 발견해, 예측은 연결 상태와 관계없이3초 분량(기본60걸음)에서 멈추도록 보완했다. 한도에 도달하면 정상 상태에서도 같은 세션 복구를 시작하고, 끊기기 전·복구 중 입력이 이 한도를 공유한다. 이후 위치를 고정하지만 키·목적지·pending을 임의로 지우지 않는다. 별 획득은 서버 확정만 인정한다.
- 복구 첫 snapshot의 ack 이하 입력은 확인 처리한다. 같은 fix의 남은 입력만 seq 순서대로 최대 80개/초로 재전송한다. 새 입력이 이를 추월하지 않게 한다. fix가 올랐다면 서버 보정을 적용하고 교정된 미확인 입력 수를 기록한다. 이를 무손실 성공으로 세지 않는다.
- `status.phase`는 joining/playing/recovering/failed/closed, 복구 시도·성공·실패 수, 확인·재전송·교정 수를 제공한다. 게스트와 정산 원장 저장소를 변경하지 않는다.

## Claude 화면 연결

main.jsx에서 위 연결 객체를 사용한다. 복구 중에는 playing 화면을 유지하며 바로 장애 덮개를 띄우지 않는다. 제목 줄에 ‘연결을 다시 확인하고 있어요’를 표시한다. engine.connected=false로 예측이 멈추면 광장 위의 pointer-events:none 띠도 표시한다. 이 문구를 배포 진행 표시와 섞지 않는다. 실패 콜백에서만 기존 장애 화면과 수동 입장 버튼을 사용한다. 정상 worker/PB 배포에서는 복구 문구·입력 차단이 나타나면 실패다.

WorldCanvas의 이동 루프는 engine.connected를 그대로 사용한다. 복구 중 send는 연결 객체에 맡긴다. 송신 실패를 화면에서 별도로 종료 처리하지 않는다. 연결 객체는 미확인 입력 상한에 도달하기 전에 예측을 멈춘다.

Codex는 UI 파일을 직접 수정하지 않는다. Claude 소유는 main.jsx, 필요 시 WorldCanvas.jsx, style.css, offline-ui.mjs 및 FRONTEND_HANDOFF_RESULT.md다. 서버·api.js·state.js·visual-update.js는 다른 작업자가 변경하므로 건드리지 않는다.

## 검증

강제 TCP 절단 후 같은 room/session, 위치·진행 점수 보존, 미확인 입력 ack 대조, 중복 입력 무시를 검증한다. 복구 중 서버 fix·방 소멸·시간 초과·수동 종료도 검사한다. 화면은 복구 중 안내 덮개 없음, 실패 시 안내 표시를 확인한다. 장시간 공개 검사는 이 검증을 통과한 뒤 별도로 실행한다.

## 구현 상태와 다음 반영

서버·api.js·state.js·connection.js와 Claude 화면 연결을 구현했다. 실제 로컬 검증은 [보고서](../reviews/2026-10-09-disconnect-recovery.md)를 따른다. 이전 인계의 외부 장애 복구 NEEDS-DECISION은 사용자 ‘진행’ 요청으로 이 계약을 구현하는 것으로 결정됐다. 운영 반영·공개30분·최신띠화면검증은 [공개 재검사](../reviews/2026-10-09-public-recovery-recheck.md)를 따른다. 무손실복구는 통과했고 끊김없는기준은 실패했다.

상태 보관은 게임 접속 프로세스 메모리에 있다. 프로세스나 호스트가 사라진 뒤 이전 위치를 복원하는 기능은 없다. 복구 시간 초과 때 pending을 지우지는 않지만, 사용자가 수동 새 입장을 선택하면 새 세션으로 시작한다. 이때 이전 입력을 처리됐다고 보고하지 않는다. 별·지갑은 기존 서버 정산과 개인 원장 대조를 따른다.
