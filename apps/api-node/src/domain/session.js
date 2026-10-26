import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { publicUser } from '../models/User.js';

// Es prepara i signa abans d'escriure; mai es desa el JWT complet.
export function prepareSession(userId, config) {
  const jti = randomBytes(32).toString('hex');
  const iat = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ iat }, config.secret, {
    algorithm: 'HS256', subject: String(userId), jwtid: jti, expiresIn: config.expiresIn,
    issuer: config.issuer, audience: config.audience,
  });
  return { token, jti, userId, expiresAt: new Date((iat + config.expiresIn) * 1000) };
}

export function sessionResponse(user, session, config) {
  return { user: publicUser(user), token: session.token, tokenType: 'Bearer', expiresIn: config.expiresIn };
}
