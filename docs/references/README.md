# 개발 참고 자료

초기 조사·제작·검증 자료를 용도별로 찾아보기 위한 문서다. 2026-10-08에 기존 `work/`와 브라우저 기록 등을 프로젝트 내부로 재배치했다. 현재 제품·기술·진행 상태는 [문서 안내](../README.md)의 정본을 따른다.

## 자료 지도

| 목적 | 위치 | 현재 프로젝트와의 관계 |
|---|---|---|
| 처음 참고한 화면과 동작 조사 | [원본 조사 자료](local/source-study/) | `original.html`은 당시 내려받은 원본, `original-isolated.html`은 통신을 제거한 관찰용 사본. `browser-records/`에 스크린샷·페이지 스냅샷·콘솔 기록이 있다. 조사 해석과 한계는 [analysis.md](../analysis.md)에 있다. |
| 초기 구현 과정 확인 | [제작 스크립트](local/prototype-scripts/) | `write-backend.py`, `enhance-backend.py`는 초기 코드를 생성·수정했던 일회성 스크립트다. 현재 구현은 루트의 `colyseus/`, `pocketbase/`, `scripts/`를 따른다. |
| 과거 화면 검증 방식 참고 | [UI 검증 스크립트](local/ui-checks/) | `ui-check.js`, `ui-peer-check.js`, `ui-game-final.js`, `ui-final-capture.js`, `ui-final-shot.js`. 현재 검증 코드는 루트의 `tests/`를 따른다. |
| 문서 양식 재사용 | [문서 템플릿](templates/README.md) | 초기 첨부 Lite 문서 팩. 명세·현황의 빈 양식과 계획·ADR 템플릿을 포함한다. 실제 프로젝트 진행 상태가 아니다. |
| 과거 통합 테스트 데이터 조사 | [테스트 실행 자료](local/test-runs/) | `run-bFFIID`, `run-WWWMcj`의 SQLite DB·환경 파일·outbox. 현재 개발 DB는 `pocketbase/.local/pb_data`다. |
| 당시 도구 설정 확인 | [도구 설정](local/tooling/) | `browser-config.json`은 당시 Chromium 설치 경로, `pb-release.json`은 당시 PocketBase 릴리스 조회 응답이다. 현재 설치 설정은 루트 README·lockfile을 따른다. |
| 자료 이동 및 보존 근거 확인 | [보존 기록](local/provenance/) | `docs-preservation.json`은 초기 문서 해시, `relocation-manifest.json`은 첫 폴더 이동 기록, `reference-relocation.json`은 이번 재배치 시점의 파일 해시다. `previous-archive-README.md`는 이전 배치 설명이다. |
| 기존 바깥 폴더 흔적 확인 | [작업 폴더 메타데이터](local/workspace-metadata/) | 빈 lockfile과 Finder 메타데이터. 개발에 사용하지 않는다. |
| 배포 문서 윤문 원문·수정 목록·렌더 증거 | [문서 편집 기록](local/document-editing/) | 기존 `_workspace/2026-10-08-001`–`003`의 전체 자료. 최종 문구는 이미 현재 문서에 반영돼 있다. |
| 정원 100명 확장 당시 게임·배포·통합 검사 | [게임 변경 기록](local/game-history/capacity-100/) | 기준본·배포 스크립트·결과·PB 바이너리. `repo-2026-10-07.tar.gz`에는 과거 체크아웃 전체(`.git`·환경 파일·의존성·테스트 DB)를 보존했다. 정원 변경은 main에 이미 반영돼 있다. |
| 합성 유저 30·60명 도구와 검증 결과 | [합성 유저 기록](local/load-tests/synthetic-users/), [화면 증거](local/load-tests/playwright/) | 과거 일반 게임의 `town`·`move` 계약과 Mac mini 설치 경로를 전제로 한 도구다. 현재 최소 게임용 검사는 `tests/minimal-*`를 따른다. |
| 초기 Colyseus 인증·Monitor 구현 | [서버 프로토타입](local/prototypes/colyseus/) | 과거 인증·상태 조회·접속 검증 코드. 현재 서버 코드는 루트 `colyseus/`를 따른다. |
| 과거 서버 라우팅 설정 화면 | [서버 설정 증거](local/server-setup/) | Cloudflare 설정 당시 캡처이며 현재 운영 상태의 검증 근거가 아니다. |
| zrok 프록시·터널 비교 실험 | [터널 실험](local/tunnel-experiments/zrok-test/) | 프록시·검증 코드·설치 안내·측정 결과·당시 의존성을 보존했다. 현재 운영 설정에 적용하지 않았다. |
| 초기 설계와 서버 비용 발표 | [발표 자료 안내](../presentations/README.md) | 독립 HTML을 Git으로 관리한다. 발표 당시 수치와 요금을 현재 값으로 해석하지 않는다. |
| 2026-10-24 자료 이동의 해시·권한·경로 대응 | [정리 보존 기록](local/provenance/workspace-cleanup-2026-10-24/relocation.json) | 이동 전 파일 목록·SHA-256과 압축 검증 결과, Test2 호환 링크 변경을 기록했다. 가져오기 당시 안내 원문은 [별도 보존](local/provenance/test2-import-2026-10-24/README.original.md)했다. |

## 참고 순서와 재사용 방법

1. 디자인 의도를 확인할 때는 [원본 분석](../analysis.md)과 [제품 명세](../01_PRODUCT_SPEC.md)를 먼저 읽고 필요한 관찰 자료를 연다. 원본 HTML은 외부 통신 코드가 포함된 과거 사본이므로 소스 열람에 사용한다.
2. 과거 검증 스크립트는 당시 UI 문구·포트·`outputs/pixeltown` 경로를 전제로 한다. 필요한 동작만 현재 `tests/`에 옮기고 현재 UI에 맞춰 검증한다. 이 파일 자체가 최신 동작을 검증한다는 뜻은 아니다.
3. 초기 제작 스크립트는 파일을 덮어쓰며 옛 `backend/` 구조를 생성한다. 현재 프로젝트에서 그대로 실행하지 않는다. 구현 경위를 읽는 자료로 사용한다.
4. 문서 작성에는 [계획 양식](templates/plans/PLAN_TEMPLATE.md)과 [ADR 양식](templates/decisions/ADR_TEMPLATE.md)을 참고한다. 새 문서는 현재 `docs/plans/` 또는 `docs/decisions/`에 작성한다. `AGENTS.template.md`는 당시 AI 진입점의 예시이며, 적용 지시는 루트 [AGENTS.md](../../AGENTS.md)에서 확인한다.
5. 과거 DB는 별도 복사본으로 조사한다. 현재 실행 데이터에 덮어쓰지 않으며, 과거 테스트 결과를 현재 버전의 통과 근거로 사용하지 않는다.

## 로컬 자료와 공유 문서

이 안내와 `templates/`는 Git으로 관리할 수 있다. `local/`에는 원본 HTML·스크린샷, 환경 파일·테스트 DB, 개인 설치 경로가 있는 자료를 두고 `.gitignore`로 제외했다. 원본 스크린샷을 공개 저장소에 올리지 않는 기존 [조사 기록](../analysis.md)의 방침도 유지한다.

`local/` 링크는 자료가 있는 현재 컴퓨터에서 열 수 있다. 새로 clone한 저장소에는 이 파일들이 없으므로, 필요할 때 별도 전달받아 같은 위치에 둔다. 로컬 파일을 보존하려면 프로젝트 폴더 백업에 포함해야 하며 Git push만으로는 백업되지 않는다. 게임 빌드에는 이 참고 자료를 포함하지 않는다.

2026-10-24 정리에서 `_workspace/` 자료를 위 용도별 위치로 옮겼다. 과거 체크아웃은 압축본의 모든 파일 해시·권한·심볼릭 링크를 대조한 뒤 제거했다. 압축본은 비공개 환경 파일과 테스트 DB를 포함하므로 `local/` 안에 보관하며, 복원이 필요하면 별도 임시 폴더에 풀어 조사한다. Test2의 기존 자료 링크 14개는 새 위치를 가리키도록 갱신했다.
