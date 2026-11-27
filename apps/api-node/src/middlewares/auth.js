import User from '../models/User.js';
import Session from '../models/Session.js';
import { verifyAccessToken } from '../domain/auth.js';

export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

export async function requireAuth(req, res, next) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') ?? '');
  if (!match) return res.status(401).json({ error: 'Autenticació requerida' });
  try {
    const payload = verifyAccessToken(match[1]);
    const user = await User.findById(payload.sub).lean();
    if (!user || (user.sessionVersion ?? 0) !== (payload.sessionVersion ?? 0)) return res.status(401).json({ error: 'Sessió no vàlida' });
    const session = await Session.exists({
      jti: payload.jti, userId: user._id, expiresAt: { $gt: new Date() },
    });
    if (!session) {
      return res.status(401).json({ error: 'Sessió no vàlida' });
    }
    req.user = user;
    req.authSession = { jti: payload.jti };
    next();
  } catch (err) {
    next(err);
  }
}

export function authenticateEventReader(req, res, next) {
  res.vary('Authorization');
  if (req.get('Authorization') === undefined) return next();
  res.set('Cache-Control', 'no-store');
  return requireAuth(req, res, next);
}
