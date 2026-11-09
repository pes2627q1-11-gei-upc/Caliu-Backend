import User, { publicUser } from '../models/User.js';
import { validateUsername, validatePreferences } from '../domain/userValidation.js';
import { userConflict } from '../domain/userConflict.js';

export function getMe(req, res) {
  res.json(publicUser(req.user));
}

export function getPreferences(req, res) {
  res.json({ preferences: req.user.preferences });
}

// La identitat prové exclusivament del middleware; cap camp intern es desa.
async function updateOwnUser(req, changes) {
  return User.findOneAndUpdate(
    { _id: req.user._id },
    { $set: changes },
    { new: true, runValidators: true },
  );
}

export async function updateMe(req, res, next) {
  try {
    const username = validateUsername(req.body);
    const user = await updateOwnUser(req, { username });
    if (!user) return res.status(401).json({ error: 'Sessió no vàlida' });
    res.json(publicUser(user));
  } catch (err) {
    next(userConflict(err));
  }
}

export async function replacePreferences(req, res, next) {
  try {
    const preferences = validatePreferences(req.body);
    const user = await updateOwnUser(req, { preferences });
    if (!user) return res.status(401).json({ error: 'Sessió no vàlida' });
    res.json({ preferences: user.preferences });
  } catch (err) {
    next(err);
  }
}
