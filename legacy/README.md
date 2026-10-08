# 기존 게임 보존 구역

기존 게임의 소스는 참조 경로와 운영 배포를 보존하기 위해 원래 위치에 유지한다. 최소 게임은 별도 소스·데이터·포트·브라우저 인증 저장소로 실행한다. 이 디렉터리는 보존 안내와 원본 파일 해시를 관리한다.

| 구분 | 기존 게임 | 최소 게임 |
|---|---|---|
| 프런트 | `game/src/` | `minimal/game/` |
| 게임 서버 | `colyseus/*.js` | `colyseus/minimal/` |
| PB hooks | `pocketbase/pb_hooks/` | `pocketbase/minimal/pb_hooks/` |
| 맵·규칙 | `shared/` | `minimal/shared/` |
| DB | `pocketbase/.local/pb_data/` | `.local/minimal/pb_data/` |
| 정산 대기열 | `colyseus/.local/outbox/` | `.local/minimal/outbox/` |
| 관리자 | `pocketbase/.env.local` | `.local/minimal/admin.json` |
| 브라우저 인증 | 기존 `pixeltown.guest` 및 PB 기본 인증 | `pixeltown.minimal.*` |
| 실행 | `npm run dev:legacy` | `npm run dev:all` |
| 웹 / PB / 게임 포트 | 5173 / 18090 / 12567 | 5270 / 18120 / 12620 |
| 빌드 | `npm run build:legacy` → `dist/` | `npm run build` → `dist-minimal/` |

기존 계정·별·구매·외형·가구 배치는 삭제하거나 최소 DB로 자동 이전하지 않았다. 최소 게임은 별도 계정을 만들며 기존 지갑이 표시되지 않는 것이 의도된 격리다. 같은 머신의 동일 PocketBase 바이너리를 읽어 실행하지만 DB·hooks·관리자·마이그레이션·public 폴더는 별개다.

`source-manifest.json`은 `45fcdd5`의 기존 소스 40개가 변경되지 않았는지 확인하는 SHA-256 목록이다. 비밀정보·DB 사본은 포함하지 않는다. Git 이력, 기존 파일과 기존 데이터가 복원 근거이며 삭제 가능한 임시 자료를 뜻하지 않는다.

기존 원격 화면 빌드는 `npm run build:legacy:remote`, 개발은 `npm run dev:remote`다. Mac mini용 `scripts/deploy-macmini.sh`도 기존 게임용으로 유지한다. 최소 공개 프런트는 `build:remote`로 따로 빌드하고 백엔드는 미니멀 전용 경로를 사용한다. 기존 서비스·데이터는 유지하며 최신 게시 상태는 PROJECT_STATUS를 따른다.
