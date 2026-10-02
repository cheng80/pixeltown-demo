import { createHash } from 'node:crypto';
import PocketBase from 'pocketbase';

// Cache only a digest of the Basic header and the PocketBase token, never the password.
// deniedEmails: superusers that must never open the monitor (the Colyseus outbox service account).
export function pocketbaseAdminGuard(pbUrl, monitorOrigins, deniedEmails = new Set()) {
  const sessions = new Map();
  const attempts = new Map();
  return async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Monitor includes GET endpoints that change rooms. Reject cross-site API calls.
    if (req.headers['sec-fetch-site'] === 'cross-site' && req.headers['sec-fetch-mode'] !== 'navigate') {
      return res.status(403).send('Cross-site monitor requests are blocked');
    }
    if (req.path.startsWith('/api') && req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).send('Cross-site monitor requests are blocked');
    }
    if (req.headers.origin && !monitorOrigins.has(req.headers.origin)) {
      return res.status(403).send('Cross-origin monitor requests are blocked');
    }
    const deny = () => {
      res.setHeader('WWW-Authenticate', 'Basic realm="Pixeltown PocketBase Administrator", charset="UTF-8"');
      res.status(401).send('PocketBase administrator login required');
    };
    const header = req.headers.authorization;
    if (!header?.startsWith('Basic ') || header.length > 8192) return deny();
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 1) return deny();
    const email = decoded.slice(0, colon), password = decoded.slice(colon + 1);
    if (deniedEmails.has(email.toLowerCase())) return deny();
    const key = createHash('sha256').update(header).digest('hex');
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
    for (const [k, v] of attempts) if (v.expires < now) attempts.delete(k);
    const source = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const pb = new PocketBase(pbUrl);
    try {
      const cached = sessions.get(key);
      if (cached) {
        pb.authStore.save(cached.token);
        const auth = await pb.collection('_superusers').authRefresh({ signal: AbortSignal.timeout(5000) });
        cached.token = auth.token;
      } else {
        const rate = attempts.get(source) || { count: 0, expires: now + 300000 };
        if (rate.count >= 10 || attempts.size >= 1024) {
          res.setHeader('Retry-After', '300'); return res.status(429).send('Too many login attempts');
        }
        rate.count++; attempts.set(source, rate);
        const auth = await pb.collection('_superusers').authWithPassword(email, password, { signal: AbortSignal.timeout(5000) });
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        sessions.set(key, { token: auth.token, expires: now + 300000 });
      }
      next();
    } catch { sessions.delete(key); deny(); }
  };
}
