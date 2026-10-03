import React from "react";
import { ITEMS } from "../../../shared/world.js";
import { zoneLabel } from "../zones.js";
import { Portrait, Sheet } from "./Pixels.jsx";

export function Notebook({ records, earned, recordError, loadRecords, me, close }) {
  return (
    <Sheet close={close} className="notebook paper" role="dialog" aria-label="내 수첩">
      <div className="notebook-head"><b>📒 나의 미니 수첩</b><button className="btn tiny ghost" onClick={close} aria-label="수첩 닫기">닫기</button></div>
      <div className="notebook-body">
        <div className="nb-profile"><Portrait player={me} scale={3} className="portrait small" /><div><h3>{records.profiles[0]?.name || me.name}</h3><p>이 브라우저에 저장된 내 캐릭터</p></div></div>
        <h4>별 보상 <span>{earned}개</span></h4>
        {records.inventory.length ? records.inventory.slice(0, 20).map(i => <div className="record" key={i.id}><span>★ 별 조각</span><b>×{i.quantity ?? 0}</b></div>) : <p className="empty">아직 모은 별이 없어요.</p>}
        <h4>산 물건 <span>{records.purchases.length}개</span></h4>
        {records.purchases.length ? <p className="owned-list">{records.purchases.map(p => ITEMS[p.item]?.name || p.item).join(" · ")}</p> : <p className="empty">아직 산 물건이 없어요.</p>}
        <h4>최근 기록</h4>
        {records.results.length ? records.results.slice(0, 10).map(r => <div className="record" key={r.id}><span>{zoneLabel(r.zone)}<small>{new Date(r.ended_at || r.created).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small></span><b>{r.score ?? 0}점</b></div>) : <p className="empty">첫 번째 별 모으기에 도전해 보세요.</p>}
        {recordError && <p className="error" role="alert">{recordError}</p>}
      </div>
      <div className="notebook-foot"><button className="btn small ghost" onClick={loadRecords}>새로고침</button></div>
    </Sheet>
  );
}
