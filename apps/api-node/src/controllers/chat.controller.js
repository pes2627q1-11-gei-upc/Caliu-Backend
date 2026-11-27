import mongoose from 'mongoose';
import MissatgeXatbot from '../models/MissatgeXatbot.js';
import SessioXatbot, { SESSION_TITLE_LENGTH } from '../models/SessioXatbot.js';
import { proxyToPython } from '../integrations/pythonService.js';
import { httpError } from '../domain/httpError.js';

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 1000;
// Idiomes de l'app (#147): Python el fa servir quan no pot detectar l'idioma del missatge.
const LOCALES = ['ca', 'es', 'en'];

function validateMessage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['message', 'sessionId', 'locale'].includes(key))) {
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
  if (body.locale !== undefined && !LOCALES.includes(body.locale)) {
    return { error: `Camp "locale" no vàlid (${LOCALES.join(', ')})`, code: 'INVALID_LOCALE' };
  }
  return { message, locale: body.locale };
}

// "Nova conversa" (#161, HU #47): crea una sessió buida. Els missatges que s'hi enviïn no porten
// cap context de les sessions anteriors, que es conserven per a l'historial (#48).
export async function createChatSession(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
    return res.status(400).json({ error: 'Cos de la petició no vàlid', code: 'INVALID_BODY' });
  }
  try {
    const chatSession = await SessioXatbot.create({ userId: req.user._id });
    return res.status(201).json({ sessionId: String(chatSession._id), createdAt: chatSession.createdAt });
  } catch (err) {
    return next(err);
  }
}

// Historial (#163): la sessió passa a ser la més recent i, si encara no en té, pren com a títol l'inici
// del primer missatge. $literal evita que un missatge que comenci per "$" s'interpreti com un camp.
// Si falla, la resposta no es perd: els missatges ja estan desats i només queda l'ordre desactualitzat.
async function touchSession(sessionId, message) {
  const title = Array.from(message).slice(0, SESSION_TITLE_LENGTH).join('').trim();
  try {
    await SessioXatbot.updateOne({ _id: sessionId }, [
      { $set: { lastActivityAt: new Date(), title: { $ifNull: ['$title', { $literal: title }] } } },
    ]);
  } catch {
    console.error('No s’ha pogut actualitzar la sessió de xat');
  }
}

const toSession = ({ _id, title, createdAt, lastActivityAt, updatedAt }) => ({
  id: String(_id),
  title: title ?? null,
  createdAt,
  lastActivityAt: lastActivityAt ?? updatedAt ?? createdAt,
});

// GET /chat/sessions (#163, HU #48): sessions de l'usuari autenticat, de la més recent a la més antiga.
// Inclou les sessions buides creades amb POST /chat/sessions (title null), perquè l'app pugui reobrir
// la immediatament anterior encara que no tingui missatges.
export async function listChatSessions(req, res, next) {
  try {
    const sessions = await SessioXatbot.find({ userId: req.user._id })
      .sort({ lastActivityAt: -1, _id: -1 })
      .select('title createdAt updatedAt lastActivityAt')
      .lean();
    return res.json({ items: sessions.map(toSession) });
  } catch (err) {
    return next(err);
  }
}

// GET /chat/sessions/:id/messages (#163): missatges en ordre cronològic. Una sessió d'una altra persona
// respon igual que una inexistent (404), sense revelar que existeix.
export async function listChatMessages(req, res, next) {
  const { id } = req.params;
  if (!mongoose.isObjectIdOrHexString(id)) {
    return res.status(400).json({ error: 'Identificador de sessió no vàlid', code: 'INVALID_SESSION_ID' });
  }
  try {
    const chatSession = await SessioXatbot.exists({ _id: id, userId: req.user._id });
    if (!chatSession) return res.status(404).json({ error: 'Sessió de xat no trobada', code: 'SESSION_NOT_FOUND' });
    const messages = await MissatgeXatbot.find({ sessionId: id })
      .sort({ createdAt: 1, _id: 1 })
      .select('role content createdAt')
      .lean();
    return res.json({
      items: messages.map(({ _id, role, content, createdAt }) => ({ id: String(_id), role, content, createdAt })),
    });
  } catch (err) {
    return next(err);
  }
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
        ...(validated.locale ? { locale: validated.locale } : {}),
      },
    });
    if (typeof result?.reply !== 'string' || !result.reply.trim()) {
      return next(httpError(502, 'Resposta del servei de xatbot no vàlida', 'CHATBOT_INVALID_RESPONSE'));
    }
    const events = Array.isArray(result.events) ? result.events : [];
    // Filtres interpretats (#138): l'app els mostra sota la resposta. null si Python no n'envia.
    const filters = result.filters && typeof result.filters === 'object' && !Array.isArray(result.filters)
      ? result.filters
      : null;

    // "fallback" (#142): Gemini no ha respost i Python dona una resposta alternativa. No es desa a
    // l'historial: si l'usuari torna a enviar el missatge, no queda duplicat. Si era una conversa nova,
    // tampoc es crea la sessió (no quedaria buida a l'historial de converses) i sessionId és null.
    const isFallback = result.type === 'fallback';
    if (!chatSession && !isFallback) {
      chatSession = await SessioXatbot.create({ userId: req.user._id });
    }
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
      await touchSession(chatSession._id, validated.message);
    }

    // "plan" (#140): itinerari de passos per al widget de l'app. Si no és vàlid, es respon com a text.
    const isPlan = result.type === 'plan' && Array.isArray(result.plan?.steps) && result.plan.steps.length > 0;
    let type = 'text';
    if (isPlan) type = 'plan';
    else if (isFallback) type = 'fallback';
    return res.status(200).json({
      sessionId: chatSession ? String(chatSession._id) : null,
      type,
      reply: result.reply,
      events,
      filters,
      ...(isPlan ? { plan: result.plan } : {}),
    });
  } catch (err) {
    return next(err);
  }
}
