import React, { useEffect, useRef } from "react";

export function Chat({ chatOpen, setChatOpen, unread, chatOpacity, setChatOpacity, messages, chat, setChat, sendChat, chatInput, keys, route, online, canSend }) {
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
