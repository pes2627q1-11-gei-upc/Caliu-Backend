import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User, { publicUser } from '../models/User.js';
import { validateCredentials } from '../domain/userValidation.js';
import { getAuthConfig } from '../config/auth.js';

// Hash de farciment: fa que un email inexistent també executi bcrypt.compare.
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Ttx0ft0XDsVYQ6XN8F1Jk79HZf7K';

export async function register(req, res, next) {
  try {
    const { email, password } = validateCredentials(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return next(Object.assign(new Error('El correu ja està registrat'), { status: 409 }));
    }
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = validateCredentials(req.body);
    const config = getAuthConfig();
    const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
    const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !matches) {
      return res.status(401).json({ error: 'Credencials incorrectes' });
    }
    const token = jwt.sign({ tokenVersion: user.tokenVersion }, config.secret, {
      algorithm: 'HS256', subject: String(user._id), expiresIn: config.expiresIn,
      issuer: config.issuer, audience: config.audience,
    });
    res.json({ user: publicUser(user), token, tokenType: 'Bearer', expiresIn: config.expiresIn });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const result = await User.updateOne(
      { _id: req.user._id, tokenVersion: req.user.tokenVersion },
      { $inc: { tokenVersion: 1 } },
    );
    if (result.matchedCount !== 1) return res.status(401).json({ error: 'Sessió no vàlida' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
