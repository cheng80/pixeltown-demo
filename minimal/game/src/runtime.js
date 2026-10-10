import { authenticate, createGameConnection, pb, request, savedGuest } from './api.js';
import { cleanLedger, failureMessage, isDuplicateGuest, readStored, reconcileLedger, rememberScore, retryDelay, WalletState, writeStored } from './state.js';
import { createEngine, applySnapshot, stopMovement } from './engine.js';

const DEPLOY_STEPS = { idle: {}, preparing: { live: true }, 'catching-up': { live: true }, applied: { hold: 4000 }, cancelled: { hold: 5000 } };
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function createRuntime({ api = { authenticate, createGameConnection, pb, request, savedGuest }, engine = createEngine() } = {}) {
  const listeners = new Set(), interactions = new Set();
  let snapshot = freeze({ user: null, ui: { name: '' }, phase: 'welcome', notice: '', otherTab: false, recovering: false, held: false,
    storageNotice: '', retryAt: 0, now: Date.now(), crowd: 0, game: null, wallet: { value: null, status: 'unknown', message: '', retryAt: 0 },
    pending: {}, toast: null, release: null, hasSaved: !!api.savedGuest() || !!(api.pb.authStore.isValid && api.pb.authStore.record?.id), visual: null });
  let disposed = false, started = false, user, connection, authBusy = false, authGeneration = 0, authController, toastTimer, clock;
  let walletCleanup, refreshWallet, ledger = {}, settled = [], deployment = { seq: -1, queue: [], timer: 0 };
  let frontendListener = () => {}, beforeEnter = async () => {}, bindSlot = () => {}, uiError = () => {};
  function publish(patch) {
    if (disposed) return;
    snapshot = freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  }
  function saveLedger(next) {
    ledger = next; publish({ pending: next });
    if (user && !writeStored(`pending.${user.id}`, next)) publish({ storageNotice: '이 브라우저에 대기 중인 별을 기록하지 못했어요. 저장 확인 전에는 창을 닫지 말아 주세요.' });
  }
  function announce(text, tone = 'info') {
    clearTimeout(toastTimer); publish({ toast: { text, tone, id: Date.now() } });
    toastTimer = setTimeout(() => publish({ toast: null }), 4200);
  }
  function resetDeployment() {
    clearTimeout(deployment.timer); deployment = { seq: -1, queue: [], timer: 0 }; publish({ release: null });
  }
  function showDeployStep() {
    const d = deployment, phase = d.queue.shift();
    if (!phase) { d.timer = 0; if (snapshot.release && !DEPLOY_STEPS[snapshot.release.phase].live) publish({ release: { ...snapshot.release, phase: 'idle' } }); return; }
    if (snapshot.release) publish({ release: { ...snapshot.release, phase } });
    const step = DEPLOY_STEPS[phase]; d.shownAt = Date.now(); d.hold = !d.queue.length && !!step.hold;
    d.timer = phase === 'idle' ? (d.queue.length ? setTimeout(showDeployStep, 0) : 0) : setTimeout(showDeployStep, d.queue.length || step.live ? 700 : step.hold);
  }
  function trackDeployment(status) {
    const d = deployment;
    if (!status || !(status.phase in DEPLOY_STEPS) || !Number.isFinite(status.eventSeq) || status.eventSeq <= d.seq) return;
    const first = d.seq < 0; d.seq = status.eventSeq;
    publish({ release: { phase: snapshot.release?.phase || 'idle', revision: typeof status.revision === 'string' ? status.revision.slice(0, 8) : null, generation: Number(status.generation) || null } });
    d.queue.push(first && !DEPLOY_STEPS[status.phase].live ? 'idle' : status.phase);
    if (!d.timer) showDeployStep();
    else if (d.hold) { clearTimeout(d.timer); d.timer = setTimeout(showDeployStep, Math.max(0, d.shownAt + 700 - Date.now())); }
  }
  function startWallet() {
    walletCleanup?.();
    const state = new WalletState();
    let stopped = false, timer, controller, inFlight = false, failures = 0, nextAllowed = 0;
    const report = (message = '') => { if (!stopped) publish({ wallet: { value: state.value, status: state.status, message, retryAt: nextAllowed } }); };
    const poll = async () => {
      if (stopped || inFlight || Date.now() < nextAllowed) return;
      clearTimeout(timer); inFlight = true;
      const generation = state.begin(); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000); report(); let delay = 10000;
      try {
        const data = await api.request('/api/minimal/wallet', { token: api.pb.authStore.token, signal: controller.signal });
        if (stopped || !state.accept(generation, data)) return;
        failures = 0; settled = data.settledMatchIds;
        const before = ledger, after = reconcileLedger(before, data.settledMatchIds);
        const saved = Object.keys(before).filter(id => !(id in after)).reduce((sum, id) => sum + before[id].score, 0);
        saveLedger(after); if (saved) announce(`별 ${saved.toLocaleString('ko-KR')}개가 저장됐어요`, 'saved');
        nextAllowed = Date.now() + delay; report();
      } catch (error) {
        if (stopped || !state.fail(generation)) return;
        delay = Math.max(retryDelay(error), Math.min(60000, 15000 * 2 ** Math.min(failures++, 2)));
        nextAllowed = Date.now() + delay; report(failureMessage(error, 'wallet'));
      } finally { clearTimeout(timeout); inFlight = false; if (!stopped) timer = setTimeout(poll, delay); }
    };
    refreshWallet = poll;
    publish({ wallet: { value: null, status: 'unknown', message: '', retryAt: 0 } }); void poll();
    walletCleanup = () => { stopped = true; state.invalidate(); clearTimeout(timer); controller?.abort(); refreshWallet = null; };
  }
  function join() {
    connection?.dispose();
    engine.connected = false; engine.initialized = false; engine.pending = []; engine.others.clear(); engine.stars = [];
    engine.seq = 0; engine.fix = 0; engine.snapshot = null; engine.userId = user.id; stopMovement(engine);
    publish({ phase: 'joining', crowd: 0, game: null, otherTab: false, recovering: false }); resetDeployment();
    const generation = authGeneration;
    const current = () => !disposed && generation === authGeneration;
    connection = api.createGameConnection({ engine, userId: user.id, token: api.pb.authStore.token,
      onSnapshot: data => {
        if (!current() || data?.zone !== 'lobby' || !Array.isArray(data.players) || !applySnapshot(engine, data, user.id)) return false;
        publish({ phase: 'playing', notice: snapshot.phase === 'playing' ? snapshot.notice : '', crowd: data.players.length, game: structuredClone(data.game || null) });
        trackDeployment(data.deployment);
        const next = rememberScore(ledger, data.game?.id, data.game?.scores?.[user.id], false, settled);
        if (next !== ledger && next[data.game?.id]?.score !== ledger[data.game?.id]?.score) saveLedger(next);
        return true;
      },
      onGameEnded: result => {
        if (!current()) return;
        saveLedger(rememberScore(ledger, result.match_id, result.scores?.[user.id], true, settled));
        const mine = Number(result.scores?.[user.id]) || 0;
        if (mine > 0) announce(`이번 판 별 ${mine}개 · 저장 확인을 기다리고 있어요`, 'round');
      },
      onDeployment: value => { if (current()) trackDeployment(value); },
      onFrontend: value => { if (current()) frontendListener(value); },
      onFeatureUnavailable: () => { if (current()) publish({ notice: '지금은 광장에서 걷고 별을 모을 수 있어요.' }); },
      onRecovery: value => { if (current()) publish({ recovering: value?.phase === 'recovering' }); },
      onFailure: error => {
        if (!current()) return;
        engine.connected = false; engine.send = null; stopMovement(engine);
        publish({ recovering: false, phase: 'game-error', otherTab: isDuplicateGuest(error), notice: failureMessage(error, 'game'), retryAt: Date.now() + retryDelay(error) });
      },
    });
    engine.send = movement => connection.send(movement);
  }
  async function enter() {
    if (disposed || authBusy || Date.now() < snapshot.retryAt) return;
    authBusy = true; const generation = ++authGeneration;
    publish({ phase: 'authenticating', notice: '' });
    const controller = new AbortController(); authController = controller;
    let timeout;
    try {
      await beforeEnter();
      if (disposed || generation !== authGeneration) return;
      timeout = setTimeout(() => controller.abort(), 12000);
      const auth = await api.authenticate(snapshot.ui.name, controller.signal);
      if (disposed || generation !== authGeneration) return;
      const changed = user?.id !== auth.record.id;
      if (changed) settled = [];
      user = auth.record; ledger = cleanLedger(readStored(`pending.${user.id}`, {}));
      publish({ pending: ledger, user: { id: user.id, name: user.name || '' }, phase: 'joining', retryAt: 0, hasSaved: true });
      if (changed) startWallet(); join();
    } catch (error) {
      if (disposed || generation !== authGeneration) return;
      publish({ phase: 'entry-error', retryAt: Date.now() + retryDelay(error), notice: error.storageFailure || error.message?.startsWith('Storage unavailable')
        ? '입장 정보를 이 브라우저에 저장하지 못했어요. 브라우저의 저장소 허용 설정을 확인해 주세요.' : failureMessage(error, api.savedGuest() ? 'auth' : 'guest') });
    } finally { clearTimeout(timeout); if (generation === authGeneration) authBusy = false; }
  }
  const facade = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    enter, refreshWallet: () => refreshWallet?.(),
    setUI(patch) { publish({ ui: { ...snapshot.ui, ...structuredClone(patch) } }); },
    setPad(x, y) { if ((!engine.connected && (x || y)) || ![-1, 0, 1].includes(x) || ![-1, 0, 1].includes(y)) return; engine.target = null; engine.pad = { x, y }; },
    nudge(x, y) { if (!engine.connected || ![-1, 0, 1].includes(x) || ![-1, 0, 1].includes(y)) return; engine.target = { x: engine.self.x + x * 16, y: engine.self.y + y * 16 }; },
    setInteraction(kind, active) { active ? interactions.add(kind) : interactions.delete(kind); },
    bindWorldSlot: element => bindSlot(element), reportUIError: error => uiError(error),
  });
  return {
    facade, engine, get safeToSwap() { return !interactions.size && !authBusy; },
    get connection() { return connection; },
    setHooks({ onFrontend, checkBeforeEnter, onBindSlot, onUIError } = {}) {
      if (onFrontend) frontendListener = onFrontend; if (checkBeforeEnter) beforeEnter = checkBeforeEnter;
      if (onBindSlot) bindSlot = onBindSlot; if (onUIError) uiError = onUIError;
    },
    publishVisual: visual => publish({ visual }),
    requestFrontend() { connection?.requestFrontend?.(); },
    start() {
      if (started || disposed) return; started = true;
      clock = setInterval(() => { connection?.checkStale(); publish({ now: Date.now(), held: snapshot.recovering && !engine.connected }); }, 200);
      if (snapshot.hasSaved) void enter();
    },
    dispose() {
      disposed = true; authGeneration++; authController?.abort(); walletCleanup?.(); connection?.dispose();
      clearInterval(clock); clearTimeout(toastTimer); clearTimeout(deployment.timer); listeners.clear(); stopMovement(engine);
    },
  };
}

// Each release gets a revocable command lease; an old callback cannot issue new work.
export function createUIFacade(runtime, onError) {
  let active = false, disposed = false;
  const subscriptions = new Set(), facade = {};
  facade.getSnapshot = runtime.facade.getSnapshot;
  facade.subscribe = listener => {
    if (disposed) return () => {};
    const remove = runtime.facade.subscribe(listener); subscriptions.add(remove);
    return () => { remove(); subscriptions.delete(remove); };
  };
  for (const name of ['enter', 'refreshWallet', 'setUI', 'setPad', 'nudge', 'setInteraction']) facade[name] = (...args) => {
    if (!active || disposed) throw new Error('Inactive UI command');
    return runtime.facade[name](...args);
  };
  facade.bindWorldSlot = element => { if (active && !disposed) runtime.facade.bindWorldSlot(element); };
  facade.reportUIError = error => { if (!disposed) onError(error); };
  return { facade: Object.freeze(facade), setActive(value) { active = value && !disposed; },
    dispose() { active = false; disposed = true; for (const remove of subscriptions) remove(); subscriptions.clear(); },
  };
}
