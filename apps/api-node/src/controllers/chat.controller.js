import mongoose from 'mongoose';
import MissatgeXatbot from '../models/MissatgeXatbot.js';
import SessioXatbot from '../models/SessioXatbot.js';
import { proxyToPython } from '../integrations/pythonService.js';
import { httpError } from '../domain/httpError.js';

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 1000;

function validateMessage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['message', 'sessionId'].includes(key))) {
    return { error: 'Cos de la petició no vàlid', code: 'INVALID_BODY' };
  }
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return { error: 'Camp "message" obligatori', code: 'MESSAGE_REQUIRED' };
  }
  const message = body.message.trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `Camp "message" massa llarg (màxim ${MAX_MESSAGE_LENGTH} caràcters)`, code: 'MESSAGE_TOO_LONG' };
  }
  if (body.sessionId !== undefined
    && (typeof body.sessionId !== 'string' || !mongoose.isValidObjectId(body.sessionId))) {
    return { error: 'Camp "sessionId" no vàlid', code: 'INVALID_SESSION_ID' };
  }
  return { message };
}

export async function postChatMessage(req, res, next) {
  const validated = validateMessage(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code });

  try {
    let chatSession;
    if (req.body.sessionId) {
      chatSession = await SessioXatbot.findOne({
        _id: req.body.sessionId,
        userId: req.user._id,
      });
      if (!chatSession) return res.status(404).json({ error: 'Sessió de xat no trobada', code: 'SESSION_NOT_FOUND' });
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
      return next(httpError(502, 'Resposta del servei de xatbot no vàlida', 'CHATBOT_INVALID_RESPONSE'));
    }

    if (!chatSession) {
      chatSession = await SessioXatbot.create({ userId: req.user._id });
    }

    // "fallback" (#142): Gemini no ha respost i Python dona una resposta alternativa. No es desa a
    // l'historial: si l'usuari torna a enviar el missatge, no queda duplicat. La sessió es manté.
    const isFallback = result.type === 'fallback';
    if (!isFallback) {
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
    }

    // "plan" (#140): itinerari de passos per al widget de l'app. Si no és vàlid, es respon com a text.
    const isPlan = result.type === 'plan' && Array.isArray(result.plan?.steps) && result.plan.steps.length > 0;
    let type = 'text';
    if (isPlan) type = 'plan';
    else if (isFallback) type = 'fallback';
    return res.status(200).json({
      sessionId: String(chatSession._id),
      type,
      reply: result.reply,
      ...(isPlan ? { plan: result.plan } : {}),
    });
  } catch (err) {
    return next(err);
  }
}
