# Resposta "pla" del xatbot (#140, HU #13): quan l'usuari demana un itinerari, es retorna una llista de
# passos encadenats (build_itinerary, #139) que l'app mostra amb un widget dins del xat. La resta de
# missatges continuen sent una resposta de text de Gemini.

from dataclasses import replace
from datetime import datetime, time

from app.chatbot.intent import TZ
from app.chatbot.itinerary import build_itinerary
from app.chatbot.language import DEFAULT_LANGUAGE, LANGUAGE_NAMES
from app.chatbot.rag import answer_with_events, extract_message_filters, retrieve_upcoming_events

# Text que acompanya el pla. Sense una segona crida a Gemini: el pla es pot mostrar encara que falli.
TEXTS = {
    "ca": {
        "plan": "Aquí tens un itinerari de {n} passos per al {date}:",
        "single": "Només he trobat una activitat que encaixi per al {date}:",
        "empty": "No he trobat activitats per encadenar en un itinerari per al {date}. "
                 "Prova amb una altra data, franja o zona.",
    },
    "es": {
        "plan": "Aquí tienes un itinerario de {n} pasos para el {date}:",
        "single": "Solo he encontrado una actividad que encaje para el {date}:",
        "empty": "No he encontrado actividades para encadenar en un itinerario para el {date}. "
                 "Prueba con otra fecha, franja o zona.",
    },
    "en": {
        "plan": "Here is a {n}-step itinerary for {date}:",
        "single": "I only found one activity that fits on {date}:",
        "empty": "I couldn't find activities to chain into an itinerary on {date}. "
                 "Try another date, time of day or area.",
    },
}


def _hour(iso: str) -> str:
    return datetime.fromisoformat(iso).strftime("%H:%M")


def plan_reply(steps: list[dict], day: datetime, language: str = DEFAULT_LANGUAGE) -> str:
    texts = TEXTS.get(language, TEXTS[DEFAULT_LANGUAGE])
    date = day.strftime("%d/%m")
    if not steps:
        return texts["empty"].format(date=date)
    header = texts["single" if len(steps) == 1 else "plan"].format(n=len(steps), date=date)
    lines = []
    for step in steps:
        place = f" ({step['municipality']})" if step.get("municipality") else ""
        lines.append(f"{step['order']}. {_hour(step['start'])}–{_hour(step['end'])} · {step['title']}{place}")
    return "\n".join([header, *lines])


# Resposta del xat: {"type": "plan", "reply", "plan": {"date", "steps"}} si es demana un itinerari,
# o {"type": "text", "reply"} per a la resta (també si l'itinerari no té cap pas).
def answer_chat(
    message: str,
    now: datetime | None = None,
    client=None,
    collection=None,
    filter_extractor=None,
    history: list[dict] | None = None,
    language: str = DEFAULT_LANGUAGE,
) -> dict:
    now = (now or datetime.now(TZ)).astimezone(TZ)
    filters = extract_message_filters(message, now, history, filter_extractor)
    # Una data passada la respon el text normal, que ja explica que ha passat.
    if not filters.itinerary or filters.date_passed:
        reply = answer_with_events(
            message, now=now, client=client, collection=collection, history=history,
            language_name=LANGUAGE_NAMES.get(language), filters=filters,
        )
        return {"type": "text", "reply": reply}

    # Un itinerari és per a un sol dia: el primer dia demanat, des d'ara si és avui.
    start = max(filters.from_ or now, now).astimezone(TZ)
    end_of_day = datetime.combine(start.date(), time(23, 59, 59), TZ)
    until = min(filters.to, end_of_day) if filters.to else end_of_day
    events, _ = retrieve_upcoming_events(
        now=now, filters=replace(filters, from_=start, to=until), collection=collection,
    )
    steps = build_itinerary(events, start, until=until) if until > start else []
    reply = plan_reply(steps, start, language)
    if not steps:
        return {"type": "text", "reply": reply}
    return {"type": "plan", "reply": reply, "plan": {"date": start.date().isoformat(), "steps": steps}}
