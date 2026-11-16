from google import genai

from app.chatbot.config import get_gemini_api_key

DEFAULT_MODEL = "gemini-3.8-flash"


class GeminiClient:
    def __init__(self, api_key: str | None = None, model: str = DEFAULT_MODEL):
        key = get_gemini_api_key() if api_key is None else api_key.strip()
        if not key:
            raise RuntimeError("Falta la variable d'entorn GEMINI_API_KEY")
        self.model = model
        self._client = genai.Client(api_key=key)

    def generate(self, contents: str) -> str:
        response = self._client.models.generate_content(model=self.model, contents=contents)
        text = getattr(response, "text", None)
        if not text or not str(text).strip():
            raise RuntimeError("Gemini no ha retornat text")
        return str(text)
