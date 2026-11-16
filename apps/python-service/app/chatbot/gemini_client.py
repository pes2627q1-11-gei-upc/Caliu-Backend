import os

from google import genai

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

    def generate(self, contents: str) -> str:
        response = self._client.models.generate_content(model=self.model, contents=contents)
        text = getattr(response, "text", None)
        if not text or not str(text).strip():
            raise RuntimeError("Gemini no ha retornat text")
        return str(text)
