export const PREFIX = 'pixeltown.minimal.';

export function readStored(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key)) ?? fallback; }
  catch { return fallback; }
}
export function writeStored(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function validateWallet(data) {
  if (!data || !Number.isSafeInteger(data.balance) || data.balance < 0 ||
      !Array.isArray(data.settledMatchIds) || !data.settledMatchIds.every(id => typeof id === 'string') ||
      typeof data.profile?.name !== 'string') throw new Error('Invalid wallet response');
  return data;
}

// A failed or superseded request must never replace the last confirmed balance.
export class WalletState {
  generation = 0;
  value = null;
  status = 'unknown';
  begin() { this.status = 'checking'; return ++this.generation; }
  accept(generation, value) {
    if (generation !== this.generation) return false;
    this.value = validateWallet(value);
    this.status = 'confirmed';
    return true;
  }
  fail(generation) {
    if (generation !== this.generation) return false;
    this.status = 'unknown';
    return true;
  }
  invalidate() { this.generation++; }
}

export function rememberScore(ledger, matchId, score, durable = false, settled = []) {
  if (typeof matchId !== 'string' || !matchId || !Number.isSafeInteger(score) || score < 1 || settled.includes(matchId)) return ledger;
  const old = ledger[matchId];
  return { ...ledger, [matchId]: { score: Math.max(old?.score || 0, score), durable: durable || !!old?.durable } };
}
export function reconcileLedger(ledger, settledIds) {
  const settled = new Set(settledIds);
  return Object.fromEntries(Object.entries(ledger).filter(([id]) => !settled.has(id)));
}
export function cleanLedger(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .filter(([id, row]) => id && Number.isSafeInteger(row?.score) && row.score > 0)
    .map(([id, row]) => [id, { score: row.score, durable: row.durable === true }]));
}
export function pendingTotal(ledger) { return Object.values(ledger).reduce((sum, row) => sum + row.score, 0); }
export function errorStatus(error) { return Number(error?.status || error?.code || error?.response?.code || 0); }
export function retryDelay(error) {
  return errorStatus(error) === 429 ? Math.max(60000, Number(error.retryAfterMs) || 0) : 10000;
}
export function failureMessage(error, area) {
  const status = errorStatus(error);
  if (status === 429) return '요청이 잠시 몰렸어요. 잠시 기다린 뒤 다시 시도해 주세요.';
  if (area === 'wallet') return status === 401 || status === 403
    ? '별 저장 내역을 확인하려면 다시 입장해 주세요.'
    : '저장된 별을 확인하지 못했어요. 마지막으로 확인한 수량을 표시하고 있어요.';
  if (area === 'guest' && status === 400) return '사용할 수 없는 닉네임이에요. 다른 이름으로 다시 입력해 주세요.';
  if (status === 401 || status === 403) return '입장 정보를 확인하지 못했어요. 잠시 후 다시 입장해 주세요.';
  return area === 'game' ? '광장에 연결하지 못했어요. 잠시 후 다시 입장해 주세요.' : '지금은 입장할 수 없어요. 잠시 후 다시 시도해 주세요.';
}
