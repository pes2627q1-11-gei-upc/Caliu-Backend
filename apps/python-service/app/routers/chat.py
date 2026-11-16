from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.chatbot.intent import MAX_MESSAGE_LENGTH, IntentExtractionError, extract_filters

router = APIRouter(prefix="/chat", tags=["chat"])


class FiltersRequest(BaseModel):
    message: str


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
