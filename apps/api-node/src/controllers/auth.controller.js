import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User, { USERNAME_COLLATION } from '../models/User.js';
import Session from '../models/Session.js';
import { validateCredentials, normalizeUsername } from '../domain/userValidation.js';
import { getAuthConfig } from '../config/auth.js';
import { prepareSession, sessionResponse } from '../domain/session.js';
import { userConflict, usernameConflict } from '../domain/userConflict.js';

// Hash de farciment: fa que un email inexistent també executi bcrypt.compare.
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Ttx0ft0XDsVYQ6XN8F1Jk79HZf7K';

export async function register(req, res, next) {
  try {
    const { email, password } = validateCredentials(req.body, true);
    const username = normalizeUsername(req.body.username);
    const existingUsername = await User.exists({ username }).collation(USERNAME_COLLATION);
    if (existingUsername) throw usernameConflict();
    const config = getAuthConfig();
    const passwordHash = await bcrypt.hash(password, 12);
    const _id = new mongoose.Types.ObjectId();
    const session = prepareSession(_id, config);
    // Standalone: sessió primer, compte després. Si falla la sessió, no hi ha compte.
    // Una sessió òrfena no autentica ningú i caduca per TTL; mai eliminem comptes.
    await Session.create({ userId: _id, jti: session.jti, expiresAt: session.expiresAt });
    let user;
    try {
      user = await User.create({ _id, email, username, passwordHash });
    } catch (err) {
      try { await Session.deleteOne({ userId: _id, jti: session.jti }); }
      catch { console.error('No s’ha pogut netejar una sessió òrfena'); }
      throw userConflict(err);
    }
    res.status(201).json(sessionResponse(user, session, config));
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = validateCredentials(req.body);
    const config = getAuthConfig();
    const user = await User.findOne({ email }).select('+passwordHash');
    const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !matches) {
      return res.status(401).json({ error: 'Credencials incorrectes' });
    }
    const session = prepareSession(user._id, config);
    await Session.create({ userId: user._id, jti: session.jti, expiresAt: session.expiresAt });
    res.json(sessionResponse(user, session, config));
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const result = await Session.deleteOne({
      userId: req.user._id, jti: req.authSession.jti, expiresAt: { $gt: new Date() },
    });
    if (result.deletedCount !== 1) return res.status(401).json({ error: 'Sessió no vàlida' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
