import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from '@colyseus/sdk';
import { authenticate, GAME_URL, pb, request, savedGuest } from './api.js';
import { cleanLedger, failureMessage, pendingTotal, readStored, reconcileLedger, rememberScore, retryDelay, WalletState, writeStored } from './state.js';
import WorldCanvas, { applySnapshot, createEngine, stopMovement } from './WorldCanvas.jsx';
import './style.css';

function App() {
  const [engine] = useState(createEngine);
  const [user, setUser] = useState(null);
  const [name, setName] = useState('');
  const [phase, setPhase] = useState('welcome');
  const [notice, setNotice] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [roomAttempt, setRoomAttempt] = useState(0);
  const [crowd, setCrowd] = useState(0);
  const [game, setGame] = useState(null);
  const [wallet, setWallet] = useState({ value: null, status: 'unknown', message: '', retryAt: 0 });
  const [pending, setPending] = useState({});
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(0);
  const [release, setRelease] = useState(null);
  const deployment = useRef({ seq: -1, queue: [], timer: 0 });
  const ledger = useRef({});
  const settled = useRef([]);
  const userRef = useRef(null);
  const authBusy = useRef(false);
  const authController = useRef(null);
  const authGeneration = useRef(0);
  const refreshWallet = useRef(null);
  const initialRestore = useRef(false);
  const phaseRef = useRef(phase); phaseRef.current = phase;

  function saveLedger(next) {
    ledger.current = next; setPending(next);
    if (userRef.current && !writeStored(`pending.${userRef.current.id}`, next)) setStorageNotice('이 브라우저에 대기 중인 별을 기록하지 못했어요. 저장 확인 전에는 창을 닫지 말아 주세요.');
  }
  function announce(text, tone = 'info') {
    clearTimeout(toastTimer.current);
    setToast({ text, tone, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }
  // Deployment status is display-only: it never gates input, snapshots or reconnection.
  // The version follows the latest status at once; only the step labels replay, each briefly, since a swap takes tens of ms.
  function resetDeployment() {
    clearTimeout(deployment.current.timer);
    deployment.current = { seq: -1, queue: [], timer: 0 };
    setRelease(null);
  }
  function trackDeployment(status) {
    const d = deployment.current;
    if (!status || !(status.phase in DEPLOY_STEPS) || !Number.isFinite(status.eventSeq) || status.eventSeq <= d.seq) return;
    const first = d.seq < 0;
    d.seq = status.eventSeq;
    const revision = typeof status.revision === 'string' ? status.revision.slice(0, 8) : null, generation = Number(status.generation) || null;
    setRelease(r => ({ phase: r?.phase || 'idle', revision, generation }));
    // On entry only an in-progress deployment is worth a step; finished ones show the version alone.
    d.queue.push(first && !DEPLOY_STEPS[status.phase].live ? 'idle' : status.phase);
    if (!d.timer) showDeployStep();
    // A finished step lingers only while nothing newer is waiting.
    else if (d.hold) { clearTimeout(d.timer); d.timer = setTimeout(showDeployStep, Math.max(0, d.shownAt + 700 - Date.now())); }
  }
  function showDeployStep() {
    const d = deployment.current, phase = d.queue.shift();
    if (!phase) { d.timer = 0; setRelease(r => r && !DEPLOY_STEPS[r.phase].live ? { ...r, phase: 'idle' } : r); return; }
    setRelease(r => r && { ...r, phase });
    const step = DEPLOY_STEPS[phase];
    d.shownAt = Date.now(); d.hold = !d.queue.length && !!step.hold;
    d.timer = phase === 'idle' ? (d.queue.length ? setTimeout(showDeployStep, 0) : 0)
      : setTimeout(showDeployStep, d.queue.length || step.live ? 700 : step.hold);
  }
  async function enter(event) {
    event?.preventDefault();
    if (authBusy.current || Date.now() < retryAt) return;
    authBusy.current = true;
    const generation = ++authGeneration.current;
    setPhase('authenticating'); setNotice('');
    const controller = new AbortController(); authController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const auth = await authenticate(name, controller.signal);
      if (generation !== authGeneration.current) return;
      if (userRef.current?.id !== auth.record.id) settled.current = [];
      userRef.current = auth.record;
      ledger.current = cleanLedger(readStored(`pending.${auth.record.id}`, {}));
      setPending(ledger.current);
      setUser(auth.record); setRoomAttempt(n => n + 1); setPhase('joining');
      setRetryAt(0);
    } catch (error) {
      if (generation !== authGeneration.current) return;
      setPhase('entry-error'); setRetryAt(Date.now() + retryDelay(error));
      setNotice(error.storageFailure || error.message?.startsWith('Storage unavailable')
        ? '입장 정보를 이 브라우저에 저장하지 못했어요. 브라우저의 저장소 허용 설정을 확인해 주세요.'
        : failureMessage(error, savedGuest() ? 'auth' : 'guest'));
    } finally {
      clearTimeout(timeout);
      if (generation === authGeneration.current) authBusy.current = false;
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    if (!initialRestore.current) {
      initialRestore.current = true;
      if (savedGuest() || (pb.authStore.isValid && pb.authStore.record?.id)) void enter();
    }
    return () => { clearInterval(timer); clearTimeout(toastTimer.current); clearTimeout(deployment.current.timer); authGeneration.current++; authController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const state = new WalletState();
    let disposed = false, timer, controller, inFlight = false, failures = 0, nextAllowed = 0;
    const publish = (message = '') => {
      if (!disposed) setWallet({ value: state.value, status: state.status, message, retryAt: nextAllowed });
    };
    const poll = async () => {
      if (disposed || inFlight || Date.now() < nextAllowed) return;
      clearTimeout(timer); inFlight = true;
      const generation = state.begin(); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      publish();
      let delay = 10000;
      try {
        const data = await request('/api/minimal/wallet', { token: pb.authStore.token, signal: controller.signal });
        if (disposed || !state.accept(generation, data)) return;
        failures = 0; settled.current = data.settledMatchIds;
        const before = ledger.current, after = reconcileLedger(before, data.settledMatchIds);
        const saved = Object.keys(before).filter(id => !(id in after)).reduce((sum, id) => sum + before[id].score, 0);
        saveLedger(after);
        if (saved) announce(`별 ${saved.toLocaleString('ko-KR')}개가 저장됐어요`, 'saved');
        nextAllowed = Date.now() + delay; publish();
      } catch (error) {
        if (disposed || !state.fail(generation)) return;
        delay = Math.max(retryDelay(error), Math.min(60000, 15000 * 2 ** Math.min(failures++, 2)));
        nextAllowed = Date.now() + delay; publish(failureMessage(error, 'wallet'));
      } finally {
        clearTimeout(timeout); inFlight = false;
        if (!disposed) timer = setTimeout(poll, delay);
      }
    };
    refreshWallet.current = poll;
    setWallet({ value: null, status: 'unknown', message: '', retryAt: 0 });
    void poll();
    return () => { disposed = true; state.invalidate(); clearTimeout(timer); controller?.abort(); refreshWallet.current = null; };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let disposed = false, joined = null, timeout, staleTimer;
    engine.connected = false; engine.initialized = false; engine.pending = []; engine.others.clear(); engine.stars = [];
    engine.seq = 0; engine.fix = 0; engine.snapshot = null; engine.userId = user.id; stopMovement(engine);
    setPhase('joining'); setCrowd(0); setGame(null); resetDeployment();
    const closeRoom = room => {
      if (!room) return;
      room.reconnection.maxRetries = 0;
      try { void room.leave().catch(() => {}); } catch { /* Already closed. */ }
    };
    const fail = error => {
      if (disposed) return;
      disposed = true; clearTimeout(timeout); clearInterval(staleTimer);
      engine.connected = false; engine.room = null; stopMovement(engine); closeRoom(joined);
      setPhase('game-error'); setNotice(failureMessage(error, 'game')); setRetryAt(Date.now() + retryDelay(error));
    };
    const client = new Client(GAME_URL);
    if (client.auth.settings) client.auth.settings.key = 'pixeltown.minimal.room-auth';
    client.auth.token = pb.authStore.token;
    timeout = setTimeout(() => fail(new Error('Join timeout')), 12000);
    client.joinOrCreate('minimal-town', { zone: 'lobby' }).then(room => {
      if (disposed) { closeRoom(room); return; }
      joined = room; room.reconnection.maxRetries = 0;
      engine.room = room;
      engine.send = movement => room.send('move', movement);
      room.onMessage('snapshot', data => {
        if (disposed || data?.zone !== 'lobby' || !Array.isArray(data.players)) return;
        if (!applySnapshot(engine, data, user.id)) return;
        clearTimeout(timeout); engine.connected = true;
        if (phaseRef.current !== 'playing') { setPhase('playing'); setNotice(''); }
        setCrowd(data.players.length); setGame(data.game || null); trackDeployment(data.deployment);
        const score = data.game?.scores?.[user.id];
        const next = rememberScore(ledger.current, data.game?.id, score, false, settled.current);
        const previous = ledger.current[data.game?.id];
        if (next !== ledger.current && next[data.game?.id]?.score !== previous?.score) saveLedger(next);
      });
      room.onMessage('gameEnded', result => {
        if (disposed) return;
        saveLedger(rememberScore(ledger.current, result.match_id, result.scores?.[user.id], true, settled.current));
        const mine = Number(result.scores?.[user.id]) || 0;
        if (mine > 0) announce(`이번 판 별 ${mine}개 · 저장 확인을 기다리고 있어요`, 'round');
      });
      room.onMessage('deployment', status => { if (!disposed) trackDeployment(status); });
      room.onMessage('featureUnavailable', () => { if (!disposed) setNotice('지금은 광장에서 걷고 별을 모을 수 있어요.'); });
      room.onDrop(code => fail({ code })); room.onLeave(code => fail({ code })); room.onError((code) => fail({ code }));
      staleTimer = setInterval(() => {
        if (engine.initialized && (Date.now() - engine.lastSnapshot > 8000 || !engine.connected)) fail(new Error('Connection stale'));
      }, 1000);
    }).catch(fail);
    return () => { disposed = true; clearTimeout(timeout); clearInterval(staleTimer); engine.connected = false; engine.send = null; engine.room = null; stopMovement(engine); closeRoom(joined); };
  }, [user, roomAttempt, engine]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const diagnostic = Object.freeze({
      get snapshot() { return engine.snapshot || null; },
      get current() { return engine.snapshot || null; },
      get userId() { return userRef.current?.id || null; },
      get room() { return engine.room || null; },
    });
    window.__minimal = diagnostic;
    return () => { if (window.__minimal === diagnostic) delete window.__minimal; };
  }, [engine]);

  const waiting = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const busy = phase === 'authenticating' || phase === 'joining';
  const ready = phase === 'playing';
  const hasSaved = !!savedGuest() || (pb.authStore.isValid && !!pb.authStore.record?.id);
  const total = pendingTotal(pending);
  const unknownPending = Object.entries(pending).some(([id, row]) => !row.durable && id !== game?.id);
  const seconds = game?.active ? Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000)) : null;
  const walletUnknown = wallet.status !== 'confirmed';
  const clock = ready && seconds !== null ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '—';
  return <main className={`app ${user ? 'in-game' : 'at-title'}`}>
    <div className="frame">
      <header className="titlebar">
        <a className="brand" href="./" aria-label="픽셀타운 처음 화면"><Icon map={STAR}/> 픽셀타운</a>
        <span className="place">작은 광장</span>
        {user && ready && release && <Release release={release}/>}
        {user && <span className={`presence ${ready ? 'online' : ''}`}><i aria-hidden="true"/>{ready ? `함께 있는 이웃 ${crowd}명` : busy ? '입장 준비 중' : '연결 확인 필요'}</span>}
      </header>
      <section className="stage" aria-label="광장">
        <WorldCanvas engine={engine} ready={ready} controls={!!user}/>
        {user && <div className="hud">
          <section className="wallet" aria-label="내 별">
            <div className="stat saved"><Icon map={STAR}/><span className="stat-label">저장된 별</span><strong>{wallet.value ? wallet.value.balance.toLocaleString('ko-KR') : '—'}</strong><span className={`stat-note ${walletUnknown ? 'unconfirmed' : 'confirmed'}`}>{wallet.status === 'checking' ? '확인 중' : walletUnknown ? (wallet.value ? '미확인 · 마지막 확인값' : '미확인') : '저장 확인 완료'}</span></div>
            <div className="stat pending"><Icon map={STAR} hollow/><span className="stat-label">정산 대기</span><strong key={total} className="pending-number">{total.toLocaleString('ko-KR')}<small>개</small></strong><span className="stat-note">{unknownPending ? '이전 별 저장 여부 확인 중' : '저장 확인 후 반영돼요'}</span></div>
            <div className="stat round"><Icon map={CLOCK}/><span className="stat-label">다음 정산</span><strong>{clock}</strong><span className="stat-note">모은 별을 정산해요</span></div>
          </section>
          <div className="toasts">
            {wallet.message && <div className="wallet-message toast warn" role="status"><span><b>저장 내역 미확인.</b> {wallet.message}</span><button className="text-button" disabled={wallet.status === 'checking' || now < wallet.retryAt} onClick={() => refreshWallet.current?.()}>{now < wallet.retryAt ? '잠시 후 확인' : '다시 확인'}</button></div>}
            {ready && notice && <p className="toast" role="status">{notice}</p>}
            {storageNotice && <p className="toast warn" role="alert">{storageNotice}</p>}
            {toast && <p key={toast.id} className={`toast ${toast.tone}`} role="status">{toast.tone === 'saved' && <Icon map={STAR}/>}{toast.text}</p>}
          </div>
        </div>}
        {!user && <div className="overlay title-screen">
          <section className="dialog welcome" aria-labelledby="welcome-title">
            <p className="kicker">작은 광장에서 만나요</p>
            <h1 id="welcome-title"><Icon map={STAR}/>픽셀타운</h1>
            <p className="intro">이웃과 함께 걷고<br/>반짝이는 별을 모아요.</p>
            <form onSubmit={enter} className="entry-form">
              {!hasSaved && <label><span>닉네임</span><input name="nickname" autoComplete="nickname" placeholder="2~12자로 지어 주세요" value={name} onChange={e => setName(e.target.value)} maxLength={12} minLength={2} required disabled={busy} /></label>}
              <button className="primary" disabled={busy || waiting > 0 || (!hasSaved && name.trim().length < 2)}>{busy ? '입장 준비 중…' : waiting ? `${waiting}초 후 다시 시도` : hasSaved ? '다시 입장하기' : '광장 들어가기'}</button>
            </form>
            {notice && <p className="message" role="alert">{notice}</p>}
            <p className="fine-print">다음에는 이 브라우저에서 바로 이어서 들어와요. 브라우저 데이터를 지우면 입장 정보를 잃을 수 있어요.</p>
            <a className="help-link" href="/unavailable.html">접속이 어려운가요?</a>
          </section>
        </div>}
        {user && !ready && <div className="overlay cover" role="status">
          <section className="dialog">
            <span className={`cover-icon ${busy ? 'busy' : ''}`} aria-hidden="true"><Icon map={busy ? STAR : CLOUD}/></span>
            <h2>{busy ? '광장으로 가는 중…' : '잠시 쉬어 가요'}</h2>
            <p>{busy ? '이웃과 별을 불러오고 있어요.' : notice || '연결 상태를 확인해 주세요.'}</p>
            {!busy && <><button className="primary" disabled={waiting > 0} onClick={enter}>{waiting ? `${waiting}초 후 다시 입장` : '다시 입장하기'}</button><a className="help-link" href="/unavailable.html">접속 안내 보기</a></>}
          </section>
        </div>}
      </section>
    </div>
  </main>;
}

const DEPLOY_STEPS = {
  idle: { label: '현재 버전' },
  preparing: { label: '새 버전 준비 중', live: true, at: 1 },
  'catching-up': { label: '상태 확인 중', live: true, at: 2 },
  applied: { label: '적용 완료', hold: 4000, at: 3 },
  cancelled: { label: '이번 배포 취소 · 현재 버전 유지', hold: 5000 },
};
function Release({ release }) {
  const step = DEPLOY_STEPS[release.phase];
  const version = `${release.revision || '확인 중'}${release.generation ? ` · ${release.generation}회차` : ''}`;
  const spoken = release.phase === 'idle' ? '' : release.phase === 'applied' ? `배포 적용 완료. 현재 버전 ${version}` : `배포 상태: ${step.label}`;
  return <div className={`release ${release.phase}`}>
    <span className="release-version" title="현재 적용 버전 · 교체 회차"><span className="release-label">현재 버전</span> <b>{version}</b></span>
    {release.phase !== 'idle' && <span className="release-step" aria-hidden="true">
      {release.phase !== 'cancelled' && <span className="release-dots">{[1, 2, 3].map(n => <i key={n} className={n < step.at ? 'done' : n === step.at ? 'now' : ''}/>)}</span>}
      {step.label}
    </span>}
    <span className="sr-only" role="status">{spoken}</span>
  </div>;
}

// Tiny pixel icons: '#' outline, 'o' fill, '.' empty.
const STAR = ['......#......', '.....#o#.....', '.....#o#.....', '....#ooo#....', '#####ooo#####', '#ooooooooooo#', '.#ooooooooo#.', '..#ooooooo#..', '..#ooo#ooo#..', '.#oo#...#oo#.', '.#o#.....#o#.', '#o#.......#o#', '###.......###'];
const CLOCK = ['..#####..', '.#ooooo#.', '#oooiooo#', '#oooiooo#', '#oooiiio#', '#ooooooo#', '#ooooooo#', '.#ooooo#.', '..#####..'];
const CLOUD = ['....####.......', '...#oooo#.###..', '.###oooo##ooo#.', '#ooooooooooooo#', '#ooooooooooooo#', '.#############.'];
function Icon({ map, hollow }) {
  const cells = [];
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') cells.push(<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" className={ch === '#' ? 'px-line' : ch === 'i' ? 'px-ink' : 'px-fill'}/>); }));
  return <svg className={`px-icon ${hollow ? 'hollow' : ''}`} viewBox={`0 0 ${Math.max(...map.map(r => r.length))} ${map.length}`} shapeRendering="crispEdges" aria-hidden="true">{cells}</svg>;
}

createRoot(document.getElementById('root')).render(<App/>);
