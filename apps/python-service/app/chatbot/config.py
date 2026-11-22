import logging
import os

DEFAULT_MODEL = "gemini-3.8-flash"

# Temps màxim de cada crida a Gemini i reintents de la resposta del xat (#142). Configurables per entorn
# (valors a confirmar per l'equip). Cas pitjor amb els valors per defecte: extracció (15 s) + 2 intents
# de resposta (2 × 15 s) ≈ 45 s, per sota del PYTHON_TIMEOUT_MS de 60 s amb què Node espera Python.
DEFAULT_GEMINI_TIMEOUT_MS = 15_000
DEFAULT_GEMINI_RETRIES = 1
logger = logging.getLogger(__name__)


def get_gemini_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Falta la variable d'entorn GEMINI_API_KEY")
    return key


# Un valor no vàlid no ha de tombar el xat: s'avisa als logs i es fa servir el per defecte.
def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = None
    if value is None or not minimum <= value <= maximum:
        logger.warning("%s no vàlid (ha de ser un enter entre %s i %s); es fa servir %s", name, minimum, maximum, default)
        return default
    return value


def gemini_timeout_ms() -> int:
    return _int_env("GEMINI_TIMEOUT_MS", DEFAULT_GEMINI_TIMEOUT_MS, 1_000, 60_000)


def gemini_retries() -> int:
    return _int_env("GEMINI_RETRIES", DEFAULT_GEMINI_RETRIES, 0, 3)
