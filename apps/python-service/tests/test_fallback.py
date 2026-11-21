from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from google.genai.errors import ClientError

import app.routers.chat as chat_router
from app.chatbot.fallback import MAX_FALLBACK_EVENTS, fallback_reply
from unittest.mock import MagicMock, patch

import httpx

from app.chatbot.gemini_client import GeminiClient, GeminiResponseError, GeminiUnavailableError
from app.chatbot.intent import EventFilters, normalize_filters
from app.chatbot.plan import answer_chat
from app.chatbot.rag import answer_with_events, select_events
from app.main import app
from tests.test_chatbot_rag import NOW, TZ, FakeCollection, event

# Dimecres 18/11/2026 a les 10:00 (NOW de test_chatbot_rag).
TEATRE = event("Teatre avui", NOW + timedelta(hours=6), NOW + timedelta(hours=7), categories=["Teatre"],
               municipality="Girona")
CONCERT_DEMA = event("Concert demà", NOW + timedelta(days=1, hours=2), NOW + timedelta(days=1, hours=3),
                     categories=["Música"], municipality="Salt")
EXPOSICIO = event("Exposició en curs", NOW - timedelta(days=10), NOW + timedelta(days=20), categories=["Arts"])


@pytest.fixture(autouse=True)
def development(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")


def titles(events):
    return [e["title"] for e in events]


# --- select_events: suggeriment més general ----------------------------------------------------------

def test_matching_events_are_not_alternatives():
    events, total, alternatives = select_events(NOW, EventFilters(categories=["Teatre"]), FakeCollection([TEATRE]))
    assert (titles(events), total, alternatives) == (["Teatre avui"], 1, False)


def test_no_match_widens_to_the_same_dates_without_other_criteria():
    today = normalize_filters({"date_from": "2026-11-18", "categories": ["Comèdia"]}, NOW)
    events, _, alternatives = select_events(NOW, today, FakeCollection([TEATRE, CONCERT_DEMA]))
    assert alternatives is True
    assert titles(events) == ["Teatre avui"]  # mateix dia, sense la categoria; demà queda fora


def test_no_match_on_those_dates_widens_to_the_coming_days():
    today = normalize_filters({"date_from": "2026-11-18", "categories": ["Comèdia"]}, NOW)
    events, _, alternatives = select_events(NOW, today, FakeCollection([CONCERT_DEMA]))
    assert (titles(events), alternatives) == (["Concert demà"], True)


def test_no_events_at_all_returns_empty_without_alternatives():
    collection = FakeCollection([])
    assert select_events(NOW, EventFilters(categories=["Teatre"]), collection) == ([], 0, False)


def test_without_criteria_or_with_a_past_date_the_search_is_not_widened():
    collection = FakeCollection([])
    assert select_events(NOW, EventFilters(), collection) == ([], 0, False)
    assert len(collection.queries) == 1  # cap cerca addicional
    past = normalize_filters({"date_from": "2026-11-10"}, NOW)
    assert select_events(NOW, past, FakeCollection([TEATRE])) == ([], 0, False)


# --- answer_with_events: el que rep Gemini ---------------------------------------------------------

def _prompt_for(filters, documents):
    captured = {}

    def fake_generate(contents, **kwargs):
        captured["prompt"] = contents
        return "Resposta."

    answer_with_events("x", now=NOW, client=SimpleNamespace(generate=fake_generate),
                       collection=FakeCollection(documents), filters=filters)
    return captured["prompt"]


def test_gemini_is_asked_to_say_so_and_propose_broader_events():
    prompt = _prompt_for(EventFilters(categories=["Comèdia"]), [TEATRE])
    assert "No s'han trobat esdeveniments amb els criteris demanats" in prompt
    assert "No he trobat activitats per aquests criteris" in prompt
    assert "deixant clar que no compleixen tots els criteris" in prompt
    assert "Teatre avui" in prompt


def test_gemini_is_asked_to_suggest_widening_when_there_is_nothing():
    prompt = _prompt_for(EventFilters(categories=["Comèdia"]), [])
    assert "ni tampoc propostes més generals" in prompt
    assert "suggereix ampliar la cerca" in prompt


def test_place_note_is_kept_with_alternatives():
    prompt = _prompt_for(EventFilters(municipality="Gerona"), [TEATRE])
    assert "No s'han trobat esdeveniments per a «Gerona»" in prompt
    assert "Teatre avui" in prompt


# --- answer_chat: resposta alternativa quan Gemini no respon ----------------------------------------

class FailingGemini:
    def __init__(self, error):
        self.error = error

    def generate(self, *_args, **_kwargs):
        raise self.error


def _chat(error, documents, args=None, language="ca"):
    return answer_chat("x", now=NOW, client=FailingGemini(error), collection=FakeCollection(documents),
                       filter_extractor=lambda message, now: normalize_filters(args or {}, NOW), language=language)


@pytest.mark.parametrize("error", [
    GeminiUnavailableError("sense resposta"),
    ClientError(404, {"error": {"code": 404, "message": "model", "status": "NOT_FOUND"}}, None),
    GeminiResponseError("Gemini no ha retornat text"),
])
def test_gemini_failure_returns_a_fallback_with_events(error):
    answer = _chat(error, [TEATRE, EXPOSICIO])
    assert answer["type"] == "fallback"
    lines = answer["reply"].splitlines()
    assert lines[0].startswith("Ara mateix no puc generar una resposta completa")
    assert "- Exposició en curs · en curs" in lines
    assert "- Teatre avui · 18/11 16:00 · Girona" in lines
    assert lines[-1].startswith("Pots tornar a enviar el missatge")


def test_connection_errors_end_in_a_fallback_once_the_attempts_are_exhausted(monkeypatch):
    # Revisió del #49: un httpx.ConnectError (connexió refusada) es reintenta i, esgotats els intents,
    # el xat dona la resposta alternativa en lloc d'un 500.
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_RETRIES", "2")
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = httpx.ConnectError("connection refused")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=sdk):
        gemini = GeminiClient()
    gemini._sleep = lambda _seconds: None

    answer = answer_chat("x", now=NOW, client=gemini, collection=FakeCollection([TEATRE]),
                         filter_extractor=lambda message, now: EventFilters())

    assert answer["type"] == "fallback"
    assert "- Teatre avui · 18/11 16:00 · Girona" in answer["reply"]
    assert sdk.models.generate_content.call_count == 3  # 1 intent + 2 reintents


def test_configuration_errors_are_not_hidden_behind_a_fallback(monkeypatch):
    # Sense GEMINI_API_KEY el servidor està mal configurat: ha de donar un 503 visible, no un 200.
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        answer_chat("x", now=NOW, collection=FakeCollection([TEATRE]),
                    filter_extractor=lambda message, now: EventFilters())
    res = TestClient(app).post("/chat/messages", json={"message": "què fer avui?"})
    assert res.status_code == 503
    assert res.json()["code"] == "CHATBOT_UNAVAILABLE"


def test_fallback_reuses_the_events_without_querying_mongo_again():
    ok, failing = FakeCollection([TEATRE]), FakeCollection([TEATRE])
    answer_chat("x", now=NOW, client=SimpleNamespace(generate=lambda *a, **k: "ok"), collection=ok,
                filter_extractor=lambda message, now: EventFilters())
    answer_chat("x", now=NOW, client=FailingGemini(GeminiUnavailableError("x")), collection=failing,
                filter_extractor=lambda message, now: EventFilters())
    assert len(failing.find_args) == len(ok.find_args)


def test_fallback_says_when_the_events_are_broader_suggestions():
    answer = _chat(GeminiUnavailableError("x"), [TEATRE], {"categories": ["Comèdia"]}, language="es")
    assert answer["reply"].startswith("No he encontrado actividades para estos criterios")
    assert "- Teatre avui · 18/11 16:00 · Girona" in answer["reply"]


def test_fallback_without_events():
    assert _chat(GeminiUnavailableError("x"), [], language="en") == {
        "type": "fallback",
        "reply": "I can't answer right now and I couldn't find activities for these criteria. "
                 "Please try again in a while or try another date or area.",
        "events": [],
    }


def test_fallback_reply_lists_at_most_three_events_with_local_times():
    many = [event(f"Pas {i}", datetime(2026, 11, 18, 10 + i, tzinfo=TZ), datetime(2026, 11, 18, 11 + i, tzinfo=TZ))
            for i in range(1, 6)]
    reply = fallback_reply(many, False, NOW, "ca")
    assert [line for line in reply.splitlines() if line.startswith("- ")] == [
        "- Pas 1 · 18/11 11:00", "- Pas 2 · 18/11 12:00", "- Pas 3 · 18/11 13:00",
    ]
    assert MAX_FALLBACK_EVENTS == 3
    # Dates de Mongo sense zona horària (UTC): 15:00 UTC són les 16:00 a Catalunya.
    naive = {"title": "Data de Mongo", "startDate": datetime(2026, 11, 18, 15)}
    assert "- Data de Mongo · 18/11 16:00" in fallback_reply([naive], False, NOW, "fr")


def test_messages_endpoint_returns_the_fallback(monkeypatch):
    monkeypatch.setattr(chat_router, "answer_chat",
                        lambda message, history, language: {"type": "fallback", "reply": "Ara mateix no puc…"})
    res = TestClient(app).post("/chat/messages", json={"message": "què fer avui?"})
    assert res.status_code == 200
    assert res.json() == {"type": "fallback", "reply": "Ara mateix no puc…", "language": "ca"}
