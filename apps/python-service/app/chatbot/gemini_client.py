import logging
import os
import time

import httpx
from google import genai
from google.genai import types
from google.genai.errors import APIError

from app.chatbot.config import DEFAULT_MODEL, gemini_retries, gemini_timeout_ms, get_gemini_api_key

# Errors temporals de Gemini que val la pena reintentar (#142): saturació, quota per minut, temps esgotat
# i errors de connexió (httpx.TransportError inclou ConnectError, ReadError i els temps esgotats).
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
RETRY_DELAY_S = 0.5
logger = logging.getLogger(__name__)


# Gemini no ha respost després dels reintents: el xat ha de donar una resposta alternativa.
class GeminiUnavailableError(RuntimeError):
    pass


# Gemini ha respost però sense text útil (truncat o buit): també es dona la resposta alternativa.
# És diferent d'un error de configuració (p. ex. sense GEMINI_API_KEY), que ha de donar un 503.
class GeminiResponseError(RuntimeError):
    pass


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, APIError) and getattr(exc, "code", None) in RETRYABLE_STATUS


class GeminiClient:
    def __init__(self, api_key: str | None = None, model: str | None = None):
        if api_key is None:
            key = get_gemini_api_key()
        else:
            key = api_key.strip()
        if not key:
            raise RuntimeError("La clau GEMINI_API_KEY no pot estar buida")
        self.model = model or os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
        self._client = genai.Client(api_key=key, http_options={"timeout": gemini_timeout_ms()})
        self._retries = gemini_retries()
        self._sleep = time.sleep

    def generate(
        self,
        contents: str,
        system_instruction: str | None = None,
        temperature: float = 0.25,
        max_output_tokens: int = 2048,
    ) -> str:
        config = {
            "temperature": temperature,
            "max_output_tokens": max_output_tokens,
        }
        # thinking_level només existeix als models Gemini 3: els anteriors (p. ex. gemini-2.5-flash) el rebutgen amb un 400.
        if self.model.removeprefix("models/").startswith("gemini-3"):
            config["thinking_config"] = types.ThinkingConfig(thinking_level="LOW")
        if system_instruction:
            config["system_instruction"] = system_instruction
        response = self._generate_with_retries(contents, config)
        finish_reason = None
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            finish_reason = getattr(candidates[0], "finish_reason", None)
            if getattr(finish_reason, "name", None) == "MAX_TOKENS":
                raise GeminiResponseError("Gemini ha truncat la resposta per límit de tokens")
        text = getattr(response, "text", None)
        if not text or not str(text).strip():
            if finish_reason is not None:
                reason = getattr(finish_reason, "name", str(finish_reason))
                raise GeminiResponseError(f"Gemini no ha retornat text (motiu: {reason})")
            raise GeminiResponseError("Gemini no ha retornat text")
        return str(text)

    def _generate_with_retries(self, contents: str, config: dict):
        attempts = self._retries + 1
        for attempt in range(attempts):
            try:
                return self._client.models.generate_content(model=self.model, contents=contents, config=config)
            except Exception as exc:
                if not _is_retryable(exc):
                    raise
                logger.warning("Gemini no ha respost (intent %s de %s): %s", attempt + 1, attempts, exc)
                if attempt + 1 == attempts:
                    raise GeminiUnavailableError("Gemini no ha respost després dels reintents") from exc
                self._sleep(RETRY_DELAY_S * 2**attempt)
