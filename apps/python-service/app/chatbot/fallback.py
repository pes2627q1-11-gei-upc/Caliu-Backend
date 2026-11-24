# Resposta alternativa del xat quan Gemini no respon (#142, HU #14): text fix en la llengua de l'usuari i,
# si n'hi ha, fins a MAX_FALLBACK_EVENTS esdeveniments, perquè la conversa no quedi bloquejada.
# No depèn de Gemini: es pot donar encara que Gemini estigui caigut.

from datetime import datetime, timezone

from app.chatbot.intent import TZ
from app.chatbot.language import DEFAULT_LANGUAGE

MAX_FALLBACK_EVENTS = 3

TEXTS = {
    "ca": {
        "events": "Ara mateix no puc generar una resposta completa, però aquí tens algunes activitats "
                  "que et poden interessar:",
        "alternatives": "No he trobat activitats per aquests criteris i ara mateix no puc generar una resposta "
                        "completa. Aquí tens algunes propostes més generals:",
        "empty": "Ara mateix no puc respondre i no he trobat activitats per aquests criteris. "
                 "Torna-ho a provar d'aquí a una estona o prova amb una altra data o zona.",
        "ongoing": "en curs",
        "retry": "Pots tornar a enviar el missatge per tenir una resposta completa.",
    },
    "es": {
        "events": "Ahora mismo no puedo generar una respuesta completa, pero aquí tienes algunas actividades "
                  "que te pueden interesar:",
        "alternatives": "No he encontrado actividades para estos criterios y ahora mismo no puedo generar una "
                        "respuesta completa. Aquí tienes algunas propuestas más generales:",
        "empty": "Ahora mismo no puedo responder y no he encontrado actividades para estos criterios. "
                 "Vuelve a intentarlo dentro de un rato o prueba con otra fecha o zona.",
        "ongoing": "en curso",
        "retry": "Puedes volver a enviar el mensaje para obtener una respuesta completa.",
    },
    "en": {
        "events": "I can't generate a full answer right now, but here are some activities you might like:",
        "alternatives": "I couldn't find activities for these criteria and I can't generate a full answer right "
                        "now. Here are some broader suggestions:",
        "empty": "I can't answer right now and I couldn't find activities for these criteria. "
                 "Please try again in a while or try another date or area.",
        "ongoing": "ongoing",
        "retry": "You can send the message again to get a full answer.",
    },
}


# Mongo retorna les dates sense zona horària (en UTC).
def _local(value: datetime) -> datetime:
    return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value).astimezone(TZ)


def _line(event: dict, now: datetime, texts: dict) -> str:
    start = event.get("startDate")
    when = ""
    if isinstance(start, datetime):
        local = _local(start)
        when = texts["ongoing"] if local < now else local.strftime("%d/%m %H:%M")
    parts = [event.get("title", ""), when, event.get("municipality", "")]
    return "- " + " · ".join(part for part in parts if part)


def fallback_reply(events: list[dict], alternatives: bool, now: datetime, language: str = DEFAULT_LANGUAGE) -> str:
    texts = TEXTS.get(language, TEXTS[DEFAULT_LANGUAGE])
    if not events:
        return texts["empty"]
    header = texts["alternatives" if alternatives else "events"]
    lines = [_line(event, now.astimezone(TZ), texts) for event in events[:MAX_FALLBACK_EVENTS]]
    return "\n".join([header, *lines, texts["retry"]])
