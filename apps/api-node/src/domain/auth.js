import jwt from 'jsonwebtoken';
import { getAuthConfig } from '../config/auth.js';
import { httpError } from './httpError.js';

export function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw httpError(401, 'Autenticació requerida');
  }

  const config = getAuthConfig();
  let payload;
  try {
    payload = jwt.verify(token, config.secret, {
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
    });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
      throw httpError(401, 'Sessió no vàlida');
    }
    throw err;
  }

  if (!payload || typeof payload.sub !== 'string' || !/^[a-f0-9]{24}$/i.test(payload.sub)
    || !Number.isSafeInteger(payload.exp) || typeof payload.jti !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.jti)) {
    throw httpError(401, 'Sessió no vàlida');
  }
  return payload;
}
