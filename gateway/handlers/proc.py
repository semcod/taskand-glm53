from gateway.auth import require_grant
from gateway.middleware.logging import log_event
from gateway.utils import call_process, status_for
from gateway.handlers.mcp_control import URI as MCP_URI, authorize as authorize_mcp
import json
import os
import urllib.error
import urllib.request
from urllib.parse import urlsplit

LLM_URI = 'proc://taskand.dev/dev/llm/v1'


def handle_conversation(handler, body):
    """Conversation only: a fixed LLM URI, no intent dispatch or tool execution."""
    user = require_grant(handler, LLM_URI, 'call')
    if not user:
        return
    messages = body.get('messages')
    if (not isinstance(messages, list) or not 1 <= len(messages) <= 24
            or any(not isinstance(m, dict) or set(m) != {'role', 'content'}
                   or m['role'] not in {'user', 'assistant'}
                   or not isinstance(m['content'], str) or not m['content'].strip()
                   or len(m['content']) > 12000 for m in messages)
            or messages[-1]['role'] != 'user'
            or sum(len(m['content']) for m in messages) > 48000):
        handler._send(400, {'ok': False, 'error': 'CONVERSATION_MESSAGES_INVALID'})
        return
    data = {'messages': [{'role': 'system', 'content':
        'Odpowiadaj po polsku. To rozmowa i przygotowanie zadań. Nie masz narzędzi '
        'w tym trybie. Nie twierdź, że wykonałeś operacje ani odczytałeś aktualny stan usług.'},
        *messages], 'max_tokens': 2500, 'reasoning_effort': 'low'}
    upstream = os.environ.get('TASKAND_CONVERSATION_GATEWAY', '')
    if not upstream:
        result = call_process(LLM_URI, data, timeout=100)
    else:
        endpoint = urlsplit(upstream)
        if (endpoint.scheme != 'http' or endpoint.hostname not in {'127.0.0.1', 'localhost', '::1'}
                or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment
                or endpoint.path not in {'', '/'}):
            handler._send(503, {'ok': False, 'error': 'CONVERSATION_GATEWAY_INVALID'})
            return
        # Forward the caller's Taskand token, never a provider credential or admin token.
        headers = {'Content-Type': 'application/json'}
        for name in ('Authorization', 'X-Taskand-Key'):
            if handler.headers.get(name):
                headers[name] = handler.headers[name]
        request = urllib.request.Request(upstream.rstrip('/') + '/api/proc/call',
            data=json.dumps({'uri': LLM_URI, 'data': data}).encode(), headers=headers)
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=105) as response:
                raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError('oversized response')
            observed = json.loads(raw)
            if not isinstance(observed, dict) or observed.get('user') != user['name']:
                raise ValueError('identity mismatch')
            result = observed.get('result', {})
        except urllib.error.HTTPError as error:
            handler._send(error.code if error.code in {401, 403} else 502,
                          {'ok': False, 'error': 'CONVERSATION_UPSTREAM_DENIED' if error.code in {401, 403} else 'CONVERSATION_UPSTREAM_FAILED'})
            return
        except (OSError, ValueError):
            handler._send(502, {'ok': False, 'error': 'CONVERSATION_UPSTREAM_UNAVAILABLE'})
            return
    if not isinstance(result, dict) or result.get('ok') is not True or not isinstance(result.get('content'), str) or not result['content'].strip():
        handler._send(503, {'ok': False, 'error': 'CONVERSATION_MODEL_UNAVAILABLE'})
        return
    handler._send(200, {'ok': True, 'reply': result['content'], 'mode': 'conversation', 'toolsExecuted': False})


def handle_proc_call(request_handler, body: dict) -> None:
    uri = body.get("uri", "")
    if not uri:
        request_handler._send(400, {"ok": False, "error": "Brak wymaganego pola 'uri'"})
        return
    user = require_grant(request_handler, uri, "call")
    if not user:
        return
    data = body.get("data", {})
    if uri == MCP_URI:
        data = authorize_mcp(request_handler, user, data)
        if data is None:
            return
    result = call_process(uri, data, timeout=40 if uri == MCP_URI else int(body.get("timeout", 60)))
    log_event("gateway.proc.call", {"uri": uri, "user": user["name"], "errorType": result.get("errorType")})
    request_handler._send(status_for(result), {"ok": result.get("ok") is not False, "uri": uri, "user": user["name"], "result": result})
