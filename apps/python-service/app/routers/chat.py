import logging
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from google.genai.errors import APIError
from pymongo.errors import PyMongoError

from app.chatbot.intent import MAX_MESSAGE_LENGTH, IntentExtractionError, extract_filters
from app.chatbot.language import LANGUAGE_NAMES, detect_conversation_language
from app.chatbot.rag import answer_with_events_and_cards, extract_chat_filters

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


class FiltersRequest(BaseModel):
    message: str


class ChatHistoryMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(max_length=1000)


class MessagesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=10)
    # Idioma de l'app (#147): només s'usa quan el missatge no permet detectar-ne cap.
    locale: Literal["ca", "es", "en"] | None = None


@router.post("/filters")
def chat_filters(body: FiltersRequest):
    message = body.message.strip()
    if not message:
        return JSONResponse(status_code=400, content={"error": 'Camp "message" obligatori'})
    if len(message) > MAX_MESSAGE_LENGTH:
        return JSONResponse(
            status_code=400,
            content={"error": f'Camp "message" massa llarg (màxim {MAX_MESSAGE_LENGTH} caràcters)'},
        )
    try:
        filters = extract_filters(message)
    except IntentExtractionError as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)})
    return {"filters": filters.to_dict(), "hasFilters": not filters.is_empty()}


@router.post("/messages")
def chat_messages(body: MessagesRequest):
    message = body.message.strip()
    if not message:
        return JSONResponse(status_code=400, content={"error": 'Camp "message" obligatori'})
    if len(message) > MAX_MESSAGE_LENGTH:
        return JSONResponse(
            status_code=400,
            content={"error": f'Camp "message" massa llarg (màxim {MAX_MESSAGE_LENGTH} caràcters)'},
        )
    try:
        history = [item.model_dump() for item in body.history]
        language = detect_conversation_language(message, history, default=body.locale)
        filters = extract_chat_filters(message, history=history)
        reply, events = answer_with_events_and_cards(
            message,
            history=history,
            language_name=LANGUAGE_NAMES[language],
            filters=filters,
        )
    except (APIError, RuntimeError):
        logger.exception("No s'ha pogut generar la resposta del xatbot")
        return JSONResponse(status_code=503, content={"error": "El servei de xatbot no està disponible"})
    except PyMongoError:
        logger.exception("No s'han pogut recuperar esdeveniments per al xatbot")
        return JSONResponse(status_code=503, content={"error": "El servei d'esdeveniments no està disponible"})
    # "filters" (#138): el que s'ha interpretat del missatge, perquè l'app ho mostri; null si no n'hi ha cap.
    return {
        "reply": reply,
        "language": language,
        "events": events,
        "filters": None if filters.is_empty() else filters.to_dict(),
    }
