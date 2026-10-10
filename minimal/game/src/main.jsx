import React, { useSyncExternalStore } from 'react';
import WorldCanvas from './WorldCanvas.jsx';
import VisualStatus from './VisualStatus.jsx';
import OtaTestScreen from './OtaTestScreen.jsx';

// Test-only screen for the OTA extension check; never shown in a normal build.
const OTA_TEST_SCREEN = import.meta.env.VITE_OTA_TEST_SCREEN === '1';

// Display only: auth, room, wallet, timers and input live in the runtime (runtime.js), which outlives every UI release.
// Anything that must survive a UI swap (drafts, open panel, choices) is kept in runtime ui state, not React state.
export default function App({ runtime }) {
  const { user, ui, phase, notice, otherTab, recovering, held, storageNotice, retryAt, now, crowd, game, wallet, pending, toast, release, hasSaved, visual } =
    useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const name = ui.name || '';
  const enter = event => { event?.preventDefault(); runtime.enter(); };
  const waiting = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const busy = phase === 'authenticating' || phase === 'joining';
  const ready = phase === 'playing';
  const total = Object.values(pending).reduce((sum, row) => sum + row.score, 0);
  const unknownPending = Object.entries(pending).some(([id, row]) => !row.durable && id !== game?.id);
  const seconds = game?.active ? Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000)) : null;
  const walletUnknown = wallet.status !== 'confirmed';
  const clock = ready && seconds !== null ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '—';
  const testOpen = OTA_TEST_SCREEN && ready && ui.panel === 'ota-test';
  // An open IME composition holds a UI swap back; focusout covers a composition that never reports its end.
  return <main className={`app ${user ? 'in-game' : 'at-title'}`}
    onCompositionStart={() => runtime.setInteraction('composition', true)}
    onCompositionEnd={() => runtime.setInteraction('composition', false)}
    onBlur={() => runtime.setInteraction('composition', false)}>
    <div className="frame">
      <header className="titlebar">
        <a className="brand" href="./" aria-label="픽셀타운 처음 화면"><Icon map={STAR}/> 픽셀타운</a>
        <span className="place">작은 광장</span>
        {OTA_TEST_SCREEN && user && ready && <button type="button" className="text-button" aria-expanded={testOpen} aria-controls="ota-test-screen"
          onClick={() => runtime.setUI({ panel: testOpen ? null : 'ota-test' })}>검증 화면</button>}
        {user && ready && release && <Release release={release}/>}
        <VisualStatus status={visual}/>
        {user && (ready && recovering
          ? <span className="presence recovering" role="status"><i aria-hidden="true"/>연결을 다시 확인하고 있어요</span>
          : <span className={`presence ${ready ? 'online' : ''}`}><i aria-hidden="true"/>{ready ? `함께 있는 이웃 ${crowd}명` : busy ? '입장 준비 중' : otherTab ? '다른 탭에서 입장 중' : '연결 확인 필요'}</span>)}
      </header>
      <section className="stage" aria-label="광장">
        <WorldCanvas runtime={runtime} ready={ready} moving={ready && !held} controls={!!user}/>
        {user && <div className="hud">
          <section className="wallet" aria-label="내 별">
            <div className="stat saved"><Icon map={STAR}/><span className="stat-label">저장된 별</span><strong>{wallet.value ? wallet.value.balance.toLocaleString('ko-KR') : '—'}</strong><span className={`stat-note ${walletUnknown ? 'unconfirmed' : 'confirmed'}`}>{wallet.status === 'checking' ? '확인 중' : walletUnknown ? (wallet.value ? '미확인 · 마지막 확인값' : '미확인') : '저장 확인 완료'}</span></div>
            <div className="stat pending"><Icon map={STAR} hollow/><span className="stat-label">정산 대기</span><strong key={total} className="pending-number">{total.toLocaleString('ko-KR')}<small>개</small></strong><span className="stat-note">{unknownPending ? '이전 별 저장 여부 확인 중' : '저장 확인 후 반영돼요'}</span></div>
            <div className="stat round"><Icon map={CLOCK}/><span className="stat-label">다음 정산</span><strong>{clock}</strong><span className="stat-note">모은 별을 정산해요</span></div>
          </section>
          <div className="toasts">
            {wallet.message && <div className="wallet-message toast warn" role="status"><span><b>저장 내역 미확인.</b> {wallet.message}</span><button className="text-button" disabled={wallet.status === 'checking' || now < wallet.retryAt} onClick={() => runtime.refreshWallet()}>{now < wallet.retryAt ? '잠시 후 확인' : '다시 확인'}</button></div>}
            {ready && notice && <p className="toast" role="status">{notice}</p>}
            {storageNotice && <p className="toast warn" role="alert">{storageNotice}</p>}
            {toast && <p key={toast.id} className={`toast ${toast.tone}`} role="status">{toast.tone === 'saved' && <Icon map={STAR}/>}{toast.text}</p>}
          </div>
        </div>}
        {testOpen && <OtaTestScreen runtime={runtime} ui={ui}/>}
        {ready && recovering && held && <p className="recovery-band" aria-hidden="true"><Icon map={STAR}/>연결을 다시 확인하고 있어요…</p>}
        {!user && <div className="overlay title-screen">
          <section className="dialog welcome" aria-labelledby="welcome-title">
            <p className="kicker">작은 광장에서 만나요</p>
            <h1 id="welcome-title"><Icon map={STAR}/>픽셀타운</h1>
            <p className="intro">이웃과 함께 걷고<br/>반짝이는 별을 모아요.</p>
            <form onSubmit={enter} className="entry-form">
              {!hasSaved && <label><span>닉네임</span><input name="nickname" autoComplete="nickname" placeholder="2~12자로 지어 주세요" value={name} onChange={e => runtime.setUI({ name: e.target.value })} maxLength={12} minLength={2} required disabled={busy} /></label>}
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
            <h2>{busy ? '광장으로 가는 중…' : otherTab ? '다른 탭에서 광장을 열었어요' : '잠시 쉬어 가요'}</h2>
            <p>{busy ? '이웃과 별을 불러오고 있어요.' : notice || '연결 상태를 확인해 주세요.'}</p>
            {!busy && <><button className="primary" disabled={waiting > 0} onClick={enter}>{waiting ? `${waiting}초 후 다시 입장` : otherTab ? '여기서 다시 입장하기' : '다시 입장하기'}</button>{!otherTab && <a className="help-link" href="/unavailable.html">접속 안내 보기</a>}</>}
          </section>
        </div>}
      </section>
    </div>
  </main>;
}

const DEPLOY_STEPS = {
  idle: { label: '현재 버전' },
  preparing: { label: '새 버전 준비 중', at: 1 },
  'catching-up': { label: '상태 확인 중', at: 2 },
  applied: { label: '적용 완료', at: 3 },
  cancelled: { label: '이번 배포 취소 · 현재 버전 유지' },
};
function Release({ release }) {
  const step = DEPLOY_STEPS[release.phase] || DEPLOY_STEPS.idle;
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
