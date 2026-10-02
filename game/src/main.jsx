import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PocketBase from "pocketbase";
import { Client } from "colyseus.js";
import g11 from "galmuri/dist/Galmuri11.woff2";
import g11b from "galmuri/dist/Galmuri11-Bold.woff2";
import { getMap, moveActor, blocked, nearestFree, findPath, portalAt, entryPoint, spreadSpot, homeMap, roomProblem, CATALOG, ITEMS, COLLECT_RADIUS, STAR_SPAWN_MS, STEP_PER_TICK, TICK_MS } from "../../shared/world.js";
import { scene, createView } from "./render.js";
import { avatarSprite, lookFor, petSprite, propSprite } from "./sprites.js";
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
  ["arcade", "🕹️", "오락실", "오락기 사이사이 숨은 별을 찾아요."],
  ["home", "🏠", "미니룸", "모은 별로 산 가구로 내 방을 꾸며요."],
];
const SLOTS = [["hat", "모자"], ["top", "옷"], ["pet", "펫"], ["furniture", "가구"]];
const MOVE_KEYS = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
const load = (key, fallback, ok) => { try { const v = JSON.parse(localStorage.getItem(key)); return ok(v) ? v : fallback; } catch { return fallback; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
const isTyping = t => ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName) || t?.isContentEditable;

function Portrait({ player, scale = 6, className = "portrait" }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const look = lookFor(player);
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, 18 * scale, 31 * scale);
    c.drawImage(avatarSprite(look, 0, 0), 0, 0, 18 * scale, 31 * scale);
    const pet = look.pet && petSprite(look.pet, 0);
    if (pet) c.drawImage(pet, 11 * scale, 19 * scale, 14 * scale * 0.7, 14 * scale * 0.7);
  }, [player.id, player.color, player.look?.hat, player.look?.top, player.look?.pet, scale]);
  return <div className={className}><canvas ref={ref} width={18 * scale} height={31 * scale} aria-hidden="true" /></div>;
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
  const [records, setRecords] = useState({ profiles: [], inventory: [], results: [], purchases: [] });
  const [shop, setShop] = useState(false);
  const [edit, setEdit] = useState(null); // mini-room furniture editing: { placements, sel }
  const [recordError, setRecordError] = useState("");
  const [toast, setToast] = useState("");
  const [, setNow] = useState(0);
  const canvasRef = useRef(null), viewRef = useRef(null), room = useRef(null), keys = useRef(new Set()), touch = useRef({ dx: 0, dy: 0 });
  const route = useRef([]), marker = useRef(null), state = useRef({ players: [], game: {} }), bubbles = useRef({}), emotes = useRef({});
  const selfId = useRef("solo"), soloPos = useRef(null), entry = useRef("default"), portalArmed = useRef(false), chatVisible = useRef(chatOpen);
  const collectTimes = useRef({}), persistStatus = useRef(null), chatInput = useRef(null), lastSent = useRef("");
  const entered = Boolean(user || solo), local = solo || zone === "home", zoneInfo = ZONES.find(z => z[0] === zone);
  const profile = records.profiles[0], outfit = profile?.outfit || {};
  const owned = useMemo(() => new Set(records.purchases.map(p => p.item)), [records.purchases]);
  const earned = records.inventory.reduce((n, i) => n + (i.quantity || 0), 0), wallet = earned - records.purchases.reduce((n, p) => n + (p.price || 0), 0);
  const placements = edit ? edit.placements : Array.isArray(profile?.room) ? profile.room : [];
  const home = useMemo(() => homeMap(placements), [JSON.stringify(placements)]);
  const map = zone === "home" ? home : getMap(zone), mapRef = useRef(map), profileRef = useRef(profile);
  mapRef.current = map; profileRef.current = profile;

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
    const rows = await Promise.all(["profiles", "inventory", "results", "purchases"].map(async col => {
      try { return [col, await pb.collection(col).getFullList({ filter: pb.filter("user = {:id}", { id: user.id }), sort: "-created" })]; }
      catch { failed.push(col); return [col, []]; }
    }));
    setRecords(Object.fromEntries(rows));
    if (failed.length) setRecordError(`${failed.join(", ")} 정보를 불러오지 못했어요.`);
  }
  useEffect(() => { if (user) loadRecords(); }, [user]);

  function goZone(to, via = "default") {
    if (to === zone) return;
    if (to === "home" && solo) return;
    setEdit(null); entry.current = via; route.current = []; marker.current = null; setZone(to);
  }

  // room connection (or local practice)
  useEffect(() => {
    if (!entered) return;
    let cancelled = false;
    setStatus(local ? "solo" : "connecting");
    state.current = { players: [], game: {}, zone }; setSnap(state.current);
    persistStatus.current = null; setMessages([]); setUnread(0);
    collectTimes.current = {}; bubbles.current = {}; emotes.current = {}; keys.current.clear(); touch.current = { dx: 0, dy: 0 };
    route.current = []; portalArmed.current = false; lastSent.current = "";
    const via = entry.current; entry.current = "default";
    if (zone === "home") { selfId.current = user.id; soloPos.current = entryPoint(mapRef.current, via); return; }
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
      const m = mapRef.current, s = state.current;
      let dx = touch.current.dx, dy = touch.current.dy;
      for (const k of keys.current) if (MOVE_KEYS[k]) { dx += MOVE_KEYS[k][0]; dy += MOVE_KEYS[k][1]; }
      const me = local ? soloPos.current : s.players?.find(p => p.id === selfId.current);
      if (!me) return;
      if (!dx && !dy && route.current.length) {
        while (route.current.length && Math.hypot(route.current[0].x - me.x, route.current[0].y - me.y) < 2) route.current.shift();
        if (route.current.length) { dx = route.current[0].x - me.x; dy = route.current[0].y - me.y; }
        else marker.current = null;
      }
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) { dx /= len; dy /= len; } else { dx = 0; dy = 0; }
      if (local) {
        if (blocked(m, me.x, me.y)) Object.assign(soloPos.current, nearestFree(m, me.x, me.y)); // furniture placed on top of me
        if (dx || dy) Object.assign(soloPos.current, moveActor(m, me.x, me.y, dx, dy, STEP_PER_TICK));
        const g = s.game;
        s.players = [solo ? { id: "solo", name: "나그네", color: "#ff9ec4", ...soloPos.current } : { id: user.id, name: profileRef.current?.name || user.name || "나", color: profileRef.current?.color, look: profileRef.current?.outfit, ...soloPos.current }];
        if (!g?.active) setSnap({ ...s });
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
      else if (portalArmed.current && (local || status === "online")) { portalArmed.current = false; goZone(portal.to, portal.entry); }
    }, TICK_MS);
    return () => { clearInterval(tick); removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", reset); document.removeEventListener("visibilitychange", reset); };
  }, [user, solo, zone, status, local]);

  // render loop
  useEffect(() => {
    if (!entered || !canvasRef.current) return;
    const view = (viewRef.current = createView(canvasRef.current)), sc = scene(map), anim = new Map();
    let raf, last = performance.now(), first = true;
    window.__pixeltown = { view, zone, anim, state, route, marker }; // read-only hooks for UI verification scripts
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
        const self = p.id === selfId.current, look = lookFor(p);
        // pets trot to a spot just behind their owner; facing the camera they sit beside, not hidden behind the body
        let pet = null;
        if (look.pet) {
          const back = [[-14, -3], [0, 8], [-13, 2], [13, 2]][a.dir], tx = a.x + back[0], ty = a.y + back[1];
          a.pet ||= { x: tx, y: ty, flip: false, hop: 0 };
          const pdx = tx - a.pet.x, pdy = ty - a.pet.y, pd = Math.hypot(pdx, pdy);
          if (pd > 60) Object.assign(a.pet, { x: tx, y: ty }); else { const k = Math.min(1, dt * 5); a.pet.x += pdx * k; a.pet.y += pdy * k; }
          if (Math.abs(pdx) > 1) a.pet.flip = pdx < 0;
          a.pet.hop = pd > 3 ? a.pet.hop + dt : 0;
          pet = { id: look.pet, x: a.pet.x, y: a.pet.y, flip: a.pet.flip, frame: Math.floor(a.pet.hop * 8) % 2 };
        }
        avatars.push({ x: a.x, y: a.y, dir: a.dir, frame: a.walk ? [1, 0, 2, 0][Math.floor(a.walk / 5) % 4] : 0, look, pet, name: p.name || "이웃", self,
          bubble: bubbles.current[p.id]?.until > now ? bubbles.current[p.id].text : null, emote: emotes.current[p.id] > now });
      }
      const me = avatars.find(a => a.self);
      view.draw(sc, { focus: me, avatars, stars: s.game?.active ? s.game.stars : [], time: t, dt, snap: first && Boolean(me), marker: marker.current });
      if (me) first = false;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [entered, zone, map]);

  function onStagePointer(e) {
    if (e.button > 0 || !viewRef.current) return;
    const r = e.currentTarget.getBoundingClientRect(), target = viewRef.current.toWorld(e.clientX - r.left, e.clientY - r.top);
    if (edit) { editAt(target); return; }
    const me = local ? soloPos.current : state.current.players?.find(p => p.id === selfId.current);
    if (!me) return;
    document.activeElement?.blur?.();
    route.current = findPath(map, me, target); marker.current = route.current.at(-1) || null;
  }
  // Mini-room editing: click a placed piece to pick it up, click the floor to put the selected piece down.
  function editAt({ x, y }) {
    const c = Math.floor(x / 16), r = Math.floor(y / 16);
    const hit = edit.placements.find(p => { const [w, h] = ITEMS[p.item].cells; return c >= p.c && c < p.c + w && r >= p.r && r < p.r + h; });
    if (hit && !edit.sel) { setEdit({ placements: edit.placements.filter(p => p !== hit), sel: hit.item }); return; }
    if (!edit.sel) { notify("아래 목록에서 놓을 가구를 고르세요."); return; }
    const [w, h] = ITEMS[edit.sel].cells, next = [...edit.placements.filter(p => p.item !== edit.sel), { item: edit.sel, c: c - Math.floor((w - 1) / 2), r: r - h + 1 }];
    const problem = roomProblem(next, owned);
    if (problem) notify(problem); else setEdit({ placements: next, sel: null });
  }
  async function saveRoom() {
    try { await pb.send("/api/pixeltown/shop/room", { method: "POST", body: { placements: edit.placements } }); await loadRecords(); setEdit(null); notify("미니룸을 저장했어요!"); }
    catch (e) { notify(e.response?.message || "저장하지 못했어요."); }
  }
  async function buy(item) {
    try { await pb.send("/api/pixeltown/shop/buy", { method: "POST", body: { item: item.id } }); await loadRecords(); notify(`${item.name}을(를) 샀어요!`); }
    catch (e) { notify(e.response?.message || "구매하지 못했어요."); }
  }
  async function wear(item) {
    const next = { hat: outfit.hat || null, top: outfit.top || null, pet: outfit.pet || null };
    next[item.slot] = next[item.slot] === item.id ? null : item.id;
    try { await pb.send("/api/pixeltown/shop/equip", { method: "POST", body: next }); await loadRecords(); room.current?.send("look"); }
    catch (e) { notify(e.response?.message || "갈아입지 못했어요."); }
  }
  function sendEmote() {
    if (!local && status !== "online") return;
    emotes.current[selfId.current] = Date.now() + 2500;
    room.current?.send("emote", {});
  }
  function sendChat(e) {
    e.preventDefault();
    const text = chat.trim(); if (!text) return;
    if (local) append({ id: selfId.current, name: solo ? "나그네" : profile?.name || "나", text, mine: true });
    else room.current?.send("chat", { text: text.slice(0, 200) });
    setChat("");
  }
  function logout() {
    room.current?.leave(); room.current = null; pb.authStore.clear();
    setUser(null); setSolo(false); setNotebook(false); setShop(false); setEdit(null); setZone("lobby");
  }

  if (!entered) return <Login {...{ email, setEmail, password, setPassword, busy, error, setError, authenticate, setSolo }} />;

  const game = snap.game || {}, me = snap.players?.find(p => p.id === selfId.current) || { id: selfId.current, name: profile?.name || user?.name || "나그네", color: profile?.color || "#ff9ec4", look: outfit };
  const remaining = Math.max(0, Math.ceil(((game.endsAt || 0) - Date.now()) / 1000)), clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const myScore = game.scores?.[selfId.current] || 0;
  const ranking = Object.entries(game.scores || {}).map(([id, score]) => ({ id, score, name: snap.players?.find(p => p.id === id)?.name || (id === selfId.current ? "나" : "이웃") })).sort((a, b) => b.score - a.score);
  const totalStars = earned;
  const online = snap.players?.length || (local ? 1 : 0);
  const openShop = () => { setShop(true); loadRecords(); };
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
          <div className="row-badges"><span className="stars-badge" title="쓸 수 있는 별">지갑 ★ {wallet}</span>{solo && <span className="tag">연습 모드</span>}</div>
          {zone !== "home" && starCard}
          {!solo && <button className="btn wide" onClick={openShop}>🛍 별 상점 · 옷장</button>}
          <button className="btn ghost wide" onClick={() => { setNotebook(true); loadRecords(); }}>📒 내 수첩</button>
        </aside>
        <section className="room paper">
          <header className="room-title">
            <b className="brand">픽셀타운</b><span className="zone-name">{zoneInfo[1]} {map.title}</span><small className="url">pixel.town/{map.slug}</small>
            <span className={`online ${status}`}>{status === "online" ? `${online}명 접속 중` : zone === "home" ? "나만의 방" : status === "solo" ? "혼자 산책 중" : status === "connecting" ? "연결 중…" : "연결 끊김"}</span>
          </header>
          <div className="stage" onPointerDown={onStagePointer}>
            <canvas ref={canvasRef} className="world" aria-label={`${map.title} 미니룸. 화면을 누르면 그곳으로 걸어가요.`} />
            {zone !== "home" && <div className="strip">{starCard}</div>}
            {edit && <div className="edit-bar" onPointerDown={e => e.stopPropagation()}>
              <p>{edit.sel ? `${ITEMS[edit.sel].name}: 바닥을 눌러 놓기` : "가구를 고르거나, 놓인 가구를 눌러 들기"}</p>
              <div className="edit-items">
                {CATALOG.items.filter(i => i.slot === "furniture" && owned.has(i.id)).map(i => {
                  const placed = edit.placements.some(p => p.item === i.id);
                  return <button key={i.id} className={`edit-item${edit.sel === i.id ? " on" : ""}${placed ? " placed" : ""}`} onClick={() => setEdit({ placements: edit.placements.filter(p => p.item !== i.id), sel: edit.sel === i.id ? null : i.id })} title={placed ? "다시 누르면 들어 올려요" : ""}><ItemIcon item={i} />{i.name}</button>;
                })}
                {!owned.size || !CATALOG.items.some(i => i.slot === "furniture" && owned.has(i.id)) ? <span className="muted">상점에서 가구를 먼저 사 주세요.</span> : null}
              </div>
              <div className="row"><button className="btn small" onClick={saveRoom}>저장</button><button className="btn small ghost" onClick={() => setEdit(null)}>취소</button></div>
            </div>}
            {status === "disconnected" && <div className="notice" role="alert" onPointerDown={e => e.stopPropagation()}>서버 연결이 끊겼어요. <button className="btn small" onClick={() => setUser({ ...user })}>다시 연결</button></div>}
            {!edit && <Chat {...{ chatOpen, setChatOpen, unread, chatOpacity, setChatOpacity, messages, chat, setChat, sendChat, chatInput, keys, route, online, canSend: local || status === "online" }} />}
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
            <button className="btn small blue" onClick={sendEmote} disabled={!local && status !== "online"}>♥ 인사</button>
            {zone === "home" && !edit && <button className="btn small" onClick={() => { setEdit({ placements, sel: null }); route.current = []; marker.current = null; }}>🪑 가구 배치</button>}
            {!solo && <button className="btn small ghost only-compact" onClick={openShop}>🛍 상점</button>}
            <button className="btn small ghost only-compact" onClick={() => { setNotebook(true); loadRecords(); }}>📒 수첩</button>
            <span className="hint"><kbd>WASD</kbd> 걷기 · <kbd>클릭</kbd> 이동 · <kbd>Space</kbd> 인사 · <kbd>Enter</kbd> 채팅</span>
          </footer>
        </section>
        <nav className="tabs" aria-label="장소 이동">
          {ZONES.filter(([id]) => !(solo && id === "home")).map(([id, icon, label]) => <button key={id} aria-pressed={zone === id} onClick={() => goZone(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </nav>
      </div>
      {shop && <Shop {...{ wallet, owned, outfit, buy, wear, me, close: () => setShop(false) }} />}
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

// Small dot preview for a catalogue item (furniture sprite, pet, or the avatar wearing it).
function ItemIcon({ item, player }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, 64, 64);
    const worn = item.slot === "hat" || item.slot === "top";
    const spr = item.slot === "furniture" ? propSprite({ type: item.id }) : item.slot === "pet" ? petSprite(item.id, 0)
      : avatarSprite(lookFor({ ...player, look: { [item.slot]: item.id } }), 0, 0);
    // hats show the head, tops the body (2x, cropped); other items fit the box
    const k = worn ? 2 : Math.max(1, Math.floor(Math.min(64 / spr.width, 64 / spr.height)));
    const y = item.slot === "hat" ? 2 : item.slot === "top" ? 64 - spr.height * k + 4 : Math.floor((64 - spr.height * k) / 2);
    c.drawImage(spr, Math.floor((64 - spr.width * k) / 2), y, spr.width * k, spr.height * k);
  }, [item.id]);
  return <canvas ref={ref} width={64} height={64} className="item-icon" aria-hidden="true" />;
}

function Shop({ wallet, owned, outfit, buy, wear, me, close }) {
  const [tab, setTab] = useState("hat"), [busy, setBusy] = useState("");
  const run = async (id, fn) => { setBusy(id); try { await fn(); } finally { setBusy(""); } };
  return (
    <div className="sheet-backdrop" onClick={close}>
      <aside className="notebook shop paper" role="dialog" aria-label="별 상점" onClick={e => e.stopPropagation()}>
        <div className="notebook-head"><b>🛍 별 상점 · 옷장</b><span className="stars-badge">지갑 ★ {wallet}</span><button className="btn tiny ghost" onClick={close} aria-label="상점 닫기">닫기</button></div>
        <div className="shop-tabs" role="tablist">{SLOTS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
        <div className="notebook-body shop-grid">
          {CATALOG.items.filter(i => i.slot === tab).map(i => {
            const have = owned.has(i.id), worn = outfit[i.slot] === i.id;
            return (
              <div key={i.id} className={`shop-item${worn ? " worn" : ""}`}>
                <ItemIcon item={i} player={me} />
                <b>{i.name}</b>
                {!have ? <button className="btn tiny" disabled={busy === i.id || wallet < i.price} onClick={() => run(i.id, () => buy(i))}>★ {i.price} 사기</button>
                  : i.slot === "furniture" ? <span className="muted">보유 · 미니룸에서 배치</span>
                  : <button className={`btn tiny${worn ? " ghost" : " blue"}`} disabled={busy === i.id} onClick={() => run(i.id, () => wear(i))}>{worn ? "벗기" : i.slot === "pet" ? "데리고 다니기" : "입기"}</button>}
              </div>
            );
          })}
        </div>
        <p className="notebook-foot muted">별은 마을 곳곳에서 모아요. 3분마다 정산되면 지갑에 들어와요.</p>
      </aside>
    </div>
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
          <h4>산 물건 <span>{records.purchases.length}개</span></h4>
          {records.purchases.length ? <p className="owned-list">{records.purchases.map(p => ITEMS[p.item]?.name || p.item).join(" · ")}</p> : <p className="empty">아직 산 물건이 없어요.</p>}
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
