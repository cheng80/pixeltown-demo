import React, { useEffect, useState } from 'react';

export default function VisualStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const receive = event => setStatus(event.detail);
    window.addEventListener('minimal-visual-status', receive);
    setStatus(window.__minimalVisual?.status || null);
    return () => window.removeEventListener('minimal-visual-status', receive);
  }, []);
  if (!status || status.revision === 'development') return null;
  const message = { preparing: '새 화면 준비 중', applied: '새 화면 적용 완료', retained: '현재 화면 유지', incompatible: '새 화면은 다음 입장 때 적용' }[status.phase];
  return <span className="visual-version" title="현재 화면 코드와 리소스 버전">
    화면 <b>{status.revision.slice(0, 8)}</b>{message && <span role="status"> · {message}</span>}
  </span>;
}
