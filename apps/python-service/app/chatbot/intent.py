# Frase en llenguatge natural -> filtres d'esdeveniments. Gemini extreu els descriptors
# (function calling) i normalize_filters els valida: mai s'apliquen filtres inventats.

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.chatbot.catalog import (
    AUDIENCES,
    EVENT_CATEGORIES,
    TIME_OF_DAY,
    TIMEZONE,
    canonical_category,
    fold,
)

FUNCTION_NAME = "aplicar_filtres_esdeveniments"
DEFAULT_MODEL = "gemini-2.5-flash"
MAX_MESSAGE_LENGTH = 500

TZ = ZoneInfo(TIMEZONE)
WEEKDAYS_CA = ["dilluns", "dimarts", "dimecres", "dijous", "divendres", "dissabte", "diumenge"]

FUNCTION_DECLARATION = {
    "name": FUNCTION_NAME,
    "description": (
        "Aplica a la cerca d'esdeveniments culturals els filtres que l'usuari ha expressat. "
        "Omple NOMÉS els camps que la frase esmenta explícitament o implica clarament; "
        "deixa buits la resta. Si no hi ha cap descriptor, crida-la sense arguments."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "date_from": {
                "type": "STRING",
                "description": "Primer dia demanat, format YYYY-MM-DD (p. ex. 'demà', 'dissabte').",
            },
            "date_to": {
                "type": "STRING",
                "description": (
                    "Últim dia demanat, format YYYY-MM-DD. Només si és un interval "
                    "('aquest cap de setmana' = dissabte a diumenge)."
                ),
            },
            "time_of_day": {
                "type": "STRING",
                "format": "enum",
                "enum": list(TIME_OF_DAY),
                "description": "Franja del dia: mati, migdia, tarda, vespre o nit.",
            },
            "categories": {
                "type": "ARRAY",
                "items": {"type": "STRING", "format": "enum", "enum": EVENT_CATEGORIES},
                "description": "Categories d'esdeveniment que encaixen amb el que demana.",
            },
            "audience": {
                "type": "STRING",
                "format": "enum",
                "enum": AUDIENCES,
                "description": (
                    "Públic: 'infantil' si parla de nens, canalla, infants o fills petits; "
                    "'familiar' si parla de família o d'anar-hi amb tota la família."
                ),
            },
            "max_price": {
                "type": "NUMBER",
                "description": "Preu màxim en euros, només si l'usuari dona una xifra.",
            },
            "free": {
                "type": "BOOLEAN",
                "description": "true si demana explícitament activitats gratuïtes o d'entrada lliure.",
            },
        },
    },
}


class IntentExtractionError(Exception):
    pass


@dataclass
class EventFilters:
    from_: datetime | None = None
    to: datetime | None = None
    time_of_day: str | None = None
    categories: list[str] = field(default_factory=list)
    audience: str | None = None
    max_price: float | None = None  # 0 = només gratuïts

    def is_empty(self) -> bool:
        return (
            self.from_ is None
            and self.to is None
            and not self.categories
            and self.audience is None
            and self.max_price is None
        )

    def to_dict(self) -> dict:
        return {
            "from": self.from_.isoformat() if self.from_ else None,
            "to": self.to.isoformat() if self.to else None,
            "timeOfDay": self.time_of_day,
            "categories": list(self.categories),
            "audience": self.audience,
            "maxPrice": self.max_price,
        }


def _parse_day(value) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def _at(day: date, hour: int) -> datetime:
    if hour >= 24:
        return datetime.combine(day, time(23, 59, 59), TZ)
    return datetime.combine(day, time(hour), TZ)


def _resolve_dates(args: dict, now: datetime, slot: str | None) -> tuple[datetime | None, datetime | None]:
    today = now.date()
    day_from = _parse_day(args.get("date_from"))
    day_to = _parse_day(args.get("date_to"))

    if day_to and not day_from:
        day_from = today
    if day_from and not day_to:
        day_to = day_from
    if day_from and day_to < day_from:
        day_from = day_to = None

    start_h, end_h = TIME_OF_DAY[slot] if slot else (0, 24)

    if not day_from:
        if not slot:
            return None, None
        # Només franja ("a la tarda"): avui, o demà si ja s'ha acabat.
        day_from = day_to = today if _at(today, end_h) > now else today + timedelta(days=1)

    if day_to < today:
        return None, None

    start, end = _at(day_from, start_h), _at(day_to, end_h)
    if start < now < end:
        start = now.replace(microsecond=0)
    return start, end


def _parse_price(args: dict) -> float | None:
    if args.get("free") is True:
        return 0
    value = args.get("max_price")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return int(value) if float(value).is_integer() else float(value)


def normalize_filters(args: dict | None, now: datetime | None = None) -> EventFilters:
    args = dict(args or {})
    now = (now or datetime.now(TZ)).astimezone(TZ)

    slot = args.get("time_of_day")
    slot = fold(slot) if isinstance(slot, str) else None
    if slot not in TIME_OF_DAY:
        slot = None

    categories: list[str] = []
    raw_categories = args.get("categories")
    if isinstance(raw_categories, str):
        raw_categories = [raw_categories]
    for value in raw_categories or []:
        category = canonical_category(value)
        if category and category not in categories:
            categories.append(category)

    audience = args.get("audience")
    audience = fold(audience) if isinstance(audience, str) else None
    if audience not in AUDIENCES:
        audience = None

    start, end = _resolve_dates(args, now, slot)
    return EventFilters(
        from_=start,
        to=end,
        time_of_day=slot if start else None,
        categories=categories,
        audience=audience,
        max_price=_parse_price(args),
    )


def build_system_instruction(now: datetime) -> str:
    local = now.astimezone(TZ)
    return (
        "Ets l'assistent de Caliu, una app d'agenda cultural de Catalunya. La teva única feina ara "
        f"és cridar la funció {FUNCTION_NAME} amb els filtres que expressa l'usuari.\n"
        f"Avui és {WEEKDAYS_CA[local.weekday()]} {local.date().isoformat()} i són les "
        f"{local.strftime('%H:%M')} (hora de Catalunya). Calcula les dates relatives a partir d'avui.\n"
        "Regles:\n"
        "- Omple només el que l'usuari diu o implica clarament. No inventis dates, categories, "
        "públic ni preus.\n"
        "- 'nens', 'canalla', 'infants', 'els petits' -> audience 'infantil'; "
        "'família', 'en família' -> audience 'familiar'.\n"
        "- 'a la tarda' sense dia -> només time_of_day; no posis date_from.\n"
        "- 'aquest cap de setmana' -> dissabte i diumenge d'aquesta setmana (si avui és diumenge, només avui).\n"
        "- 'gratis', 'gratuït', 'entrada lliure' -> free=true. 'barat' sense xifra NO és un preu.\n"
        "- Categories només si el tipus d'activitat ho indica (concert -> Música, titelles -> Teatre...).\n"
        "- L'usuari pot escriure en català, castellà o anglès.\n"
        "- Si la frase no té cap descriptor reconeixible, crida la funció sense arguments."
    )


_client = None


def _default_client():
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise IntentExtractionError("GEMINI_API_KEY no està configurada")
        from google import genai

        _client = genai.Client(api_key=api_key)
    return _client


def _call_args(response) -> dict:
    for call in getattr(response, "function_calls", None) or []:
        if call.name == FUNCTION_NAME:
            return dict(call.args or {})
    return {}


def extract_filters(message: str, now: datetime | None = None, client=None, model: str | None = None) -> EventFilters:
    now = (now or datetime.now(TZ)).astimezone(TZ)
    client = client or _default_client()
    config = {
        "system_instruction": build_system_instruction(now),
        "tools": [{"function_declarations": [FUNCTION_DECLARATION]}],
        "tool_config": {
            "function_calling_config": {"mode": "ANY", "allowed_function_names": [FUNCTION_NAME]}
        },
        "temperature": 0,
    }
    try:
        response = client.models.generate_content(
            model=model or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL,
            contents=message,
            config=config,
        )
    except Exception as exc:
        raise IntentExtractionError(f"Error en cridar Gemini: {exc}") from exc
    return normalize_filters(_call_args(response), now)
