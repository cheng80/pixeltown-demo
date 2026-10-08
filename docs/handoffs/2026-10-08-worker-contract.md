# worker 교체·프런트 연결 계약 (Codex, 2026-10-08)

구현 기준: 접속 계층은 Colyseus room/session/WebSocket과 outbox를 유지하고 게임 로직만 Node worker로 교체한다. wire protocol 1 및 이동 규칙은 유지한다. 기존 5270/18120/12620 서버는 재시작하지 않는다.

- 입력·입퇴장·틱·정산 확인에 서버 내부 단조 순서를 붙인다. 시각·난수 seed는 접속 계층에서 확정하며 worker 재생 시 동일하게 쓴다.
- 상태 schema 1: players, moves(예산·시각), game(퇴장자 점수 포함), starCounter, nextStarAt, pendingMatch, timing. 후보는 체크포인트 이후 이벤트를 순서대로 추격하고 동일 순서의 상태·효과 hash가 일치해야 한다.
- 후보는 외부 저장/통지 권한이 없다. 틱 경계에서 추격 완료·미처리 active 응답 없음 확인 후 세대를 전환한다. 이전 worker 응답은 버린다. 후보 실패/지연/불일치는 기존 worker를 유지한다.
- 정산은 제안 → 접속 계층 디스크 저장 → gameEnded(매치별 한 번) → worker 확인 순서다. 실패 시 pendingMatch를 유지하고 다음 틱에 재시도한다.
- 정상 교체는 room/session, 위치, seq/ack/fix, 점수, 진행 판, 입력을 초기화하지 않는다. snapshot은 50ms 주기다. 초기 검증은 타인 100ms 보간을 사용했고, 현재 프런트는 `6e7134b` 이후 `playback.js`로 서버가 확인한 걸음을 순서대로 재생한다. 상단 배포 알림은 [별도 표시 계약](2026-10-08-deployment-indicator.md)을 따른다. 정상 교체에 재입장·재연결 메시지를 추가하지 않는다.
- Claude 요청: `main.jsx`, `WorldCanvas.jsx` 및 화면은 변경 불필요. 기존 onDrop/onLeave/onError와 8초 무응답 처리는 실제 장애용으로 유지한다. 정상 worker 교체는 해당 콜백을 유발하지 않아야 한다. reconnection.maxRetries=0 유지 가능.
- 최초 구조 도입 및 접속 계층 자체 재시작은 무중단 worker 교체 범위가 아니다. 기존 프로세스가 소유한 소켓을 새 코드로 옮기지 않는다. 초기 로컬 구현 때는 운영 접근/전환이 금지됐고, 이후 사용자가 최소 서버 도입과 검증 진행을 승인했다. 최신 실행·게시 결과는 PROJECT_STATUS를 따른다.

관리 계약: loopback 전용 HTTP 서버의 `POST /internal/worker/swap`는 Origin 요청을 거절하고 별도 `MINIMAL_SWAP_TOKEN` Bearer 인증이 있을 때만 허용한다. 후보 파일은 시작 시 설정한 `MINIMAL_WORKER_ENTRY`(기본 simulation-worker.js)를 새 worker에서 다시 로드한다. 요청 body로 실행 경로를 받지 않는다. health는 교체 가능 여부와 generation/sequence/교체 결과를 노출하며 개인정보·토큰은 기록하지 않는다.

검증 결과는 PROJECT_STATUS와 별도 로컬 보고서에 기록한다. 외형 계약 및 입장 위치 변경은 이번 범위가 아니다.

검증 완료: 100명 실제 로컬 활동에서 43,100 입력·9회 교체, 두 실제 브라우저 6회 교체 모두 연결/입력/보정/장애 화면 이상 없음. [상세 결과](../reviews/2026-10-08-worker-swap-verification.md)를 따른다. 프런트 변경 요청 없음. 당시 5270/18120/12620은 보존했고 새 구조는 별도 검사했다. 이후 실행·장시간 검증·게시 결과는 PROJECT_STATUS를 따른다.
