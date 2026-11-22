from datetime import datetime
from itertools import combinations
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.routers.chat as chat_router
from app.chatbot import rag
from app.chatbot.intent import TZ, EventFilters
from app.chatbot.language import (
    DEFAULT_LANGUAGE,
    LANGUAGE_NAMES,
    LANGUAGES,
    WORDS,
    detect_conversation_language,
    detect_language,
)
from app.main import app

client = TestClient(app)
NOW = datetime(2026, 11, 18, 10, 0, tzinfo=TZ)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("què fer amb nens a la tarda", "ca"),
        ("Hi ha alguna activitat gratuïta aquest cap de setmana?", "ca"),
        ("M'agradaria anar a un concert a Girona", "ca"),
        ("gràcies!", "ca"),
        ("i demà?", "ca"),
        ("qué hacer con niños por la tarde", "es"),
        ("¿Hay alguna actividad gratis este fin de semana?", "es"),
        ("Me gustaría ir a un concierto en Girona", "es"),
        ("¿y mañana?", "es"),
        ("gracias", "es"),
        ("what to do with kids in the afternoon", "en"),
        ("Is there any free activity this weekend?", "en"),
        ("I would like to go to a concert in Girona", "en"),
        ("thanks!", "en"),
    ],
)
def test_detects_language(text, expected):
    assert detect_language(text) == expected


# Topònims catalans amb lletres pròpies del català (ç, à, è, ò, l·l): no han de decidir l'idioma de la frase.
@pytest.mark.parametrize(
    "text,expected",
    [
        ("¿Hay jazz en Lliçà d'Amunt?", "es"),
        ("Any jazz in Lliçà d'Amunt?", "en"),
        ("hay jazz en lliçà d'amunt?", "es"),
        ("any jazz in lliçà d'amunt?", "en"),
        ("¿Qué hay en Sant Cugat del Vallès este sábado?", "es"),
        ("What's on in Vilafranca del Penedès this weekend?", "en"),
        ("Conciertos para niños en Sant Feliu de Guíxols", "es"),
        ("Free activities for kids in Cerdanyola del Vallès", "en"),
        ("Hi ha jazz a Lliçà d'Amunt?", "ca"),
        ("Concerts a Sant Feliu de Guíxols aquest cap de setmana", "ca"),
    ],
)
def test_catalan_place_names_do_not_decide_the_language(text, expected):
    assert detect_language(text) == expected


def test_only_a_place_name_falls_back_to_the_conversation():
    assert detect_language("Jazz a Lliçà d'Amunt") is None
    history = [{"role": "user", "content": "What can I do with the kids?"}]
    assert detect_conversation_language("Jazz a Lliçà d'Amunt", history) == "en"


@pytest.mark.parametrize("text", ["Girona", "hola", "ok", "21/11", "", "   "])
def test_ambiguous_text_has_no_language(text):
    assert detect_language(text) is None


def test_word_lists_do_not_share_words():
    for first, second in combinations(LANGUAGES, 2):
        assert not WORDS[first] & WORDS[second], (first, second, WORDS[first] & WORDS[second])


def test_ambiguous_message_uses_previous_user_language():
    history = [
        {"role": "user", "content": "¿Qué hay para niños en Girona?"},
        {"role": "assistant", "content": "Hi ha un taller de ceràmica per a infants."},
    ]
    assert detect_conversation_language("Girona", history) == "es"


def test_assistant_messages_do_not_decide_the_language():
    history = [{"role": "assistant", "content": "What do you want to do this weekend?"}]
    assert detect_conversation_language("ok", history) == DEFAULT_LANGUAGE


def test_without_clues_defaults_to_catalan():
    assert detect_conversation_language("ok") == "ca"
    assert detect_conversation_language("ok", [{"role": "user", "content": "Girona"}]) == "ca"


def test_app_locale_is_the_fallback_language():
    assert detect_conversation_language("ok", default="es") == "es"
    assert detect_conversation_language("Girona", [{"role": "user", "content": "Girona"}], default="en") == "en"
    # El missatge i l'historial tenen prioritat; un idioma desconegut no s'aplica.
    assert detect_conversation_language("què hi ha avui?", default="en") == "ca"
    assert detect_conversation_language("ok", [{"role": "user", "content": "¿Qué hay hoy?"}], default="en") == "es"
    assert detect_conversation_language("ok", default="fr") == DEFAULT_LANGUAGE


def test_clear_message_wins_over_history():
    history = [{"role": "user", "content": "què fer amb nens a la tarda"}]
    assert detect_conversation_language("what about tomorrow?", history) == "en"


@pytest.mark.parametrize("name", LANGUAGE_NAMES.values())
def test_system_instruction_names_the_detected_language(name):
    text = rag.build_system_instruction(NOW, name)
    assert "en la llengua de l'usuari" in text
    assert f"respon sempre en {name}" in text
    assert "no tradueixis els títols dels esdeveniments" in text


def test_out_of_domain_rule_also_asks_for_the_users_language():
    # Sense això, les preguntes fora de domini es responien en català copiant la regla del prompt.
    text = rag.build_system_instruction(NOW, "castellà")
    assert "explica breument, en la llengua de l'usuari, que només pots ajudar" in text


def test_system_instruction_without_language_keeps_generic_rule():
    text = rag.build_system_instruction(NOW)
    assert "en la llengua de l'usuari" in text
    assert "respon sempre en" not in text


def test_answer_with_events_sends_language_to_gemini(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    captured = {}

    def fake_generate(contents, **kwargs):
        captured.update(kwargs)
        return "Respuesta."

    collection = SimpleNamespace(
        find=lambda *a, **k: SimpleNamespace(sort=lambda *_: SimpleNamespace(limit=lambda *_: iter([]))),
        count_documents=lambda *a, **k: 0,
    )
    rag.answer_with_events(
        "¿Qué hacer con niños?",
        now=NOW,
        client=SimpleNamespace(generate=fake_generate),
        collection=collection,
        filter_extractor=lambda message, now: EventFilters(),
        language_name="castellà",
    )
    assert "respon sempre en castellà" in captured["system_instruction"]


@pytest.mark.parametrize(
    "message,history,expected",
    [
        ("¿Qué hay para niños esta tarde?", [], "es"),
        ("What can I do with the kids?", [], "en"),
        ("què hi ha per als nens?", [], "ca"),
        ("Girona", [{"role": "user", "content": "What can I do with the kids?"}], "en"),
        ("¿Hay jazz en Lliçà d'Amunt?", [], "es"),
        ("Any jazz in Lliçà d'Amunt?", [], "en"),
    ],
)
def test_messages_endpoint_answers_in_detected_language(monkeypatch, message, history, expected):
    seen = {}

    def fake_answer(text, history, language, filter_extractor=None):
        seen["language"] = language
        return {"type": "text", "reply": "ok"}

    monkeypatch.setattr(chat_router, "answer_chat", fake_answer)
    res = client.post("/chat/messages", json={"message": message, "history": history})
    assert res.status_code == 200
    assert res.json()["language"] == expected
    assert seen["language"] == expected
