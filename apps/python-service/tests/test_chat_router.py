from datetime import datetime

from fastapi.testclient import TestClient

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
