# PocketBase 개발 인스턴스

게임·Colyseus와 같은 부모 아래의 독립 폴더다. `npm run dev:all`이 공식 바이너리를 checksum 검증 후 `.local/pocketbase`에 준비하고 `.local/pb_data`로 실행한다. 관리자는 `.env.local`에 무작위 생성한다. 이 파일과 데이터는 Git에 올리지 않는다.

`pb_hooks/matches.pb.js`는 게임 서버의 superuser만 결과를 트랜잭션으로 저장하도록 한다. 직접 실행할 때에는 `--hooksDir=pocketbase/pb_hooks`가 필요하다. 기본 REST는 `http://127.0.0.1:18090`, Colyseus는 `ws://127.0.0.1:12567`이다. 기존 운영 PocketBase와 분리한다. 설치·환경변수·검증 명령은 부모 README 및 docs/02_TECH_SPEC.md를 따른다.
