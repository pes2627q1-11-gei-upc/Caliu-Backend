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
    ctor.assert_called_once_with(api_key="test-key", http_options={"timeout": 15_000})
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


# --- #142: temps màxim i reintents -----------------------------------------------------------------

import httpx  # noqa: E402
from google.genai.errors import ClientError, ServerError  # noqa: E402

from app.chatbot import config  # noqa: E402
from app.chatbot.gemini_client import GeminiUnavailableError  # noqa: E402


def _client_with(monkeypatch, effects, retries=None):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    if retries is not None:
        monkeypatch.setenv("GEMINI_RETRIES", str(retries))
    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = effects
    with patch("app.chatbot.gemini_client.genai.Client", return_value=mock_client):
        client = GeminiClient()
    client._sleep = lambda seconds: client.waits.append(seconds)
    client.waits = []
    return client, mock_client


def _server_error(code):
    return ServerError(code, {"error": {"code": code, "message": "x", "status": "UNAVAILABLE"}}, None)


def test_retries_a_transient_error_and_returns_the_answer(monkeypatch):
    client, mock = _client_with(monkeypatch, [_server_error(503), SimpleNamespace(text="Hola")])
    assert client.generate("Bon dia") == "Hola"
    assert mock.models.generate_content.call_count == 2
    assert client.waits == [0.5]


@pytest.mark.parametrize("error", [
    _server_error(504),
    ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}, None),
    httpx.ReadTimeout("timed out"),
    httpx.ConnectError("connection refused"),
])
def test_gives_up_after_the_retries_with_a_specific_error(monkeypatch, error):
    client, mock = _client_with(monkeypatch, [error, error, error], retries=2)
    with pytest.raises(GeminiUnavailableError):
        client.generate("Bon dia")
    assert mock.models.generate_content.call_count == 3
    assert client.waits == [0.5, 1.0]


def test_does_not_retry_permanent_errors(monkeypatch):
    error = ClientError(400, {"error": {"code": 400, "message": "bad", "status": "INVALID_ARGUMENT"}}, None)
    client, mock = _client_with(monkeypatch, [error])
    with pytest.raises(ClientError):
        client.generate("Bon dia")
    assert mock.models.generate_content.call_count == 1


def test_zero_retries_means_a_single_attempt(monkeypatch):
    client, mock = _client_with(monkeypatch, [_server_error(503)], retries=0)
    with pytest.raises(GeminiUnavailableError):
        client.generate("Bon dia")
    assert mock.models.generate_content.call_count == 1


@pytest.mark.parametrize("name,getter,default", [
    ("GEMINI_TIMEOUT_MS", config.gemini_timeout_ms, 15_000),
    ("GEMINI_RETRIES", config.gemini_retries, 1),
])
@pytest.mark.parametrize("raw", ["", "abc", "-1", "999999"])
def test_invalid_settings_fall_back_to_the_defaults(monkeypatch, name, getter, default, raw):
    monkeypatch.setenv(name, raw)
    assert getter() == default


def test_settings_from_the_environment(monkeypatch):
    monkeypatch.setenv("GEMINI_TIMEOUT_MS", "8000")
    monkeypatch.setenv("GEMINI_RETRIES", "2")
    assert (config.gemini_timeout_ms(), config.gemini_retries()) == (8000, 2)
