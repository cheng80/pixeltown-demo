import React, { useState } from "react";
import { CATALOG } from "../../../shared/world.js";
import { ItemIcon, Sheet } from "./Pixels.jsx";

const SLOTS = [["hat", "모자"], ["top", "옷"], ["pet", "펫"], ["furniture", "가구"]];

export function Shop({ wallet, unsaved, owned, outfit, buy, wear, me, close }) {
  const [tab, setTab] = useState("hat"), [busy, setBusy] = useState("");
  const run = async (id, fn) => { setBusy(id); try { await fn(); } finally { setBusy(""); } };
  return (
    <Sheet close={close} className="notebook shop paper" role="dialog" aria-label="별 상점">
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
    </Sheet>
  );
}
