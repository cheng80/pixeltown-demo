import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PocketBase from "pocketbase";
import { Client } from "@colyseus/sdk";
import g11 from "galmuri/dist/Galmuri11.woff2";
import g11b from "galmuri/dist/Galmuri11-Bold.woff2";
import { getMap, moveActor, stepInput, facing, blocked, nearestFree, findPath, portalAt, entryPoint, homeMap, roomProblem, CATALOG, ITEMS, touchesStar, STEP_PER_TICK, TICK_MS, MAX_QUEUED_INPUTS } from "../../shared/world.js";
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
const GUEST_KEY = "pixeltown.guest";
const isTyping = t => ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName) || t?.isContentEditable;

function Portrait({ player, scale = 6, className = "portrait" }) {
  const ref = useRef(null), look = lookFor(player);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, 18 * scale, 31 * scale);
    c.drawImage(avatarSprite(look, 0, 0), 0, 0, 18 * scale, 31 * scale);
    const pet = look.pet && petSprite(look.pet, 0);
    if (pet) c.drawImage(pet, 11 * scale, 19 * scale, 14 * scale * 0.7, 14 * scale * 0.7);
  }, [look.key, look.pet, scale]);
  return <div className={className}><canvas ref={ref} width={18 * scale} height={31 * scale} aria-hidden="true" /></div>;
}

function App() {
  const [user, setUser] = useState(pb.authStore.isValid ? pb.authStore.record : null);
  const [booting, setBooting] = useState(!pb.authStore.isValid); // signing a returning guest in from saved credentials
  const [bootError, setBootError] = useState("");
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
  const [loaded, setLoaded] = useState(false); // records fetched once after login
  const [setup, setSetup] = useState(false); // character set-up opened from the game
  const [shop, setShop] = useState(false);
  const [edit, setEdit] = useState(null); // mini-room furniture editing: { placements, sel }
  const [recordError, setRecordError] = useState("");
  const [toast, setToast] = useState("");
  const [, setNow] = useState(0);
  const canvasRef = useRef(null), viewRef = useRef(null), room = useRef(null), keys = useRef(new Set()), touch = useRef({ dx: 0, dy: 0 });
  // Smooth movement: my avatar is predicted from my own inputs (reconciled with the server's `ack`), drawn with an even
  // per-tick glide; other players are drawn ~100 ms behind server time, interpolated between snapshots.
  const pred = useRef(null), pending = useRef([]), seq = useRef(0), glide = useRef(null), serverClock = useRef({ samples: [], offset: 0 });
  const stall = useRef({ x: 0, y: 0, n: 0 }), route = useRef([]), marker = useRef(null), state = useRef({ players: [], game: {} }), bubbles = useRef({}), emotes = useRef({});
  const trails = useRef({}), selfId = useRef("me"), soloPos = useRef(null), entry = useRef("default"), portalArmed = useRef(false), chatVisible = useRef(chatOpen);
  const [joinTry, setJoinTry] = useState(0), rejoining = useRef(false), lastAutoJoin = useRef(0), [ping, setPing] = useState(null);
  // Stars I collected that are not in my inventory yet (settled every 3 minutes): period id -> my score in it.
  const ledger = useRef({});
  const lastAck = useRef({ ack: -1, at: 0 }); // the latest of my inputs the server has applied, and when that snapshot came
  const picked = useRef({}), corrections = useRef([]), persistStatus = useRef(null), chatInput = useRef(null), lastSent = useRef("");
  const profile = records.profiles[0], outfit = profile?.outfit || {};
  // First entry (FR-014): a signed-in user whose profile has no chosen look makes a character before joining a room.
  const needsSetup = Boolean(user && loaded && profile && !profile.avatar);
  const entered = Boolean(user && loaded && !needsSetup), local = zone === "home", zoneInfo = ZONES.find(z => z[0] === zone);
  const myLook = { ...outfit, ...profile?.avatar };
  const owned = useMemo(() => new Set(records.purchases.map(p => p.item)), [records.purchases]);
  const earned = records.inventory.reduce((n, i) => n + (i.quantity || 0), 0), wallet = earned - records.purchases.reduce((n, p) => n + (p.price || 0), 0);
  // The wallet shows a star the moment the server counts it; the part not saved yet cannot be spent until settlement.
  const savedPeriods = new Set(records.inventory.map(i => i.match_id));
  const unsaved = Object.entries(ledger.current).reduce((n, [id, k]) => n + (savedPeriods.has(id) ? 0 : k), 0);
  // Settlement happens in whichever zone room the stars were collected, maybe one I already left: look for it now and then.
  useEffect(() => {
    if (!unsaved) return;
    const poll = setInterval(loadRecords, 20000);
    return () => clearInterval(poll);
  }, [unsaved > 0]);
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

  // Guests (PLAN-006): the browser keeps a random password; a returning visitor whose token expired signs in again with it.
  useEffect(() => {
    if (pb.authStore.isValid) return;
    const saved = load(GUEST_KEY, null, v => typeof v?.email === "string" && typeof v?.password === "string");
    if (!saved) { setBooting(false); return; }
    const signIn = (n = 0) => pb.collection("users").authWithPassword(saved.email, saved.password)
      .then(r => { setUser(r.record); setBooting(false); })
      .catch(e => {
        if (e.status === 400) { try { localStorage.removeItem(GUEST_KEY); } catch {} setBooting(false); } // account gone: make a new character
        else if (e.status === 429 && n < 5) setTimeout(() => signIn(n + 1), 3000); // shared IP hit the sign-in rate limit
        else setBootError("마을 서버에 연결하지 못했어요. 잠시 뒤 새로고침해 주세요.");
      });
    signIn();
  }, []);
  async function createGuest(body) {
    const password = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
    const r = await pb.send("/api/pixeltown/guest", { method: "POST", body: { ...body, password } }).catch(e => {
      if (e.status === 429) e.response = { message: "이 곳에서 새 캐릭터를 너무 많이 만들었어요. 한 시간쯤 뒤에 다시 시도해 주세요." };
      throw e;
    });
    save(GUEST_KEY, { email: r.record.email, password });
    pb.authStore.save(r.token, r.record); setUser(r.record);
  }
  async function loadRecords() {
    if (!user) return;
    setRecordError("");
    const failed = [];
    const rows = await Promise.all(["profiles", "inventory", "results", "purchases"].map(async col => {
      try { return [col, await pb.collection(col).getFullList({ filter: pb.filter("user = {:id}", { id: user.id }), sort: "-created" })]; }
      catch { failed.push(col); return [col, []]; }
    }));
    setRecords(Object.fromEntries(rows)); setLoaded(true);
    if (failed.length) setRecordError(`${failed.join(", ")} 정보를 불러오지 못했어요.`);
  }
  useEffect(() => { if (user) loadRecords(); }, [user]);

  function goZone(to, via = "default") {
    if (to === zone) return;
    setEdit(null); entry.current = via; route.current = []; marker.current = null; setZone(to);
  }

  // room connection (or local practice)
  useEffect(() => {
    if (!entered) return;
    let cancelled = false, giveUp = null, joined = null;
    setStatus(local ? "home" : rejoining.current ? "reconnecting" : "connecting");
    state.current = { players: [], game: {}, zone }; setSnap(state.current);
    persistStatus.current = null; setMessages([]); setUnread(0);
    picked.current = {}; lastAck.current = { ack: -1, at: 0 }; bubbles.current = {}; emotes.current = {}; keys.current.clear(); touch.current = { dx: 0, dy: 0 };
    route.current = []; portalArmed.current = false; lastSent.current = ""; pred.current = null; pending.current = []; glide.current = null; trails.current = {};
    const via = entry.current; entry.current = "default";
    if (zone === "home") { selfId.current = user.id; soloPos.current = entryPoint(mapRef.current, via); return; }
    // This room's own map: mapRef switches to the next zone on render, before this effect is cleaned up, and a late
    // snapshot replayed on the wrong map snapped the avatar at a doorway.
    const roomMap = getMap(zone);
    // A reload can race the server noticing the previous socket closed (409): retry briefly.
    client.auth.token = pb.authStore.token; // Colyseus 0.18: verified by the room's onAuth, not sent in join options
    const join = (n = 0) => client.joinOrCreate("town", { zone, entry: via })
      .catch(e => (e.code === 409 && n < 6 && !cancelled ? new Promise(r => setTimeout(r, 700)).then(() => join(n + 1)) : Promise.reject(e)));
    // A join that neither succeeds nor fails (network gone mid-handshake) must not leave the dialog spinning.
    const joinTimer = setTimeout(() => { if (!cancelled && !joined) setStatus("disconnected"); }, 15000);
    join().then(r => {
      clearTimeout(joinTimer);
      if (cancelled) { r.leave(); return; }
      joined = r; room.current = r; selfId.current = user.id; rejoining.current = false; setStatus("online");
      // A room being left can still deliver a last snapshot after the next zone's state was reset: ignore it, or its
      // position becomes the new zone's prediction and the avatar slides across the map on arrival.
      r.onMessage("snapshot", data => {
        if (cancelled || data.zone !== zone) return;
        const c = serverClock.current; c.samples.push(Date.now() - data.t); if (c.samples.length > 60) c.samples.shift(); c.offset = Math.min(...c.samples);
        const mine = data.players.find(p => p.id === user.id);
        if (mine) { // server position + my inputs it has not applied yet = where I am now
          pending.current = pending.current.filter(i => i.seq > (mine.ack ?? -1)); lastAck.current = { ack: mine.ack ?? -1, at: Date.now() };
          let p = { x: mine.x, y: mine.y };
          for (const i of pending.current) p = stepInput(roomMap, p, i);
          if (pred.current) { const err = Math.hypot(p.x - pred.current.x, p.y - pred.current.y); if (err > 0.5) { corrections.current.push({ at: Date.now(), err: +err.toFixed(1), ack: mine.ack, pending: pending.current.length, zone, from: [Math.round(pred.current.x), Math.round(pred.current.y)], to: [Math.round(p.x), Math.round(p.y)] }); if (corrections.current.length > 100) corrections.current.shift(); } }
          // Only when the server disagrees: restarting the glide on every snapshot made the per-frame step uneven, and
          // the camera, locked to the avatar, shook (worst on diagonals, both axes at once).
          if (!pred.current || Math.hypot(p.x - pred.current.x, p.y - pred.current.y) > 0.01) setPred(p, !pred.current || Math.hypot(p.x - pred.current.x, p.y - pred.current.y) > 40);
        }
        for (const p of data.players) if (p.id !== user.id) { const b = (trails.current[p.id] ||= []); b.push({ t: data.t, x: p.x, y: p.y }); if (b.length > 40) b.shift(); }
        const my = data.game?.scores?.[user.id];
        if (data.game?.id && my) ledger.current[data.game.id] = Math.max(ledger.current[data.game.id] || 0, my);
        state.current = data; setSnap(data);
        const p = data.persistence;
        if (p?.status === "saved" && persistStatus.current === "pending") { loadRecords(); notify("기록과 별 보상이 저장되었어요! 수첩에서 확인하세요."); }
        persistStatus.current = p?.status;
      });
      r.onMessage("chat", d => !cancelled && append({ id: d.id, name: d.name || "이웃", text: d.text, mine: d.id === user.id }));
      r.onMessage("emote", d => { if (!cancelled) emotes.current[d.id] = Date.now() + 2500; });
      r.onMessage("gameEnded", m => { const n = m.scores?.[user.id]; if (n) ledger.current[m.match_id] = n; if (n) { persistStatus.current = "pending"; notify(`별 ${n}개 정산! 기록을 저장하는 중이에요.`); } });
      // While the socket is down nothing moves or predicts on its own and a dialog blocks the page.
      // 1. Drop: the SDK reconnects into the same server session (kept 15 s), so nothing is lost.
      // 2. That fails (session gone, socket refused) or hangs: join again automatically; the login is still valid.
      // 3. Only if that join fails too (server unreachable) does the dialog show a button.
      const halt = next => { keys.current.clear(); touch.current = { dx: 0, dy: 0 }; route.current = []; marker.current = null; pending.current = []; setStatus(next); };
      let lost = false;
      const joinAgain = () => {
        if (cancelled || lost) return; lost = true; clearTimeout(giveUp); room.current = null;
        // ponytail: one automatic join per 10 s, so a server that keeps closing us cannot loop; then the button
        if (Date.now() - lastAutoJoin.current < 10000) { halt("disconnected"); return; }
        lastAutoJoin.current = Date.now(); rejoining.current = true; halt("reconnecting"); setJoinTry(n => n + 1);
      };
      r.reconnection.maxRetries = 6;
      r.onDrop(() => {
        if (cancelled) return;
        room.current = null; halt("reconnecting");
        clearTimeout(giveUp); giveUp = setTimeout(joinAgain, 15000); // a retry that never opens or closes (network gone)
      });
      r.onReconnect(() => { if (!cancelled) { clearTimeout(giveUp); room.current = r; lastSent.current = ""; setStatus("online"); } });
      r.onLeave(joinAgain);
      r.onError((code, message) => { if (!cancelled) console.warn(`room error ${code}: ${message}`); });
    }).catch(e => { clearTimeout(joinTimer); if (!cancelled) { setStatus("disconnected"); notify(`마을 연결 실패: ${e.message}`); } });
    return () => {
      cancelled = true; clearTimeout(giveUp); clearTimeout(joinTimer);
      if (joined && joined !== room.current) { joined.reconnection.maxRetries = 0; try { joined.connection?.close(); } catch {} } // stop a dropped room's retries
      room.current?.leave(); room.current = null;
    };
  }, [entered, user, zone, joinTry]);

  // Round trip to the game server every 2 s, shown next to the player count (green / yellow / red).
  useEffect(() => {
    if (status !== "online") { setPing(null); return; }
    const measure = () => room.current?.ping(ms => setPing(Math.round(ms)));
    measure(); const timer = setInterval(measure, 2000);
    return () => clearInterval(timer);
  }, [status, zone, joinTry]);

  // input: keyboard / d-pad / click route, sent to the server every tick
  useEffect(() => {
    if (!entered) return;
    const down = e => {
      if (isTyping(e.target) || (!local && status !== "online")) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS[k]) { e.preventDefault(); keys.current.add(k); route.current = []; marker.current = null; }
      else if (k === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); if (!e.repeat) sendEmote(); }
      else if (k === "enter") { e.preventDefault(); setChatOpen(true); setTimeout(() => chatInput.current?.focus(), 0); }
    };
    const up = e => keys.current.delete(e.key.toLowerCase());
    const reset = () => { keys.current.clear(); touch.current = { dx: 0, dy: 0 }; };
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", reset); document.addEventListener("visibilitychange", reset);
    const tick = setInterval(() => {
      const m = local ? mapRef.current : getMap(zone), s = state.current; // see roomMap: never the next zone's map
      let dx = touch.current.dx, dy = touch.current.dy, to = null;
      for (const k of keys.current) if (MOVE_KEYS[k]) { dx += MOVE_KEYS[k][0]; dy += MOVE_KEYS[k][1]; }
      const me = local ? soloPos.current : pred.current;
      if (!me) return;
      if (!dx && !dy && route.current.length) {
        // Re-plan from where the avatar really is when it has not moved for half a second (lag or a corner pushed it off the line).
        const moved = Math.hypot(me.x - stall.current.x, me.y - stall.current.y) > 0.5;
        stall.current = { x: me.x, y: me.y, n: moved ? 0 : stall.current.n + 1 };
        if (stall.current.n >= 10) { route.current = findPath(m, me, route.current.at(-1)); stall.current.n = 0; }
        while (route.current.length && Math.hypot(route.current[0].x - me.x, route.current[0].y - me.y) < 2) route.current.shift();
        if (route.current.length) { dx = route.current[0].x - me.x; dy = route.current[0].y - me.y; if (route.current.length === 1) to = route.current[0]; }
        else marker.current = null;
      }
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) { dx /= len; dy /= len; } else { dx = 0; dy = 0; }
      if (local) {
        if (blocked(m, me.x, me.y)) Object.assign(soloPos.current, nearestFree(m, me.x, me.y)); // furniture placed on top of me
        if (dx || dy) { Object.assign(soloPos.current, moveActor(m, me.x, me.y, dx, dy, STEP_PER_TICK)); setPred(soloPos.current); }
        s.players = [{ id: user.id, name: profileRef.current?.name || user.name || "나", color: profileRef.current?.color, look: { ...profileRef.current?.outfit, ...profileRef.current?.avatar }, ...soloPos.current }];
        setSnap({ ...s });
      } else if (room.current && pending.current.length >= MAX_QUEUED_INPUTS - 4) {
        // The server has not confirmed ~3 s of steps (the connection stalled): wait in place instead of predicting further
        // ahead. Past the server's queue the oldest steps would be dropped and the avatar would snap back when it resumes.
      } else if (room.current) {
        const msg = `${dx.toFixed(2)},${dy.toFixed(2)}`;
        // On the last leg the server steers to `to` itself and stops on it, so lag cannot carry the avatar past the click.
        if (dx || dy || msg !== lastSent.current) {
          const input = { dx, dy, seq: ++seq.current, ...(to ? { to: { x: to.x, y: to.y } } : {}) };
          room.current.send("input", input);
          pending.current.push(input);
          setPred(stepInput(m, me, input)); // show the step now; the server confirms it with `ack`
        }
        lastSent.current = msg;
      }
      // doorway mats: only after stepping off the arrival mat once
      const portal = portalAt(m, me.x, me.y);
      if (!portal) portalArmed.current = true;
      else if (portalArmed.current && (local || status === "online")) { portalArmed.current = false; goZone(portal.to, portal.entry); }
    }, TICK_MS);
    return () => { clearInterval(tick); removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", reset); document.removeEventListener("visibilitychange", reset); };
  }, [entered, user, zone, status, local]);

  // render loop
  useEffect(() => {
    if (!entered || !canvasRef.current) return;
    const view = (viewRef.current = createView(canvasRef.current)), sc = scene(map), anim = new Map();
    let raf, last = performance.now();
    window.__pixeltown = { view, zone, anim, state, route, marker, picked, corrections, pending, self: selfId }; // read-only hooks for UI verification scripts
    const frame = t => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const s = state.current, now = Date.now(), avatars = [], renderT = now - serverClock.current.offset - 100;
      for (const p of s.players || []) {
        let a = anim.get(p.id);
        if (!a) { a = { x: p.x, y: p.y, dir: 0, walk: 0, moving: 0 }; anim.set(p.id, a); }
        const target = p.id === selfId.current ? glidePos(performance.now()) || p : trailPos(trails.current[p.id], renderT) || p;
        const ddx = target.x - a.x, ddy = target.y - a.y, dist = Math.hypot(ddx, ddy);
        a.x = target.x; a.y = target.y;
        if (dist > 0.05) { // average the last few frames so tiny per-frame differences cannot flip the sprite
          a.vx = (a.vx || 0) * 0.75 + ddx * 0.25; a.vy = (a.vy || 0) * 0.75 + ddy * 0.25;
          a.dir = facing(a.vx, a.vy); a.moving = now + 120;
        }
        if (a.moving > now) a.walk += dist; else a.walk = 0;
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
      // The server picks stars up from its own positions; the screen hides a star the moment the drawn avatar touches it
      // and shows it again if the server still has it a second later.
      const stars = s.game?.active ? (s.game.stars || []).filter(star => {
        // Hidden from the touch until the server has applied my steps up to that moment; only if the star is still there
        // half a second after that (someone else was first, or the server saw me miss it) does it show again. A fixed
        // timer showed it again on a slow connection, where the server reaches the star seconds after the screen does.
        const p = picked.current[star.id];
        if (p) { const a = lastAck.current; if (p.ackAt === undefined && a.at > p.at && a.ack >= p.seq) p.ackAt = now; return p.ackAt !== undefined && now - p.ackAt > 500; }
        if (me && touchesStar(me, star)) { picked.current[star.id] = { seq: seq.current, at: now, x: star.x, y: star.y }; return false; }
        return true;
      }) : [];
      const pops = Object.values(picked.current).filter(p => now - p.at < 800);
      view.draw(sc, { focus: me, avatars, stars, pops, time: t, dt, marker: marker.current });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [entered, zone, map]);

  // My drawn position glides evenly from where it was to the latest prediction over one server tick.
  function setPred(p, jump = false) {
    const at = performance.now(), from = jump ? p : glidePos(at) || p;
    pred.current = { x: p.x, y: p.y }; glide.current = { from, to: pred.current, at };
  }
  function glidePos(t) {
    const g = glide.current; if (!g) return null;
    const k = Math.min(1, (t - g.at) / TICK_MS);
    return { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k };
  }
  function trailPos(b, t) { // linear interpolation between the two server samples around t
    if (!b?.length) return null;
    if (t <= b[0].t) return b[0];
    for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= t) {
      const q = b[i - 1], r = b[i]; if (t >= r.t) return r;
      const k = (t - q.t) / (r.t - q.t); return { x: q.x + (r.x - q.x) * k, y: q.y + (r.y - q.y) * k };
    }
    return b[b.length - 1];
  }
  function onStagePointer(e) {
    if (e.button > 0 || !viewRef.current) return;
    const r = e.currentTarget.getBoundingClientRect(), target = viewRef.current.toWorld(e.clientX - r.left, e.clientY - r.top);
    if (edit) { editAt(target); return; }
    const me = local ? soloPos.current : pred.current;
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
    if (local) append({ id: selfId.current, name: profile?.name || "나", text, mine: true });
    else room.current?.send("chat", { text: text.slice(0, 200) });
    setChat("");
  }
  async function saveCharacter(body) {
    await pb.send("/api/pixeltown/profile", { method: "POST", body });
    await loadRecords(); room.current?.send("look"); setSetup(false);
  }

  if (!entered) {
    if (!user && !booting) return <main className="page"><CharacterSetup profile={null} userId={null} save={createGuest} /></main>;
    if (needsSetup) return <main className="page"><CharacterSetup profile={profile} userId={user.id} save={saveCharacter} /></main>;
    return <main className="page"><p className="loading paper" role="status">{bootError || recordError || "내 미니홈피를 여는 중…"}</p></main>;
  }

  const game = snap.game || {}, me = snap.players?.find(p => p.id === selfId.current) || { id: selfId.current, name: profile?.name || user?.name || "나그네", color: profile?.color || "#ff9ec4", look: myLook };
  const remaining = Math.max(0, Math.ceil(((game.endsAt || 0) - Date.now()) / 1000)), clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const myScore = game.scores?.[selfId.current] || 0;
  const ranking = Object.entries(game.scores || {}).map(([id, score]) => ({ id, score, name: snap.players?.find(p => p.id === id)?.name || (id === selfId.current ? "나" : "이웃") })).sort((a, b) => b.score - a.score);
  const totalStars = earned;
  const online = snap.players?.length || (local ? 1 : 0);
  const openShop = () => { setShop(true); loadRecords(); };
  const saving = snap.persistence?.status === "pending";
  const starCard = (
    <section className="star-card" aria-label="별 모으기">
      <div className="star-card-head"><b>★ 별 모으기</b><span className="muted">상시 이벤트</span></div>
      <p className="star-line">지갑 ★ <b className="wallet-live">{wallet + unsaved}</b>{unsaved > 0 && <span className="pending" title="정산되면 상점에서 쓸 수 있어요"> (정산 대기 {unsaved})</span>} · 이번 판 {myScore}개 · 맵의 별 {game.stars?.length || 0}/12</p>
      <p className="star-line muted">{game.active ? `다음 정산까지 ${clock}` : "별 가까이 걸어가면 모아요"}</p>
      {ranking.length > 0 && <ol className="ranking">{ranking.slice(0, 3).map(p => <li key={p.id} className={p.id === selfId.current ? "mine" : ""}><span>{ranking.filter(q => q.score > p.score).length + 1}</span>{p.name}<b>{p.score}★</b></li>)}</ol>}
      {saving && <p className="save-state" role="status">{snap.persistence.lastError ? "기록 저장 재시도 중…" : "기록 저장 중…"}</p>}
    </section>
  );
  return (
    <main className="page">
      <div className="hompy">
        <aside className="profile paper">
          <div className="today">TODAY <b>{online}</b> <span>|</span> TOTAL <b>{totalStars + unsaved}</b></div>
          <Portrait player={me} />
          <h2 className="me-name">{me.name}</h2>
          <p className="mood">♪ {zoneInfo[3]}</p>
          <div className="row-badges"><span className="stars-badge" title={unsaved ? `쓸 수 있는 별 ${wallet} + 정산 대기 ${unsaved}` : "쓸 수 있는 별"}>지갑 ★ {wallet + unsaved}</span></div>
          {zone !== "home" && starCard}
          <button className="btn wide" onClick={openShop}>🛍 별 상점 · 옷장</button>
          <button className="btn ghost wide" onClick={() => setSetup(true)}>🎨 캐릭터 꾸미기</button>
          <button className="btn ghost wide" onClick={() => { setNotebook(true); loadRecords(); }}>📒 내 수첩</button>
        </aside>
        <section className="room paper">
          <header className="room-title">
            <b className="brand">픽셀타운</b><span className="zone-name">{zoneInfo[1]} {map.title}</span><small className="url">pixel.town/{map.slug}</small>
            <span className={`online ${status}`}>{status === "online" ? `${online}명 접속 중` : zone === "home" ? "나만의 방" : status === "connecting" ? "연결 중…" : "연결 끊김"}</span>
            {ping !== null && <span className={`ping ${ping < 150 ? "good" : ping < 400 ? "slow" : "bad"}`} title="게임 서버까지 왕복 시간">핑 {ping}ms</span>}
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
            <button className="btn small ghost only-compact" onClick={openShop}>🛍 상점</button>
            <button className="btn small ghost only-compact" onClick={() => { setNotebook(true); loadRecords(); }}>📒 수첩</button>
            <span className="hint"><kbd>WASD</kbd> 걷기 · <kbd>클릭</kbd> 이동 · <kbd>Space</kbd> 인사 · <kbd>Enter</kbd> 채팅</span>
          </footer>
        </section>
        <nav className="tabs" aria-label="장소 이동">
          {ZONES.map(([id, icon, label]) => <button key={id} aria-pressed={zone === id} onClick={() => goZone(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </nav>
      </div>
      {(status === "disconnected" || status === "reconnecting") && !local && <div className="sheet-backdrop offline">
        <div className="notebook paper" role="alertdialog" aria-modal="true" aria-labelledby="offline-title">
          <div className="notebook-head"><b id="offline-title">{status === "reconnecting" ? "서버에 다시 연결하는 중…" : "서버 연결이 끊겼어요"}</b></div>
          <p className="notebook-body">연결될 때까지 이동·채팅·장소 이동을 할 수 없어요.</p>
          {status === "disconnected" && <div className="notebook-foot"><button className="btn wide" autoFocus onClick={() => { rejoining.current = true; setJoinTry(n => n + 1); }}>다시 연결</button></div>}
        </div>
      </div>}
      {shop && <Shop {...{ wallet, unsaved, owned, outfit, buy, wear, me, close: () => setShop(false) }} />}
      {notebook && <Notebook {...{ records, recordError, loadRecords, me, close: () => setNotebook(false) }} />}
      {setup && <CharacterSetup profile={profile} userId={user.id} save={saveCharacter} close={() => setSetup(false)} />}
    </main>
  );
}

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

function Shop({ wallet, unsaved, owned, outfit, buy, wear, me, close }) {
  const [tab, setTab] = useState("hat"), [busy, setBusy] = useState("");
  const run = async (id, fn) => { setBusy(id); try { await fn(); } finally { setBusy(""); } };
  return (
    <div className="sheet-backdrop" onClick={close}>
      <aside className="notebook shop paper" role="dialog" aria-label="별 상점" onClick={e => e.stopPropagation()}>
        <div className="notebook-head"><b>🛍 별 상점 · 옷장</b><span className="stars-badge" title="쓸 수 있는 별">지갑 ★ {wallet}</span><button className="btn tiny ghost" onClick={close} aria-label="상점 닫기">닫기</button></div>
        {unsaved > 0 && <p className="shop-pending">정산 대기 ★{unsaved}: 3분마다 정산되면 쓸 수 있어요.</p>}
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

function Notebook({ records, recordError, loadRecords, me, close }) {
  return (
    <div className="sheet-backdrop" onClick={close}>
      <aside className="notebook paper" role="dialog" aria-label="내 수첩" onClick={e => e.stopPropagation()}>
        <div className="notebook-head"><b>📒 나의 미니 수첩</b><button className="btn tiny ghost" onClick={close} aria-label="수첩 닫기">닫기</button></div>
        <div className="notebook-body">
          <div className="nb-profile"><Portrait player={me} scale={3} className="portrait small" /><div><h3>{records.profiles[0]?.name || me.name}</h3><p>이 브라우저에 저장된 내 캐릭터</p></div></div>
          <h4>별 보상 <span>{records.inventory.reduce((n, i) => n + (i.quantity || 0), 0)}개</span></h4>
          {records.inventory.length ? records.inventory.slice(0, 20).map(i => <div className="record" key={i.id}><span>★ 별 조각</span><b>×{i.quantity ?? 0}</b></div>) : <p className="empty">아직 모은 별이 없어요.</p>}
          <h4>산 물건 <span>{records.purchases.length}개</span></h4>
          {records.purchases.length ? <p className="owned-list">{records.purchases.map(p => ITEMS[p.item]?.name || p.item).join(" · ")}</p> : <p className="empty">아직 산 물건이 없어요.</p>}
          <h4>최근 기록</h4>
          {records.results.length ? records.results.slice(0, 10).map(r => <div className="record" key={r.id}><span>{({ lobby: "광장", garden: "정원", arcade: "오락실" })[r.zone] || r.zone}<small>{new Date(r.ended_at || r.created).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small></span><b>{r.score ?? 0}점</b></div>) : <p className="empty">첫 번째 별 모으기에 도전해 보세요.</p>}
          {recordError && <p className="error" role="alert">{recordError}</p>}
        </div>
        <div className="notebook-foot"><button className="btn small ghost" onClick={loadRecords}>새로고침</button></div>
      </aside>
    </div>
  );
}

// Character set-up (FR-014): nickname, skin, hair colour and style, shirt colour. The PB hook re-checks every value.
function CharacterSetup({ profile, userId, save, close }) {
  const A = CATALOG.avatar, cur = profile?.avatar || {};
  const [name, setName] = useState(profile?.name || "");
  const [color, setColor] = useState(A.shirts.includes(profile?.color) ? profile.color : A.shirts[0]);
  const [look, setLook] = useState({ skin: cur.skin ?? 0, hair: cur.hair ?? 0, style: cur.style ?? 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [nameError, setNameError] = useState(""), nameInput = useRef(null);
  const length = [...name.trim()].length, nameOk = length >= A.nameMin && length <= A.nameMax;
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(""); setNameError("");
    try { await save({ name: name.trim(), color, avatar: look }); }
    catch (err) {
      // A taken nickname comes back as { data: { name: "taken" } }: point at the field so the player picks another name.
      if (err.response?.data?.name) { setNameError(err.response.message); nameInput.current?.focus(); }
      else setError(err.response?.message || "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
    finally { setBusy(false); }
  }
  const swatches = (label, colors, selected, pick) => (
    <fieldset className="swatches"><legend>{label}</legend>
      {colors.map((c, i) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-label={`${label} ${i + 1}`} aria-pressed={selected === i} onClick={() => pick(i)} />)}
    </fieldset>
  );
  return (
    <div className="sheet-backdrop" onClick={close}>
      <form className="notebook setup paper" role="dialog" aria-label={close ? "캐릭터 꾸미기" : "캐릭터 만들기"} onSubmit={submit} onClick={e => e.stopPropagation()}>
        {!userId && <header className="setup-brand"><h1 className="logo">PIXEL TOWN</h1><p className="tagline">미니홈피 속 작은 마을을 걷고, 이웃과 수다 떨고, 별을 모아요 ♥</p></header>}
        <div className="notebook-head"><b>🎨 {close ? "캐릭터 꾸미기" : "내 캐릭터 만들기"}</b>{close && <button type="button" className="btn tiny ghost" onClick={close}>닫기</button>}</div>
        <div className="notebook-body setup-body">
          <Portrait player={{ id: userId || "new-guest", color, look: { ...profile?.outfit, ...look } }} scale={5} />
          <div className="setup-fields">
            <label className="field">닉네임<input ref={nameInput} value={name} maxLength={A.nameMax} onChange={e => { setName(e.target.value); setNameError(""); }} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "name-error" : "name-hint"} autoFocus={!close} /></label>
            {nameError ? <p id="name-error" className="error" role="alert">{nameError}</p> : <small id="name-hint" className="muted">{A.nameMin}–{A.nameMax}자 · 한글·영문·숫자 · 띄어쓰기·대소문자·_·-만 다른 이름은 같은 이름이에요</small>}
            {swatches("피부", A.skins, look.skin, i => setLook({ ...look, skin: i }))}
            {swatches("머리 색", A.hairs, look.hair, i => setLook({ ...look, hair: i }))}
            <fieldset className="swatches"><legend>머리 모양</legend>
              {A.styles.map((label, i) => <button type="button" key={label} className="btn tiny ghost" aria-pressed={look.style === i} onClick={() => setLook({ ...look, style: i })}>{label}</button>)}
            </fieldset>
            {swatches("옷 색", A.shirts, A.shirts.indexOf(color), i => setColor(A.shirts[i]))}
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        </div>
        <div className="notebook-foot"><span className="muted">{close ? "모자·옷·펫은 별 상점에서 사요." : userId ? "나중에 언제든 바꿀 수 있어요." : "입장하면 이 브라우저에 내 캐릭터가 저장돼요."}</span><button className="btn" disabled={busy || !nameOk}>{busy ? "저장 중…" : close ? "저장" : "이대로 입장 ▶"}</button></div>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
