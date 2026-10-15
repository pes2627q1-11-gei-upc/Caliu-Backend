"""Assignació de categories (les del filtre del frontend) a partir del text de la font.

IMPORTANT: EVENT_CATEGORIES ha de ser idèntic a apps/api-node/src/domain/eventCategories.js.
Si es canvia allà, cal canviar-ho aquí (hi ha un test que ho recorda).
"""
import re
import unicodedata

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

# Paraules clau (sense accents, minúscules). Per defecte coincideixen com a PREFIX de paraula
# ("concert" -> concert, concerts, concertino). Si acaben en "$" han de ser la paraula exacta.
#   KEYWORDS    : compten al títol/etiquetes i a la descripció
#   TITLE_ONLY  : massa ambigües per a la descripció, només compten al títol/etiquetes
KEYWORDS: dict[str, list[str]] = {
    "Música": ["musica", "music$", "musics$", "concert", "jazz", "cobla", "cantada", "havaner", "orquestra",
               "simfonic", "cantautor", "recital", "orgue", "flamenc", "rock$", "dj$", "opera$", "banda$"],
    "Teatre": ["teatre", "titelles", "marionet", "pallass", "circ$", "circense", "dramatitz", "obra de teatre"],
    "Gastronomia": ["gastronom", "tapes$", "formatge", "cuina$", "degustaci", "tast$", "tasts$", "vins$", "vi$", "cervesa", "vermut"],
    "Menjar i beguda": ["gastronom", "tapes$", "formatge", "degustaci", "tast$", "tasts$", "vins$", "vi$", "cervesa", "vermut", "brunch"],
    "Arts": ["exposici", "fotograf", "cinema", "film", "pellicul", "documental", "dansa", "pintura", "escultura",
             "ceramica", "museu", "patrimoni", "arqueolog", "galeria", "art$", "arts$", "artista", "il lustraci",
             "literatura", "poesia", "cultura popular", "castellers", "gegants", "trencadis", "arquitectura"],
    "Esports": ["esport", "cursa", "caminada", "ciclis", "futbol", "senderisme", "triatl", "marato", "escalada", "natacio"],
    "Tallers": ["taller", "curs$", "cursos$", "masterclass", "formacio"],
    "Comèdia": ["comedia", "monoleg", "humor", "stand up", "standup"],
    "A l'aire lliure": ["aire lliure", "platja", "muntanya", "excursi", "senderisme", "a la fresca", "parc natural"],
}
TITLE_ONLY: dict[str, list[str]] = {
    "Teatre": ["espectacle"],
    "Arts": ["mostra"],
    "Tallers": ["activitat familiar"],
    "A l'aire lliure": ["ruta", "passeig"],
}
# Un "festival" o un "cicle" sense més pistes NO bastan per classificar: són massa genèrics.

DESC_MIN_HITS = 2  # coincidències necessàries a la descripció per assignar una categoria


def strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _norm(text: str) -> str:
    t = strip_accents(text or "").lower().replace("·", "").replace("-", " ").replace("'", " ").replace("’", " ")
    return " " + t + " "


def _compile(words: list[str]) -> re.Pattern:
    parts = [r"\b" + re.escape(w[:-1]) + r"\b" if w.endswith("$") else r"\b" + re.escape(w) for w in words]
    return re.compile("|".join(parts))


_RX = {cat: _compile(words) for cat, words in KEYWORDS.items()}
_RX_TITLE = {cat: _compile(words) for cat, words in TITLE_ONLY.items()}


def categorize(primary: str = "", secondary: str = "", *, start_hour_local: int | None = None) -> list[str]:
    """Retorna les categories (en l'ordre d'EVENT_CATEGORIES) que encaixen.

    primary   : text fiable (títol, etiquetes, taxonomia de la font): 1 coincidència n'hi ha prou.
    secondary : text llarg (descripció): calen DESC_MIN_HITS coincidències.
    start_hour_local: hora d'inici en hora local (None si es desconeix). >= 21h -> "Nit".
    """
    p, d = _norm(primary), _norm(secondary)
    found = set()
    for cat, rx in _RX.items():
        if rx.search(p) or (cat in _RX_TITLE and _RX_TITLE[cat].search(p)):
            found.add(cat)
        elif len(rx.findall(d)) >= DESC_MIN_HITS:
            found.add(cat)
    for cat, rx in _RX_TITLE.items():
        if cat not in found and rx.search(p):
            found.add(cat)
    if start_hour_local is not None and start_hour_local >= 21:
        found.add("Nit")
    return [c for c in EVENT_CATEGORIES if c in found]
