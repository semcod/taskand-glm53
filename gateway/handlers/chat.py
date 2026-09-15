from gateway.auth import require_grant
from gateway.middleware.logging import log_event
from gateway.utils import call_process, status_for

DEV_CHAT = "proc://taskand.dev/dev/chat/v1"


def handle_chat(request_handler, body: dict) -> None:
    """Jedna ścieżka: dev/chat trasuje organizmy i intencje; gateway nie zna organizmów ani LLM."""
    message = str(body.get("message", "")).strip()
    if not message:
        request_handler._send(400, {"ok": False, "error": "Wymagane pole 'message'"})
        return
    user = require_grant(request_handler, DEV_CHAT, "call")
    if not user:
        return
    organism = str(body.get("organism", "")).strip().lower()
    log_event("gateway.chat", {"user": user["name"], "organism": organism})
    result = call_process(DEV_CHAT, {"message": message, "organism": organism})
    response = {
        "ok": result.get("ok", False),
        "organism": result.get("organism", organism),
        "intent": result.get("intent"),
        "reply": result.get("reply") or result.get("error"),
    }
    for key in ("devices", "topology", "networks", "result", "data", "summary", "twinId", "projects"):
        if key in result and result[key] is not None:
            response[key] = result[key]
    request_handler._send(status_for(result), response)
