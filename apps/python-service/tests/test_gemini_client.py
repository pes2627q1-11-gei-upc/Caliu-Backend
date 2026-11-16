from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.chatbot.config import get_gemini_api_key
from app.chatbot.gemini_client import DEFAULT_MODEL, GeminiClient


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
    mock_client = MagicMock()
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client) as ctor:
        GeminiClient()
    ctor.assert_called_once_with(api_key="test-key")


def test_generate_returns_model_text(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text="Hola")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        client = GeminiClient()
        assert client.generate("Bon dia") == "Hola"
    mock_client.models.generate_content.assert_called_once_with(
        model=DEFAULT_MODEL,
        contents="Bon dia",
    )


def test_generate_rejects_empty_response(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text="  ")
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        client = GeminiClient()
        with pytest.raises(RuntimeError, match="no ha retornat text"):
            client.generate("Bon dia")
