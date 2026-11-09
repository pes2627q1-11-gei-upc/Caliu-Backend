import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { getAuthConfig } from '../config/auth.js';

export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

export async function requireAuth(req, res, next) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') ?? '');
  if (!match) return res.status(401).json({ error: 'Autenticació requerida' });
  try {
    const config = getAuthConfig();
    let payload;
    try {
      payload = jwt.verify(match[1], config.secret, {
        algorithms: ['HS256'], issuer: config.issuer, audience: config.audience,
      });
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
        return res.status(401).json({ error: 'Sessió no vàlida' });
      }
      throw err;
    }
    if (!payload || typeof payload.sub !== 'string' || !/^[a-f0-9]{24}$/i.test(payload.sub)
      || !Number.isSafeInteger(payload.exp) || typeof payload.jti !== 'string'
      || !/^[a-f0-9]{64}$/.test(payload.jti)) {
      return res.status(401).json({ error: 'Sessió no vàlida' });
    }
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ error: 'Sessió no vàlida' });
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
