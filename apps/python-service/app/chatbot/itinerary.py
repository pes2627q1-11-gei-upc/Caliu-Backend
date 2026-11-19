# Itinerari d'esdeveniments encadenats (#139, HU #13): a partir dels esdeveniments candidats, construeix
# una llista de passos que no se solapen, ordenats per hora i, a igualtat d'hora, per distància.
# És lògica pura (no toca la base de dades ni Gemini): rep els documents tal com surten de Mongo.

import math
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.chatbot.catalog import TIMEZONE

TZ = ZoneInfo(TIMEZONE)

MAX_STEPS = 5
# Dos esdeveniments que comencen amb menys diferència es consideren a la mateixa hora: guanya el més proper.
SAME_TIME = timedelta(minutes=30)
# Espera màxima entre el final d'un pas i l'inici del següent.
MAX_WAIT = timedelta(hours=3)
# Distància màxima entre passos consecutius: un itinerari encadenat ha de ser a prop.
MAX_LEG_KM = 15
# Velocitat mitjana aproximada per estimar el desplaçament (a peu i en transport públic).
TRAVEL_SPEED_KMH = 20
# Un esdeveniment més llarg és d'horari obert (exposició, fira...): s'hi fa una visita d'aquesta durada.
LONG_EVENT = timedelta(hours=6)
DEFAULT_VISIT = timedelta(minutes=90)


# Mongo retorna les dates sense zona horària (en UTC).
def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _coordinates(event: dict) -> tuple[float, float] | None:
    coords = (event.get("location") or {}).get("coordinates")
    if isinstance(coords, (list, tuple)) and len(coords) == 2 and all(isinstance(c, (int, float)) for c in coords):
        return float(coords[0]), float(coords[1])  # [lng, lat]
    return None


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


# Franja en què es pot fer l'esdeveniment si s'hi arriba a `arrival`, o None si ja no es pot.
def _visit(event: dict, arrival: datetime) -> tuple[datetime, datetime, bool] | None:
    start = _utc(event["startDate"])
    end = _utc(event.get("endDate") or event["startDate"])
    if end - start > LONG_EVENT:
        visit_start = max(start, arrival)
        if visit_start >= end:
            return None
        return visit_start, min(end, visit_start + DEFAULT_VISIT), True
    # Un esdeveniment curt (concert, visita guiada) s'ha de fer sencer: no s'hi pot arribar tard.
    if arrival > start:
        return None
    return start, max(end, start), False  # dades amb endDate < startDate: dura 0


def _step(order: int, event: dict, visit_start, visit_end, leg_km, travel) -> dict:
    coords = _coordinates(event)
    return {
        "order": order,
        "id": str(event["_id"]) if event.get("_id") is not None else None,
        "title": event.get("title", ""),
        "start": visit_start.astimezone(TZ).isoformat(),
        "end": visit_end.astimezone(TZ).isoformat(),
        "venue": event.get("venue", ""),
        "address": event.get("address", ""),
        "municipality": event.get("municipality", ""),
        "coordinates": list(coords) if coords else None,
        "distanceKm": round(leg_km, 1) if leg_km is not None else None,
        "travelMinutes": math.ceil(travel.total_seconds() / 60) if leg_km is not None else None,
        "url": event.get("url", ""),
    }


# Passos de l'itinerari a partir de `start` (i, opcionalment, d'un punt `origin` [lng, lat]) fins a `until`
# (per defecte, el final del dia). Si no hi ha prou esdeveniments, retorna només els passos possibles.
def build_itinerary(
    events: list[dict],
    start: datetime,
    origin: tuple[float, float] | None = None,
    until: datetime | None = None,
    max_steps: int = MAX_STEPS,
) -> list[dict]:
    start = _utc(start)
    until = _utc(until) if until else datetime.combine(start.astimezone(TZ).date(), time(23, 59, 59), TZ)
    remaining, seen = [], set()
    for event in events:
        key = event.get("_id") or id(event)
        if event.get("startDate") and key not in seen:
            seen.add(key)
            remaining.append(event)

    steps, now, position = [], start, origin
    while remaining and len(steps) < max_steps:
        options = []
        for event in remaining:
            coords = _coordinates(event)
            leg = distance_km(position, coords) if position and coords else None
            if leg is not None and leg > MAX_LEG_KM:
                continue
            travel = timedelta(hours=leg / TRAVEL_SPEED_KMH) if leg is not None else timedelta()
            visit = _visit(event, now + travel)
            if not visit or visit[1] > until or visit[0] - (now + travel) > MAX_WAIT:
                continue
            options.append((visit, leg, travel, event))
        if not options:
            break

        # Un esdeveniment d'horari obert només s'escull si no fa perdre el proper esdeveniment amb hora fixa.
        fixed_starts = [visit[0] for visit, *_ in options if not visit[2]]
        next_fixed = min(fixed_starts) if fixed_starts else None
        options = [o for o in options if not o[0][2] or next_fixed is None or o[0][1] <= next_fixed]

        earliest = min(visit[0] for visit, *_ in options)
        same_time = [o for o in options if o[0][0] - earliest < SAME_TIME]
        visit, leg, travel, event = min(
            same_time,
            key=lambda o: (o[1] if o[1] is not None else math.inf, o[0][0], o[3].get("title", "")),
        )
        steps.append(_step(len(steps) + 1, event, visit[0], visit[1], leg, travel))
        remaining.remove(event)
        now = visit[1]
        position = _coordinates(event) or position
    return steps
