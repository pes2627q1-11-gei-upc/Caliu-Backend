from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.routers.chat as chat_router
from app.chatbot.intent import TZ, normalize_filters
from app.chatbot.plan import answer_chat, plan_reply
from app.main import app

# Dissabte 21/11/2026 a les 10:00, a Girona.
NOW = datetime(2026, 11, 21, 10, 0, tzinfo=TZ)
CATEDRAL = [2.8259, 41.9875]
RAMBLA = [2.8240, 41.9845]


def at(hour, minute=0, day=21):
    return datetime(2026, 11, day, hour, minute, tzinfo=TZ)


def event(title, start, end, coords=None, municipality="Girona"):
    doc = {"_id": title, "title": title, "startDate": start, "endDate": end, "municipality": municipality,
           "source": "ingest"}
    if coords:
        doc["location"] = {"type": "Point", "coordinates": coords}
    return doc


SATURDAY = [
    event("Visita guiada al Call", at(10, 30), at(12), CATEDRAL),
    event("Concert vermut", at(12, 30), at(13, 30), RAMBLA),
    event("Titelles", at(16), at(17), RAMBLA),  # 2,5 h després del vermut (màxim 3 h)
]
SUNDAY = [event("Fira de diumenge", at(11, day=22), at(12, day=22), CATEDRAL)]


class FakeCollection:
    # Retorna sempre els mateixos documents: el filtratge per dia el fa build_itinerary amb `until`.
    def __init__(self, documents):
        self.documents = documents
        self.projections = []

    def find(self, query, projection, **_kwargs):
        self.projections.append(projection)
        docs = list(self.documents)
        return SimpleNamespace(sort=lambda *_: SimpleNamespace(limit=lambda *_: iter(docs)))

    def count_documents(self, *_args, **_kwargs):
        return len(self.documents)


class FakeGemini:
    def __init__(self):
        self.calls = []

    def generate(self, contents, **kwargs):
        self.calls.append(kwargs["system_instruction"])
        return "Resposta de text."


def extractor(args):
    calls = []

    def extract(message, now):
        calls.append(message)
        return normalize_filters(args, NOW)

    extract.calls = calls
    return extract


@pytest.fixture(autouse=True)
def development(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")


def test_itinerary_request_returns_a_plan():
    gemini, extract = FakeGemini(), extractor({"itinerary": True})
    collection = FakeCollection(SATURDAY + SUNDAY)

    answer = answer_chat("fes-me un itinerari per avui", now=NOW, client=gemini, collection=collection,
                         filter_extractor=extract)

    assert answer["type"] == "plan"
    assert answer["plan"]["date"] == "2026-11-21"
    assert [s["title"] for s in answer["plan"]["steps"]] == ["Visita guiada al Call", "Concert vermut", "Titelles"]
    assert answer["reply"] == (
        "Aquí tens un itinerari de 3 passos per al 21/11:\n"
        "1. 10:30–12:00 · Visita guiada al Call (Girona)\n"
        "2. 12:30–13:30 · Concert vermut (Girona)\n"
        "3. 16:00–17:00 · Titelles (Girona)"
    )
    assert len(extract.calls) == 1  # una sola extracció de filtres
    assert gemini.calls == []  # el pla no necessita una segona crida a Gemini
    assert all(p.get("location") == 1 for p in collection.projections)  # coordenades per a les distàncies


def test_steps_keep_the_widget_fields():
    answer = answer_chat("itinerari", now=NOW, client=FakeGemini(), collection=FakeCollection(SATURDAY),
                         filter_extractor=extractor({"itinerary": True}))
    step = answer["plan"]["steps"][1]
    assert set(step) == {"order", "id", "title", "start", "end", "venue", "address", "municipality",
                         "coordinates", "distanceKm", "travelMinutes", "url"}
    assert step["coordinates"] == RAMBLA and step["distanceKm"] == 0.4


def test_multi_day_request_plans_the_first_day():
    answer = answer_chat("una ruta per aquest cap de setmana", now=NOW, client=FakeGemini(),
                         collection=FakeCollection(SATURDAY + SUNDAY),
                         filter_extractor=extractor({"itinerary": True, "date_from": "2026-11-21",
                                                     "date_to": "2026-11-22"}))
    assert answer["plan"]["date"] == "2026-11-21"
    assert "Fira de diumenge" not in [s["title"] for s in answer["plan"]["steps"]]


def test_future_day_and_time_of_day_bound_the_plan():
    answer = answer_chat("itinerari diumenge al matí", now=NOW, client=FakeGemini(),
                         collection=FakeCollection(SATURDAY + SUNDAY),
                         filter_extractor=extractor({"itinerary": True, "date_from": "2026-11-22",
                                                     "time_of_day": "mati"}))
    assert answer["plan"]["date"] == "2026-11-22"
    assert [s["title"] for s in answer["plan"]["steps"]] == ["Fira de diumenge"]
    assert answer["reply"].startswith("Només he trobat una activitat que encaixi per al 22/11:")


def test_itinerary_without_steps_is_a_text_answer():
    gemini = FakeGemini()
    answer = answer_chat("itinerari", now=NOW, client=gemini, collection=FakeCollection([]),
                         filter_extractor=extractor({"itinerary": True}))
    assert answer == {
        "type": "text",
        "reply": "No he trobat activitats per encadenar en un itinerari per al 21/11. "
                 "Prova amb una altra data, franja o zona.",
    }
    assert gemini.calls == []


def test_past_date_itinerary_is_answered_by_gemini():
    gemini = FakeGemini()
    answer = answer_chat("itinerari d'ahir", now=NOW, client=gemini, collection=FakeCollection(SATURDAY),
                         filter_extractor=extractor({"itinerary": True, "date_from": "2026-11-20"}))
    assert answer == {"type": "text", "reply": "Resposta de text."}
    assert len(gemini.calls) == 1


def test_other_messages_keep_the_text_answer_with_one_extraction():
    gemini, extract = FakeGemini(), extractor({"audience": "infantil"})
    answer = answer_chat("què fer amb nens?", now=NOW, client=gemini, collection=FakeCollection(SATURDAY),
                         filter_extractor=extract, language="es")
    assert answer == {"type": "text", "reply": "Resposta de text."}
    assert len(extract.calls) == 1
    assert "respon sempre en castellà" in gemini.calls[0]


@pytest.mark.parametrize(
    "language,header,single,empty",
    [
        ("ca", "Aquí tens un itinerari de 2 passos per al 21/11:", "Només he trobat una activitat",
         "No he trobat activitats"),
        ("es", "Aquí tienes un itinerario de 2 pasos para el 21/11:", "Solo he encontrado una actividad",
         "No he encontrado actividades"),
        ("en", "Here is a 2-step itinerary for 21/11:", "I only found one activity", "I couldn't find activities"),
    ],
)
def test_plan_reply_in_each_language(language, header, single, empty):
    steps = answer_chat("itinerari", now=NOW, client=FakeGemini(), collection=FakeCollection(SATURDAY[:2]),
                        filter_extractor=extractor({"itinerary": True}))["plan"]["steps"]
    assert plan_reply(steps, NOW, language).splitlines() == [
        header,
        "1. 10:30–12:00 · Visita guiada al Call (Girona)",
        "2. 12:30–13:30 · Concert vermut (Girona)",
    ]
    assert plan_reply(steps[:1], NOW, language).startswith(single)
    assert plan_reply([], NOW, language).startswith(empty)


def test_unknown_language_falls_back_to_catalan_and_steps_without_place():
    step = {"order": 1, "title": "Sense lloc", "start": "2026-11-21T11:00:00+01:00",
            "end": "2026-11-21T12:00:00+01:00", "municipality": ""}
    assert plan_reply([step], NOW, "fr").splitlines()[1] == "1. 11:00–12:00 · Sense lloc"


def test_messages_endpoint_returns_the_plan_and_language(monkeypatch):
    plan = {"date": "2026-11-21", "steps": [{"order": 1, "title": "Visita guiada al Call"}]}

    def fake_answer(message, history, language):
        return {"type": "plan", "reply": "Aquí tienes un itinerario…", "plan": plan}

    monkeypatch.setattr(chat_router, "answer_chat", fake_answer)
    res = TestClient(app).post("/chat/messages", json={"message": "hazme un itinerario para hoy"})
    assert res.status_code == 200
    assert res.json() == {"type": "plan", "reply": "Aquí tienes un itinerario…", "plan": plan, "language": "es"}
