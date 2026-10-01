# 프로젝트 현황

갱신일: 2026-10-02 (Asia/Seoul). 리비전: 최초 공개 전 작업 트리.

## 1. 로드맵

| 단계 | 마일스톤 | 상태 |
|---|---|---|
| M1 | 원본 읽기 전용 조사·기획·PRD·기술 계약·개발 계획 | 문서 정리 중 |
| M2 | 자체 도트 게임·PocketBase/Colyseus 연동·3개 방 | 구현 완료, UI 보완 검증 중 |
| M3 | 보안·복구·20명 로컬·모바일 검증 | 12개 통합·2개 단위 통과, 최종 회귀 예정 |
| M4 | 공개 GitHub 연결·단계별 한국어 커밋/push·인수인계 | 공개 저장소 생성 완료, 커밋 준비 중 |

최초 요청에 따른 구현이 진행된 뒤 사용자가 Lite 문서 팩과 공개 저장소를 추가 요청했다. 따라서 문서 정리 이전의 구현을 기획 이후에 시작했다고 소급 표현하지 않는다. 이 계획은 현재 구현을 정리하고 남은 검증·배포를 완료하는 기준이다.

## 2. 진행 중인 계획

`plans/PLAN-001.md` — 로컬 멀티플레이 데모 완성과 단계별 게시.

## 3. 현재 작업

- [ ] 첨부 Lite 템플릿에 맞춘 정본 문서 정리·검토
- [ ] 최종 스키마 변경 후 통합 검증 재실행
- [ ] 채팅 오버레이·설정 유지·모바일·가로 화면 검증 증거 정리
- [ ] 문서 / 게임 구현 / 검증 단계 커밋·push

## 4. 완료

- 원본 HTML/공개 클라이언트·설정 화면·무통신 로컬 사본 조사. 외부 브로커 입장·메시지 수집 없음.
- React/Vite + 자체 Canvas 도트 타운, 로비·정원·아케이드, 키보드·터치, 추적 카메라.
- 별도 개발 PocketBase 0.40.4, Colyseus 0.16.26; 토큰 검증, 사용자별 SDK, 이동/수집/점수 서버 판정.
- 결과·보상 트랜잭션 및 unique constraint, 영구 outbox·재시작 재전송.
- 채팅 반투명 배경 20–95%, 접기/펼치기, 미확인 수, 브라우저 설정 유지.
- Git 로컬 `main`, 공개 https://github.com/cheng80/pixeltown-demo 생성.

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

주요 파일은 `src/main.jsx`, `src/world.js`, `backend/town.js`, `backend/outbox.js`, `backend/pb_hooks/matches.pb.js`, `scripts/init-pocketbase.mjs`, `tests/integration.mjs`다. 실제 명령은 루트 README에 있다.

UI에서 `sort:-created` 조회가 400인 문제를 발견했다. 신규 PocketBase collection에 날짜 필드가 없었던 원인으로, seed가 기존/신규 schema의 created/updated autodate를 보완하도록 수정했다. 재seed 후 프로필 조회·기록 패널 오류 0을 확인했다. 이전 실패 증거는 최종 검증의 성공으로 덮어 쓰지 않고 이 원인과 수정을 보존한다.

## 8. 변경된 계약

- 최신 Colyseus 문서의 static JWT 훅을 기본 사용하지 않는다. 설치 0.16의 인스턴스 `onAuth(client, options)`에서 PocketBase 토큰을 검증한다.
- `gameEnded`는 outbox 디스크 저장 완료이며 PB 저장 완료가 아니다. `snapshot.persistence.status`가 saved로 전환될 때 기록을 조회한다.
- 회원가입은 이번 데모에서 제공하지 않는다. 초기 계정과 기존 계정 로그인을 지원하며 일반 사용자의 users 직접 쓰기는 차단한다.
- 채팅은 사용자 요청으로 배경 alpha 설정과 접기/펼치기, 미확인 수를 제공한다. 텍스트 opacity는 1이다.

## 9. 검증 상태

| 항목 | 결과 | 근거 | 날짜 | 리비전 | 유효성 | 출처 / 공백 |
|---|---|---|---|---|---|---|
| 통합 12개 | PASS | RECHECKED | 2026-10-02 | 최초 작업 트리 | CURRENT | `tests/report.json`; 날짜 필드 최종 회귀 예정 |
| 단위 2개 | PASS | RECHECKED | 2026-10-02 | 최초 작업 트리 | CURRENT | `npm --prefix backend test` |
| 빌드 | PASS | RECHECKED | 2026-10-02 | 최초 작업 트리 | CURRENT | `npm run build` |
| UI 1280×720 / 390×844 / 844×390 / 390×430 | PASS | RECHECKED | 2026-10-02 | 최초 작업 트리 | CURRENT | 페이지 scrollWidth/Height=viewport, 오버레이·설정·두 브라우저 채팅, `assets/` |
| 실제 모바일 키보드 | NOT_RUN | NONE | - | - | UNKNOWN | 브라우저 높이 축소 모의만 수행 |
| 인터넷 성능·100명·운영 배포 | NOT_RUN | NONE | - | - | UNKNOWN | 20명은 짧은 동일 머신 검증 |

## 10. 재개 명령

```sh
npm run dev:all
# 서버를 종료하고 자동 검증
npm run test:integration
npm --prefix backend test
npm run build
```
