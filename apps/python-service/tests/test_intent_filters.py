from datetime import datetime
from types import SimpleNamespace

import pytest

from app.chatbot.intent import (
    FUNCTION_DECLARATION,
    FUNCTION_NAME,
    TZ,
    IntentExtractionError,
    build_system_instruction,
    extract_filters,
    normalize_filters,
)
from app.chatbot.catalog import EVENT_CATEGORIES
from app.chatbot.config import DEFAULT_MODEL

# Dimecres 18/11/2026 a les 10:00 (hora de Catalunya, UTC+1).
NOW = datetime(2026, 11, 18, 10, 0, tzinfo=TZ)


class FakeGemini:
    def __init__(self, args=None, name=FUNCTION_NAME, calls=True, error=None):
        self.requests = []
        self._error = error
        calls_list = [SimpleNamespace(name=name, args=args)] if calls else None
        self._response = SimpleNamespace(function_calls=calls_list)
        self.models = self

    def generate_content(self, **kwargs):
        self.requests.append(kwargs)
        if self._error:
            raise self._error
        return self._response


# (frase, arguments que retornaria Gemini, filtres esperats)
PHRASES = [
    (
        "què fer amb nens a la tarda",
        {"audience": "infantil", "time_of_day": "tarda"},
        {"from": "2026-11-18T15:00:00+01:00", "to": "2026-11-18T20:00:00+01:00",
         "timeOfDay": "tarda", "categories": [], "audience": "infantil", "maxPrice": None},
    ),
    (
        "plans en família aquest cap de setmana gratis",
        {"audience": "familiar", "date_from": "2026-11-21", "date_to": "2026-11-22", "free": True},
        {"from": "2026-11-21T00:00:00+01:00", "to": "2026-11-22T23:59:59+01:00",
         "timeOfDay": None, "categories": [], "audience": "familiar", "maxPrice": 0},
    ),
    (
        "teatre infantil dissabte al matí per menys de 10 euros",
        {"categories": ["Teatre"], "audience": "infantil", "date_from": "2026-11-21",
         "time_of_day": "mati", "max_price": 10},
        {"from": "2026-11-21T08:00:00+01:00", "to": "2026-11-21T13:00:00+01:00",
         "timeOfDay": "mati", "categories": ["Teatre"], "audience": "infantil", "maxPrice": 10},
    ),
    (
        "algun concert o taller per a la canalla demà",
        {"categories": ["Música", "Tallers"], "audience": "infantil", "date_from": "2026-11-19"},
        {"from": "2026-11-19T00:00:00+01:00", "to": "2026-11-19T23:59:59+01:00",
         "timeOfDay": None, "categories": ["Música", "Tallers"], "audience": "infantil", "maxPrice": None},
    ),
    (
        "teatre a Girona aquest dissabte",
        {"categories": ["Teatre"], "municipality": "Girona", "date_from": "2026-11-21"},
        {"from": "2026-11-21T00:00:00+01:00", "to": "2026-11-21T23:59:59+01:00",
         "timeOfDay": None, "categories": ["Teatre"], "audience": None, "maxPrice": None,
         "municipality": "Girona"},
    ),
    (
        "hola, què em recomanes?",
        {},
        {"from": None, "to": None, "timeOfDay": None, "categories": [], "audience": None, "maxPrice": None},
    ),
]


@pytest.mark.parametrize("phrase,gemini_args,expected", PHRASES, ids=[p[0] for p in PHRASES])
def test_extract_filters_from_phrases(phrase, gemini_args, expected):
    client = FakeGemini(gemini_args)
    filters = extract_filters(phrase, now=NOW, client=client)
    assert filters.to_dict() == expected
    assert client.requests[0]["contents"] == phrase


def test_request_forces_function_calling_with_declared_tool():
    client = FakeGemini({})
    extract_filters("què fer amb nens a la tarda", now=NOW, client=client, model="model-x")
    req = client.requests[0]
    assert req["model"] == "model-x"
    config = req["config"]
    assert config["tools"] == [{"function_declarations": [FUNCTION_DECLARATION]}]
    assert config["tool_config"]["function_calling_config"] == {
        "mode": "ANY",
        "allowed_function_names": [FUNCTION_NAME],
    }
    assert "2026-11-18" in config["system_instruction"]
    assert "dimecres" in config["system_instruction"]


def test_extraction_uses_shared_default_model(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    client = FakeGemini({})

    extract_filters("teatre", now=NOW, client=client)

    assert client.requests[0]["model"] == DEFAULT_MODEL


def test_declaration_uses_shared_categories():
    props = FUNCTION_DECLARATION["parameters"]["properties"]
    assert props["categories"]["items"]["enum"] == EVENT_CATEGORIES
    assert set(props) == {
        "date_from", "date_to", "municipality", "comarca", "time_of_day", "categories",
        "audience", "max_price", "free",
    }


def test_location_filters_are_trimmed_and_limited():
    filters = normalize_filters({"municipality": " Girona ", "comarca": "Gironès"}, NOW)
    assert filters.municipality == "Girona"
    assert filters.comarca == "Gironès"
    assert normalize_filters({"municipality": "x" * 101}, NOW).municipality == "x" * 100


def test_no_function_call_means_no_filters():
    filters = extract_filters("bon dia", now=NOW, client=FakeGemini(calls=False))
    assert filters.is_empty()


def test_other_function_name_is_ignored():
    filters = extract_filters("x", now=NOW, client=FakeGemini({"audience": "infantil"}, name="altra"))
    assert filters.is_empty()


def test_gemini_error_is_wrapped():
    with pytest.raises(IntentExtractionError):
        extract_filters("x", now=NOW, client=FakeGemini(error=RuntimeError("quota")))


def test_missing_api_key(monkeypatch):
    import app.chatbot.intent as intent

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(intent, "_client", None)
    with pytest.raises(IntentExtractionError, match="GEMINI_API_KEY"):
        extract_filters("x", now=NOW)


def test_invented_values_are_dropped():
    filters = normalize_filters(
        {"categories": ["Cinema", "Màgia", 3], "audience": "jubilats", "time_of_day": "matinada",
         "max_price": -5, "date_from": "dimarts"},
        NOW,
    )
    assert filters.is_empty()


def test_categories_are_canonicalised_and_deduplicated():
    filters = normalize_filters({"categories": ["musica", "Música", "a l'aire lliure"]}, NOW)
    assert filters.categories == ["Música", "A l'aire lliure"]


def test_single_category_as_string():
    assert normalize_filters({"categories": "Teatre"}, NOW).categories == ["Teatre"]


def test_time_of_day_already_started_starts_now():
    now = datetime(2026, 11, 18, 16, 30, tzinfo=TZ)
    f = normalize_filters({"time_of_day": "tarda"}, now)
    assert f.to_dict()["from"] == "2026-11-18T16:30:00+01:00"
    assert f.to_dict()["to"] == "2026-11-18T20:00:00+01:00"


def test_time_of_day_already_over_moves_to_tomorrow():
    now = datetime(2026, 11, 18, 21, 0, tzinfo=TZ)
    f = normalize_filters({"time_of_day": "tarda"}, now).to_dict()
    assert f["from"] == "2026-11-19T15:00:00+01:00"
    assert f["to"] == "2026-11-19T20:00:00+01:00"


def test_today_without_slot_starts_now():
    f = normalize_filters({"date_from": "2026-11-18"}, NOW).to_dict()
    assert f["from"] == "2026-11-18T10:00:00+01:00"
    assert f["to"] == "2026-11-18T23:59:59+01:00"


def test_night_slot_ends_at_end_of_day():
    f = normalize_filters({"date_from": "2026-11-20", "time_of_day": "nit"}, NOW).to_dict()
    assert (f["from"], f["to"]) == ("2026-11-20T21:00:00+01:00", "2026-11-20T23:59:59+01:00")


def test_only_date_to_starts_today():
    f = normalize_filters({"date_to": "2026-11-20"}, NOW).to_dict()
    assert f["from"] == "2026-11-18T10:00:00+01:00"
    assert f["to"] == "2026-11-20T23:59:59+01:00"


@pytest.mark.parametrize(
    "args",
    [
        {"date_from": "2026-11-22", "date_to": "2026-11-20"},  # interval invertit
        {"date_from": "2026-11-10"},  # dia passat
        {"date_from": "no-es-una-data"},
    ],
)
def test_invalid_dates_are_dropped(args):
    f = normalize_filters(args, NOW)
    assert f.from_ is None and f.to is None and f.time_of_day is None


def test_past_date_is_marked_instead_of_becoming_an_unfiltered_search():
    filters = normalize_filters({"date_from": "2026-11-17"}, NOW)

    assert filters.from_ is None
    assert filters.to is None
    assert filters.date_passed is True
    assert filters.is_empty() is False
    assert filters.to_dict()["datePassed"] is True


def test_past_time_slot_on_today_is_marked():
    filters = normalize_filters(
        {"date_from": "2026-11-18", "time_of_day": "mati"},
        datetime(2026, 11, 18, 15, 0, tzinfo=TZ),
    )

    assert filters.date_passed is True


def test_summer_time_offset():
    now = datetime(2026, 7, 1, 9, 0, tzinfo=TZ)
    f = normalize_filters({"date_from": "2026-07-04", "time_of_day": "mati"}, now).to_dict()
    assert f["from"] == "2026-07-04T08:00:00+02:00"


@pytest.mark.parametrize(
    "args,expected",
    [
        ({"free": True, "max_price": 20}, 0),
        ({"max_price": 12.5}, 12.5),
        ({"max_price": 15.0}, 15),
        ({"max_price": True}, None),
        ({"max_price": "10"}, None),
        ({"free": False}, None),
    ],
)
def test_price(args, expected):
    assert normalize_filters(args, NOW).max_price == expected


def test_audience_case_insensitive():
    assert normalize_filters({"audience": "Infantil"}, NOW).audience == "infantil"


def test_none_args():
    assert normalize_filters(None, NOW).is_empty()


def test_system_instruction_mentions_rules():
    text = build_system_instruction(NOW)
    assert FUNCTION_NAME in text
    assert "No inventis" in text
