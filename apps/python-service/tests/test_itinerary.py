from datetime import datetime, timedelta, timezone

import pytest

from app.chatbot import itinerary
from app.chatbot.itinerary import TZ, build_itinerary, distance_km

# Dissabte 21/11/2026 a les 10:00, a Girona.
NOW = datetime(2026, 11, 21, 10, 0, tzinfo=TZ)
CATEDRAL = (2.8259, 41.9875)
RAMBLA = (2.8240, 41.9845)  # ~0,4 km de la catedral
SALT = (2.7925, 41.9750)  # ~3 km
BARCELONA = (2.1734, 41.3851)  # ~85 km


def at(hour, minute=0, day=21):
    return datetime(2026, 11, day, hour, minute, tzinfo=TZ)


def event(title, start, end, coords=None, **fields):
    doc = {"_id": title, "title": title, "startDate": start, "endDate": end, **fields}
    if coords:
        doc["location"] = {"type": "Point", "coordinates": list(coords)}
    return doc


GUIDED = event("Visita guiada al Call", at(10, 30), at(12), CATEDRAL, venue="Call jueu", municipality="Girona")
VERMUT = event("Concert vermut", at(12, 30), at(13, 30), RAMBLA)
SALT_WORKSHOP = event("Taller a Salt", at(12, 30), at(14), SALT)
OVERLAP = event("Conferència", at(11), at(12, 30), CATEDRAL)
EXHIBITION = event("Exposició al museu", datetime(2026, 11, 1, 10, tzinfo=TZ), datetime(2026, 12, 31, 20, tzinfo=TZ), CATEDRAL)
PUPPETS = event("Titelles", at(17), at(18), RAMBLA)
FAR = event("Concert a Barcelona", at(15), at(16), BARCELONA)
EVENTS = [PUPPETS, FAR, EXHIBITION, OVERLAP, SALT_WORKSHOP, VERMUT, GUIDED]


def titles(steps):
    return [step["title"] for step in steps]


def test_builds_a_chained_plan_ordered_by_time_and_distance():
    steps = build_itinerary(EVENTS, NOW)

    assert titles(steps) == ["Visita guiada al Call", "Concert vermut", "Exposició al museu", "Titelles"]
    assert [step["order"] for step in steps] == [1, 2, 3, 4]
    for previous, current in zip(steps, steps[1:]):
        assert previous["end"] <= current["start"]  # no se solapen
    assert steps[0] == {
        "order": 1,
        "id": "Visita guiada al Call",
        "title": "Visita guiada al Call",
        "start": "2026-11-21T10:30:00+01:00",
        "end": "2026-11-21T12:00:00+01:00",
        "venue": "Call jueu",
        "address": "",
        "municipality": "Girona",
        "coordinates": list(CATEDRAL),
        "distanceKm": None,
        "travelMinutes": None,
        "url": "",
    }
    assert steps[1]["distanceKm"] == 0.4 and steps[1]["travelMinutes"] == 2


def test_same_time_prefers_the_closest_event():
    steps = build_itinerary([GUIDED, SALT_WORKSHOP, VERMUT], NOW)
    assert titles(steps)[:2] == ["Visita guiada al Call", "Concert vermut"]


def test_earlier_event_wins_even_if_farther():
    # Salt (a ~9 minuts) comença 35 minuts abans que el concert proper: guanya l'hora, i després s'hi torna a temps.
    early_far = event("Taller a Salt d'hora", at(12, 15), at(12, 45), SALT)
    steps = build_itinerary([GUIDED, early_far, event("Concert tard", at(13), at(13, 30), RAMBLA)], NOW)
    assert titles(steps) == ["Visita guiada al Call", "Taller a Salt d'hora", "Concert tard"]


def test_travel_time_is_taken_into_account():
    # Des de la catedral, Salt és a ~9 minuts: un taller que comença 5 minuts després ja no s'hi arriba.
    too_soon = event("Taller a Salt", at(12, 5), at(13), SALT)
    assert titles(build_itinerary([GUIDED, too_soon], NOW)) == ["Visita guiada al Call"]


def test_overlapping_and_already_started_short_events_are_skipped():
    started = event("Concert ja començat", at(9, 30), at(11), CATEDRAL)
    assert titles(build_itinerary([started, OVERLAP, GUIDED], NOW)) == ["Visita guiada al Call"]


def test_open_hours_event_does_not_make_you_miss_a_fixed_one():
    steps = build_itinerary([EXHIBITION, GUIDED], NOW)
    assert titles(steps) == ["Visita guiada al Call", "Exposició al museu"]
    assert steps[1]["start"] == "2026-11-21T12:00:00+01:00"
    assert steps[1]["end"] == "2026-11-21T13:30:00+01:00"


def test_open_hours_event_fills_free_time():
    steps = build_itinerary([EXHIBITION], NOW)
    assert steps[0]["start"] == "2026-11-21T10:00:00+01:00"
    assert steps[0]["end"] == "2026-11-21T11:30:00+01:00"


def test_far_events_and_long_waits_are_not_chained():
    late = event("Concert de nit", at(21), at(22), RAMBLA)
    assert titles(build_itinerary([GUIDED, FAR, late], NOW)) == ["Visita guiada al Call"]


def test_returns_only_the_available_steps():
    assert build_itinerary([], NOW) == []
    assert build_itinerary([event("Ahir", at(10, day=20), at(11, day=20))], NOW) == []
    assert titles(build_itinerary([GUIDED], NOW)) == ["Visita guiada al Call"]


def test_origin_adds_the_first_leg():
    # Des de Salt cal desplaçar-se ~9 minuts: el concert de les 10:05 ja no s'arriba a temps.
    soon = event("Concert d'hora", at(10, 5), at(11), CATEDRAL)
    steps = build_itinerary([soon, GUIDED], NOW, origin=SALT)
    assert titles(steps) == ["Visita guiada al Call"]
    assert steps[0]["distanceKm"] == pytest.approx(distance_km(SALT, CATEDRAL), abs=0.05)
    assert steps[0]["travelMinutes"] == 10


def test_events_without_coordinates_are_ordered_by_time():
    a = event("Sense lloc A", at(11), at(12))
    b = event("Sense lloc B", at(12, 30), at(13))
    steps = build_itinerary([b, a], NOW)
    assert titles(steps) == ["Sense lloc A", "Sense lloc B"]
    assert steps[1]["distanceKm"] is None and steps[1]["coordinates"] is None


def test_naive_dates_from_mongo_are_utc():
    # 09:30 UTC = 10:30 a Girona a l'hivern.
    naive = event("Data de Mongo", datetime(2026, 11, 21, 9, 30), datetime(2026, 11, 21, 11))
    steps = build_itinerary([naive], NOW)
    assert steps[0]["start"] == "2026-11-21T10:30:00+01:00"


def test_stays_within_the_day_and_the_step_limit():
    tomorrow = event("Demà", at(10, 30, day=22), at(11, day=22), CATEDRAL)
    assert build_itinerary([tomorrow], NOW) == []
    many = [event(f"Pas {h}", at(h), at(h, 45), CATEDRAL) for h in range(11, 20)]
    assert len(build_itinerary(many, NOW)) == itinerary.MAX_STEPS
    assert len(build_itinerary(many, NOW, max_steps=2)) == 2
    assert titles(build_itinerary(many, NOW, until=at(13))) == ["Pas 11", "Pas 12"]


@pytest.mark.parametrize("hour", [0, 8, 10])
def test_plan_for_a_whole_day_does_not_depend_on_the_start_hour(hour):
    # Un itinerari per a un altre dia (#140) comença a les 00:00: ha de donar el mateix pla que a les 10:00.
    steps = build_itinerary(EVENTS, at(hour))
    assert titles(steps) == ["Visita guiada al Call", "Concert vermut", "Exposició al museu", "Titelles"]


def test_max_wait_does_not_apply_to_the_first_step():
    afternoon = event("Concert de tarda", at(15), at(16), RAMBLA)
    assert titles(build_itinerary([afternoon], at(0))) == ["Concert de tarda"]


def test_open_hours_visits_stay_within_opening_hours():
    steps = build_itinerary([EXHIBITION], at(0))
    assert (steps[0]["start"], steps[0]["end"]) == ("2026-11-21T10:00:00+01:00", "2026-11-21T11:30:00+01:00")
    assert titles(build_itinerary([EXHIBITION], at(18, 30))) == ["Exposició al museu"]  # 18:30–20:00
    assert build_itinerary([EXHIBITION], at(19)) == []  # la visita ja no cap abans de les 20:00


@pytest.mark.parametrize("start,guided_at", [(at(9), at(10, 35)), (at(10), at(11, 35))])
def test_open_hours_event_accounts_for_travel_to_the_next_fixed_one(start, guided_at):
    # L'exposició a Salt acabaria 5 minuts abans de la visita, però hi ha ~9 minuts fins a la catedral.
    salt_exhibition = event("Exposició a Salt", datetime(2026, 11, 1, 10, tzinfo=TZ),
                            datetime(2026, 12, 31, 20, tzinfo=TZ), SALT)
    guided = event("Visita guiada", guided_at, guided_at + timedelta(hours=1), CATEDRAL)
    assert titles(build_itinerary([salt_exhibition, guided], start)) == ["Visita guiada", "Exposició a Salt"]


def test_duplicate_events_appear_once():
    assert titles(build_itinerary([GUIDED, dict(GUIDED)], NOW)) == ["Visita guiada al Call"]


def test_distance_km():
    assert distance_km(CATEDRAL, CATEDRAL) == 0
    assert distance_km(CATEDRAL, BARCELONA) == pytest.approx(85, abs=3)
