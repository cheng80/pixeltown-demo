import React from 'react';

// The single updater publishes its status into the runtime snapshot (`visual`); this only displays it.
export default function VisualStatus({ status }) {
  if (!status?.revision || status.revision === 'development') return null;
  const message = { preparing: '새 화면 준비 중', applied: '새 화면 적용 완료', retained: '현재 화면 유지', incompatible: '새 화면은 다음 입장 때 적용' }[status.phase];
  return <span className="visual-version" title="현재 화면 코드와 리소스 버전">
    화면 <b>{status.revision.slice(0, 8)}</b>{message && <span role="status"> · {message}</span>}
  </span>;
}
