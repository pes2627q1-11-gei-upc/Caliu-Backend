"""Converteix un document "cru" de la col·lecció font (Agenda Cultural de la Generalitat)
en un document amb la forma del model Event de api-node.

Lògica PURA (no toca la base de dades): es pot testejar sense Mongo.

ATENCIÓ: els noms dels camps de la font (FIELD_MAP) són els de l'Agenda Cultural a Socrata.
Si a la vostra col·lecció de Mongo tenen un altre nom, només cal canviar FIELD_MAP.
"""
import base64
import html
import json
import re
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .categories import categorize, strip_accents

MADRID = ZoneInfo("Europe/Madrid")

# camp lògic -> possibles noms a la font (el primer que existeixi; admet camins amb punts)
FIELD_MAP: dict[str, list[str]] = {
    "code": ["codiGencat", "codi", "code"],
    "title": ["titol", "denominaci", "title"],
    "description": ["descripcio", "description"],
    "start": ["dataInici", "data_inici", "startDate"],
    "end": ["dataFi", "data_fi", "endDate"],
    "schedule": ["horari", "schedule"],
    "venue": ["espai", "venue"],
    "address": ["ubicacio.adreca", "adreca", "address"],
    "municipality": ["ubicacio.municipi", "municipi"],
    "comarca": ["ubicacio.comarca", "comarca"],
    "location": ["localitzacio", "location"],
    "etiquetes": ["etiquetes", "tags_categor_es", "tags"],
    "ambits": ["ambits", "tags_mbits"],
    # NO es llegeix `esGratuit`: el trigger actual el posa a true quan no hi ha preu.
    "is_free": ["gratuita"],
    "price": ["entrades", "preu", "price"],
    "url": ["urlOficial", "url"],
    "images": ["imatges", "imatge", "images"],
    "email": ["email"],
    "phone": ["telefon", "tel_fon", "phone"],
}

IMAGE_BASE = "https://agenda.cultura.gencat.cat"  # `cultura.gencat.cat` dona 404 per a aquests recursos

# Límits aproximats de Catalunya: coordenades fora d'aquí són gairebé segur errors de la font.
LAT_RANGE = (40.4, 42.95)
LNG_RANGE = (0.1, 3.4)

COMARQUES = {
    "alt-camp": "Alt Camp", "alt-emporda": "Alt Empordà", "alt-penedes": "Alt Penedès",
    "alt-urgell": "Alt Urgell", "alta-ribagorca": "Alta Ribagorça", "anoia": "Anoia",
    "bages": "Bages", "baix-camp": "Baix Camp", "baix-ebre": "Baix Ebre",
    "baix-emporda": "Baix Empordà", "baix-llobregat": "Baix Llobregat",
    "baix-penedes": "Baix Penedès", "barcelones": "Barcelonès", "bergueda": "Berguedà",
    "cerdanya": "Cerdanya", "conca-de-barbera": "Conca de Barberà", "garraf": "Garraf",
    "garrigues": "Garrigues", "garrotxa": "Garrotxa", "girones": "Gironès",
    "maresme": "Maresme", "montsia": "Montsià", "noguera": "Noguera", "osona": "Osona",
    "pallars-jussa": "Pallars Jussà", "pallars-sobira": "Pallars Sobirà",
    "pla-d-urgell": "Pla d'Urgell", "pla-de-l-estany": "Pla de l'Estany",
    "priorat": "Priorat", "ribera-d-ebre": "Ribera d'Ebre", "ripolles": "Ripollès",
    "segarra": "Segarra", "segria": "Segrià", "selva": "Selva", "solsones": "Solsonès",
    "tarragones": "Tarragonès", "terra-alta": "Terra Alta", "urgell": "Urgell",
    "val-d-aran": "Val d'Aran", "valles-occidental": "Vallès Occidental",
    "valles-oriental": "Vallès Oriental", "moianes": "Moianès",
    "lluces": "Lluçanès",
}

TAG_LABELS = {
    "concerts": "Concerts", "musica": "Música", "musica-classica": "Música clàssica",
    "jazz": "Jazz", "teatre": "Teatre", "dansa": "Dansa", "exposicions": "Exposicions",
    "cinema": "Cinema", "festes-populars": "Festes populars", "familiar": "Família",
    "infantil": "Infantil", "tallers": "Tallers", "cultura-popular-i-tradicional": "Cultura popular",
    "literatura": "Literatura", "cicles": "Cicles", "fires": "Fires",
    "festivals-i-mostres": "Festivals i mostres", "rutes-i-visites": "Rutes i visites",
    "activitats-virtuals": "Activitats virtuals", "conferencies": "Conferències", "festes": "Festes",
    "gegants": "Gegants", "espectacles": "Espectacles", "divulgacio": "Divulgació",
}


# ---------------------------------------------------------------- helpers
def get_path(doc: dict, path: str) -> Any:
    cur: Any = doc
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def pick(doc: dict, key: str) -> Any:
    """Primer valor no buit de la font per al camp lògic `key`."""
    for name in FIELD_MAP[key]:
        v = get_path(doc, name)
        if v is not None and v != "" and v != []:
            return v
    return None


def clean_text(value: Any) -> str:
    """Treu HTML, desfà entitats (&amp;...) i normalitza espais."""
    if value is None:
        return ""
    text = re.sub(r"<br\s*/?>|</p>", "\n", str(value), flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


_PARTICLES = {"de", "del", "dels", "la", "les", "el", "els", "i", "al", "a", "en", "sa", "ses", "es"}


def slug_to_label(slug: str) -> str:
    """'vilafranca-del-penedes' -> 'Vilafranca del Penedes' (els accents NO es poden recuperar)."""
    slug = slug.strip().lower()
    if slug in TAG_LABELS:
        return TAG_LABELS[slug]
    words = re.split(r"[-_\s]+", slug)
    out: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        if w in ("l", "d") and i + 1 < len(words):  # l-hospitalet -> L'Hospitalet
            out.append(f"{w.upper() if w == 'l' else w}'{words[i + 1].capitalize()}")
            i += 2
            continue
        out.append(w if (w in _PARTICLES and out) else w.capitalize())
        i += 1
    return " ".join(out)


def split_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [s.strip() for s in str(value).split(",") if s.strip()]


def parse_date(value: Any) -> datetime | None:
    """-> datetime UTC (tz-aware).

    Tant un text sense zona com un datetime "naive" (BSON Date) es tracten com a hora de
    Barcelona: el trigger d'Atlas fa `new Date("2026-10-24T22:00:00.000")` en un servidor UTC,
    de manera que desa les xifres de l'hora local com si fossin UTC.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=MADRID)
    return dt.astimezone(timezone.utc)


def hour_from_schedule(text: Any) -> int | None:
    """Hora d'inici a partir de `horari` ("A les 18 h", "21.30 h", "20 h Durada: 1 hora").
    Només s'accepta si l'horari COMENÇA amb l'hora: "de 10 a 22 h" (horari d'obertura) no val."""
    m = re.match(
        r"\s*(?:a\s+partir\s+de\s+(?:les|la)\s+|a\s+les\s+|a\s+la\s+|a\s+l')?(\d{1,2})(?:[.:](\d{2}))?\s*h\b",
        clean_text(text),
        re.I,
    )
    if not m:
        return None
    hour = int(m.group(1))
    return hour if hour < 24 else None


def parse_price(value: Any, is_free: Any = None) -> float | None:
    """0 = gratuït; None = desconegut. `is_free` és el camp `gratuita` ("Sí"/"No") o un booleà."""
    if is_free is True or (isinstance(is_free, str) and strip_accents(is_free).strip().lower() == "si"):
        return 0.0
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if value >= 0 else None
    text = clean_text(value).lower()
    if not text:
        return None
    if "gratu" in text or "entrada lliure" in text:
        return 0.0
    # Només es fia d'un número acompanyat de moneda: "938 123 456" o "a les 18 h" NO són preus.
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:€|euros?\b)", text) or re.search(r"€\s*(\d+(?:[.,]\d+)?)", text)
    return float(m.group(1).replace(",", ".")) if m else None


def parse_coord(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).strip().replace(",", "."))
    except ValueError:
        return None


def parse_location(value: Any) -> dict | None:
    """Accepta un GeoJSON Point ({'coordinates': [lng, lat]}). Retorna None si no és fiable."""
    if not isinstance(value, dict):
        return None
    coords = value.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) != 2:
        return None
    lng, lat = parse_coord(coords[0]), parse_coord(coords[1])
    if lat is None or lng is None:
        return None
    # [lat, lng] en lloc de [lng, lat]?
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]) and (LAT_RANGE[0] <= lng <= LAT_RANGE[1]):
        lat, lng = lng, lat
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
        return None
    return {"type": "Point", "coordinates": [lng, lat]}


def _last_slug(value: Any) -> str:
    return str(value).strip().strip("/").rsplit("/", 1)[-1] if value else ""


def parse_place(municipality_raw: Any, comarca_raw: Any) -> tuple[str, str]:
    """'agenda:ubicacions/barcelona/valles-occidental/terrassa' -> ('Terrassa', ...).
    Si no té format de slug (text pla), es deixa tal qual."""
    def one(raw: Any, table: dict | None = None) -> str:
        text = str(raw).strip() if raw else ""
        if not text:
            return ""
        if "agenda:" not in text and "/" not in text:
            return text
        slug = _last_slug(text)
        return (table or {}).get(slug) or slug_to_label(slug)

    return one(municipality_raw), one(comarca_raw, COMARQUES)


def parse_images(value: Any) -> list[str]:
    out = []
    for img in split_list(value):
        if img.startswith("//"):
            img = "https:" + img
        elif img.startswith("/"):
            img = IMAGE_BASE + img
        # URLs absolutes antigues (camp `imatge` del trigger anterior) apunten al host que no serveix
        img = img.replace("://cultura.gencat.cat/", "://agenda.cultura.gencat.cat/", 1)
        if img.startswith("http"):
            out.append(img)
    return out


def tags_from(value: Any) -> list[str]:
    tags = []
    for raw in split_list(value):
        label = slug_to_label(_last_slug(raw)) if ("agenda:" in raw or "/" in raw) else raw
        if label and label not in tags:
            tags.append(label)
    return tags


def pick_event_url(value: Any) -> str:
    """urlOficial pot dur diverses URLs separades per comes; una és un cercador de l'agenda
    de la Generalitat, que no serveix com a enllaç de l'esdeveniment. Es pren la primera bona."""
    urls = [u for u in split_list(value) if u.startswith("http")]
    good = [u for u in urls if "agenda.cultura.gencat.cat" not in u]
    return good[0] if good else ""


def gencat_taxonomy(value: Any) -> list[str]:
    """Llegeix ambits/categories del paràmetre `c=` (JSON en base64) dels enllaços del cercador
    de l'agenda. Millor esforç: si res no quadra retorna []."""
    out: list[str] = []
    for url in split_list(value):
        m = re.search(r"[?&]c=([A-Za-z0-9_\-]+)", url)
        if not m:
            continue
        token = m.group(1)
        stripped = token.rstrip("_")
        padded = stripped + "=" * (len(token) - len(stripped))  # '__' fa de padding '=='
        try:
            data = json.loads(base64.urlsafe_b64decode(padded + "=" * (-len(padded) % 4)))
        except Exception:
            continue
        for key in ("ambits", "categories"):
            for item in data.get(key) or []:
                out.append(_last_slug(item).replace("-", " "))
    return out


# ---------------------------------------------------------------- principal
class SkipEvent(Exception):
    """Document de la font que no es pot convertir en un Event vàlid."""


MAX_EVENT_SPAN_DAYS = 3 * 366  # exposicions llargues sí; anys 2924 no


def normalize_event(raw: dict) -> dict:
    """Document cru -> document Event. Llança SkipEvent amb el motiu si no és vàlid."""
    code = pick(raw, "code")
    if code is None:
        raise SkipEvent("sense_codi")
    code = str(code).strip()

    title = clean_text(pick(raw, "title"))
    if not title:
        raise SkipEvent("sense_titol")

    start = parse_date(pick(raw, "start"))
    if start is None:
        raise SkipEvent("sense_data_inici")
    end = parse_date(pick(raw, "end")) or start
    if end < start or (end - start).days > MAX_EVENT_SPAN_DAYS:
        end = start  # data de fi absurda (p. ex. any 2924): no es pot confiar-hi
    # La font dóna dates sense hora (00:00). Si no, un esdeveniment d'un sol dia es consideraria
    # acabat des de la mitjanit del mateix dia i la API (endDate >= ara) mai el mostraria.
    end_local = end.astimezone(MADRID)
    if (end_local.hour, end_local.minute, end_local.second) == (0, 0, 0):
        end = end_local.replace(hour=23, minute=59, second=59).astimezone(timezone.utc)

    municipality, comarca = parse_place(pick(raw, "municipality"), pick(raw, "comarca"))
    url_raw = pick(raw, "url")
    tags = tags_from(pick(raw, "etiquetes"))
    local_start = start.astimezone(MADRID)
    # L'hora real sol anar a `horari` (text lliure); data_inici gairebé sempre és a les 00:00.
    hour = hour_from_schedule(pick(raw, "schedule"))
    if hour is None and (local_start.hour or local_start.minute):
        hour = local_start.hour
    ambits_text = " ".join(_last_slug(a).replace("-", " ") for a in split_list(pick(raw, "ambits")))

    doc = {
        "code": code,
        "title": title,
        "description": clean_text(pick(raw, "description")),
        "startDate": start,
        "endDate": end,
        "schedule": clean_text(pick(raw, "schedule")),
        "venue": clean_text(pick(raw, "venue")),
        "address": clean_text(pick(raw, "address")),
        "municipality": municipality,
        "comarca": comarca,
        "categories": categorize(
            f"{title} {' '.join(tags)} {ambits_text} {' '.join(gencat_taxonomy(url_raw))}",
            clean_text(pick(raw, "description")),
            start_hour_local=hour,
        ),
        "tags": tags,
        "url": pick_event_url(url_raw),
        "images": parse_images(pick(raw, "images")),
        "email": str(pick(raw, "email") or "").strip(),
        "phone": clean_text(pick(raw, "phone")),
        "source": "ingest",
    }
    location = parse_location(pick(raw, "location"))
    if location:
        doc["location"] = location
    price = parse_price(pick(raw, "price"), pick(raw, "is_free"))
    if price is not None:
        doc["price"] = price
    return doc
