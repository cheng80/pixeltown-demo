# 전체 프런트 OTA 운영 적용·실제 접속 검증

2026-10-11 (Asia/Seoul). 사용자 승인으로 main commit·push, 운영 게임 서버 알림 도입, Pages 게시·활성화와 공개 브라우저 검증을 완료했다. [사이트](https://pixeltown.fastmake.net), [로컬 검증](2026-10-11-frontend-ota.md), [PLAN-008](../plans/PLAN-008.md).

## 결과

- 구현 commit `4d6ce49`, 운영에서 발견한 HTML 리다이렉트 수정·공개 검사 commit `07abda9`를 main에 push했다. 두 Git Pages 빌드가 성공했다. 영구 `index.html`·`unavailable.html`은 사이트에 유지하고 UI release에서는 제외한다. Pages가 HTML 파일을 308 정규 URL로 보내 공개 SHA 도구가 활성화를 거절했던 문제다. 검증을 느슨하게 바꾸지 않았다.
- 운영은 공개 current·불변 manifest·현재 release 파일 5개 SHA를 확인한 뒤 SSH의 loopback 전용 활성화를 사용한다. 토큰은 운영 호스트에서 생성·0600 파일과 private env에만 보관한다. 공개 API에서 관리자 활성화는 403이다.
- 최종 UI revision `52c726b52633e5cccc5669ded4493d53ba351f38e3695e94bb76d98e573c44ab`, compatibility `3877e3eb20ae64a1f09725465f849d19274685bb2f47e5306eb1040751970657`, frontend generation 3. 원래 문구·색상으로 복원했다. 시험 전용 두 번째 화면은 활성화하지 않았다.

## 운영 적용 순서

1. 적용 직전 players 0·정산 pending/failed 0/0, 운영 서버 원본과 Git 기준 서버 SHA 일치를 확인했다. 원본 소스·환경은 운영 private backup에 보존했다.
2. 최초 알림 도입을 위해 미니멀 게임 host만 한 번 재시작했다(PID 93884→56510). PocketBase 87530, 기존 PB 92143·게임 63906은 유지됐다. 이후 UI 교체에서는 서버를 재시작하지 않았다.
3. Git 자동 게시 뒤 수정된 A release를 검증·활성화했다(generation 1, 타깃 0). 실제 브라우저 2개로 입장했다.
4. 원본을 건드리지 않은 격리 빌드 B `5c7a4c722d5bc577d6cb8aeb59cb3cf6b70e7885e70a364ad1d93494df9d84aa`를 공개 게시했다. 문구 `작은 광장`→`새 작은 광장`, `.titlebar` 배경 `rgb(255, 250, 252)`→`rgb(222, 240, 255)`를 바꿨다. 같은 compatibility, 자체 React/ReactDOM·전체 UI entry의 새 release다. 공개 파일 SHA 확인 후 generation 2·알림 대상 2·실패 0으로 활성화했다.
5. A를 복원 게시하고 공개 파일 SHA 확인 후 generation 3·알림 대상 2·실패 0으로 활성화했다. 양쪽 실제 화면·CSS·root 교체와 이동을 검사하고 입력을 drain한 뒤 자체 브라우저를 닫았다. 생성한 게스트 2명의 자격증명은 보고서에 기록하지 않았다.

## 실제 검증

Chromium 140.0.7339.186 두 독립 context, 공개 TLS·Cloudflare/Tunnel·운영 PB/게임 경로. 03:47:12.330–03:49:05.285 KST, 준비를 포함해 112.955초. `tests/minimal-frontend-public-ota.mjs`는 외부 게시/활성화와 분리해 50ms 표본으로 읽기 전용 진단을 관측한다.

| 항목 | 페이지 1 | 페이지 2 |
|---|---|---|
| 최종 입력 seq / ack | 2088 / 2088 | 1973 / 1973 |
| drops / recovered / failures / corrected / fix / pending | 모두 0 | 모두 0 |
| navigation / canvas 수 / 입력 타이머 / 그리기 루프 | 1 / 1 / 1 / 1 | 1 / 1 / 1 / 1 |
| 방·세션·canvas | 그대로 유지 | 그대로 유지 |
| B→A 전체 UI root·CSS·문구 | 2회 교체 확인 | 2회 교체 확인 |
| 소켓 close/error·페이지 오류·덮개·UI 실패/rollback | 모두 0 | 모두 0 |
| 최대 pending / snapshot 나이 / 계측 표본 간격 | 7 / 101ms / 125.7ms | 7 / 110ms / 138.3ms |

단위60/60, 실제 HTTP/SDK 활성화8개·게시/네트워크19/19, 오프라인 UI(1280/390), 최종 A/B 운영 빌드·영구 HTML 보존·현재 파일 SHA 자체 확인, 공개 Postman API5/5·화면5/5가 통과했다. Postman cloud 게시·인증은 하지 않았고 assertion 결과를 로컬에 보관했다.

자료: `.test-work/ota-public-20261011/`(Git Pages·host 이행·A/B 빌드/게시·generation 1/2/3 receipt·계약 검사)와 `.test-work/minimal-frontend-public-ota-KBy2Cq/`(report.json, samples.jsonl, 명령/결과, 화면 캡처). `.local/minimal/frontend-deploy.env`는 이 체크아웃의 비밀값 없는 private 대상 설정이며 Git에 넣지 않는다.

## 남은 한계와 다음 게시

- 기존 구 runtime 탭은 최초 한 번 새로고침해야 이 구조를 받는다. 그 뒤 호환 UI release는 새로고침 없이 교체된다. runtime compatibility 변경은 계속 새로고침이 필요하다.
- Git Pages 자동 빌드는 연결돼 있지만 CI의 SSH 후속 활성화는 자동화하지 않았다. 매번 Git 게시 성공 후 이 체크아웃에서 `node --env-file=.local/minimal/frontend-deploy.env scripts/activate-minimal-frontend.mjs --revision <공개 revision>`으로 확인·활성화한다. 수동 `deploy:minimal:frontend`도 이 대상 env가 필요하다. 자동 활성화 파이프라인 추가는 별도 작업이다.
- 이번 공개 검사는 두 브라우저·합성 키 입력의 짧은 기능 검사다. 실제 모바일·IME·터치와 공개 85명 장시간 안정성은 검사하지 않았다. 과거 공개 정체 2건과 이전 로컬 실패의 최초 원인은 미확정 그대로다. 개발 세션·worktree는 보존한다.
