# PLAN-002 — 싸이월드 도트 감성 재제작 (맵·깊이·충돌·UI)

- 상태: `IN_PROGRESS`
- 날짜: 2026-10-02
- 기준 커밋: `dc2e191` (사용자 거절판)
- 브랜치: `cheng80/cyworld-remake` (별도 브랜치, main 직접 수정·강제 push 없음)
- 관련 요구사항: FR-001–010, BR-001–013, AC-001–016
- 관련 결정: [ADR-001](../decisions/ADR-001.md) 유지, [ADR-002](../decisions/ADR-002.md), [ADR-003](../decisions/ADR-003.md) 신규

## 1. 목표와 범위

거절된 화면을 고치는 수준이 아니라 맵·렌더러·아바타·UI를 새로 만든다. 백엔드 보안·저장 계약(ADR-001)은 그대로 재사용한다. 완료 조건은 PRODUCT_SPEC 8절의 AC 전체를 실제 실행 증거로 확인하는 것이다.

범위 밖: 아바타 꾸미기 저장, 친구·쪽지·방명록, 운영 배포, 100명 측정, PR·merge.

## 2. 현재 상태와 전제

- 원래 체크아웃(`~/Documents/Codex/.../outputs/pixeltown`)의 개발 서버가 5173/18090/12567을 사용 중이다. 소유권을 모르므로 종료하지 않는다. 이 worktree는 Vite 5273, PB 18190, Colyseus 12667을 쓴다. 통합 테스트는 18191/12668을 쓴다.
- 이 worktree는 자체 `npm --prefix colyseus run init`으로 PB 바이너리(checksum 검증)·관리자 파일·개발 DB·demo 계정을 만든다. 원래 체크아웃의 `.env.local`·`pb_data`를 읽거나 복사하지 않는다.
- 원본 사이트 관찰은 MQTT 스크립트 차단 + 무통신 stub 상태로만 했다(PRODUCT_SPEC 1.1).

## 3. 실행 단계

| 단계 | 내용 | 산출물 | 단계 검증 | 커밋 |
|---|---|---|---|---|
| S1 문서 | PRODUCT_SPEC 재작성, STATUS 재제작 상태, PLAN-002, ADR-002/003 | docs | 문서 상호 링크·AC 매핑 | `문서:` |
| S2 공용 모듈·서버 | `shared/world.js` 3개 맵·소품 정의·충돌·이동·경로·별 후보. `colyseus/town.js`·`config.js` 연결, 입구 선택, 50ms 틱. 포트 환경변수화 | shared, colyseus, scripts | 단위: 연결성·시작점·나무 수관 아래 이동·벽/물 차단·모서리 미끄러짐·별 후보·기존 별 상한 | `기능:` |
| S3 렌더러 | 도트 스프라이트·자동 외곽선·3계층·정수배 스케일·2등신 아바타·말풍선 | `game/src/render.js`, `sprites.js` | 브라우저: 소품 앞/뒤 캡처, smoothing 꺼짐 | `기능:` |
| S4 UI | 미니홈피 프레임·폴더 탭·프로필·별 카드·채팅 오버레이·수첩·반응형·클릭 이동·출입구 | `main.jsx`, `style.css` | 4 뷰포트 scroll 0, 채팅 투명도·접기·미읽음, 입력 중 이동 방지 | `기능:` |
| S5 검증 | 단위·통합(별도 포트)·build, 2유저 브라우저 동기화, 30초 기본 라운드·상한·결과/보상, 스크린샷 | docs/verification.md, docs/assets, tests/report.json | AC 표 대조 | `테스트:` |
| S6 정리 | TECH_SPEC·README·STATUS 갱신, 인계 | docs, README | 명세·코드 재대조 | `문서:` |

각 단계 끝에 한국어 커밋 후 `origin cheng80/cyworld-remake`로 push한다. 중간 단계는 최종 결과로 보고하지 않는다.

## 4. 예상 변경 범위

| 영역 | 파일 / 계약 영향 |
|---|---|
| 공용 | `shared/world.js` 신규 — 맵·충돌 정본 |
| 화면 | `game/src/main.jsx`, `render.js`, `sprites.js`, `style.css` 재작성, `world.js` 삭제, `galmuri` 의존성 |
| 서버 | `colyseus/town.js` 이동·별·입구, `config.js` WORLD/ZONES 공용 모듈 사용 |
| 실행 | `scripts/dev.mjs`, `dev-backend.mjs`, `init-pocketbase.mjs`, `vite.config.js` 포트 환경변수(기본값 유지) |
| 테스트 | `colyseus/test/*.test.js` 갱신·추가, `tests/integration.mjs` 공용 경로 찾기·포트 환경변수 |
| DB | 변경 없음 |

## 5. 검증 계획

| AC | 방법 |
|---|---|
| AC-014 깊이·충돌 | 단위: 수관 아래 칸 걷기 가능, 밑동 차단, 지붕 뒤 칸 걷기 가능, 벽 바닥 차단, 물 차단, 모서리 미끄러짐. 브라우저: 실제 키 입력으로 나무 북쪽→가려짐, 남쪽→앞 노출, 건물 뒤 지붕 가림, 오락기 섬 뒤 캡처 |
| AC-015 맵 | 단위: 장소별 BFS로 모든 걷는 칸 연결, 출입구·입구 걷기 가능. 브라우저: 3장소 캡처, 출입구 왕복 |
| AC-016 도트 | 브라우저: 캔버스 크기 = 저해상도×정수, `imageSmoothingEnabled=false`, Galmuri 로드 |
| AC-003/004/005 | 두 브라우저 컨텍스트 demo1/demo2: 같은 방 이동·채팅·말풍선, 방 이동 격리, 클릭 이동, 입력 중 WASD 무시 |
| AC-006/011 | 1280×720, 390×844, 844×390, 390×430 scrollWidth/Height, 투명도 20/95·새로고침 복원·접힘 미읽음 |
| AC-007/008/013 | 통합 테스트(상한·회수·재생성·위조) + 브라우저 기본 30초 라운드 수집·종료·저장 완료·수첩 |
| AC-009/010/012 | 통합 테스트 전체(권한·rollback·outbox 재시작·20명 smoke)와 build |

통과 기록은 날짜·리비전과 함께 PROJECT_STATUS 9절과 verification.md에 남긴다. 실행하지 않은 항목은 NOT_RUN으로 남긴다.

## 6. 위험과 미해결

- 50ms 틱으로 snapshot 크기×빈도가 늘어난다. 20명 smoke 수치를 다시 기록한다.
- 클라이언트 예측이 없어 원격 서버 지연이 크면 조작감이 떨어진다. localhost 범위에서만 판단한다.
- 절차 도트 그래픽의 완성도는 스크린샷으로 사용자 판단을 받는다. 코드 테스트로 대신하지 않는다.
- nanoid 2.x audit 항목은 Colyseus 0.16 호환 때문에 강제 override하지 않는다(PROJECT_STATUS 5절).

## 7. 완료 조건

S1–S6 완료, AC-001–016 증거 기록, 발견 문제 수정·재검증, 단계별 한국어 커밋·push, 사용자 보고(브랜치·실행 URL·변경·검증·제약).
