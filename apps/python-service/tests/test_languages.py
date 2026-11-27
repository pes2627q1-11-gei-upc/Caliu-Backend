# El xatbot en català, castellà i anglès: mateixos filtres per a la mateixa petició i resposta en la
# llengua de l'usuari. Els tests amb Gemini real només s'executen amb:
# RUN_GEMINI_TESTS=1 GEMINI_API_KEY=... python -m pytest tests/test_languages.py

import os
import re
import time
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.chatbot import intent, rag
from app.chatbot.intent import FUNCTION_NAME, TZ, EventFilters, extract_filters
from app.chatbot.language import LANGUAGE_NAMES, detect_conversation_language, detect_language

# Dimecres 18/11/2026 a les 10:00. Dissabte = 21.
NOW = datetime(2026, 11, 18, 10, 0, tzinfo=TZ)
LANGUAGES = ("ca", "es", "en")

# Mateixa petició en els tres idiomes, arguments que retornaria Gemini i filtres esperats.
REQUESTS = [
    {
        "ca": "què fer amb nens a la tarda",
        "es": "qué hacer con niños por la tarde",
        "en": "what to do with kids in the afternoon",
        "gemini": {"audience": "infantil", "time_of_day": "tarda"},
        "real": {"audience": "infantil", "time_of_day": "tarda"},
    },
    {
        "ca": "teatre gratuït per a la canalla dissabte",
        "es": "teatro gratis para los peques el sábado",
        "en": "free theatre for children on Saturday",
        "gemini": {"categories": ["Teatre"], "audience": "infantil", "date_from": "2026-11-21", "free": True},
        "real": {"categories": ["Teatre"], "audience": "infantil", "date_from": "2026-11-21", "max_price": 0},
    },
    {
        "ca": "concerts a Girona aquest cap de setmana",
        "es": "conciertos en Girona este fin de semana",
        "en": "concerts in Girona this weekend",
        "gemini": {"categories": ["Música"], "municipality": "Girona",
                   "date_from": "2026-11-21", "date_to": "2026-11-22"},
        "real": {"categories": ["Música"], "municipality": "Girona", "date_from": "2026-11-21",
                 "date_to": "2026-11-22"},
    },
]

# Preguntes per al xat: una sobre activitats i una fora de domini, en cada idioma.
CHAT = {
    "ca": ["Què em recomanes per fer amb els nens?", "Quina és la capital de França?"],
    "es": ["¿Qué me recomiendas para hacer con los niños?", "¿Cuál es la capital de Francia?"],
    "en": ["What do you recommend doing with the kids?", "What is the capital of France?"],
}

class FakeGemini:
    def __init__(self, args):
        self.requests = []
        self.models = self
        self._response = SimpleNamespace(function_calls=[SimpleNamespace(name=FUNCTION_NAME, args=args)])

    def generate_content(self, **kwargs):
        self.requests.append(kwargs)
        return self._response


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, _fields):
        return self

    def limit(self, value):
        return iter(self.documents[:value])


class FakeCollection:
    def __init__(self, documents):
        self.documents = documents

    def find(self, *_args, **_kwargs):
        return FakeCursor(list(self.documents))

    def count_documents(self, *_args, **_kwargs):
        return len(self.documents)


EVENTS = [
    {"_id": "1", "title": "Titelles al parc", "startDate": NOW + timedelta(hours=6),
     "endDate": NOW + timedelta(hours=7), "municipality": "Girona", "categories": ["Teatre"],
     "tags": ["Infantil"], "price": 0, "source": "ingest"},
    {"_id": "2", "title": "Taller de ceràmica familiar", "startDate": NOW + timedelta(days=3, hours=1),
     "endDate": NOW + timedelta(days=3, hours=3), "municipality": "Manresa", "categories": ["Tallers"],
     "tags": ["Família", "Infantil"], "price": 10, "source": "ingest"},
]


# --- Sense Gemini (CI) -------------------------------------------------------------------------

def test_detect_language_recognises_each_language():
    assert detect_language("Et recomano el taller de ceràmica, que és molt divertit per als nens.") == "ca"
    assert detect_language("Te recomiendo el taller de cerámica, que es muy divertido para los niños.") == "es"
    assert detect_language("I recommend the pottery workshop, it is great fun for the kids.") == "en"
    assert detect_language("Girona 21/11") is None


def test_prompts_ask_for_the_users_language():
    assert "català, castellà o anglès" in intent.build_system_instruction(NOW)
    assert "en la llengua de l'usuari" in rag.build_system_instruction(NOW)


@pytest.mark.parametrize("request_", REQUESTS, ids=[r["ca"] for r in REQUESTS])
def test_same_request_gives_same_filters_in_every_language(request_):
    results = {}
    for lang in LANGUAGES:
        client = FakeGemini(request_["gemini"])
        results[lang] = extract_filters(request_[lang], now=NOW, client=client).to_dict()
        assert client.requests[0]["contents"] == request_[lang]
    assert results["ca"] == results["es"] == results["en"]
    assert results["ca"] != EventFilters().to_dict()


@pytest.mark.parametrize("lang", LANGUAGES)
def test_chat_message_reaches_gemini_intact(monkeypatch, lang):
    monkeypatch.setenv("APP_ENV", "development")
    message = CHAT[lang][0] + " Àà Çç Ññ Ïï"
    captured = {}

    def fake_extract(text, now):
        captured["filter_message"] = text
        return EventFilters()

    def fake_generate(contents, **kwargs):
        captured["prompt"] = contents
        captured["system"] = kwargs["system_instruction"]
        return "ok"

    rag.answer_with_events(
        message,
        now=NOW,
        client=SimpleNamespace(generate=fake_generate),
        collection=FakeCollection(EVENTS),
        filter_extractor=fake_extract,
    )

    assert captured["filter_message"] == message
    assert f"<missatge_usuari>\n{message}\n</missatge_usuari>" in captured["prompt"]
    assert "Titelles al parc" in captured["prompt"]
    assert "en la llengua de l'usuari" in captured["system"]


# --- Gemini real --------------------------------------------------------------------------------

live = pytest.mark.skipif(
    os.environ.get("RUN_GEMINI_TESTS") != "1" or not os.environ.get("GEMINI_API_KEY"),
    reason="Cal RUN_GEMINI_TESTS=1 i GEMINI_API_KEY",
)

# Saturació, límit del pla gratuït o temps esgotat: el test se salta en lloc de fallar.
TRANSIENT = ("503", "UNAVAILABLE", "504", "DEADLINE_EXCEEDED", "429", "RESOURCE_EXHAUSTED", "timed out", "Timeout")
MAX_RETRY_WAIT_S = 90
GEMINI_TIMEOUT_MS = 30_000


def _retry(call):
    for attempt in range(3):
        try:
            return call()
        except Exception as exc:
            if not any(code in str(exc) for code in TRANSIENT):
                raise
            match = re.search(r"'retryDelay': '(\d+)s'", str(exc))
            wait = int(match.group(1)) + 1 if match else 5 * (attempt + 1)
            if attempt == 2 or wait > MAX_RETRY_WAIT_S:
                pytest.skip(f"Gemini no disponible ara mateix: {str(exc)[:200]}")
            time.sleep(wait)


def _chat_client():
    from google import genai

    from app.chatbot.gemini_client import GeminiClient

    client = GeminiClient()
    # GeminiClient no té temps màxim: sense això, el test es pot quedar penjat.
    client._client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options={"timeout": GEMINI_TIMEOUT_MS})
    return client


def _day(value):
    return value.date().isoformat() if value else None


@live
@pytest.mark.parametrize("lang", LANGUAGES)
@pytest.mark.parametrize("request_", REQUESTS, ids=[r["ca"] for r in REQUESTS])
def test_real_gemini_extracts_same_filters_in_every_language(request_, lang):
    real = request_["real"]
    f = _retry(lambda: extract_filters(request_[lang], now=NOW))
    assert f.audience == real.get("audience")
    assert f.time_of_day == real.get("time_of_day")
    assert set(f.categories) == set(real.get("categories", []))
    assert f.municipality == real.get("municipality")
    assert f.max_price == real.get("max_price")
    if "date_from" in real:
        assert _day(f.from_) == real["date_from"]
        assert _day(f.to) == real.get("date_to", real["date_from"])


@live
@pytest.mark.parametrize("lang", LANGUAGES)
@pytest.mark.parametrize("kind", [0, 1], ids=["activitats", "fora-de-domini"])
def test_real_gemini_answers_in_the_users_language(monkeypatch, lang, kind):
    monkeypatch.setenv("APP_ENV", "development")
    message = CHAT[lang][kind]
    # Mateix flux que POST /chat/messages: es detecta l'idioma i s'indica a Gemini.
    language = detect_conversation_language(message)
    assert language == lang
    client = _chat_client()
    reply = _retry(lambda: rag.answer_with_events(
        message,
        now=NOW,
        client=client,
        collection=FakeCollection(EVENTS),
        filter_extractor=lambda text, now: EventFilters(),  # una sola crida a Gemini per test
        language_name=LANGUAGE_NAMES[language],
    ))
    assert detect_language(reply) == lang, reply


# Missatge ambigu ("Girona") dins d'una conversa en castellà: la resposta ha de continuar en castellà.
@live
def test_real_gemini_keeps_the_conversation_language_for_ambiguous_messages(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    history = [
        {"role": "user", "content": "¿Qué me recomiendas para hacer con los niños?"},
        {"role": "assistant", "content": "Hay unas titelles al parque esta tarde."},
    ]
    language = detect_conversation_language("Girona", history)
    assert language == "es"
    client = _chat_client()
    reply = _retry(lambda: rag.answer_with_events(
        "Girona",
        now=NOW,
        client=client,
        collection=FakeCollection(EVENTS),
        filter_extractor=lambda text, now: EventFilters(),
        history=history,
        language_name=LANGUAGE_NAMES[language],
    ))
    assert detect_language(reply) == "es", reply
