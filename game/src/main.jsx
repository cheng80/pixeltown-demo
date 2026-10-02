import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PocketBase from "pocketbase";
import { Client } from "colyseus.js";
import g11 from "galmuri/dist/Galmuri11.woff2";
import g11b from "galmuri/dist/Galmuri11-Bold.woff2";
import { getMap, moveActor, findPath, portalAt, entryPoint, spreadSpot, COLLECT_RADIUS, STAR_SPAWN_MS, STEP_PER_TICK, TICK_MS } from "../../shared/world.js";
import { scene, createView } from "./render.js";
import { avatarSprite, lookFor } from "./sprites.js";
import "./style.css";

for (const [src, weight] of [[g11, "400"], [g11b, "700"]]) {
  const face = new FontFace("Galmuri11", `url(${src})`, { weight });
  document.fonts.add(face); face.load().catch(() => {});
}
const pb = new PocketBase(import.meta.env.VITE_PB_URL || "http://127.0.0.1:18090");
pb.autoCancellation(false);
const client = new Client(import.meta.env.VITE_GAME_URL || "ws://127.0.0.1:12567");
const ZONES = [
  ["lobby", "⛲", "광장", "분수 앞에서 만나요. 표지판을 따라 정원·오락실로!"],
  ["garden", "🌷", "정원", "연못 다리를 건너 온실까지 천천히 산책해요."],
  ["arcade", "🕹️", "오락실", "별 무대에서 30초 별 모으기 한 판!"],
];
const MOVE_KEYS = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
const load = (key, fallback, ok) => { try { const v = JSON.parse(localStorage.getItem(key)); return ok(v) ? v : fallback; } catch { return fallback; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
const isTyping = t => ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName) || t?.isContentEditable;

function Portrait({ player, scale = 6, className = "portrait" }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, 18 * scale, 27 * scale);
    c.drawImage(avatarSprite(lookFor(player), 0, 0), 0, 0, 18 * scale, 27 * scale);
  }, [player.id, player.color, scale]);
  return <div className={className}><canvas ref={ref} width={18 * scale} height={27 * scale} aria-hidden="true" /></div>;
}

function App() {
  const [user, setUser] = useState(pb.authStore.isValid ? pb.authStore.record : null);
  const [solo, setSolo] = useState(false);
  const [email, setEmail] = useState("demo1@pixeltown.local");
  const [password, setPassword] = useState("PixelTown123!");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zone, setZone] = useState("lobby");
  const [status, setStatus] = useState("connecting");
  const [snap, setSnap] = useState({ players: [], game: {} });
  const [messages, setMessages] = useState([]);
  const [chat, setChat] = useState("");
  const [chatOpen, setChatOpen] = useState(() => load("pixeltown.chatOpen", window.innerWidth >= 900, v => typeof v === "boolean"));
  const [unread, setUnread] = useState(0);
  const [chatOpacity, setChatOpacity] = useState(() => load("pixeltown.chatOpacity", 72, v => Number.isInteger(v) && v >= 20 && v <= 95));
  const [notebook, setNotebook] = useState(false);
  const [records, setRecords] = useState({ profiles: [], inventory: [], results: [] });
  const [recordError, setRecordError] = useState("");
  const [toast, setToast] = useState("");
  const [, setNow] = useState(0);
  const canvasRef = useRef(null), viewRef = useRef(null), room = useRef(null), keys = useRef(new Set()), touch = useRef({ dx: 0, dy: 0 });
  const route = useRef([]), marker = useRef(null), state = useRef({ players: [], game: {} }), bubbles = useRef({}), emotes = useRef({});
  const selfId = useRef("solo"), soloPos = useRef(null), entry = useRef("default"), portalArmed = useRef(false), chatVisible = useRef(chatOpen);
  const collectTimes = useRef({}), persistStatus = useRef(null), chatInput = useRef(null), lastSent = useRef("");
  const entered = Boolean(user || solo), map = getMap(zone), zoneInfo = ZONES.find(z => z[0] === zone);

  const notify = setToast;
  const append = m => {
    if (!chatVisible.current && !m.mine) setUnread(n => n + 1);
    setMessages(a => [...a.slice(-79), { ...m, key: `${Date.now()}-${Math.random()}` }]);
    if (m.id) bubbles.current[m.id] = { text: m.text, until: Date.now() + 4000 };
  };
  useEffect(() => { chatVisible.current = chatOpen; save("pixeltown.chatOpen", chatOpen); if (chatOpen) setUnread(0); }, [chatOpen]);
  useEffect(() => save("pixeltown.chatOpacity", chatOpacity), [chatOpacity]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const fit = () => document.documentElement.style.setProperty("--app-height", `${window.visualViewport?.height || window.innerHeight}px`);
    fit(); window.visualViewport?.addEventListener("resize", fit); window.addEventListener("resize", fit);
    return () => { window.visualViewport?.removeEventListener("resize", fit); window.removeEventListener("resize", fit); };
  }, []);

  async function authenticate(e) {
    e.preventDefault(); setBusy(true); setError("");
    try { const r = await pb.collection("users").authWithPassword(email, password); setUser(r.record); setSolo(false); }
    catch (err) { setError(err.status === 400 ? "이메일 또는 비밀번호가 맞지 않아요." : `로그인 서버에 연결하지 못했어요. (${err.message})`); }
    finally { setBusy(false); }
  }
  async function loadRecords() {
    if (!user || solo) return;
    setRecordError("");
    const failed = [];
    const rows = await Promise.all(["profiles", "inventory", "results"].map(async col => {
      try { return [col, await pb.collection(col).getFullList({ filter: pb.filter("user = {:id}", { id: user.id }), sort: "-created" })]; }
      catch { failed.push(col); return [col, []]; }
    }));
    setRecords(Object.fromEntries(rows));
    if (failed.length) setRecordError(`${failed.join(", ")} 정보를 불러오지 못했어요.`);
  }
  useEffect(() => { if (user) loadRecords(); }, [user]);

  function goZone(to, via = "default") {
    if (to === zone) return;
    entry.current = via; route.current = []; marker.current = null; setZone(to);
  }

  // room connection (or local practice)
  useEffect(() => {
    if (!entered) return;
    let cancelled = false;
    setStatus(solo ? "solo" : "connecting");
    state.current = { players: [], game: {} }; setSnap(state.current);
    persistStatus.current = null; setMessages([]); setUnread(0);
    collectTimes.current = {}; bubbles.current = {}; emotes.current = {}; keys.current.clear(); touch.current = { dx: 0, dy: 0 };
    route.current = []; portalArmed.current = false; lastSent.current = "";
    const via = entry.current; entry.current = "default";
    if (solo) {
      selfId.current = "solo"; soloPos.current = entryPoint(getMap(zone), via);
      const stars = [];
      while (stars.length < 5) stars.push({ id: String(stars.length), ...spreadSpot(getMap(zone), [...stars, soloPos.current]) });
      state.current.game = { active: true, endsAt: 0, counter: 5, nextSpawnAt: Date.now() + STAR_SPAWN_MS, stars, scores: { solo: 0 } };
      return;
    }
    // A reload can race the server noticing the previous socket closed (409): retry briefly.
    const join = (n = 0) => client.joinOrCreate("town", { token: pb.authStore.token, zone, entry: via })
      .catch(e => (e.code === 409 && n < 6 && !cancelled ? new Promise(r => setTimeout(r, 700)).then(() => join(n + 1)) : Promise.reject(e)));
    join().then(r => {
      if (cancelled) { r.leave(); return; }
      room.current = r; selfId.current = user.id; setStatus("online");
      r.onMessage("snapshot", data => {
        if (data.zone !== zone) return;
        state.current = data; setSnap(data);
        const p = data.persistence;
        if (p?.status === "saved" && persistStatus.current === "pending") { loadRecords(); notify("기록과 별 보상이 저장되었어요! 수첩에서 확인하세요."); }
        persistStatus.current = p?.status;
      });
      r.onMessage("chat", d => append({ id: d.id, name: d.name || "이웃", text: d.text, mine: d.id === user.id }));
      r.onMessage("emote", d => { emotes.current[d.id] = Date.now() + 2500; });
      r.onMessage("gameEnded", m => { const n = m.scores?.[user.id]; if (n) { persistStatus.current = "pending"; notify(`별 ${n}개 정산! 기록을 저장하는 중이에요.`); } });
      r.onLeave(() => { if (!cancelled) setStatus("disconnected"); });
      r.onError((code, message) => { if (!cancelled) { setStatus("disconnected"); notify(message || `연결 오류 (${code})`); } });
    }).catch(e => { if (!cancelled) { setStatus("disconnected"); notify(`마을 연결 실패: ${e.message}`); } });
    return () => { cancelled = true; room.current?.leave(); room.current = null; };
  }, [user, solo, zone]);

  // input: keyboard / d-pad / click route, sent to the server every tick
  useEffect(() => {
    if (!entered) return;
    const down = e => {
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS[k]) { e.preventDefault(); keys.current.add(k); route.current = []; marker.current = null; }
      else if (k === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); if (!e.repeat) sendEmote(); }
      else if (k === "enter") { e.preventDefault(); setChatOpen(true); setTimeout(() => chatInput.current?.focus(), 0); }
    };
    const up = e => keys.current.delete(e.key.toLowerCase());
    const reset = () => { keys.current.clear(); touch.current = { dx: 0, dy: 0 }; };
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", reset); document.addEventListener("visibilitychange", reset);
    const tick = setInterval(() => {
      const m = getMap(zone), s = state.current;
      let dx = touch.current.dx, dy = touch.current.dy;
      for (const k of keys.current) if (MOVE_KEYS[k]) { dx += MOVE_KEYS[k][0]; dy += MOVE_KEYS[k][1]; }
      const me = solo ? soloPos.current : s.players?.find(p => p.id === selfId.current);
      if (!me) return;
      if (!dx && !dy && route.current.length) {
        while (route.current.length && Math.hypot(route.current[0].x - me.x, route.current[0].y - me.y) < 2) route.current.shift();
        if (route.current.length) { dx = route.current[0].x - me.x; dy = route.current[0].y - me.y; }
        else marker.current = null;
      }
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) { dx /= len; dy /= len; } else { dx = 0; dy = 0; }
      if (solo) {
        if (dx || dy) Object.assign(soloPos.current, moveActor(m, me.x, me.y, dx, dy, STEP_PER_TICK));
        const g = s.game;
        s.players = [{ id: "solo", name: "나그네", color: "#ff9ec4", ...soloPos.current }];
        if (g?.active) {
          const now = Date.now();
          g.stars = g.stars.filter(star => { if (Math.hypot(star.x - me.x, star.y - me.y) <= COLLECT_RADIUS) { g.scores.solo++; return false; } return true; });
          if (now >= g.nextSpawnAt) { if (g.stars.length < 12) g.stars.push({ id: String(g.counter++), ...spreadSpot(m, [...g.stars, me]) }); g.nextSpawnAt = now + STAR_SPAWN_MS; }
          setSnap({ ...s, game: { ...g } });
        }
      } else if (room.current) {
        const msg = `${dx.toFixed(2)},${dy.toFixed(2)}`;
        if (dx || dy || msg !== lastSent.current) room.current.send("input", { dx, dy });
        lastSent.current = msg;
        if (s.game?.active) for (const star of s.game.stars || [])
          if (Math.hypot(star.x - me.x, star.y - me.y) <= COLLECT_RADIUS - 1 && Date.now() - (collectTimes.current[star.id] || 0) > 600) {
            collectTimes.current[star.id] = Date.now(); room.current.send("collect", { id: star.id });
          }
      }
      // doorway mats: only after stepping off the arrival mat once
      const portal = portalAt(m, me.x, me.y);
      if (!portal) portalArmed.current = true;
      else if (portalArmed.current && (solo || status === "online")) { portalArmed.current = false; goZone(portal.to, portal.entry); }
    }, TICK_MS);
    return () => { clearInterval(tick); removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", reset); document.removeEventListener("visibilitychange", reset); };
  }, [user, solo, zone, status]);

  // render loop
  useEffect(() => {
    if (!entered || !canvasRef.current) return;
    const view = (viewRef.current = createView(canvasRef.current)), sc = scene(zone), anim = new Map();
    let raf, last = performance.now(), first = true;
    window.__pixeltown = { view, zone, anim, state, route }; // read-only hooks for UI verification scripts
    const frame = t => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const s = state.current, now = Date.now(), avatars = [];
      for (const p of s.players || []) {
        let a = anim.get(p.id);
        if (!a) { a = { x: p.x, y: p.y, dir: 0, walk: 0, moving: 0 }; anim.set(p.id, a); }
        const ddx = p.x - a.x, ddy = p.y - a.y, dist = Math.hypot(ddx, ddy);
        if (dist > 40) { a.x = p.x; a.y = p.y; } else { const k = Math.min(1, dt * 16); a.x += ddx * k; a.y += ddy * k; }
        if (dist > 0.6) { a.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 2 : 3) : (ddy > 0 ? 0 : 1); a.moving = now + 120; }
        if (a.moving > now) a.walk += dist * k2(dt); else a.walk = 0;
        const self = p.id === selfId.current;
        avatars.push({ x: a.x, y: a.y, dir: a.dir, frame: a.walk ? [1, 0, 2, 0][Math.floor(a.walk / 5) % 4] : 0, look: lookFor(p), name: p.name || "이웃", self,
          bubble: bubbles.current[p.id]?.until > now ? bubbles.current[p.id].text : null, emote: emotes.current[p.id] > now });
      }
      const me = avatars.find(a => a.self);
      view.draw(sc, { focus: me, avatars, stars: s.game?.active ? s.game.stars : [], time: t, dt, snap: first && Boolean(me), marker: marker.current });
      if (me) first = false;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [entered, zone]);

  function onStagePointer(e) {
    if (e.button > 0 || !viewRef.current) return;
    const r = e.currentTarget.getBoundingClientRect(), target = viewRef.current.toWorld(e.clientX - r.left, e.clientY - r.top);
    const me = solo ? soloPos.current : state.current.players?.find(p => p.id === selfId.current);
    if (!me) return;
    document.activeElement?.blur?.();
    route.current = findPath(map, me, target); marker.current = route.current.at(-1) || null;
  }
  function sendEmote() {
    if (!solo && status !== "online") return;
    emotes.current[selfId.current] = Date.now() + 2500;
    room.current?.send("emote", {});
  }
  function sendChat(e) {
    e.preventDefault();
    const text = chat.trim(); if (!text) return;
    if (solo) append({ id: "solo", name: "나그네", text, mine: true });
    else room.current?.send("chat", { text: text.slice(0, 200) });
    setChat("");
  }
  function logout() {
    room.current?.leave(); room.current = null; pb.authStore.clear();
    setUser(null); setSolo(false); setNotebook(false);
  }

  if (!entered) return <Login {...{ email, setEmail, password, setPassword, busy, error, setError, authenticate, setSolo }} />;

  const game = snap.game || {}, me = snap.players?.find(p => p.id === selfId.current) || { id: selfId.current, name: user?.name || "나그네", color: "#ff9ec4" };
  const remaining = Math.max(0, Math.ceil(((game.endsAt || 0) - Date.now()) / 1000)), clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const myScore = game.scores?.[selfId.current] || 0;
  const ranking = Object.entries(game.scores || {}).map(([id, score]) => ({ id, score, name: snap.players?.find(p => p.id === id)?.name || (id === selfId.current ? "나" : "이웃") })).sort((a, b) => b.score - a.score);
  const totalStars = records.inventory.reduce((n, i) => n + (i.quantity || 0), 0);
  const online = snap.players?.length || (solo ? 1 : 0);
  const saving = snap.persistence?.status === "pending";
  const starCard = (
    <section className="star-card" aria-label="별 모으기">
      <div className="star-card-head"><b>★ 별 모으기</b><span className="muted">{solo ? "연습" : "상시 이벤트"}</span></div>
      <p className="star-line">내 별 <b>{myScore}</b>개 · 맵의 별 {game.stars?.length || 0}/12</p>
      <p className="star-line muted">{solo ? "별 가까이 걸어가면 모아요 (저장 안 됨)" : game.active ? `다음 정산까지 ${clock}` : "별 가까이 걸어가면 모아요"}</p>
      {ranking.length > 0 && <ol className="ranking">{ranking.slice(0, 3).map(p => <li key={p.id} className={p.id === selfId.current ? "mine" : ""}><span>{ranking.filter(q => q.score > p.score).length + 1}</span>{p.name}<b>{p.score}★</b></li>)}</ol>}
      {saving && <p className="save-state" role="status">{snap.persistence.lastError ? "기록 저장 재시도 중…" : "기록 저장 중…"}</p>}
    </section>
  );
  return (
    <main className="page">
      <div className="hompy">
        <aside className="profile paper">
          <div className="today">TODAY <b>{online}</b> <span>|</span> TOTAL <b>{totalStars}</b></div>
          <Portrait player={me} />
          <h2 className="me-name">{me.name}</h2>
          <p className="mood">♪ {zoneInfo[3]}</p>
          <div className="row-badges"><span className="stars-badge">★ {totalStars}</span>{solo && <span className="tag">연습 모드</span>}</div>
          {starCard}
          <button className="btn ghost wide" onClick={() => { setNotebook(true); loadRecords(); }}>📒 내 수첩</button>
        </aside>
        <section className="room paper">
          <header className="room-title">
            <b className="brand">픽셀타운</b><span className="zone-name">{zoneInfo[1]} {map.title}</span><small className="url">pixel.town/{map.slug}</small>
            <span className={`online ${status}`}>{status === "online" ? `${online}명 접속 중` : status === "solo" ? "혼자 산책 중" : status === "connecting" ? "연결 중…" : "연결 끊김"}</span>
          </header>
          <div className="stage" onPointerDown={onStagePointer}>
            <canvas ref={canvasRef} className="world" aria-label={`${map.title} 미니룸. 화면을 누르면 그곳으로 걸어가요.`} />
            <div className="strip">{starCard}</div>
            {status === "disconnected" && <div className="notice" role="alert" onPointerDown={e => e.stopPropagation()}>서버 연결이 끊겼어요. <button className="btn small" onClick={() => setUser({ ...user })}>다시 연결</button></div>}
            <Chat {...{ chatOpen, setChatOpen, unread, chatOpacity, setChatOpacity, messages, chat, setChat, sendChat, chatInput, keys, route, online, canSend: solo || status === "online" }} />
            <div className="dpad" aria-label="방향 이동" onPointerDown={e => e.stopPropagation()}>
              {[["▲", 0, -1, "위"], ["◀", -1, 0, "왼쪽"], ["▼", 0, 1, "아래"], ["▶", 1, 0, "오른쪽"]].map(([label, dx, dy, name]) => (
                <button key={name} className={`pad ${name}`} aria-label={`${name}로 이동`}
                  onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); route.current = []; touch.current = { dx, dy }; }}
                  onPointerUp={() => (touch.current = { dx: 0, dy: 0 })} onPointerCancel={() => (touch.current = { dx: 0, dy: 0 })} onLostPointerCapture={() => (touch.current = { dx: 0, dy: 0 })}>{label}</button>
              ))}
            </div>
            {toast && <div className="toast" role="status">{toast}</div>}
          </div>
          <footer className="room-tools">
            <button className="btn small blue" onClick={sendEmote} disabled={!solo && status !== "online"}>♥ 인사</button>
            <button className="btn small ghost only-compact" onClick={() => { setNotebook(true); loadRecords(); }}>📒 수첩</button>
            <span className="hint"><kbd>WASD</kbd> 걷기 · <kbd>클릭</kbd> 이동 · <kbd>Space</kbd> 인사 · <kbd>Enter</kbd> 채팅</span>
          </footer>
        </section>
        <nav className="tabs" aria-label="장소 이동">
          {ZONES.map(([id, icon, label]) => <button key={id} aria-pressed={zone === id} onClick={() => goZone(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </nav>
      </div>
      {notebook && <Notebook {...{ records, recordError, loadRecords, logout, solo, user, me, close: () => setNotebook(false) }} />}
    </main>
  );
}
const k2 = dt => Math.min(1, dt * 16);

function Chat({ chatOpen, setChatOpen, unread, chatOpacity, setChatOpacity, messages, chat, setChat, sendChat, chatInput, keys, route, online, canSend }) {
  const end = useRef(null);
  useEffect(() => { if (chatOpen) end.current?.scrollIntoView({ block: "nearest" }); }, [messages, chatOpen]);
  if (!chatOpen) return (
    <button className="chat-fab" aria-expanded="false" onPointerDown={e => e.stopPropagation()} onClick={() => setChatOpen(true)}>
      💬 채팅 펼치기{unread > 0 && <span className="badge" aria-label={`읽지 않은 메시지 ${unread}개`}>{unread > 99 ? "99+" : unread}</span>}
    </button>
  );
  return (
    <section className="chat" style={{ backgroundColor: `rgba(255, 250, 252, ${chatOpacity / 100})` }} aria-label="방 채팅">
      <div className="chat-head" onPointerDown={e => e.stopPropagation()}>
        <b>마을 이야기 <span>{online}</span></b>
        <label className="opacity">배경<input type="range" min="20" max="95" step="1" value={chatOpacity} onChange={e => setChatOpacity(Number(e.target.value))} aria-label="채팅 배경 불투명도" /><span>{chatOpacity}%</span></label>
        <button className="btn tiny ghost" aria-expanded="true" onClick={() => setChatOpen(false)}>접기</button>
      </div>
      <div className="chat-log" role="log" aria-live="polite">
        {messages.length === 0 && <p className="empty">이웃에게 먼저 인사해 보세요. 이 방 모두에게 보여요.</p>}
        {messages.map(m => <p key={m.key} className={m.mine ? "mine" : ""}><b>{m.name}</b> {m.text}</p>)}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={sendChat} onPointerDown={e => e.stopPropagation()}>
        <input ref={chatInput} value={chat} maxLength={200} onFocus={() => { keys.current.clear(); route.current = []; }} onChange={e => setChat(e.target.value)} onKeyDown={e => { if (e.key === "Escape") e.currentTarget.blur(); }} placeholder="메시지 입력" aria-label="채팅 메시지" />
        <button className="btn small" disabled={!chat.trim() || !canSend}>전송</button>
      </form>
    </section>
  );
}

function Notebook({ records, recordError, loadRecords, logout, solo, user, me, close }) {
  return (
    <div className="sheet-backdrop" onClick={close}>
      <aside className="notebook paper" role="dialog" aria-label="내 수첩" onClick={e => e.stopPropagation()}>
        <div className="notebook-head"><b>📒 나의 미니 수첩</b><button className="btn tiny ghost" onClick={close} aria-label="수첩 닫기">닫기</button></div>
        <div className="notebook-body">
          <div className="nb-profile"><Portrait player={me} scale={3} className="portrait small" /><div><h3>{records.profiles[0]?.name || me.name}</h3><p>{solo ? "로컬 연습 모드 · 기록 저장 안 됨" : user?.email}</p></div></div>
          <h4>별 보상 <span>{records.inventory.reduce((n, i) => n + (i.quantity || 0), 0)}개</span></h4>
          {records.inventory.length ? records.inventory.slice(0, 20).map(i => <div className="record" key={i.id}><span>★ 별 조각</span><b>×{i.quantity ?? 0}</b></div>) : <p className="empty">아직 모은 별이 없어요.</p>}
          <h4>최근 기록</h4>
          {records.results.length ? records.results.slice(0, 10).map(r => <div className="record" key={r.id}><span>{({ lobby: "광장", garden: "정원", arcade: "오락실" })[r.zone] || r.zone}<small>{new Date(r.ended_at || r.created).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small></span><b>{r.score ?? 0}점</b></div>) : <p className="empty">첫 번째 별 모으기에 도전해 보세요.</p>}
          {recordError && <p className="error" role="alert">{recordError}</p>}
        </div>
        <div className="notebook-foot"><button className="btn small ghost" onClick={loadRecords} disabled={solo}>새로고침</button><button className="btn small" onClick={logout}>로그아웃</button></div>
      </aside>
    </div>
  );
}

function Login({ email, setEmail, password, setPassword, busy, error, setError, authenticate, setSolo }) {
  return (
    <main className="page">
      <section className="login paper">
        <h1 className="logo">PIXEL TOWN</h1>
        <p className="tagline">미니홈피 속 작은 마을을 걷고, 이웃과 수다 떨고, 별을 모아요 ♥</p>
        <div className="login-body">
          <div className="login-art"><Portrait player={{ id: email, color: "#ff9ec4" }} scale={7} /><span className="muted">이메일마다 다른 아바타</span></div>
          <form onSubmit={authenticate} className="login-form">
            <label className="field">이메일<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
            <label className="field">비밀번호<input required type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="row">{[1, 2].map(i => <button type="button" key={i} className="btn small ghost" onClick={() => { setEmail(`demo${i}@pixeltown.local`); setPassword("PixelTown123!"); setError(""); }}>이웃 {i} 계정</button>)}</div>
            <button className="btn wide" disabled={busy}>{busy ? "입장하는 중…" : "타운 입장하기 ▶"}</button>
            <button type="button" className="btn blue wide" onClick={() => setSolo(true)}>혼자 둘러보기 (연습)</button>
          </form>
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
