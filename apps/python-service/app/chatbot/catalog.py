import unicodedata

# IMPORTANT: ha de ser idèntic a apps/api-node/src/domain/eventCategories.js i docs/atlas/daily_agenda_sync.js.
EVENT_CATEGORIES = [
    "Música",
    "Teatre",
    "Gastronomia",
    "Arts",
    "Esports",
    "Menjar i beguda",
    "Nit",
    "Tallers",
    "Comèdia",
    "A l'aire lliure",
]

# Els esdeveniments no tenen camp "públic": es dedueix de les etiquetes de la ingesta.
AUDIENCE_TAGS = {
    "familiar": ["Família", "Infantil"],
    "infantil": ["Infantil", "Família"],
}
AUDIENCES = list(AUDIENCE_TAGS)

# (hora_inici, hora_fi) en hora local.
TIME_OF_DAY = {
    "mati": (8, 13),
    "migdia": (12, 16),
    "tarda": (15, 20),
    "vespre": (19, 23),
    "nit": (21, 24),
}

TIMEZONE = "Europe/Madrid"


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", str(text))
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn").strip().lower()


_CATEGORY_BY_KEY = {fold(c): c for c in EVENT_CATEGORIES}


def canonical_category(value) -> str | None:
    if not isinstance(value, str):
        return None
    return _CATEGORY_BY_KEY.get(fold(value))
