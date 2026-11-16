# Frases contra Gemini real (no s'executa a la CI):
# RUN_GEMINI_TESTS=1 GEMINI_API_KEY=... python -m pytest tests/test_intent_gemini_live.py

import os
import time
from datetime import datetime

import pytest

from app.chatbot.intent import TZ, IntentExtractionError
from app.chatbot.intent import extract_filters as _extract_filters

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_GEMINI_TESTS") != "1" or not os.environ.get("GEMINI_API_KEY"),
    reason="Cal RUN_GEMINI_TESTS=1 i GEMINI_API_KEY",
)

NOW = datetime(2026, 11, 18, 10, 0, tzinfo=TZ)  

# Saturació o límit del pla gratuït: el test se salta en lloc de fallar.
TRANSIENT = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED")


def extract_filters(message, now):
    for attempt in range(3):
        try:
            return _extract_filters(message, now=now)
        except IntentExtractionError as exc:
            if not any(code in str(exc) for code in TRANSIENT):
                raise
            if attempt == 2:
                pytest.skip(f"Gemini no disponible ara mateix: {exc}")
            time.sleep(5 * (attempt + 1))


def test_nens_a_la_tarda():
    f = extract_filters("què fer amb nens a la tarda", now=NOW)
    assert f.audience == "infantil"
    assert f.time_of_day == "tarda"
    assert f.max_price is None


def test_familia_cap_de_setmana_gratis():
    f = extract_filters("plans en família aquest cap de setmana que siguin gratis", now=NOW)
    assert f.audience in ("familiar", "infantil")
    assert f.from_.date().isoformat() == "2026-11-21"
    assert f.to.date().isoformat() == "2026-11-22"
    assert f.max_price == 0


def test_teatre_dissabte_preu():
    f = extract_filters("teatre per a nens dissabte al matí per menys de 10 euros", now=NOW)
    assert "Teatre" in f.categories
    assert f.time_of_day == "mati"
    assert f.from_.date().isoformat() == "2026-11-21"
    assert f.max_price == 10


def test_castella():
    f = extract_filters("qué hacer con niños esta tarde", now=NOW)
    assert f.audience == "infantil"
    assert f.time_of_day == "tarda"


def test_sense_descriptors():
    assert extract_filters("hola, què em recomanes?", now=NOW).is_empty()
