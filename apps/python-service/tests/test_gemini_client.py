from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from google.genai import types

from app.chatbot.config import DEFAULT_MODEL, get_gemini_api_key
from app.chatbot.gemini_client import GeminiClient


def test_get_gemini_api_key_missing(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        get_gemini_api_key()


def test_get_gemini_api_key_blank(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "   ")
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        get_gemini_api_key()


def test_client_reads_key_from_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    mock_client = MagicMock()
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client) as ctor:
        client = GeminiClient()
    ctor.assert_called_once_with(api_key="test-key")
    assert client.model == DEFAULT_MODEL


def test_client_reads_model_from_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-model-from-env")
    with patch("app.chatbot.gemini_client.genai.Client"):
        client = GeminiClient()
    assert client.model == "gemini-model-from-env"


def test_explicit_model_overrides_environment(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-model-from-env")
    with patch("app.chatbot.gemini_client.genai.Client"):
        client = GeminiClient(model="gemini-explicit")
    assert client.model == "gemini-explicit"


def test_explicit_blank_api_key_has_accurate_error():
    with pytest.raises(RuntimeError, match="clau GEMINI_API_KEY"):
        GeminiClient(api_key="  ")


def test_generate_returns_model_text(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text="Hola")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        client = GeminiClient()
        assert client.generate("Bon dia") == "Hola"
    mock_client.models.generate_content.assert_called_once_with(
        model=DEFAULT_MODEL,
        contents="Bon dia",
        config={
            "temperature": 0.25,
            "max_output_tokens": 2048,
            "thinking_config": types.ThinkingConfig(thinking_level="LOW"),
        },
    )


def test_generate_sends_system_instruction(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text="Hola")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        GeminiClient().generate("Bon dia", system_instruction="Ets l'assistent de Caliu")
    mock_client.models.generate_content.assert_called_once_with(
        model=DEFAULT_MODEL,
        contents="Bon dia",
        config={
            "temperature": 0.25,
            "max_output_tokens": 2048,
            "thinking_config": types.ThinkingConfig(thinking_level="LOW"),
            "system_instruction": "Ets l'assistent de Caliu",
        },
    )


@pytest.mark.parametrize("model", ["gemini-2.5-flash", "models/gemini-2.5-flash-lite"])
def test_generate_omits_thinking_level_for_models_without_it(monkeypatch, model):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text="Hola")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        assert GeminiClient(model=model).generate("Bon dia") == "Hola"
    config = mock_client.models.generate_content.call_args.kwargs["config"]
    assert "thinking_config" not in config


def test_generate_sends_thinking_level_to_gemini_3_models(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text="Hola")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        GeminiClient(model="models/gemini-3-pro").generate("Bon dia")
    config = mock_client.models.generate_content.call_args.kwargs["config"]
    assert config["thinking_config"] == types.ThinkingConfig(thinking_level="LOW")


def test_generate_rejects_empty_response(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text="  ")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        client = GeminiClient()
        with pytest.raises(RuntimeError, match="no ha retornat text"):
            client.generate("Bon dia")


def test_generate_reports_max_token_truncation(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        text="Resposta parcial",
        candidates=[SimpleNamespace(finish_reason=types.FinishReason.MAX_TOKENS)],
    )
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        client = GeminiClient()
        with pytest.raises(RuntimeError, match="truncat la resposta"):
            client.generate("Bon dia")
