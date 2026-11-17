import os

from google import genai
from google.genai import types

from app.chatbot.config import DEFAULT_MODEL, get_gemini_api_key


class GeminiClient:
    def __init__(self, api_key: str | None = None, model: str | None = None):
        if api_key is None:
            key = get_gemini_api_key()
        else:
            key = api_key.strip()
        if not key:
            raise RuntimeError("La clau GEMINI_API_KEY no pot estar buida")
        self.model = model or os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
        self._client = genai.Client(api_key=key)

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
            "thinking_config": types.ThinkingConfig(thinking_level="LOW"),
        }
        if system_instruction:
            config["system_instruction"] = system_instruction
        response = self._client.models.generate_content(
            model=self.model,
            contents=contents,
            config=config,
        )
        finish_reason = None
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            finish_reason = getattr(candidates[0], "finish_reason", None)
            if getattr(finish_reason, "name", None) == "MAX_TOKENS":
                raise RuntimeError("Gemini ha truncat la resposta per límit de tokens")
        text = getattr(response, "text", None)
        if not text or not str(text).strip():
            if finish_reason is not None:
                reason = getattr(finish_reason, "name", str(finish_reason))
                raise RuntimeError(f"Gemini no ha retornat text (motiu: {reason})")
            raise RuntimeError("Gemini no ha retornat text")
        return str(text)
