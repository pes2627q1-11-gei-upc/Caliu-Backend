# Detecció de l'idioma del missatge (català, castellà o anglès) perquè el xatbot respongui en el mateix.
# És determinista i sense dependències: lletres pròpies de cada idioma + paraules freqüents.

import re

LANGUAGES = ("ca", "es", "en")
DEFAULT_LANGUAGE = "ca"
LANGUAGE_NAMES = {"ca": "català", "es": "castellà", "en": "anglès"}

# Lletres que només fa servir un dels tres idiomes (el català no té "á" i el castellà no té "à").
LETTERS = {
    "ca": ("à", "è", "ò", "ç", "ï", "l·l"),
    "es": ("á", "ñ", "¿", "¡"),
}
LETTER_WEIGHT = 2

# Paraules freqüents i exclusives de cada idioma (les compartides, com "de", "el", "i" o "hola", no compten).
WORDS = {
    "ca": {
        "amb", "els", "per", "què", "és", "aquest", "aquesta", "aquests", "també", "hi", "dels", "pots", "puc",
        "teu", "vull", "vols", "avui", "demà", "nens", "canalla", "infants", "només", "activitats", "molt",
        "fer", "i", "pel", "als", "cap", "setmana", "tarda", "matí", "nit", "gràcies", "bon", "bona", "dia",
        "quin", "quina", "quins", "quines", "algun", "res", "gratuït", "gratuïtes", "família", "recomanes",
        "m'agradaria", "fill", "fills",
    },
    "es": {
        "con", "los", "para", "qué", "este", "esta", "estos", "también", "hay", "del", "puedes", "puedo",
        "quiero", "quieres", "hoy", "mañana", "niños", "niñas", "peques", "solo", "actividades", "muy",
        "hacer", "y", "pero", "fin", "semana", "tarde", "noche", "gracias", "buenos", "buenas", "días",
        "dónde", "cuál", "cuáles", "algún", "nada", "gratis", "familia", "recomiendas", "gustaría", "hijos",
        "por",
    },
    "en": {
        "the", "and", "with", "for", "is", "you", "this", "there", "are", "can", "your", "today", "tomorrow",
        "kids", "children", "only", "activities", "what", "to", "of", "in", "at", "weekend", "afternoon",
        "morning", "evening", "night", "thanks", "thank", "please", "hello", "good", "where", "which", "any",
        "free", "family", "recommend", "do", "would", "like", "my",
    },
}


def _scores(text: str) -> dict:
    lowered = text.lower()
    words = re.findall(r"[\w'·]+", lowered)
    scores = {lang: sum(word in WORDS[lang] for word in words) for lang in LANGUAGES}
    for lang, letters in LETTERS.items():
        scores[lang] += LETTER_WEIGHT * sum(lowered.count(letter) for letter in letters)
    return scores


# None si no hi ha prou pistes o hi ha empat (p. ex. "Girona", "ok" o "hola").
def detect_language(text: str) -> str | None:
    scores = _scores(text or "")
    best = max(LANGUAGES, key=lambda lang: scores[lang])
    if scores[best] == 0 or list(scores.values()).count(scores[best]) > 1:
        return None
    return best


# Missatge ambigu ("i demà?"): s'agafa l'idioma dels missatges anteriors de l'usuari; si no, el català.
def detect_conversation_language(message: str, history: list[dict] | None = None) -> str:
    language = detect_language(message)
    if language:
        return language
    for item in reversed(history or []):
        if item.get("role") == "user":
            language = detect_language(item.get("content", ""))
            if language:
                return language
    return DEFAULT_LANGUAGE
