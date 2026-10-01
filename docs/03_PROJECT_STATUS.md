# 프로젝트 현황

갱신일: 2026-10-02 (Asia/Seoul). 기준 리비전 `dc2e191`(거절판). 재제작 브랜치 `cheng80/cyworld-remake`.

## 1. 로드맵

| 단계 | 마일스톤 | 상태 |
|---|---|---|
| M1 | 원본 읽기 전용 조사·기획·PRD·기술 계약·개발 계획 | 완료 (`5fa022a`) |
| M2 | 1차 도트 게임·PocketBase/Colyseus 연동·3개 방 | 완료했으나 **사용자 거절** (`9bc3d66`) |
| M3 | 1차 보안·복구·20명 로컬·모바일 검증 | 백엔드 증거만 유효. 화면 증거는 거절판 기준 |
| M4 | 공개 GitHub 단계별 게시 | 완료 (`dc2e191`) |
| M5 | 싸이월드 도트 감성 재제작 (PLAN-002) | **진행 중** — 브랜치 `cheng80/cyworld-remake` |

## 2. 계획

- `plans/PLAN-001.md` — DONE. 1차 로컬 멀티플레이 데모. 백엔드 계약은 유지, 화면·맵·충돌은 PLAN-002로 대체.
- `plans/PLAN-002.md` — IN_PROGRESS. 재제작.

## 3. 현재 작업 (PLAN-002)

- [x] S1 원본 재관찰(무통신 stub)·PRODUCT_SPEC 재작성·PLAN-002·ADR-002/003
- [ ] S2 공용 맵·충돌 모듈 `shared/world.js`, 서버 연결, 포트 환경변수화
- [ ] S3 도트 렌더러: 3계층 깊이·자동 외곽선·정수배 스케일·2등신 아바타
- [ ] S4 미니홈피 UI·반응형·채팅·클릭 이동·출입구
- [ ] S5 단위·통합·build·2유저·30초 라운드·4 뷰포트 검증과 스크린샷
- [ ] S6 TECH_SPEC·README·현황 정리와 인계

## 4. 거절과 재제작 사유

2026-10-02 사용자 피드백: "원본의 싸이월드 도트 감성도 다 사라지고 픽셀맵의 구성도 엉망이다. 캐릭터가 움직일 수 있는 부분과 못 움직이는 부분이 제대로 뎁스가 안 잡혀 있다." 원인 분석은 PRODUCT_SPEC 1.2, 설계 결정은 ADR-002/003에 둔다. 1차 판의 "완료" 표기는 기능 동작 기준이었고 디자인 승인 근거가 아니다.

1차 판에서 유지하는 것: PB 사용자별 authRefresh, ID 위조 차단, 서버 점수, `match_id` 멱등, 결과+inventory 원자 저장, 영구 outbox 재시도·재시작 보존, 채팅 투명도·접기·미읽음 요구, 별 상한 규칙.

## 5. 막힘 / 알려진 문제

- `nanoid 2.x` 전이 의존성 관련 audit 3건(2 moderate, 1 high). 실제 서버에서 ID 크기는 상수로 지정한다. Colyseus 0.16/클라이언트 호환성 때문에 무리한 override를 하지 않았다. 공개 인터넷 서비스 전 최신 호환 client/server 업그레이드와 재검증 필요. 개발 전용 loopback 서버에 한정한다.
- 실제 iPhone/Android 가상 키보드·성능, 외부 배포·TLS·지속 운영, 100명은 미검증이다.
- 진행 중 경기는 서버 프로세스 강제 종료 시 복원하지 않는다. 디스크 outbox에 완료 기록된 경기는 재시작 후 저장한다.

## 6. 다음 작업

1. 초기 데모 완료 후 100명 요구가 확정되면 delta snapshot·방 분할·관심 영역과 실제 인터넷 지연을 측정한다.
2. 외부 배포 전 서버/클라이언트 버전 업그레이드와 실기기 키보드 검증을 수행한다.
3. PWA·앱 포장은 웹 핵심 플레이 검증 후 별도 계획으로 다룬다.

## 7. 인수인계

변경하면 안 되는 경계: 운영 PocketBase·Oracle 작업·외부 브로커·클라우드 인증에는 접근하지 않는다. 개발 launcher는 18090/12567/5173을 loopback으로만 사용하고 포트 점유 시 종료한다. `.env.local`, `.local`, DB, 다운로드 바이너리와 node_modules를 공개 저장소에 넣지 않는다.

주요 파일은 `game/src/main.jsx`, `game/src/world.js`, `colyseus/town.js`, `colyseus/outbox.js`, `pocketbase/pb_hooks/matches.pb.js`, `scripts/init-pocketbase.mjs`, `tests/integration.mjs`다. 실제 명령은 루트 README에 있다.

UI에서 `sort:-created` 조회가 400인 문제를 발견했다. 신규 PocketBase collection에 날짜 필드가 없었던 원인으로, seed가 기존/신규 schema의 created/updated autodate를 보완하도록 수정했다. 재seed 후 프로필 조회·기록 패널 오류 0을 확인했다. 이전 실패 증거는 최종 검증의 성공으로 덮어 쓰지 않고 이 원인과 수정을 보존한다.

## 8. 변경된 계약

- 추가 요청에 따라 root/game, root/pocketbase, root/colyseus, root/docs 형제 구조로 재배치했다. 기존 개발 DB·바이너리·관리자 파일은 pocketbase로 보존했으며 outbox는 colyseus에 보존했다.
- 별 생성은 초기5·1500ms마다1개·방별 미회수12개 상한, 회수 후 다음 주기 보충이다. 누적 burst와 별0개 즉시 종료를 하지 않는다. DB는 개인/전체 점수 합계64 상한으로 저장을 검증한다.


- 최신 Colyseus 문서의 static JWT 훅을 기본 사용하지 않는다. 설치 0.16의 인스턴스 `onAuth(client, options)`에서 PocketBase 토큰을 검증한다.
- `gameEnded`는 outbox 디스크 저장 완료이며 PB 저장 완료가 아니다. `snapshot.persistence.status`가 saved로 전환될 때 기록을 조회한다.
- 회원가입은 이번 데모에서 제공하지 않는다. 초기 계정과 기존 계정 로그인을 지원하며 일반 사용자의 users 직접 쓰기는 차단한다.
- 채팅은 사용자 요청으로 배경 alpha 설정과 접기/펼치기, 미확인 수를 제공한다. 텍스트 opacity는 1이다.

## 9. 검증 상태

재제작 증거는 S5에서 이 표를 갱신한다. 아래는 거절판 기록이며 화면 항목은 **STALE**이다.

| 항목 | 결과 | 근거 | 날짜 | 리비전 | 유효성 | 출처 / 공백 |
|---|---|---|---|---|---|---|
| 통합 13개 | PASS | RECHECKED | 2026-10-02 | `9bc3d66` | STALE | 재제작 후 재실행 필요 |
| 단위 6개 | PASS | RECHECKED | 2026-10-02 | `9bc3d66` | STALE | 재제작 후 재실행 필요 |
| UI 4 뷰포트 | PASS | RECHECKED | 2026-10-02 | `9bc3d66` | STALE | 거절된 디자인. 승인 근거 아님 |
| 깊이·충돌·맵 | NOT_RUN | NONE | - | - | UNKNOWN | AC-014/015/016 신규 |
| 실제 모바일 키보드 | NOT_RUN | NONE | - | - | UNKNOWN | 브라우저 높이 축소 모의만 |
| 인터넷 성능·100명·운영 배포 | NOT_RUN | NONE | - | - | UNKNOWN | 범위 밖 |

## 10. 재개 명령

```sh
npm run dev:all
# 서버를 종료하고 자동 검증
npm run test:integration
npm --prefix colyseus test
npm run build
```
