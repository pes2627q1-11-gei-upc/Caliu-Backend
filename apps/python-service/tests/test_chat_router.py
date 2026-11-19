from datetime import datetime

from fastapi.testclient import TestClient
from pymongo.errors import PyMongoError

import app.routers.chat as chat_router
from app.chatbot.intent import TZ, IntentExtractionError, normalize_filters
from app.main import app

client = TestClient(app)
NOW = datetime(2026, 11, 18, 10, 0, tzinfo=TZ)


def test_filters_endpoint(monkeypatch):
    seen = []

    def fake_extract(message):
        seen.append(message)
        return normalize_filters({"audience": "infantil", "time_of_day": "tarda"}, NOW)

    monkeypatch.setattr(chat_router, "extract_filters", fake_extract)
    res = client.post("/chat/filters", json={"message": "  què fer amb nens a la tarda "})
    assert res.status_code == 200
    body = res.json()
    assert seen == ["què fer amb nens a la tarda"]
    assert body["hasFilters"] is True
    assert body["filters"]["audience"] == "infantil"
    assert body["filters"]["from"] == "2026-11-18T15:00:00+01:00"


def test_filters_endpoint_without_descriptors(monkeypatch):
    monkeypatch.setattr(chat_router, "extract_filters", lambda m: normalize_filters({}, NOW))
    body = client.post("/chat/filters", json={"message": "hola"}).json()
    assert body["hasFilters"] is False
    assert body["filters"]["categories"] == []


def test_filters_endpoint_validation():
    assert client.post("/chat/filters", json={"message": "   "}).status_code == 400
    assert client.post("/chat/filters", json={"message": "a" * 501}).status_code == 400
    assert client.post("/chat/filters", json={}).status_code == 422


def test_filters_endpoint_gemini_down(monkeypatch):
    def boom(message):
        raise IntentExtractionError("GEMINI_API_KEY no està configurada")

    monkeypatch.setattr(chat_router, "extract_filters", boom)
    res = client.post("/chat/filters", json={"message": "teatre"})
    assert res.status_code == 503
    assert res.json() == {"error": "GEMINI_API_KEY no està configurada"}


def test_messages_endpoint_returns_rag_reply(monkeypatch):
    seen = {}

    def fake_answer(message, history, language_name):
        seen["message"] = message
        seen["history"] = history
        seen["language_name"] = language_name
        return "Et recomano un concert."

    monkeypatch.setattr(chat_router, "answer_with_events", fake_answer)
    history = [{"role": "user", "content": "què hi ha avui?"}]
    res = client.post("/chat/messages", json={
        "message": "  i demà?  ",
        "history": history,
    })

    assert res.status_code == 200
    assert res.json() == {"reply": "Et recomano un concert.", "language": "ca"}
    assert seen == {"message": "i demà?", "history": history, "language_name": "català"}


def test_messages_endpoint_validates_message():
    assert client.post("/chat/messages", json={"message": "  "}).status_code == 400
    assert client.post("/chat/messages", json={"message": "a" * 501}).status_code == 400
    missing = client.post("/chat/messages", json={})
    wrong_type = client.post("/chat/messages", json={"message": 42})
    assert missing.status_code == 422
    assert "detail" in missing.json()
    assert wrong_type.status_code == 422
    assert "detail" in wrong_type.json()
    too_much_history = client.post("/chat/messages", json={
        "message": "teatre",
        "history": [{"role": "user", "content": "hola"}] * 11,
    })
    assert too_much_history.status_code == 422
    oversized_history_message = client.post("/chat/messages", json={
        "message": "teatre",
        "history": [{"role": "user", "content": "x" * 1001}],
    })
    assert oversized_history_message.status_code == 422


def test_messages_endpoint_returns_service_unavailable_on_gemini_error(monkeypatch, caplog):
    def fail(message, history, language_name):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(chat_router, "answer_with_events", fail)
    res = client.post("/chat/messages", json={"message": "teatre"})

    assert res.status_code == 503
    assert res.json() == {"error": "El servei de xatbot no està disponible"}
    assert "No s'ha pogut generar la resposta del xatbot" in caplog.text


def test_messages_endpoint_returns_service_unavailable_on_mongo_error(monkeypatch, caplog):
    def fail(message, history, language_name):
        raise PyMongoError("database unavailable")

    monkeypatch.setattr(chat_router, "answer_with_events", fail)
    res = client.post("/chat/messages", json={"message": "teatre"})

    assert res.status_code == 503
    assert res.json() == {"error": "El servei d'esdeveniments no està disponible"}
    assert "No s'han pogut recuperar esdeveniments per al xatbot" in caplog.text
