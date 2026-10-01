import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PocketBase from "pocketbase";
import { Client } from "colyseus.js";
import { WORLD, createTerrain, renderWorld, blocked, soloStar } from "./world";
import "./style.css";
const pb = new PocketBase(
  import.meta.env.VITE_PB_URL || "http://127.0.0.1:18090",
);
pb.autoCancellation(false);
const client = new Client(
  import.meta.env.VITE_GAME_URL || "ws://127.0.0.1:12567",
);
const ZONES = [
  ["lobby", "⌂", "타운 광장"],
  ["garden", "✿", "비밀 정원"],
  ["arcade", "✦", "스타 아케이드"],
];
function App() {
  const [user, setUser] = useState(
      pb.authStore.isValid ? pb.authStore.record : null,
    ),
    [solo, setSolo] = useState(false),
    [email, setEmail] = useState("demo1@pixeltown.local"),
    [password, setPassword] = useState("PixelTown123!"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [zone, setZone] = useState("lobby"),
    [status, setStatus] = useState("connecting"),
    [snap, setSnap] = useState({ players: [], game: {} }),
    [messages, setMessages] = useState([]),
    [chat, setChat] = useState(""),
    [chatOpen, setChatOpen] = useState(false),
    [unread, setUnread] = useState(0),
    [chatOpacity, setChatOpacity] = useState(() => {
      try {
        const value = Number(localStorage.getItem("pixeltown.chatOpacity"));
        return value >= 20 && value <= 95 ? value : 82;
      } catch {
        return 82;
      }
    }),
    [inventoryOpen, setInventoryOpen] = useState(false),
    [records, setRecords] = useState({
      profiles: [],
      inventory: [],
      results: [],
    }),
    [recordError, setRecordError] = useState(""),
    [toast, setToast] = useState(""),
    [now, setNow] = useState(Date.now());
  const canvas = useRef(null),
    room = useRef(null),
    keys = useRef(new Set()),
    touch = useRef({ dx: 0, dy: 0 }),
    state = useRef({ players: [], game: {} }),
    emotes = useRef({}),
    selfId = useRef("solo"),
    chatEnd = useRef(null),
    chatVisible = useRef(false),
    collectTimes = useRef({}),
    soloPos = useRef({ x: 480, y: 400 }),
    generation = useRef(0),
    persistStatus = useRef(null);
  const notify = (text) => setToast(text);
  const append = (m) => {
    if (!chatVisible.current) setUnread((n) => n + 1);
    setMessages((a) => [
      ...a.slice(-99),
      { ...m, id: `${Date.now()}-${Math.random()}` },
    ]);
  };
  useEffect(() => {
    chatVisible.current = chatOpen;
    if (chatOpen) setUnread(0);
  }, [chatOpen]);
  useEffect(() => {
    try {
      localStorage.setItem("pixeltown.chatOpacity", String(chatOpacity));
    } catch {}
  }, [chatOpacity]);
  async function authenticate(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await pb
        .collection("users")
        .authWithPassword(email, password);
      setUser(result.record);
      setSolo(false);
    } catch (e) {
      setError(
        e.message || "로그인에 실패했습니다. 서버 연결을 확인해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadRecords() {
    if (!user || solo) return;
    setRecordError("");
    let failed = [];
    const results = await Promise.all(
      ["profiles", "inventory", "results"].map(async (collection) => {
        try {
          return [
            collection,
            await pb.collection(collection).getFullList({
              filter: pb.filter("user = {:id}", { id: user.id }),
              sort: "-created",
            }),
          ];
        } catch (e) {
          failed.push(collection);
          return [collection, []];
        }
      }),
    );
    setRecords(Object.fromEntries(results));
    if (failed.length)
      setRecordError(`${failed.join(", ")} 정보를 불러오지 못했습니다.`);
  }
  useEffect(() => {
    if (user) loadRecords();
  }, [user]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (chatOpen) chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, chatOpen]);
  useEffect(() => {
    const resize = () =>
      document.documentElement.style.setProperty(
        "--app-height",
        `${window.visualViewport?.height || window.innerHeight}px`,
      );
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    if (!user && !solo) return;
    let cancelled = false;
    const gen = ++generation.current;
    setStatus(solo ? "solo" : "connecting");
    setSnap({ players: [], game: {} });
    state.current = { players: [], game: {} };
    persistStatus.current = null;
    setMessages([]);
    setUnread(0);
    collectTimes.current = {};
    emotes.current = {};
    keys.current.clear();
    touch.current = { dx: 0, dy: 0 };
    if (solo) {
      selfId.current = "solo";
      soloPos.current = { x: 480, y: 400 };
      return;
    }
    client
      .joinOrCreate("town", { token: pb.authStore.token, zone })
      .then((r) => {
        if (cancelled || gen !== generation.current) {
          r.leave();
          return;
        }
        room.current = r;
        selfId.current = user.id;
        setStatus("online");
        r.onMessage("snapshot", (data) => {
          state.current = data;
          setSnap(data);
          const p = data.persistence;
          if (p?.status === "saved" && persistStatus.current === "pending") {
            loadRecords();
            notify("게임 기록과 보상이 저장되었습니다.");
          }
          persistStatus.current = p?.status;
        });
        r.onMessage("chat", (data) =>
          append({
            name: data.name || data.playerName || "이웃",
            text: data.text,
            time: data.time,
          }),
        );
        r.onMessage("emote", (data) => {
          emotes.current[data.id || data.playerId || data.sessionId] = {
            text: data.emoji || data.text || "♥",
            until: Date.now() + 3000,
          };
        });
        r.onMessage("error", (data) =>
          notify(data.message || data.text || "요청을 처리하지 못했습니다."),
        );
        r.onMessage("gameEnded", () => {
          persistStatus.current = "pending";
          notify("별 모으기 완료! 기록을 저장하고 있습니다.");
        });
        r.onLeave(() => {
          if (!cancelled) setStatus("disconnected");
        });
        r.onError((code, message) => {
          if (!cancelled) {
            setStatus("disconnected");
            notify(message || `연결 오류 (${code})`);
          }
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setStatus("disconnected");
          notify(`마을 연결 실패: ${e.message}`);
        }
      });
    return () => {
      cancelled = true;
      generation.current++;
      if (room.current) {
        room.current.leave();
        room.current = null;
      }
    };
  }, [user, solo, zone]);
  useEffect(() => {
    if (!user && !solo) return;
    const down = (e) => {
      if (
        ["INPUT", "TEXTAREA"].includes(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      const k = e.key.toLowerCase();
      if (k === " " && e.target.tagName === "BUTTON") return;
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowleft",
          "arrowdown",
          "arrowright",
          " ",
        ].includes(k)
      ) {
        e.preventDefault();
        keys.current.add(k);
        if (k === " " && !e.repeat) sendEmote();
      }
    };
    const up = (e) => keys.current.delete(e.key.toLowerCase());
    const reset = () => {
      keys.current.clear();
      touch.current = { dx: 0, dy: 0 };
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    const interval = setInterval(() => {
      let dx = touch.current.dx,
        dy = touch.current.dy;
      const k = keys.current;
      if (k.has("a") || k.has("arrowleft")) dx--;
      if (k.has("d") || k.has("arrowright")) dx++;
      if (k.has("w") || k.has("arrowup")) dy--;
      if (k.has("s") || k.has("arrowdown")) dy++;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      if (solo) {
        const nx=Math.max(16,Math.min(944,soloPos.current.x+dx*18));
        if(!blocked(nx,soloPos.current.y))soloPos.current.x=nx;
        const ny=Math.max(16,Math.min(624,soloPos.current.y+dy*18));
        if(!blocked(soloPos.current.x,ny))soloPos.current.y=ny;
        const s = state.current;
        const me = {
          id: "solo",
          name: "나그네",
          ...soloPos.current,
          color: "#d99674",
          moving: length > 0,
        };
        s.players = [me];
        state.current = s;
        if (s.game?.active) {
          s.game.stars = s.game.stars.filter((star) => {
            if (Math.hypot(star.x - me.x, star.y - me.y) < 28) {
              s.game.scores.solo = (s.game.scores.solo || 0) + 1;
              return false;
            }
            return true;
          });
          if(Date.now()>=s.game.nextSpawnAt&&Date.now()<s.game.endsAt){
            if(s.game.stars.length<s.game.maxStars)s.game.stars.push(soloStar(String(s.game.counter++)));
            s.game.nextSpawnAt=Date.now()+1500;
          }
          if (Date.now() > s.game.endsAt) {
            s.game.active = false;
            s.game.stars=[];
            notify("산책 연습 완료!");
          }
          setSnap({ ...s, game: { ...s.game } });
        }
      } else if (room.current) {
        room.current.send("input", { dx, dy });
        const s = state.current;
        const me = s.players?.find((p) => p.id === selfId.current);
        if (me && s.game?.active)
          for (const star of s.game.stars || [])
            if (
              Math.hypot(star.x - me.x, star.y - me.y) < 28 &&
              Date.now() - (collectTimes.current[star.id] || 0) > 700
            ) {
              collectTimes.current[star.id] = Date.now();
              room.current.send("collect", { id: star.id });
            }
      }
    }, 100);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [user, solo]);
  useEffect(() => {
    if (!canvas.current) return;
    const el = canvas.current,
      c = el.getContext("2d");
    let raf,
      last = 0;
    const terrain = createTerrain(zone);
    const visual = new Map();
    let camera = { x: 0, y: 0 };
    const resize = () => {
      const r = el.getBoundingClientRect(),
        dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = r.width * dpr;
      el.height = r.height * dpr;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    function draw(t) {
      const dt = Math.min((t - last) / 1000 || 0.016, 0.05);
      last = t;
      const s = state.current;
      const players = (s.players || []).map((p) => {
        let v = visual.get(p.id) || { ...p };
        const distance = Math.hypot(p.x - v.x, p.y - v.y);
        v = {
          ...p,
          x: v.x + (p.x - v.x) * Math.min(1, dt * 14),
          y: v.y + (p.y - v.y) * Math.min(1, dt * 14),
          moving: p.moving || distance > 0.5,
        };
        visual.set(p.id, v);
        return v;
      });
      const me = players.find((p) => p.id === selfId.current) || {
        x: 477,
        y: 350,
      };
      const ratio = el.width / el.clientWidth;
      const zoom = Math.min(2.6, Math.max(1.35, el.clientHeight / 430));
      const scale = ratio * zoom;
      const vw = el.width / scale,
        vh = el.height / scale;
      const targetX = Math.max(0, Math.min(WORLD.width - vw, me.x - vw / 2)),
        targetY = Math.max(0, Math.min(WORLD.height - vh, me.y - vh / 2 + 25));
      camera.x += (targetX - camera.x) * Math.min(1, dt * 7);
      camera.y += (targetY - camera.y) * Math.min(1, dt * 7);
      c.fillStyle = "#89ba70";
      c.fillRect(0, 0, el.width, el.height);
      renderWorld(
        c,
        terrain,
        players,
        selfId.current,
        s.game?.stars,
        t,
        camera,
        emotes.current,
        scale,
      );
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [zone, user, solo]);
  function sendEmote() {
    if (!solo && status !== "online") return;
    emotes.current[selfId.current] = { text: "♥", until: Date.now() + 3000 };
    room.current?.send("emote", {});
  }
  function sendChat(e) {
    e.preventDefault();
    if (!chat.trim()) return;
    if (solo) append({ name: "나그네", text: chat.trim() });
    else if (room.current)
      room.current.send("chat", { text: chat.trim().slice(0, 200) });
    setChat("");
  }
  function startGame() {
    if (solo) {
      const game = {
        active: true,
        endsAt: Date.now() + 30000,
        maxStars:12,
        counter:5,
        nextSpawnAt:Date.now()+1500,
        stars:Array.from({length:5},(_,i)=>i===0?{id:'0',x:480,y:430}:soloStar(String(i))),
        scores: { solo: 0 },
      };
      state.current = { ...state.current, game };
      setSnap({ ...state.current });
      return;
    }
    room.current?.send("startGame", {});
  }
  function logout() {
    room.current?.leave();
    room.current = null;
    pb.authStore.clear();
    setUser(null);
    setSolo(false);
    setInventoryOpen(false);
    setChatOpen(false);
  }
  const me = snap.players?.find((p) => p.id === selfId.current),
    game = snap.game || {},
    remaining = Math.max(0, Math.ceil(((game.endsAt || 0) - Date.now()) / 1000));
  const ranking=Object.entries(game.scores||{}).map(([id,value])=>({id,score:typeof value==='number'?value:value.score,name:snap.players?.find(p=>p.id===id)?.name||(id===selfId.current?'나':'이웃')})).sort((a,b)=>b.score-a.score);
  return (
    <main className="app">
      <canvas
        ref={canvas}
        className="world"
        aria-label="분수와 나무가 있는 픽셀 타운"
      />
      <div className="vignette" />
      {!user && !solo ? (
        <div className="auth-wrap">
          <section className="auth-art">
            <div className="eyebrow">A LITTLE WORLD, TOGETHER</div>
            <h1>
              Pixel<span>Town</span>
              <i>✦</i>
            </h1>
            <p>
              잠깐 쉬어가도 좋은 곳.
              <br />
              작은 마을에서 오늘의 이웃을 만나세요.
            </p>
            <div className="art-caption">
              <span className="sun">☀</span> 언제나 맑음 <span>·</span> 새로운
              만남을 기다리는 중
            </div>
          </section>
          <section className="auth-card">
            <div className="eyebrow">YOUR NEXT LITTLE ADVENTURE</div>
            <h2>마을에 오신 걸 환영해요</h2>
            <p className="muted">
              테스트 계정 또는 준비된 계정으로 로그인하세요.
            </p>
            <form onSubmit={authenticate}>
              <label>
                이메일
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                비밀번호
                <input
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button disabled={busy} className="primary wide">
                {busy ? "잠시만 기다려 주세요…" : "마을 들어가기 →"}
              </button>
            </form>
            <div className="demo-label">테스트 계정 자동 입력</div>
            <div className="demo-buttons">
              {[1, 2].map((i) => (
                <button
                  key={i}
                  onClick={() => {
                    setEmail(`demo${i}@pixeltown.local`);
                    setPassword("PixelTown123!");
                    setError("");
                  }}
                >
                  이웃 {i} <span>↗</span>
                </button>
              ))}
            </div>
            <div className="auth-bottom">
              <button onClick={() => setSolo(true)}>혼자 둘러보기</button>
            </div>
          </section>
          <span className="auth-footer">
            WASD / 방향키로 걷기 &nbsp; · &nbsp; 모바일 터치 지원
          </span>
        </div>
      ) : (
        <>
          <header className="topbar">
            <div className="brand">
              Pixel<span>Town</span>
              <i>✦</i>
            </div>
            <nav aria-label="마을 선택">
              {ZONES.map(([id, icon, label]) => (
                <button
                  key={id}
                  className={zone === id ? "zone active" : "zone"}
                  onClick={() => setZone(id)}
                >
                  <span>{icon}</span>
                  <b>{label}</b>
                </button>
              ))}
            </nav>
            <div className="connection">
              <span className={`dot ${status}`} />
              <span>
                {status === "online"
                  ? `${snap.players?.length || 1}명 접속 중`
                  : status === "solo"
                    ? "혼자 산책 중"
                    : status === "connecting"
                      ? "연결 중…"
                      : "연결 끊김"}
              </span>
            </div>
            <button
              className="avatar"
              aria-label="내 기록 열기"
              onClick={() => {
                setInventoryOpen(!inventoryOpen);
                loadRecords();
              }}
            >
              {(me?.name || user?.name || "나")[0]}
            </button>
          </header>
          <section className="location-card">
            <div className="eyebrow">
              {zone === "lobby"
                ? "WELCOME TO THE NEIGHBORHOOD"
                : zone === "garden"
                  ? "TAKE A BREATH, STAY A WHILE"
                  : "A LITTLE SPARK OF ADVENTURE"}
            </div>
            <h2>
              {ZONES.find((z) => z[0] === zone)[2]} <span>☀</span>
            </h2>
            <p>
              {zone === "lobby"
                ? "분수 옆에서 만나요. 오늘도 좋은 하루!"
                : zone === "garden"
                  ? "느리게 걸어도 괜찮아요. 초록을 즐겨요."
                  : "반짝이는 별을 찾아, 친구들과 한 판!"}
            </p>
          </section>
          {status === "disconnected" && (
            <div className="reconnect" role="alert">
              서버 연결을 확인해 주세요.
              <button onClick={() => setUser({ ...user })}>다시 연결</button>
            </div>
          )}
          <aside className="quest">
            <div className="quest-icon">✦</div>
            <div>
              <span className="eyebrow">
                {game.active ? "STAR HUNT · 진행 중" : "PLAY A LITTLE"}
              </span>
              <strong>
                {game.active
                  ? `별 ${typeof game.scores?.[selfId.current] === "object" ? game.scores[selfId.current].score : game.scores?.[selfId.current] || 0}개 · ${remaining}초`
                  : "별 모으기 챌린지"}
              </strong>
              <p>
                {game.active
                  ? "별 가까이 걸어가면 자동으로 모아요"
                  : "30초 동안 가장 많은 별을 모아보세요"}
              </p>
              {ranking.length>0&&<div className="scoreboard" aria-label="별 모으기 순위">{ranking.slice(0,3).map(p=><span key={p.id}>{ranking.filter(q=>q.score>p.score).length+1}. {p.name} <b>{p.score}★</b></span>)}</div>}
              {game.active&&<small className="star-count">남은 별 {game.stars?.length||0} / {game.maxStars||12}</small>}
            </div>
            <button
              className="primary"
              disabled={game.active || (!solo && status !== "online")}
              onClick={startGame}
            >
              {game.active ? "진행 중" : "시작 ↗"}
            </button>
          </aside>
          {snap.persistence?.status === "pending" && (
            <div className="save-state" role="status">
              {snap.persistence.lastError
                ? "기록 저장 재시도 중"
                : "기록 저장 중…"}
            </div>
          )}
          <div className="bottom-tools">
            <button
              className={chatOpen ? "tool selected" : "tool"}
              onClick={() => setChatOpen(!chatOpen)}
              aria-expanded={chatOpen}
            >
              ☏ <span>마을 채팅</span>
              {!chatOpen && unread > 0 && (
                <small aria-label={`읽지 않은 메시지 ${unread}개`}>
                  {unread > 99 ? "99+" : unread}
                </small>
              )}
            </button>
            <button
              className="tool"
              onClick={sendEmote}
              disabled={!solo && status !== "online"}
            >
              ♡ <span>인사하기</span>
            </button>
            <div className="key-hint">
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd>
              <span>이동</span>
              <kbd>SPACE</kbd>
              <span>인사</span>
            </div>
          </div>
          <div className="dpad" aria-label="터치 이동">
            {[
              ["↑", 0, -1, "up"],
              ["←", -1, 0, "left"],
              ["↓", 0, 1, "down"],
              ["→", 1, 0, "right"],
            ].map(([label, dx, dy, cls]) => (
              <button
                className={cls}
                key={cls}
                aria-label={`${cls} 이동`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  touch.current = { dx, dy };
                }}
                onPointerUp={() => (touch.current = { dx: 0, dy: 0 })}
                onPointerCancel={() => (touch.current = { dx: 0, dy: 0 })}
                onLostPointerCapture={() => (touch.current = { dx: 0, dy: 0 })}
              >
                {label}
              </button>
            ))}
          </div>
          {chatOpen && (
            <section
              className="chat-panel"
              style={{
                backgroundColor: `rgba(255, 252, 242, ${chatOpacity / 100})`,
              }}
            >
              <div className="panel-title">
                <strong>
                  마을 이야기 <span>{snap.players?.length || 1}</span>
                </strong>
                <button
                  onClick={() => setChatOpen(false)}
                  aria-label="채팅 접기"
                >
                  ×
                </button>
              </div>
              <div className="chat-settings">
                <label htmlFor="chat-opacity">
                  배경 <span>{chatOpacity}%</span>
                </label>
                <input
                  id="chat-opacity"
                  type="range"
                  min="20"
                  max="95"
                  step="1"
                  value={chatOpacity}
                  onChange={(e) => setChatOpacity(Number(e.target.value))}
                  aria-label="채팅 배경 불투명도"
                />
              </div>
              <div className="chat-scroll" role="log" aria-live="polite">
                {messages.length === 0 && (
                  <div className="empty">
                    이웃에게 먼저 인사를 건네보세요.
                    <br />
                    <span>이 방에 있는 모두에게 보여요.</span>
                  </div>
                )}
                {messages.map((m) => (
                  <p key={m.id}>
                    <b>{m.name}</b>
                    <span>{m.text}</span>
                  </p>
                ))}
                <div ref={chatEnd} />
              </div>
              <form className="chat-input" onSubmit={sendChat}>
                <input
                  value={chat}
                  maxLength={200}
                  onFocus={() => keys.current.clear()}
                  onChange={(e) => setChat(e.target.value)}
                  placeholder="안녕하세요, 이웃!"
                  aria-label="채팅 메시지"
                />
                <button
                  disabled={!chat.trim() || (!solo && status !== "online")}
                  aria-label="메시지 보내기"
                >
                  ↑
                </button>
              </form>
            </section>
          )}
          {inventoryOpen && (
            <aside className="inventory">
              <div className="panel-title">
                <strong>나의 마을 수첩</strong>
                <button
                  aria-label="수첩 닫기"
                  onClick={() => setInventoryOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="inventory-scroll">
                <div className="profile">
                  <div className="avatar">
                    {
                      (records.profiles[0]?.name ||
                        me?.name ||
                        user?.name ||
                        "나")[0]
                    }
                  </div>
                  <div>
                    <h3>
                      {records.profiles[0]?.name ||
                        me?.name ||
                        user?.name ||
                        "나그네"}
                    </h3>
                    <p>{solo ? "로컬 산책 모드" : user?.email}</p>
                  </div>
                </div>
                <h4>
                  내 인벤토리 <span>{records.inventory.length}</span>
                </h4>
                {records.inventory.length ? (
                  records.inventory.map((item) => (
                    <div className="record" key={item.id}>
                      <span>
                        ✦{" "}
                        {item.name ||
                          item.itemName ||
                          (item.item === 'star' ? '별 조각' : item.item) ||
                          item.kind ||
                          "별 조각"}
                      </span>
                      <b>×{item.quantity ?? item.count ?? 1}</b>
                    </div>
                  ))
                ) : (
                  <p className="empty">아직 모은 아이템이 없어요.</p>
                )}
                <h4>최근 게임 기록</h4>
                {records.results.length ? (
                  records.results.slice(0, 10).map((item) => (
                    <div className="record" key={item.id}>
                      <span>
                        {item.zone || "별 모으기"}
                        <small>
                          {new Date(
                            item.ended_at || item.created,
                          ).toLocaleDateString("ko-KR")}
                        </small>
                      </span>
                      <b>{item.score ?? item.stars ?? 0} ★</b>
                    </div>
                  ))
                ) : (
                  <p className="empty">첫 번째 챌린지에 도전해 보세요.</p>
                )}
                {recordError && <p className="error">{recordError}</p>}
                <button className="secondary wide" onClick={loadRecords}>
                  기록 새로고침
                </button>
                <button className="logout wide" onClick={logout}>
                  로그아웃
                </button>
              </div>
            </aside>
          )}
          <div className="world-credit">
            PIXEL TOWN <span>·</span> {ZONES.find(z=>z[0]===zone)[2]}
          </div>
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
