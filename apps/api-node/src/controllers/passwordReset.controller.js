import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { normalizeEmail, validateFields, validatePassword } from '../domain/userValidation.js';
import { sendResetCode } from '../services/resetEmail.js';

const digest = (token) => createHash('sha256').update(token).digest('hex');

export async function forgotPassword(req, res, next) {
  try {
    validateFields(req.body, ['email']);
    const email = normalizeEmail(req.body.email);
    if (!process.env.RESEND_API_KEY || !process.env.RESET_EMAIL_FROM) {
      return res.status(503).json({ error: 'Servei de recuperació no disponible' });
    }
    const token = randomBytes(24).toString('hex');
    const result = await User.updateOne({ email }, {
      $set: { resetDigest: digest(token), resetExpiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    if (result.matchedCount) {
      void sendResetCode(email, token).catch(() => console.error('Error enviant el correu de recuperació'));
    }
    res.sendStatus(202);
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    validateFields(req.body, ['token', 'password']);
    const password = validatePassword(req.body.password);
    const { token } = req.body;
    const invalid = () => res.status(400).json({ error: 'Codi invàlid o caducat' });
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return invalid();
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.findOneAndUpdate({ resetDigest: digest(token), resetExpiresAt: { $gt: new Date() } }, {
      $inc: { sessionVersion: 1 }, $set: { passwordHash }, $unset: { resetDigest: '', resetExpiresAt: '' },
    });
    if (!user) return invalid();
    await Session.deleteMany({ userId: user._id });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}
