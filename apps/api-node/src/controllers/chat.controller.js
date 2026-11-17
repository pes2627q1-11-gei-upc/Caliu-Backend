import mongoose from 'mongoose';
import MissatgeXatbot from '../models/MissatgeXatbot.js';
import SessioXatbot from '../models/SessioXatbot.js';
import { proxyToPython } from '../integrations/pythonService.js';

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 1000;

function validateMessage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['message', 'sessionId'].includes(key))) {
    return { error: 'Cos de la petició no vàlid' };
  }
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return { error: 'Camp "message" obligatori' };
  }
  const message = body.message.trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `Camp "message" massa llarg (màxim ${MAX_MESSAGE_LENGTH} caràcters)` };
  }
  if (body.sessionId !== undefined
    && (typeof body.sessionId !== 'string' || !mongoose.isValidObjectId(body.sessionId))) {
    return { error: 'Camp "sessionId" no vàlid' };
  }
  return { message };
}

export async function postChatMessage(req, res, next) {
  const validated = validateMessage(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });

  try {
    let chatSession;
    if (req.body.sessionId) {
      chatSession = await SessioXatbot.findOne({
        _id: req.body.sessionId,
        userId: req.user._id,
      });
      if (!chatSession) return res.status(404).json({ error: 'Sessió de xat no trobada' });
    }

    const history = chatSession
      ? await MissatgeXatbot.find({ sessionId: chatSession._id })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_HISTORY_MESSAGES)
        .lean()
      : [];

    const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const result = await proxyToPython({
      path: '/chat/messages',
      token,
      body: {
        message: validated.message,
        history: history.slice().reverse().map(({ role, content }) => ({
          role,
          content: content.slice(0, MAX_HISTORY_MESSAGE_LENGTH),
        })),
      },
    });
    if (typeof result?.reply !== 'string' || !result.reply.trim()) {
      return next(Object.assign(new Error('Resposta del servei de xatbot no vàlida'), { status: 502 }));
    }

    if (!chatSession) {
      chatSession = await SessioXatbot.create({ userId: req.user._id });
    }

    await MissatgeXatbot.create({
      sessionId: chatSession._id,
      role: 'user',
      content: validated.message,
    });
    await MissatgeXatbot.create({
      sessionId: chatSession._id,
      role: 'assistant',
      content: result.reply,
    });

    return res.status(200).json({
      sessionId: String(chatSession._id),
      reply: result.reply,
    });
  } catch (err) {
    return next(err);
  }
}
