import User, { publicUser } from '../models/User.js';
import { validateUsername, validatePreferences, validateProximitatKm } from '../domain/userValidation.js';
import { userConflict } from '../domain/userConflict.js';

export function getMe(req, res) {
  res.json(publicUser(req.user));
}

// Mateixa resposta per a GET i PUT. proximitatKm és null si l'usuari no n'ha triat cap (#123).
function preferencesResponse(user) {
  return { preferences: user.preferences, proximitatKm: user.proximitatKm ?? null };
}

export function getPreferences(req, res) {
  res.json(preferencesResponse(req.user));
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
    const changes = { preferences: validatePreferences(req.body) };
    // Si no s'envia, el radi no canvia: desar només les categories no l'ha d'esborrar.
    if (req.body.proximitatKm !== undefined) {
      changes.proximitatKm = validateProximitatKm(req.body.proximitatKm);
    }
    const user = await updateOwnUser(req, changes);
    if (!user) return res.status(401).json({ error: 'Sessió no vàlida' });
    res.json(preferencesResponse(user));
  } catch (err) {
    next(err);
  }
}
