import React from 'react';

// Test-only second screen (VITE_OTA_TEST_SCREEN=1): an ordinary component that proves a screen can be added without
// touching the updater. Draft and choice live in runtime ui state; the updater restores scroll and focus by element id.
const ROWS = Array.from({ length: 40 }, (_, i) => `검증 항목 ${i + 1}`);

export default function OtaTestScreen({ runtime, ui }) {
  const close = () => runtime.setUI({ panel: null });
  return <section id="ota-test-screen" className="dialog ota-test" role="dialog" aria-labelledby="ota-test-title"
    onKeyDown={e => { if (e.key === 'Escape') close(); }}>
    <h2 id="ota-test-title">화면 교체 검증</h2>
    <label><span>입력 초안</span>
      <textarea id="ota-test-draft" rows={3} value={ui.otaDraft || ''} onChange={e => runtime.setUI({ otaDraft: e.target.value })}/>
    </label>
    <label><span>선택값</span>
      <select id="ota-test-choice" value={ui.otaChoice || 'a'} onChange={e => runtime.setUI({ otaChoice: e.target.value })}>
        <option value="a">첫째</option><option value="b">둘째</option><option value="c">셋째</option>
      </select>
    </label>
    <ul id="ota-test-list" className="ota-test-list" tabIndex={0} aria-label="스크롤 검증 목록">
      {ROWS.map(row => <li key={row}>{row}</li>)}
    </ul>
    <button type="button" className="text-button" onClick={close}>닫기</button>
  </section>;
}
