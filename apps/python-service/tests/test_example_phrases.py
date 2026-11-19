# Frases d'exemple de la història #12: cada frase es prova amb Gemini simulat (CI) i, opcionalment, real:
# RUN_GEMINI_TESTS=1 GEMINI_API_KEY=... python -m pytest tests/test_example_phrases.py

import os
import re
import time
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.chatbot.intent import FUNCTION_NAME, TZ, IntentExtractionError, extract_filters

# Dimecres 18/11/2026 a les 10:00. Demà = 19, divendres = 20, cap de setmana = 21-22.
NOW = datetime(2026, 11, 18, 10, 0, tzinfo=TZ)

EMPTY = {"from": None, "to": None, "timeOfDay": None, "categories": [], "audience": None, "maxPrice": None}

# frase: el que diu l'usuari
# gemini: arguments que retornaria Gemini (tests simulats)
# esperat: filtres que n'han de sortir, tal com els retorna l'endpoint
# real: comprovacions amb Gemini real; el que no hi surt NO s'ha d'haver extret
#       (categories_ok: categories que també s'accepten, sense ser obligatòries)
PHRASES = [
    {
        "frase": "què fer amb nens a la tarda",
        "gemini": {"audience": "infantil", "time_of_day": "tarda"},
        "esperat": {**EMPTY, "from": "2026-11-18T15:00:00+01:00", "to": "2026-11-18T20:00:00+01:00",
                    "timeOfDay": "tarda", "audience": "infantil"},
        "real": {"audience": {"infantil"}, "time_of_day": "tarda"},
    },
    {
        "frase": "plans en família aquest cap de setmana",
        "gemini": {"audience": "familiar", "date_from": "2026-11-21", "date_to": "2026-11-22"},
        "esperat": {**EMPTY, "from": "2026-11-21T00:00:00+01:00", "to": "2026-11-22T23:59:59+01:00",
                    "audience": "familiar"},
        "real": {"audience": {"familiar", "infantil"}, "date_from": "2026-11-21", "date_to": "2026-11-22"},
    },
    {
        "frase": "teatre per a la canalla dissabte al matí",
        "gemini": {"categories": ["Teatre"], "audience": "infantil", "date_from": "2026-11-21", "time_of_day": "mati"},
        "esperat": {**EMPTY, "from": "2026-11-21T08:00:00+01:00", "to": "2026-11-21T13:00:00+01:00",
                    "timeOfDay": "mati", "categories": ["Teatre"], "audience": "infantil"},
        "real": {"audience": {"infantil"}, "categories": {"Teatre"}, "date_from": "2026-11-21", "time_of_day": "mati"},
    },
    {
        "frase": "activitats gratuïtes per a nens demà",
        "gemini": {"audience": "infantil", "date_from": "2026-11-19", "free": True},
        "esperat": {**EMPTY, "from": "2026-11-19T00:00:00+01:00", "to": "2026-11-19T23:59:59+01:00",
                    "audience": "infantil", "maxPrice": 0},
        "real": {"audience": {"infantil"}, "date_from": "2026-11-19", "max_price": 0},
    },
    {
        "frase": "algun taller infantil per menys de 10 euros",
        "gemini": {"categories": ["Tallers"], "audience": "infantil", "max_price": 10},
        "esperat": {**EMPTY, "categories": ["Tallers"], "audience": "infantil", "maxPrice": 10},
        "real": {"audience": {"infantil"}, "categories": {"Tallers"}, "max_price": 10},
    },
    {
        "frase": "concerts a Girona aquest divendres a la nit",
        "gemini": {"categories": ["Música"], "municipality": "Girona", "date_from": "2026-11-20", "time_of_day": "nit"},
        "esperat": {**EMPTY, "from": "2026-11-20T21:00:00+01:00", "to": "2026-11-20T23:59:59+01:00",
                    "timeOfDay": "nit", "categories": ["Música"], "municipality": "Girona"},
        "real": {"categories": {"Música"}, "categories_ok": {"Nit"}, "municipality": "Girona", "date_from": "2026-11-20", "time_of_day": "nit"},
    },
    {
        "frase": "què puc fer amb els meus fills al Vallès Occidental?",
        "gemini": {"audience": "infantil", "comarca": "Vallès Occidental"},
        "esperat": {**EMPTY, "audience": "infantil", "comarca": "Vallès Occidental"},
        "real": {"audience": {"infantil", "familiar"}, "comarca": "Vallès Occidental"},
    },
    {
        "frase": "qué hacer con niños el domingo por la tarde",
        "gemini": {"audience": "infantil", "date_from": "2026-11-22", "time_of_day": "tarda"},
        "esperat": {**EMPTY, "from": "2026-11-22T15:00:00+01:00", "to": "2026-11-22T20:00:00+01:00",
                    "timeOfDay": "tarda", "audience": "infantil"},
        "real": {"audience": {"infantil"}, "date_from": "2026-11-22", "time_of_day": "tarda"},
    },
    {
        "frase": "family-friendly things to do this weekend",
        "gemini": {"audience": "familiar", "date_from": "2026-11-21", "date_to": "2026-11-22"},
        "esperat": {**EMPTY, "from": "2026-11-21T00:00:00+01:00", "to": "2026-11-22T23:59:59+01:00",
                    "audience": "familiar"},
        "real": {"audience": {"familiar", "infantil"}, "date_from": "2026-11-21", "date_to": "2026-11-22"},
    },
    {
        "frase": "què hi havia ahir per als nens?",
        "gemini": {"audience": "infantil", "date_from": "2026-11-17"},
        "esperat": {**EMPTY, "audience": "infantil", "datePassed": True},
        "real": {"audience": {"infantil"}, "date_passed": True},
    },
    {
        "frase": "hola, què em recomanes?",
        "gemini": {},
        "esperat": EMPTY,
        "real": {},
    },
    {
        "frase": "bon dia! gràcies per l'ajuda",
        "gemini": {},
        "esperat": EMPTY,
        "real": {},
    },
    {
        "frase": "alguna cosa barata per fer",
        "gemini": {},
        "esperat": EMPTY,
        "real": {},
    },
    {
        "frase": "quelcom per fer amb la iaia",
        "gemini": {"categories": ["Cinema"], "audience": "gent gran", "max_price": -3},
        "esperat": EMPTY,
        "real": {},
    },
    {
        "frase": "fes-me un itinerari per dissabte a Girona",
        "gemini": {"itinerary": True, "date_from": "2026-11-21", "municipality": "Girona"},
        "esperat": {**EMPTY, "from": "2026-11-21T00:00:00+01:00", "to": "2026-11-21T23:59:59+01:00",
                    "municipality": "Girona", "itinerary": True},
        "real": {"date_from": "2026-11-21", "municipality": "Girona", "itinerary": True},
    },
    {
        "frase": "una ruta amb nens per aquest cap de setmana",
        "gemini": {"itinerary": True, "audience": "infantil", "date_from": "2026-11-21", "date_to": "2026-11-22"},
        "esperat": {**EMPTY, "from": "2026-11-21T00:00:00+01:00", "to": "2026-11-22T23:59:59+01:00",
                    "audience": "infantil", "itinerary": True},
        "real": {"audience": {"infantil", "familiar"}, "date_from": "2026-11-21", "date_to": "2026-11-22",
                 "itinerary": True},
    },
]

IDS = [p["frase"] for p in PHRASES]


class FakeGemini:
    def __init__(self, args):
        self.requests = []
        self.models = self
        self._response = SimpleNamespace(function_calls=[SimpleNamespace(name=FUNCTION_NAME, args=args)])

    def generate_content(self, **kwargs):
        self.requests.append(kwargs)
        return self._response


@pytest.mark.parametrize("case", PHRASES, ids=IDS)
def test_phrase_with_simulated_gemini(case):
    client = FakeGemini(case["gemini"])
    filters = extract_filters(case["frase"], now=NOW, client=client)
    assert filters.to_dict() == case["esperat"]
    assert filters.is_empty() == (case["esperat"] == EMPTY)
    assert client.requests[0]["contents"] == case["frase"]


def test_phrases_cover_every_filter_and_the_no_descriptor_case():
    expected = [case["esperat"] for case in PHRASES]
    for key in ("from", "to", "timeOfDay", "audience", "maxPrice"):
        assert any(e[key] is not None for e in expected), key
    assert any(e["maxPrice"] == 0 for e in expected)
    assert any(e["categories"] for e in expected)
    assert any("municipality" in e for e in expected) and any("comarca" in e for e in expected)
    assert sum(e == EMPTY for e in expected) >= 3


# --- Gemini real -------------------------------------------------------------------------------

live = pytest.mark.skipif(
    os.environ.get("RUN_GEMINI_TESTS") != "1" or not os.environ.get("GEMINI_API_KEY"),
    reason="Cal RUN_GEMINI_TESTS=1 i GEMINI_API_KEY",
)

# Saturació, límit del pla gratuït o temps esgotat: el test se salta en lloc de fallar.
TRANSIENT = ("503", "UNAVAILABLE", "504", "DEADLINE_EXCEEDED", "429", "RESOURCE_EXHAUSTED", "timed out", "Timeout")


# Pla gratuït: si Gemini demana esperar poc (límit per minut) s'espera; si són hores (límit diari), se salta.
MAX_RETRY_WAIT_S = 90


def _extract_live(phrase):
    for attempt in range(3):
        try:
            return extract_filters(phrase, now=NOW)
        except IntentExtractionError as exc:
            if not any(code in str(exc) for code in TRANSIENT):
                raise
            match = re.search(r"'retryDelay': '(\d+)s'", str(exc))
            wait = int(match.group(1)) + 1 if match else 5 * (attempt + 1)
            if attempt == 2 or wait > MAX_RETRY_WAIT_S:
                pytest.skip(f"Gemini no disponible ara mateix: {str(exc)[:200]}")
            time.sleep(wait)


def _day(value):
    return value.date().isoformat() if value else None


@live
@pytest.mark.parametrize("case", PHRASES, ids=IDS)
def test_phrase_with_real_gemini(case):
    real = case["real"]
    f = _extract_live(case["frase"])

    if "audience" in real:
        assert f.audience in real["audience"]
    else:
        assert f.audience is None
    required = real.get("categories", set())
    assert required <= set(f.categories) <= required | real.get("categories_ok", set())
    assert f.max_price == real.get("max_price")
    assert f.municipality == real.get("municipality")
    assert f.comarca == real.get("comarca")
    assert f.date_passed == real.get("date_passed", False)
    assert f.time_of_day == real.get("time_of_day")
    assert f.itinerary == real.get("itinerary", False)

    if "date_from" in real:
        assert _day(f.from_) == real["date_from"]
        assert _day(f.to) == real.get("date_to", real["date_from"])
    elif "time_of_day" in real:
        assert _day(f.from_) == "2026-11-18"
    else:
        assert f.from_ is None and f.to is None
