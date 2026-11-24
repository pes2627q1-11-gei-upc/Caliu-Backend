import mongoose from 'mongoose';
import Follow from '../models/Follow.js';
import User from '../models/User.js';

export async function validateFollowTarget(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isObjectIdOrHexString(id)) return res.status(400).json({ error: 'Identificador no vàlid' });
    if (String(req.user._id) === id.toLowerCase()) return res.status(400).json({ error: 'No et pots seguir a tu mateix' });
    if (!await User.exists({ _id: id })) return res.status(404).json({ error: 'Usuari no trobat' });
    next();
  } catch (err) {
    next(err);
  }
}

export async function follow(req, res, next) {
  const relation = { follower: req.user._id, followed: req.params.id };
  try {
    await Follow.updateOne(relation, { $setOnInsert: relation }, { upsert: true });
    res.sendStatus(204);
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.follower && err.keyPattern?.followed) return res.sendStatus(204);
    next(err);
  }
}

export async function unfollow(req, res, next) {
  try {
    await Follow.deleteOne({ follower: req.user._id, followed: req.params.id });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

// Llistes de seguidors i seguits (#183, HU #62). `by` és el camp que identifica l'usuari consultat i
// `other`, l'usuari de cada element de la llista. Només s'exposen l'id i el username (per obrir el
// perfil públic). Es descarten les relacions amb comptes que ja no existeixen o sense username, de
// manera que `total` sempre coincideix amb el nombre d'elements. Del seguiment més recent al més antic.
function listFollows(by, other) {
  return async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!mongoose.isObjectIdOrHexString(id)) return res.status(400).json({ error: 'Identificador no vàlid' });
      if (!await User.exists({ _id: id })) return res.status(404).json({ error: 'Usuari no trobat' });
      const follows = await Follow.find({ [by]: id })
        .sort({ _id: -1 })
        .select(other)
        .populate({ path: other, select: 'username' })
        .lean();
      const items = follows
        .map((relation) => relation[other])
        .filter((user) => typeof user?.username === 'string')
        .map(({ _id, username }) => ({ id: String(_id), username }));
      return res.json({ items, total: items.length });
    } catch (err) {
      return next(err);
    }
  };
}

export const listFollowers = listFollows('followed', 'follower');
export const listFollowing = listFollows('follower', 'followed');
