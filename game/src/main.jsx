import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PocketBase from "pocketbase";
import { Client } from "@colyseus/sdk";
import g11 from "galmuri/dist/Galmuri11.woff2";
import g11b from "galmuri/dist/Galmuri11-Bold.woff2";
import { getMap, stepInput, routeStep, facing, blocked, nearestFree, findPath, portalAt, entryPoint, homeMap, roomProblem, CATALOG, ITEMS, touchesStar, TICK_MS } from "../../shared/world.js";
import { scene, createView } from "./render.js";
import { feed, play } from "./playback.js";
import { lookFor } from "./sprites.js";
import { ZONES } from "./zones.js";
import { ItemIcon, Portrait, Sheet } from "./components/Pixels.jsx";
import { Chat } from "./components/Chat.jsx";
import { Shop } from "./components/Shop.jsx";
import { Notebook } from "./components/Notebook.jsx";
import { CharacterSetup } from "./components/CharacterSetup.jsx";
import "./style.css";

for (const [src, weight] of [[g11, "400"], [g11b, "700"]]) {
  const face = new FontFace("Galmuri11", `url(${src})`, { weight });
  document.fonts.add(face); face.load().catch(() => {});
}
const pb = new PocketBase(import.meta.env.VITE_PB_URL || "http://127.0.0.1:18090");
pb.autoCancellation(false);
const client = new Client(import.meta.env.VITE_GAME_URL || "ws://127.0.0.1:12567");
const MOVE_KEYS = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
const load = (key, fallback, ok) => { try { const v = JSON.parse(localStorage.getItem(key)); return ok(v) ? v : fallback; } catch { return fallback; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
const GUEST_KEY = "pixeltown.guest";
const isTyping = t => ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName) || t?.isContentEditable;
// useState kept in localStorage (per-viewer convenience: chat panel open, its opacity).
function useStored(key, fallback, ok) {
  const [v, setV] = useState(() => load(key, fallback, ok));
  useEffect(() => save(key, v), [key, v]);
  return [v, setV];
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
  const [chatOpen, setChatOpen] = useStored("pixeltown.chatOpen", window.innerWidth >= 900, v => typeof v === "boolean");
  const [unread, setUnread] = useState(0);
  const [chatOpacity, setChatOpacity] = useStored("pixeltown.chatOpacity", 72, v => Number.isInteger(v) && v >= 20 && v <= 95);
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
  // Local-first movement: the browser moves my avatar itself and reports each step; the server only checks it and sends it
  // back (`fix`) if a step was impossible. Drawn with an even per-tick glide; other players are replayed step by step
  // (playback.js).
  const pred = useRef(null), fix = useRef(0), seq = useRef(0), glide = useRef(null);
  // Arriving in a room shows me on its doorway at once and lets me walk while the room is still being joined (about 2 s
  // on the slow route); those steps are sent as soon as it is. ponytail: 60 steps (3 s), within the server's saved allowance.
  const early = useRef(null);
  const stall = useRef({ x: 0, y: 0, n: 0 }), route = useRef([]), marker = useRef(null), state = useRef({ players: [], game: {} }), bubbles = useRef({}), emotes = useRef({});
  const trails = useRef({}), selfId = useRef("me"), soloPos = useRef(null), entry = useRef("default"), portalArmed = useRef(false), chatVisible = useRef(chatOpen);
  const [joinTry, setJoinTry] = useState(0), rejoining = useRef(false), lastAutoJoin = useRef(0), [ping, setPing] = useState(null);
  // Stars I collected that are not in my inventory yet (settled every 3 minutes): period id -> my score in it.
  const ledger = useRef({});
  const lastAck = useRef({ ack: -1, at: 0 }); // the latest of my steps the server has accepted, and when that snapshot came
  const picked = useRef({}), corrections = useRef([]), persistStatus = useRef(null), chatInput = useRef(null);
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
  const clearRoute = () => { route.current = []; marker.current = null; };
  const stopInput = () => { keys.current.clear(); touch.current = { dx: 0, dy: 0 }; };
  const canAct = local || status === "online";
  const append = m => {
    if (!chatVisible.current && !m.mine) setUnread(n => n + 1);
    setMessages(a => [...a.slice(-79), { ...m, key: `${Date.now()}-${Math.random()}` }]);
    if (m.id) bubbles.current[m.id] = { text: m.text, until: Date.now() + 4000 };
  };
  useEffect(() => { chatVisible.current = chatOpen; if (chatOpen) setUnread(0); }, [chatOpen]);
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
    setEdit(null); entry.current = via; clearRoute(); setZone(to);
  }

  // room connection (or local practice)
  useEffect(() => {
    if (!entered) return;
    let cancelled = false, giveUp = null, joined = null;
    setStatus(local ? "home" : rejoining.current ? "reconnecting" : "connecting");
    persistStatus.current = null; setMessages([]); setUnread(0);
    picked.current = {}; lastAck.current = { ack: -1, at: 0 }; bubbles.current = {}; emotes.current = {}; stopInput();
    route.current = []; portalArmed.current = false; pred.current = null; glide.current = null; trails.current = {};
    const via = entry.current; entry.current = "default";
    selfId.current = user.id; early.current = null;
    if (zone === "home") { soloPos.current = entryPoint(mapRef.current, via); state.current = { players: [mePlayer(soloPos.current)], game: {}, zone }; setSnap(state.current); return; }
    // The server puts me on the same doorway spot (or one step aside when someone stands there: its first snapshot moves me).
    const door = entryPoint(getMap(zone), via), seq0 = seq.current;
    fix.current = 0; early.current = []; setPred(door, true);
    state.current = { players: [mePlayer(door)], game: {}, zone }; setSnap(state.current);
    // A reload can race the server noticing the previous socket closed (409): retry briefly.
    client.auth.token = pb.authStore.token; // Colyseus 0.18: verified by the room's onAuth, not sent in join options
    const join = (n = 0) => client.joinOrCreate("town", { zone, entry: via })
      .catch(e => (e.code === 409 && n < 6 && !cancelled ? new Promise(r => setTimeout(r, 700)).then(() => join(n + 1)) : Promise.reject(e)));
    // A join that neither succeeds nor fails (network gone mid-handshake) must not leave the dialog spinning.
    const joinTimer = setTimeout(() => { if (!cancelled && !joined) setStatus("disconnected"); }, 15000);
    join().then(r => {
      clearTimeout(joinTimer);
      if (cancelled) { r.leave(); return; }
      joined = r; room.current = r; rejoining.current = false; setStatus("online");
      for (const step of early.current || []) r.send("move", step);
      early.current = null;
      // A room being left can still deliver a last snapshot after the next zone's state was reset: ignore it, or its
      // position becomes the new zone's prediction and the avatar slides across the map on arrival.
      r.onMessage("snapshot", data => {
        if (cancelled || data.zone !== zone) return;
        const mine = data.players.find(p => p.id === user.id);
        if (mine) { // my own position comes from the server only on arrival and when it refused a step (`fix` went up)
          lastAck.current = { ack: mine.ack ?? -1, at: Date.now() };
          const placed = mine.ack === undefined && seq.current === seq0; // arrived and not walked yet: stand where the server put me
          if (!pred.current || mine.fix !== fix.current || placed) {
            const err = pred.current ? Math.hypot(mine.x - pred.current.x, mine.y - pred.current.y) : 0;
            if (pred.current && !placed) { corrections.current.push({ at: Date.now(), err: +err.toFixed(1), ack: mine.ack, zone, from: [Math.round(pred.current.x), Math.round(pred.current.y)], to: [Math.round(mine.x), Math.round(mine.y)] }); if (corrections.current.length > 100) corrections.current.shift(); }
            fix.current = mine.fix; setPred({ x: mine.x, y: mine.y }, !pred.current || err > 40);
          }
        }
        for (const p of data.players) if (p.id !== user.id) feed(trails.current[p.id] ||= {}, p, performance.now());
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
      const halt = next => { stopInput(); clearRoute(); setStatus(next); };
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
      r.onReconnect(() => { if (!cancelled) { clearTimeout(giveUp); room.current = r; setStatus("online"); } });
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

  // input: keyboard / d-pad / click route, one step per tick, each step reported to the server
  useEffect(() => {
    if (!entered) return;
    const down = e => {
      if (isTyping(e.target) || (!local && status !== "online" && status !== "connecting")) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS[k]) { e.preventDefault(); keys.current.add(k); clearRoute(); }
      else if (k === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); if (!e.repeat) sendEmote(); }
      else if (k === "enter") { e.preventDefault(); setChatOpen(true); setTimeout(() => chatInput.current?.focus(), 0); }
    };
    const up = e => keys.current.delete(e.key.toLowerCase());
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", stopInput); document.addEventListener("visibilitychange", stopInput);
    const tick = setInterval(() => {
      const m = local ? mapRef.current : getMap(zone), s = state.current; // this room's own map: mapRef switches to the next zone first
      let dx = touch.current.dx, dy = touch.current.dy, routed = false;
      for (const k of keys.current) if (MOVE_KEYS[k]) { dx += MOVE_KEYS[k][0]; dy += MOVE_KEYS[k][1]; }
      const me = myPos();
      if (!me) return;
      if (!dx && !dy && route.current.length) {
        // Re-plan from where the avatar really is when it has not moved for half a second (lag or a corner pushed it off the line).
        const moved = Math.hypot(me.x - stall.current.x, me.y - stall.current.y) > 0.5;
        stall.current = { x: me.x, y: me.y, n: moved ? 0 : stall.current.n + 1 };
        if (stall.current.n >= 10) { route.current = findPath(m, me, route.current.at(-1)); stall.current.n = 0; }
        routed = true;
      }
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) { dx /= len; dy /= len; } else { dx = 0; dy = 0; }
      const walk = () => { const q = routed ? routeStep(m, me, route.current) : stepInput(m, me, { dx, dy }); if (routed && !route.current.length) marker.current = null; return q; };
      if (local) {
        if (blocked(m, me.x, me.y)) Object.assign(soloPos.current, nearestFree(m, me.x, me.y)); // furniture placed on top of me
        if (dx || dy || routed) { Object.assign(soloPos.current, walk()); setPred(soloPos.current); }
        s.players = [mePlayer(soloPos.current)];
        setSnap({ ...s });
      } else if ((room.current || (status === "connecting" && early.current?.length < 60)) && (dx || dy || routed)) {
        // Lag never holds the avatar back or pulls it back: the step is mine at once, the server only checks it.
        const next = walk();
        if (next.x !== me.x || next.y !== me.y) {
          const step = { ...next, seq: ++seq.current, fix: fix.current };
          if (room.current) room.current.send("move", step); else early.current.push(step);
          setPred(next);
        }
      }
      // doorway mats: only after stepping off the arrival mat once
      const portal = portalAt(m, me.x, me.y);
      if (!portal) portalArmed.current = true;
      else if (portalArmed.current && (local || status === "online")) { portalArmed.current = false; goZone(portal.to, portal.entry); }
    }, TICK_MS);
    return () => { clearInterval(tick); removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", stopInput); document.removeEventListener("visibilitychange", stopInput); };
  }, [entered, user, zone, status, local]);

  // render loop
  useEffect(() => {
    if (!entered || !canvasRef.current) return;
    const view = (viewRef.current = createView(canvasRef.current)), sc = scene(map), anim = new Map();
    let raf, last = performance.now();
    window.__pixeltown = { view, zone, anim, state, route, marker, picked, corrections, self: selfId }; // read-only hooks for UI verification scripts
    const frame = t => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const s = state.current, now = Date.now(), avatars = [];
      for (const p of s.players || []) {
        let a = anim.get(p.id);
        if (!a) { a = { x: p.x, y: p.y, dir: 0, walk: 0, moving: 0 }; anim.set(p.id, a); }
        const target = p.id === selfId.current ? glidePos(performance.now()) || p : (trails.current[p.id]?.pts ? play(trails.current[p.id], dt * 1000) : p);
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
  function myPos() { return local ? soloPos.current : pred.current; }
  function mePlayer(pos) {
    const pr = profileRef.current;
    return { id: user.id, name: pr?.name || user.name || "나", color: pr?.color, look: { ...pr?.outfit, ...pr?.avatar }, x: pos.x, y: pos.y };
  }
  function glidePos(t) {
    const g = glide.current; if (!g) return null;
    const k = Math.min(1, (t - g.at) / TICK_MS);
    return { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k };
  }
  function onStagePointer(e) {
    if (e.button > 0 || !viewRef.current) return;
    const r = e.currentTarget.getBoundingClientRect(), target = viewRef.current.toWorld(e.clientX - r.left, e.clientY - r.top);
    if (edit) { editAt(target); return; }
    const me = myPos();
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
  // Shop hook call: on success reload my records and run `done`, on failure show the hook's message.
  async function shopPost(path, body, done, failed) {
    try { await pb.send(`/api/pixeltown/shop/${path}`, { method: "POST", body }); await loadRecords(); done(); }
    catch (e) { notify(e.response?.message || failed); }
  }
  const saveRoom = () => shopPost("room", { placements: edit.placements }, () => { setEdit(null); notify("미니룸을 저장했어요!"); }, "저장하지 못했어요.");
  const buy = item => shopPost("buy", { item: item.id }, () => notify(`${item.name}을(를) 샀어요!`), "구매하지 못했어요.");
  function wear(item) {
    const next = { hat: outfit.hat || null, top: outfit.top || null, pet: outfit.pet || null };
    next[item.slot] = next[item.slot] === item.id ? null : item.id;
    return shopPost("equip", next, () => room.current?.send("look"), "갈아입지 못했어요.");
  }
  function sendEmote() {
    if (!canAct) return;
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
  const online = snap.players?.length || (local ? 1 : 0);
  const openShop = () => { setShop(true); loadRecords(); }, openNotebook = () => { setNotebook(true); loadRecords(); };
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
          <div className="today">TODAY <b>{online}</b> <span>|</span> TOTAL <b>{earned + unsaved}</b></div>
          <Portrait player={me} />
          <h2 className="me-name">{me.name}</h2>
          <p className="mood">♪ {zoneInfo[3]}</p>
          <div className="row-badges"><span className="stars-badge" title={unsaved ? `쓸 수 있는 별 ${wallet} + 정산 대기 ${unsaved}` : "쓸 수 있는 별"}>지갑 ★ {wallet + unsaved}</span></div>
          {zone !== "home" && starCard}
          <button className="btn wide" onClick={openShop}>🛍 별 상점 · 옷장</button>
          <button className="btn ghost wide" onClick={() => setSetup(true)}>🎨 캐릭터 꾸미기</button>
          <button className="btn ghost wide" onClick={openNotebook}>📒 내 수첩</button>
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
            {!edit && <Chat {...{ chatOpen, setChatOpen, unread, chatOpacity, setChatOpacity, messages, chat, setChat, sendChat, chatInput, keys, route, online, canSend: canAct }} />}
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
            <button className="btn small blue" onClick={sendEmote} disabled={!canAct}>♥ 인사</button>
            {zone === "home" && !edit && <button className="btn small" onClick={() => { setEdit({ placements, sel: null }); clearRoute(); }}>🪑 가구 배치</button>}
            <button className="btn small ghost only-compact" onClick={openShop}>🛍 상점</button>
            <button className="btn small ghost only-compact" onClick={openNotebook}>📒 수첩</button>
            <span className="hint"><kbd>WASD</kbd> 걷기 · <kbd>클릭</kbd> 이동 · <kbd>Space</kbd> 인사 · <kbd>Enter</kbd> 채팅</span>
          </footer>
        </section>
        <nav className="tabs" aria-label="장소 이동">
          {ZONES.map(([id, icon, label]) => <button key={id} aria-pressed={zone === id} onClick={() => goZone(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </nav>
      </div>
      {(status === "disconnected" || status === "reconnecting") && !local && <Sheet as="div" backdrop="sheet-backdrop offline" className="notebook paper" role="alertdialog" aria-modal="true" aria-labelledby="offline-title">
          <div className="notebook-head"><b id="offline-title">{status === "reconnecting" ? "서버에 다시 연결하는 중…" : "서버 연결이 끊겼어요"}</b></div>
          <p className="notebook-body">연결될 때까지 이동·채팅·장소 이동을 할 수 없어요.</p>
          {status === "disconnected" && <div className="notebook-foot"><button className="btn wide" autoFocus onClick={() => { rejoining.current = true; setJoinTry(n => n + 1); }}>다시 연결</button></div>}
      </Sheet>}
      {shop && <Shop {...{ wallet, unsaved, owned, outfit, buy, wear, me, close: () => setShop(false) }} />}
      {notebook && <Notebook {...{ records, earned, recordError, loadRecords, me, close: () => setNotebook(false) }} />}
      {setup && <CharacterSetup profile={profile} userId={user.id} save={saveCharacter} close={() => setSetup(false)} />}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
