# 플레이 중 화면 코드와 리소스 교체

사용자 요청: main에 들어온 대각선 방향 수정과 이후 화면·리소스 변경을 새로고침 없이 반영한다. 기존 연결과 게임 상태는 유지한다. 이 문서는 구현 계약이며, 완료 여부와 검증 결과는 PROJECT_STATUS 7절에 기록한다.

## 무엇을 바꾸는가

브라우저의 접속·인증·입력·이동·동기화는 계속 실행한다. 화면을 그리는 함수, 도트 그림, 스타일, 글꼴·이미지는 별도 버전으로 묶는다. 브라우저는 새 버전을 뒤에서 준비하고 다음 화면 프레임에 전환한다. 준비에 실패하면 기존 버전으로 계속 플레이한다.

이번 대상은 월드 렌더러와 그 리소스다. React 화면 구성 전체, 인증, 연결 처리, 이동 규칙, 충돌 지형은 자동 교체 대상이 아니다. 이 부분이 바뀌면 호환성 값이 달라져 열린 탭은 기존 버전을 유지한다. 기능 도입 전에 열린 탭에는 최초 한 번 새로고침이 필요하다. 현재 게임에는 음원이 없고 음원 교체는 구현·검사하지 않았다.

## 공개 파일 계약

`GET /visual/current.json`은 최신 화면 버전을 반환한다. 인증은 필요 없고 `Cache-Control: no-store`로 제공한다. 확인 간격은 15초이며 중복 요청을 하지 않는다. 게임 서버나 PB를 호출하는 경로가 아니다.

```json
{
  "schema": 1,
  "revision": "SHA-256",
  "compatibility": "SHA-256",
  "entry": "/visual/releases/<revision>/assets/visual-<hash>.js",
  "styles": ["/visual/releases/<revision>/assets/style-<hash>.css"],
  "fonts": [
    { "url": "/visual/releases/<revision>/fonts/Galmuri11.woff2", "weight": "400" },
    { "url": "/visual/releases/<revision>/fonts/Galmuri11-Bold.woff2", "weight": "700" }
  ],
  "images": [],
  "files": [
    { "path": "assets/visual-<hash>.js", "sha256": "SHA-256" }
  ]
}
```

모든 URL은 같은 게임 origin의 `/visual/releases/<revision>/` 아래에 둔다. 각 release의 URL과 파일 내용은 변경하지 않는다. 다음 공개 결과물에도 이전 release를 넣는다. 업데이트 도중 필요한 파일이 사라지지 않도록 보존한다. 서버 worker의 세대·이동 `seq/fix`와 화면 `revision`은 별개다.

## 렌더러 연결 지점

새 ES module은 `createRenderer({ canvas, engine, view, fontFamily, resources })`를 공개한다. 반환값은 즉시 실행하는 `draw(now)`와 선택적 `dispose()`다. `resources.images`는 manifest의 이미지 `name`을 키로 둔, decode가 끝난 이미지의 Map이다. import나 준비 과정에서 타이머·입력 이벤트·접속을 만들지 않는다. engine의 연결·내 좌표·입력 번호·보류 입력을 바꾸지 않는다. 타인의 표시용 재생 상태는 실제 화면을 그릴 때만 진행한다.

`WorldCanvas`가 하나의 이동 타이머, 입력 이벤트, requestAnimationFrame을 관리한다. 호출할 renderer만 교체한다. canvas·React App·room을 다시 만들지 않는다. 누른 키, 터치패드, 클릭 목적지, 위치, 점수, 보류 입력, 타인의 재생 상태를 유지한다.

새 module·CSS·이미지·글꼴을 준비한다. 이미지의 decode, 글꼴의 load가 끝날 때까지 기존 화면을 유지한다. 별도 canvas와 복제한 표시 상태로 첫 그리기를 확인하고, 실제 화면의 다음 프레임부터 전환한다. 실패하면 후보를 버리고 기존 화면을 유지한다. 화면 업데이트 실패로 게임 장애 안내를 띄우지 않는다. 호환되지 않는 release는 적용하지 않고 다음 입장 때 반영한다.

전환 후 그리기에서 오류가 나도 직전 렌더러와 스타일로 돌아간다. `visual-update.js`가 준비·전환·복구를 맡고, `VisualStatus.jsx`가 상단에 화면 버전과 적용 상태를 보여 준다. 서버 worker의 배포 표시와 별도로 표시한다. 브라우저마다 15초 확인 주기와 다운로드 시간이 달라 적용 시점도 다르다.

## 소스와 배포 방법

| 파일 | 담당 동작 |
|---|---|
| `engine.js`, `WorldCanvas.jsx` | 게임 상태·이동 타이머·입력·기존 rAF 유지 |
| `visual-release.js`, `art.js` | 새 버전으로 교체할 그림과 애니메이션 |
| `visual-update.js` | 호환성 검사·파일 준비·전환·오류 복구 |
| `scripts/minimal-visual-build.mjs` | 버전별 파일·해시 목록·캐시 헤더 생성 |
| `scripts/build-minimal-frontend.mjs` | 공개된 이전 버전을 내려받아 다음 빌드에도 보존 |
| `scripts/deploy-minimal-frontend.mjs` | 배포 잠금·공개 버전 재확인·Pages 게시 |

프로젝트 루트에서 `npm run build:remote`로 준비하고 `npm run deploy:minimal:frontend`로 게시한다. Cloudflare 로그인과 명시적인 게시 권한이 전제다. 배포 도구는 자체 빌드도 수행한다. 게임 서버에 worker 교체를 요청하지 않는다.

빌드 저장소는 `.local/minimal/frontend-releases/`다. 저장소가 없는 새 CI 환경에서도 `/visual/releases.json`과 각 버전의 `manifest.json`·`files` 목록을 읽고 SHA-256을 대조해 복원한다. 파일이 빠지거나 내용이 다르면 빌드를 거절한다. 같은 버전 경로를 다른 내용으로 덮어쓰지 않는다. `current.json`과 `releases.json`은 no-store, 버전별 파일은 1년 immutable 캐시다. 없는 파일은 404로 응답한다.

배포 도구는 같은 컴퓨터의 중복 게시를 잠금으로 막는다. 빌드 전후 공개 버전이 달라져도 중단한다. 여러 CI 작업이 마지막 확인 직후 동시에 게시하는 경쟁은 실 서비스에서 CI 배포 동시 실행 제한으로 막아야 한다.

## 검증할 내용

- 실제 WebSocket 접속과 이동 중에 그리기 코드와 눈에 보이는 리소스를 변경한다.
- navigation, room/session 변경, onDrop/onLeave/onError, 장애 안내, 예상 밖 fix는 0이어야 한다.
- `seq`와 ack가 계속 증가하며 클릭 목적지·키·터치패드·점수를 초기화하지 않는다.
- 파일 누락, 잘못된 renderer, 비호환 버전에서는 기존 화면을 유지한다.
- 이전 release URL을 다음 결과물에도 보존한다. 공개 manifest의 cache와 참조 파일을 Postman으로 확인한다.

## 확인한 결과

2026-10-08 운영 화면에 반영했다. 공개 두 번 교체의 검증 버전은 `2ca05cdd`, 호환성 값은 `c4294810`, 당시 마지막 Pages 배포는 `baa68ba8.pixeltown-4x2.pages.dev`다. main 게시 전 파일 끝 빈 줄 정리 뒤 현재 공개 버전은 `c72da755`/`bd6f0b65`, production 배포는 `0b3ed384.pixeltown-4x2.pages.dev`다. 동작 코드는 같으며 기존 검증 수치를 새 버전의 재실행 결과로 바꾸지 않는다. 사용자 주소는 그대로다. 실제 공개 브라우저 한 개에서 두 번의 Pages 교체를 관찰했고, 같은 room/session으로 5,175개 입력의 ack를 확인했다. 끊김·입력 차단·예상 밖 fix·준비 실패는 0건이었다. 상세 수치와 로컬 실패 복구 검사는 [PROJECT_STATUS 7절](../03_PROJECT_STATUS.md#7-인수인계)에 있다.

dot이 발견한 걷기 오류도 복구했다. 머지된 `WorldCanvas.jsx`에서는 `engine.movedAt = engine.lastTick`이 주석 안에 들어가 있었다. 별도 실행 줄로 옮겼으며 공개 브라우저에서 팔·다리 그림 3종이 순환하고 정지하면 서 있는 그림만 나오는 것을 확인했다. 좌표만 확인하던 기존 UI 검사에도 실제 캐릭터 그림 검사를 추가했다.

## 운영과 나중의 정리

Pages 결과물만 갱신한다. 화면 업데이트를 위해 PB·Colyseus·Tunnel을 재시작하지 않는다. 사용자 요청으로 서버 worker의 3분 자동 교체와 85명 이동 검사를 종료했고 운영 미니멀 게임 서비스도 종료했다. PB·Tunnel·기존 게임·로컬 개발 서버는 유지했다. 최신 검사 상태는 PROJECT_STATUS와 실행 폴더의 `status.json`을 따른다.

이번 기능은 사용자가 Codex의 직접 화면 수정을 허용해 적용했다. main의 기존 변경과 Claude 세션을 보존했다. 초기 운영 검증은 미커밋 작업에서 직접 게시했다. 이후 사용자 승인으로 commit/push와 [PR #2](https://github.com/cheng80/pixeltown-demo/pull/2)의 main 병합(`08884d6`)을 완료했다. 소스·빌드·게시 도구를 포함한 Git 자동 Pages 빌드의 성공과 공개 버전을 확인했다.

리소스 보관 장소, 공개 방법, 용량과 삭제 기준은 실 서비스로 옮길 때 다시 정한다. 미니멀 단계에서는 이전 release를 자동 삭제하지 않는다. 이미 import한 ES module은 탭이 닫힐 때까지 남을 수 있으므로 장시간 탭의 메모리도 확인한다. 이전 release·검사 계정·백업·원문 자료는 별도 정리 지시 전까지 보존한다.
