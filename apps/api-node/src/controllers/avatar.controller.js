import { randomUUID } from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import User from '../models/User.js';

const upload = multer({ limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0, parts: 2 } }).single('avatar');
const formats = new Map([['image/jpeg', 'jpeg'], ['image/png', 'png']]);

export function readAvatar(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const large = err.code === 'LIMIT_FILE_SIZE';
    res.status(large ? 413 : 400).json({ error: large ? 'La imatge supera 2 MiB' : 'Multipart no vàlid' });
  });
}

export async function saveAvatar(req, res, next) {
  const format = formats.get(req.file?.mimetype);
  if (!format) return res.status(400).json({ error: 'Cal una imatge JPEG o PNG' });
  let avatarBytes;
  try {
    const image = sharp(req.file.buffer, { limitInputPixels: 32_000_000 });
    if ((await image.metadata()).format !== format) throw new Error('format');
    avatarBytes = await image.rotate().resize(512, 512, { fit: 'cover', withoutEnlargement: true }).jpeg().toBuffer();
  } catch {
    return res.status(400).json({ error: 'Imatge no vàlida' });
  }
  try {
    const version = randomUUID();
    const path = `/users/${req.user._id}/avatar/${version}`;
    const avatarUrl = new URL(path, process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').href;
    const result = await User.updateOne({ _id: req.user._id }, { $set: { avatarBytes, avatarVersion: version, avatarUrl } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Usuari no trobat' });
    res.json({ avatarUrl });
  } catch (err) {
    next(err);
  }
}

export async function getAvatar(req, res, next) {
  try {
    const { id, version } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.sendStatus(404);
    const user = await User.findOne({ _id: id, avatarVersion: version }).select('+avatarBytes');
    if (!user?.avatarBytes) return res.sendStatus(404);
    res.set('X-Content-Type-Options', 'nosniff').type('image/jpeg').send(user.avatarBytes);
  } catch (err) {
    next(err);
  }
}
