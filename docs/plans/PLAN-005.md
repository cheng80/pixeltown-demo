# PLAN-005 — 첫 입장 캐릭터 만들기 (닉네임·외형)

- 상태: `DONE` — 구현·로컬·원격 검증 완료(2026-10-02)
- 날짜: 2026-10-02
- 브랜치: `main`
- 관련: PRODUCT_SPEC FR-014, BR-018, AC-021, SCREEN-008. 원본 조사 [analysis](../analysis.md) "시작" 행

## 1. 배경과 결정

원본은 첫 화면에서 닉네임과 피부·머리·옷·색을 고르고 입장한다. 계정 없이 브라우저 `localStorage`의 UUID로 저장하며 서버 검증이 없다. 지금 게임은 이메일 로그인 후 바로 입장했고 닉네임·색은 계정 발급 때 고정, 외형은 사용자 ID 해시였다.

사용자 결정(2026-10-02): **A안.** 관리자 계정 발급(공개 가입 차단)을 유지하고, 첫 입장 때 캐릭터 만들기 화면을 추가한다. 기기 UUID 저장(점수·지갑 위조와 사칭 위험)은 쓰지 않는다. 가입 없는 게스트 계정(B안)은 외부 공개 시점에 따로 계획한다.

## 2. 설계

| 항목 | 내용 |
|---|---|
| 선택지 정본 | `shared/catalog.json` `avatar`: 닉네임 2–12자, 피부 4, 머리 색 8, 머리 모양 4(단발·긴 머리·방울 머리·두건), 옷 색 8. 렌더러·서버·훅이 같은 파일을 읽는다 |
| 저장 | `profiles.avatar` json `{skin,hair,style}`(색인), 기존 `name`·`color`(옷 색). 일반 사용자 직접 쓰기 금지는 그대로 |
| API | `POST /api/pixeltown/profile` `{name,color,avatar}`(`pocketbase/pb_hooks/profile.pb.js`, 검사는 `shop_lib.js` `cleanProfile`). 로그인 필수, 목록 밖 값 400, 다른 사용자와 같은 닉네임 400 |
| 첫 입장 판정 | 로그인 후 프로필을 읽고 `avatar`가 없으면 방에 들어가기 전에 SCREEN-008을 보여 준다. 저장하면 입장한다 |
| 방 표시 | Colyseus `lookOf`가 `skin/hair/style`을 검사해 snapshot `look`에 넣는다. `look` 메시지로 이름·옷 색·외형을 다시 읽는다. 선택하지 않은 사람(연습 모드 등)은 기존처럼 ID 해시 외형 |
| 수정 | 게임 왼쪽 "🎨 캐릭터 꾸미기"에서 같은 화면을 연다 |
| 데모 계정 | 로컬 `demo1/demo2`는 시드가 기본 외형을 넣어 바로 입장한다(개발 편의). 원격 Tester 계정은 외형이 없어 첫 입장 화면을 거친다 |

닉네임 유일성(사용자 지시 후속): `profiles`에 `CREATE UNIQUE INDEX idx_profiles_name ON profiles (name COLLATE NOCASE)`. 동시 저장도 DB가 막는다. 훅은 unique 위반을 400 "이미 쓰는 닉네임이에요. 다른 이름을 지어 주세요."와 `data.name`으로 돌려주고, 화면은 입력칸 아래 안내·빨간 테두리(`aria-invalid`)·포커스로 보여 준다. 기존 DB에 같은 이름이 있으면 시드가 오래된 것을 남기고 뒤의 것에 번호를 붙인 뒤 인덱스를 만든다(로컬 개발 DB: 테스트 계정 '쇼핑왕' 4건, 원격: 0건). 운영진 사칭 단어(`avatar.reserved`: 관리자·운영자·운영팀·픽셀타운·admin·system·moderator·pixeltown, 공백 무시 포함 검사)도 거부한다. 일반 욕설 필터는 없다.

## 3. 단계와 검증

| 단계 | 내용 | 검증 |
|---|---|---|
| S1 | 카탈로그·훅·`cleanProfile`·시드(`avatar` 필드, 데모 기본값) | 단위: 허용/거부 값, `lookOf` 색인 검사 |
| S2 | 서버 `lookOf`·`refreshLook`(이름·색 갱신), 렌더러 `lookFor` | 통합: 미로그인 401, 짧은 이름·마크업·색·피부 400, 저장 200, 중복 닉네임 400, 다른 사용자 snapshot 반영 |
| S3 | UI SCREEN-008(첫 입장·게임 안), 입장 게이트 | 브라우저: 새 계정이 방 입장 전 화면, 짧은 이름 비활성, 저장 후 입장, 상대 화면 반영, 수정 반영, 캡처 |
| S4 | Mac mini 반영(`scripts/deploy-macmini.sh`가 훅 복사·스키마 추가·Colyseus 재시작), 원격 검증 | `tests/remote-ui.mjs`(Tester 2명 첫 입장 화면), `tests/remote-check.mjs` `character_setup_profile` |
| S5 | 문서 | PRODUCT_SPEC·TECH_SPEC·STATUS·verification·SERVER_OPERATIONS |
| S6 | 닉네임 DB 유일성·예약어·중복 안내 UI, 원격 반영(직전 백업 `…/backups/pixeltown-nickname-20261002/data.db`) | 통합: 중복·대소문자 변형 400과 안내 문구, 단위: 예약어, 브라우저: 입력칸 안내 캡처 |

원격 반영 전 백업: `/Users/cheng80/Servers/backups/pixeltown-character-20261002/`(DB SQLite online backup, `pb_hooks`, `app`). 되돌리기: `pb_hooks/profile.pb.js`를 지우고 이전 커밋으로 `scripts/deploy-macmini.sh`. 추가된 `profiles.avatar` 필드는 남겨도 기존 기능에 영향이 없다.
