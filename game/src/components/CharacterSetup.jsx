import React, { useRef, useState } from "react";
import { CATALOG } from "../../../shared/world.js";
import { Portrait, Sheet } from "./Pixels.jsx";

// Character set-up (FR-014): nickname, skin, hair colour and style, shirt colour. The PB hook re-checks every value.
export function CharacterSetup({ profile, userId, save, close }) {
  const A = CATALOG.avatar, cur = profile?.avatar || {};
  const [name, setName] = useState(profile?.name || "");
  const [color, setColor] = useState(A.shirts.includes(profile?.color) ? profile.color : A.shirts[0]);
  const [look, setLook] = useState({ skin: cur.skin ?? 0, hair: cur.hair ?? 0, style: cur.style ?? 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [nameError, setNameError] = useState(""), nameInput = useRef(null);
  const length = [...name.trim()].length, nameOk = length >= A.nameMin && length <= A.nameMax;
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(""); setNameError("");
    try { await save({ name: name.trim(), color, avatar: look }); }
    catch (err) {
      // A taken nickname comes back as { data: { name: "taken" } }: point at the field so the player picks another name.
      if (err.response?.data?.name) { setNameError(err.response.message); nameInput.current?.focus(); }
      else setError(err.response?.message || "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
    finally { setBusy(false); }
  }
  const swatches = (label, colors, selected, pick) => (
    <fieldset className="swatches"><legend>{label}</legend>
      {colors.map((c, i) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-label={`${label} ${i + 1}`} aria-pressed={selected === i} onClick={() => pick(i)} />)}
    </fieldset>
  );
  return (
    <Sheet close={close} as="form" className="notebook setup paper" role="dialog" aria-label={close ? "캐릭터 꾸미기" : "캐릭터 만들기"} onSubmit={submit}>
      {!userId && <header className="setup-brand"><h1 className="logo">PIXEL TOWN</h1><p className="tagline">미니홈피 속 작은 마을을 걷고, 이웃과 수다 떨고, 별을 모아요 ♥</p></header>}
      <div className="notebook-head"><b>🎨 {close ? "캐릭터 꾸미기" : "내 캐릭터 만들기"}</b>{close && <button type="button" className="btn tiny ghost" onClick={close}>닫기</button>}</div>
      <div className="notebook-body setup-body">
        <Portrait player={{ id: userId || "new-guest", color, look: { ...profile?.outfit, ...look } }} scale={5} />
        <div className="setup-fields">
          <label className="field">닉네임<input ref={nameInput} value={name} maxLength={A.nameMax} onChange={e => { setName(e.target.value); setNameError(""); }} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "name-error" : "name-hint"} autoFocus={!close} /></label>
          {nameError ? <p id="name-error" className="error" role="alert">{nameError}</p> : <small id="name-hint" className="muted">{A.nameMin}–{A.nameMax}자 · 한글·영문·숫자 · 띄어쓰기·대소문자·_·-만 다른 이름은 같은 이름이에요</small>}
          {swatches("피부", A.skins, look.skin, i => setLook({ ...look, skin: i }))}
          {swatches("머리 색", A.hairs, look.hair, i => setLook({ ...look, hair: i }))}
          <fieldset className="swatches"><legend>머리 모양</legend>
            {A.styles.map((label, i) => <button type="button" key={label} className="btn tiny ghost" aria-pressed={look.style === i} onClick={() => setLook({ ...look, style: i })}>{label}</button>)}
          </fieldset>
          {swatches("옷 색", A.shirts, A.shirts.indexOf(color), i => setColor(A.shirts[i]))}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="notebook-foot"><span className="muted">{close ? "모자·옷·펫은 별 상점에서 사요." : userId ? "나중에 언제든 바꿀 수 있어요." : "입장하면 이 브라우저에 내 캐릭터가 저장돼요."}</span><button className="btn" disabled={busy || !nameOk}>{busy ? "저장 중…" : close ? "저장" : "이대로 입장 ▶"}</button></div>
    </Sheet>
  );
}
