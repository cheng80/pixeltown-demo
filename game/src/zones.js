// Place tabs: id, icon, label, profile mood line.
export const ZONES = [
  ["lobby", "⛲", "광장", "분수 앞에서 만나요. 표지판을 따라 정원·오락실로!"],
  ["garden", "🌷", "정원", "연못 다리를 건너 온실까지 천천히 산책해요."],
  ["arcade", "🕹️", "오락실", "오락기 사이사이 숨은 별을 찾아요."],
  ["home", "🏠", "미니룸", "모은 별로 산 가구로 내 방을 꾸며요."],
];
export const zoneLabel = id => ZONES.find(z => z[0] === id)?.[2] || id;
