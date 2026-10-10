# PLAN-008 S5 프런트 게시·활성화 인계

## 결과

- `scripts/deploy-minimal-frontend.mjs`: 기존 잠금·공개 current CAS·빌드 이력 SHA 검사를 유지하고 Pages 게시 후 공개 `schema:2` current, 불변 manifest, 모든 실제 파일 SHA를 확인한다. 확인 후 `/health`의 `frontend.generation`으로 별도 `/internal/frontend/activate`를 호출한다.
- `scripts/activate-minimal-frontend.mjs --revision <64자리 SHA>`: 수동 Pages 게시 또는 Git 자동 Pages 게시가 끝난 뒤 동일한 공개 파일 확인·활성화 로직을 실행한다. 자동 빌드 성공만으로 활성화 완료를 기록하지 않는다.
- receipt 기본 위치: `.local/minimal/frontend-publication-receipt.json`. `revision`, `publication`, `activation`, `notification`, `notificationTargets`, `notificationFailed`, `generation`을 단계마다 원자 교체로 기록한다. 게시 호출 오류는 원격 반영 여부가 불명이므로 `publication:unknown`이다. 공개 파일·SHA 불일치는 `publication:failed`, 네트워크 오류로 공개 반영을 확인할 수 없으면 `publication:unknown`이며 둘 다 알림 POST를 하지 않는다. 응답 유실은 `activation:unknown`으로 먼저 저장한 뒤 같은 revision으로 한 번만 재시도한다. `202`의 부분/전체 큐 실패는 게시를 다시 하지 않고 같은 revision 활성화만 한 번 더 호출한다. `queued`는 브라우저 적용 증거가 아니다.

## 운영 대상 설정

2026-10-11 사용자 승인으로 운영 host·token·origin과 로컬 대상 env를 설정하고 게시·generation3·브라우저 적용을 확인했다([운영 결과](../reviews/2026-10-11-frontend-ota-production.md)). Git Pages 후속 SSH 활성화는 현재 수동이다. 아래 값은 실행 환경에서 제공하며 비밀 내용은 문서와 로그에 남기지 않는다.

- `MINIMAL_VISUAL_PUBLIC_URL`: 공개 정적 origin. 미지정 시 기존 게임 공개 origin을 사용한다.
- `MINIMAL_FRONTEND_SSH_HOST`: 활성화 대상 SSH 호스트.
- `MINIMAL_FRONTEND_GAME_PORT`: 그 호스트의 loopback 게임 포트.
- `MINIMAL_FRONTEND_NODE_PATH`: 원격 Node 실행 파일 절대 경로.
- `MINIMAL_FRONTEND_TOKEN_FILE`: 원격 전용 관리자 토큰 파일 절대 경로. 서버의 `MINIMAL_FRONTEND_TOKEN`과 일치해야 한다. 값은 원격 Node 프로세스에서만 파일로 읽고 내부 POST header에서만 사용한다.
- `MINIMAL_FRONTEND_SSH_KEY`: 필요할 때만 지정하는 SSH 키 경로.
- `MINIMAL_FRONTEND_RECEIPT`: 필요하면 receipt 로컬 경로.

자동 Pages 게시 파이프라인은 Pages 성공 뒤 `node scripts/activate-minimal-frontend.mjs --revision <게시된 revision>`을 실행하도록 운영에서 별도 연결해야 한다. `--revision`은 빌드 산출물의 `visual/current.json`에서 나온 SHA여야 하며, 실행 시 공개 current와 일치해야 한다. 수동 게시 후에도 같은 명령을 사용한다. 원격 대상 설정이 빠지면 수동 deploy는 Pages 게시 전에 중단한다. 실패 receipt에서 `publication:confirmed`이고 활성화만 실패/불명인 경우 해당 revision으로 활성화 명령만 재실행한다. 공개 current가 다른 revision으로 바뀌면 이전 게시 활성화는 실패하고 덮어쓰지 않는다.

## 로컬 검증

`npm run test:minimal:frontend`: 실제 HTTP/SDK 활성화8개와 게시/네트워크19/19 통과. localhost 정적 origin·활성화 HTTP 모의로 게시 실패, SHA 실패, 활성화502, 202 partial, 응답 유실, stale current, 빈 로비 generation0→1, 같은 revision 멱등 재전송, redirect/schema 오류, 공개 네트워크 확인 불가의 unknown receipt 보존을 확인했다. `npm run test:minimal:unit`: 60/60. 최종 소스의 실제 production UI·브라우저 검사는 [로컬 결과](../reviews/2026-10-11-frontend-ota.md)를 따른다. 운영 SSH·Pages는 검증하지 않았다.
