import os

DEFAULT_MODEL = "gemini-3.8-flash"


def get_gemini_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Falta la variable d'entorn GEMINI_API_KEY")
    return key
