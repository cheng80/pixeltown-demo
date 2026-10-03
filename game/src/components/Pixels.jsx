import React, { useEffect, useRef } from "react";
import { avatarSprite, lookFor, petSprite, propSprite } from "../sprites.js";

// A canvas repainted with crisp pixels whenever `deps` change.
function usePixels(paint, deps) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    paint(c);
  }, deps);
  return ref;
}

export function Portrait({ player, scale = 6, className = "portrait" }) {
  const look = lookFor(player);
  const ref = usePixels(c => {
    c.drawImage(avatarSprite(look, 0, 0), 0, 0, 18 * scale, 31 * scale);
    const pet = look.pet && petSprite(look.pet, 0);
    if (pet) c.drawImage(pet, 11 * scale, 19 * scale, 14 * scale * 0.7, 14 * scale * 0.7);
  }, [look.key, look.pet, scale]);
  return <div className={className}><canvas ref={ref} width={18 * scale} height={31 * scale} aria-hidden="true" /></div>;
}

// Small dot preview for a catalogue item (furniture sprite, pet, or the avatar wearing it).
export function ItemIcon({ item, player }) {
  const ref = usePixels(c => {
    const worn = item.slot === "hat" || item.slot === "top";
    const spr = item.slot === "furniture" ? propSprite({ type: item.id }) : item.slot === "pet" ? petSprite(item.id, 0)
      : avatarSprite(lookFor({ ...player, look: { [item.slot]: item.id } }), 0, 0);
    // hats show the head, tops the body (2x, cropped); other items fit the box
    const k = worn ? 2 : Math.max(1, Math.floor(Math.min(64 / spr.width, 64 / spr.height)));
    const y = item.slot === "hat" ? 2 : item.slot === "top" ? 64 - spr.height * k + 4 : Math.floor((64 - spr.height * k) / 2);
    c.drawImage(spr, Math.floor((64 - spr.width * k) / 2), y, spr.width * k, spr.height * k);
  }, [item.id]);
  return <canvas ref={ref} width={64} height={64} className="item-icon" aria-hidden="true" />;
}

// Modal sheet: clicking the backdrop closes it, clicks inside the panel do not.
export function Sheet({ close, as: Panel = "aside", backdrop = "sheet-backdrop", children, ...panel }) {
  return <div className={backdrop} onClick={close}><Panel {...panel} onClick={e => e.stopPropagation()}>{children}</Panel></div>;
}
