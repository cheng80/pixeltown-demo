# zrok 설정 및 운영 안내 — 픽셀타운 맥미니

작성일: 2026-10-03 (KST)

## 1. 현재 구성

| 항목 | 설정 |
|---|---|
| 설치 서버 | 맥미니, macOS Apple Silicon |
| SSH | `cheng80@100.92.43.82` (Tailscale) |
| 설치 폴더 | `/Users/cheng80/Servers/pixeltown-zrok` |
| zrok 버전 | **v1.1.13** |
| 계정 포털 | https://api-v1.zrok.io/ |
| 예약 이름 | `pixeltowncheng80test` |
| 고정 공개 주소 | https://pixeltowncheng80test.share.zrok.io |
| 게임 상태 주소 | https://pixeltowncheng80test.share.zrok.io/health |
| 게임 WebSocket 주소 | `wss://pixeltowncheng80test.share.zrok.io` |
| 테스트 프록시 | `127.0.0.1:2568` |
| 실제 Colyseus | `127.0.0.1:2567` |
| 실행 방식 | `nohup` 백그라운드 실행, **재부팅 자동 시작 미등록** |

```text
일반 사용자 브라우저
    ↓ HTTPS / WSS
zrok 공개 중계 (예약 주소 + SSL)
    ↓ zrok 클라이언트
맥미니 127.0.0.1:2568 (게임 전용 프록시)
    ↓
맥미니 127.0.0.1:2567 (Colyseus)
    ↓ 인증·저장
맥미니 127.0.0.1:8091 (PocketBase)
```

사용자는 zrok이나 Tailscale을 설치하지 않아도 공개 주소에 접속할 수 있다. Tailscale은 운영자의 SSH 접속용으로 계속 사용한다. 현재 게임 프런트엔드와 Cloudflare 연결은 그대로 유지한다. 이 주소의 루트는 게임 화면을 호스팅하지 않는다.

## 2. 맥미니 접속

맥북 터미널에서 실행:

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10   -i ~/.ssh/stonematch_macmini_ed25519 cheng80@100.92.43.82
```

이하 서버 설정 명령은 **SSH 접속한 맥미니에서 실행**한다. 개인키 내용은 복사하거나 출력하지 않는다.

## 3. 최초 설치 (이미 설치된 서버에서는 생략)

현재 계정은 **v1 포털**을 사용하므로 v1.1.13을 설치했다. zrok v2의 `zrok2 create name` 명령과 혼용하지 않는다. 새 설치 시에는 계정 포털과 클라이언트 버전의 호환성을 먼저 확인한다.

다음 명령은 공식 배포 파일을 받고 SHA256을 검증한 후 압축을 푼다.

```sh
mkdir -p /Users/cheng80/Servers/pixeltown-zrok/bin
cd /Users/cheng80/Servers/pixeltown-zrok
python3 - <<'INSTALL'
from pathlib import Path
from urllib.request import urlretrieve
import hashlib, subprocess
base = 'https://github.com/openziti/zrok/releases/download/v1.1.13/'
name = 'zrok_1.1.13_darwin_arm64.tar.gz'
urlretrieve(base + name, 'zrok.tar.gz')
urlretrieve(base + 'checksums.sha256.txt', 'checksums.sha256.txt')
expected = next(line.split()[0] for line in Path('checksums.sha256.txt').read_text().splitlines() if name in line)
actual = hashlib.sha256(Path('zrok.tar.gz').read_bytes()).hexdigest()
if actual != expected:
    raise SystemExit('SHA256 mismatch: installation stopped')
subprocess.run(['tar', '-xzf', 'zrok.tar.gz', '-C', 'bin'], check=True)
print('SHA256 verified')
INSTALL
bin/zrok version
```

## 4. 계정에 맥미니 등록 (이미 등록되어 있으면 생략)

포털의 **Getting Started Wizard → Step 2**에서 계정 토큰을 확인한다. 토큰은 비밀번호처럼 관리하고 문서·Git·로그에 넣지 않는다. 다음은 토큰이 화면과 셸 명령 기록에 나타나지 않도록 입력받는 예시다. 실행 중 잠시 프로세스 인자로 전달되므로 신뢰할 수 있는 서버에서만 사용한다.

```sh
cd /Users/cheng80/Servers/pixeltown-zrok
python3 - <<'ENABLE'
from getpass import getpass
import subprocess
key = getpass('zrok account token: ')
r = subprocess.run(['bin/zrok', 'enable', key, '--headless', '-d', 'pixeltown-macmini-test'], capture_output=True, text=True)
print((r.stdout + r.stderr).replace(key, '[redacted]'))
raise SystemExit(r.returncode)
ENABLE
bin/zrok status
```

등록 후 포털에 `pixeltown-macmini-test` 환경이 나타난다. zrok이 생성한 사용자 홈의 `~/.zrok` 인증 파일도 외부 공유·Git 등록하지 않는다. 이번 설치 때 사용한 토큰 임시 파일은 삭제 완료했다.

## 5. 게임 전용 프록시

Colyseus에 바로 터널을 붙이지 않고 `proxy.mjs`를 거쳐 게임 경로만 전달한다.

- 허용: `/health`, `/health/pocketbase`, `/matchmake/…`, 방 WebSocket 접속 경로.
- 차단: `/monitor` 및 `/me` 등 그 외 경로.
- Colyseus의 기존 사용자 인증과 Origin 검사는 유지한다.
- 외부에서 관리자 계정을 이용해 이 터널에 로그인하지 않는다.

`/Users/cheng80/Servers/pixeltown-zrok/proxy.mjs`의 실제 내용:

```js
import http from 'node:http';
import net from 'node:net';
const permitted=u=>!u.startsWith('/monitor')&&(u==='/health'||u==='/health/pocketbase'||u.startsWith('/matchmake/')||/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?:\?|$)/.test(u));
const server=http.createServer((req,res)=>{
 if(!permitted(req.url)){res.writeHead(404);return res.end();}
 const upstream=http.request({hostname:'127.0.0.1',port:2567,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
 upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
 if(!permitted(req.url)){socket.end('HTTP/1.1 404 Not Found\r\n\r\n');return;}
 const upstream=net.connect(2567,'127.0.0.1',()=>{
  upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
  if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
 });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
server.listen(2568,'127.0.0.1',()=>console.log('Game-only zrok proxy on 2568; monitor denied'));

```

## 6. 고정 주소 예약 (최초 한 번만)

```sh
cd /Users/cheng80/Servers/pixeltown-zrok
bin/zrok reserve public http://127.0.0.1:2568   --unique-name pixeltowncheng80test --json-output
```

이미 예약했으므로 같은 명령을 다시 실행할 필요가 없다. 원하는 이름은 다른 사용자가 사용하지 않는 경우에만 예약할 수 있다. v1 고유 이름은 소문자 영문·숫자, 4–32자 조건을 따른다.

```text
https:// + 예약 이름 + .share.zrok.io
```

예약 주소는 터널 종료·재실행에도 유지된다. 주소 예약은 서버를 계속 켜주는 기능이 아니므로, 프록시와 터널이 모두 실행 중이어야 접속할 수 있다. 이름을 변경하려면 새 예약을 만들고 클라이언트 주소도 바꾼다. 기존 예약 해제는 더 이상 쓰지 않을 때만 수행한다.

## 7. 시작·점검·중지

### 현재 프로세스 확인

```sh
cd /Users/cheng80/Servers/pixeltown-zrok
ps -p "$(cat proxy.pid)" -o pid=,command=
ps -p "$(cat tunnel.pid)" -o pid=,command=
```

이미 실행 중이면 중복 시작하지 않는다. PID 파일은 재부팅 후 오래된 값일 수 있으므로 명령 내용까지 확인한다.

### 실행되지 않은 경우 시작

```sh
cd /Users/cheng80/Servers/pixeltown-zrok
nohup /Users/cheng80/Servers/pixeltown-colyseus/runtime/bin/node proxy.mjs >proxy.log 2>&1 </dev/null &
echo $! >proxy.pid
nohup bin/zrok share reserved pixeltowncheng80test --headless >tunnel.log 2>&1 </dev/null &
echo $! >tunnel.pid
```

### 상태 확인

```sh
curl -fsS http://127.0.0.1:2567/health
curl -fsS http://127.0.0.1:2568/health
curl -fsS https://pixeltowncheng80test.share.zrok.io/health
curl -sS -o /dev/null -w '%{http_code}\n' https://pixeltowncheng80test.share.zrok.io/monitor/api
tail -n 20 proxy.log
tail -n 20 tunnel.log
```

상태 API는 `ok: true`, 관리자 경로는 **404**가 정상이다. 상태 API 성공만으로 게임 연결 성공을 판단하지 않는다. 실제 PocketBase 사용자 인증 후 Colyseus `town` 방 입장과 메시지 수신까지 확인한다.

### 안전하게 중지

다음은 PID에 해당하는 명령이 이 테스트 프로세스인지 확인한 뒤에만 종료한다. Colyseus·PocketBase·Cloudflare·Oracle 예약은 건드리지 않는다.

```sh
cd /Users/cheng80/Servers/pixeltown-zrok
python3 - <<'STOP'
from pathlib import Path
import os, signal, subprocess
for file, expected in [('tunnel.pid', 'zrok share reserved pixeltowncheng80test'), ('proxy.pid', 'node proxy.mjs')]:
    p = Path(file)
    if not p.exists():
        continue
    pid = int(p.read_text().strip())
    r = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True)
    if r.returncode:
        p.unlink()
        continue
    if expected not in r.stdout:
        raise SystemExit(f'{file}: process mismatch; not stopped')
    os.kill(pid, signal.SIGTERM)
    p.unlink()
    print(f'{file}: stopped')
STOP
```

중지해도 예약 이름은 유지된다. 재부팅 후에는 시작 명령을 다시 실행한다. launchd 자동 시작 설정은 이번 테스트에 포함하지 않았다.

## 8. 프런트엔드에서 테스트 연결 사용

현재 운영 게임은 Cloudflare를 계속 사용한다. 테스트용 로컬 프런트엔드의 환경 파일에서만 다음 공개 주소를 사용한다.

```dotenv
VITE_PB_URL=https://pixeltown-pb.fastmake.net
VITE_GAME_URL=wss://pixeltowncheng80test.share.zrok.io
```

환경 파일을 바꾼 뒤 개발 서버를 재시작하거나 다시 빌드해야 한다. `.env.remote`와 운영 배포 설정을 바꾸면 다른 사용자에게도 반영될 수 있으므로 별도 로컬 테스트 모드에서 사용한다. 관리자 암호·토큰은 `VITE_` 변수에 넣지 않는다.

브라우저 Origin은 게임 서버의 `ALLOWED_ORIGINS`에 정확히 등록된 주소를 사용한다. 기존 로컬 주소 `http://127.0.0.1:5173`, `http://localhost:5173`와 운영 게임 주소는 이미 허용되어 있다. zrok의 `/health` 페이지를 열었다고 게임 화면이나 브라우저 Origin이 자동 구성되지는 않는다.

## 9. 실제 검증 결과와 한계

2026-10-03, 동일 맥북에서 순차 1명 접속, 경로별 8회 채팅·800ms 간격.

| 항목 | Cloudflare | zrok |
|---|---:|---:|
| 채팅 왕복 중앙값 | 280ms | 478ms |
| 최초 방 입장 전체 시간 | 1,563ms | 2,569ms |
| `town/garden` 입장·WebSocket·snapshot 수신 | 성공 | 성공 |

zrok 터널 재시작 후 같은 주소로 HTTP 200 확인. `/monitor/api` 404 확인. 임시 사용자 삭제 완료.

이 수치는 순수 ICMP ping이 아니며 한 기기·한 시점의 소규모 테스트다. 최초 입장은 DNS·TLS·매치메이킹·인증을 포함한다. 사용자 네트워크·VPN·중계 경로에 따라 달라질 수 있다. 아시아 접속 경로, 최대 대역폭, 동접 20명 부하, 장시간 안정성은 검증하지 않았다.

## 10. 무료 제한 및 문제 해결

공개 요금 페이지는 무료 **하루 5GB**를 안내한다. 실제 v1 계정의 적용 한도·첫 접속 안내 페이지 여부는 가입한 계정 포털에서 확인한다. 일일 한도를 월 단위로 이월하는 것으로 계산하지 않는다. 자체 호스팅은 별도의 공개 서버와 회선이 필요하다.

| 증상 | 확인할 내용 |
|---|---|
| 공개 주소 404 | 예약 터널·프록시 실행 상태, 무료 한도, 허용 경로 |
| 502 또는 연결 실패 | 내부 2567·2568 상태, 프록시 로그 |
| 브라우저만 403 | 프런트엔드 Origin 허용 목록 |
| WebSocket 입장 실패 | `wss://`, PocketBase 사용자 토큰·profile, `town`·zone 설정 |
| HTTPS 성공하지만 지연 큼 | 실제 채팅 왕복·VPN·중계 경로 비교 |
| 재부팅 후 접속 불가 | 자동 시작 미등록이므로 수동 시작 |

## 공식 참고

- [v1 시작 안내](https://netfoundry.io/docs/zrok/1.1/getting-started/)
- [v1 예약 주소](https://netfoundry.io/docs/zrok/1.1/concepts/sharing-reserved/)
- [무료 요금·제한](https://zrok.io/pricing/)
- [WebSocket 지원](https://blog.openziti.io/websockets-over-zrok)
- [상태 페이지](https://status.zrok.io/)
