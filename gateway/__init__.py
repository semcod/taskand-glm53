import os
import sys
import json
import sqlite3
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from gateway.router import dispatch
from gateway.auth import bind_address, is_loopback_bind
from gateway.auth import check_auth
from gateway.context import ACTIVE, ContextError, default_store

class GatewayHTTPHandler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get('Origin')
        allowed = {'http://localhost:8090', 'http://127.0.0.1:8090'}
        if origin in allowed:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Taskand-Key')

    def _send(self, code: int, body: dict) -> None:
        context = ACTIVE.get()
        if context and not getattr(self, '_context_finished', False):
            try:
                refs = context['store'].finish(context['owner'], context['requestId'], body, code)
                body = {**body, **refs}
            except (OSError, ValueError, sqlite3.Error):
                code, body = 503, {'ok': False, 'error': 'AUDIT_COMMIT_FAILED',
                                   'outcomeUnknown': True, 'requestId': context['requestId']}
            self._context_finished = True
        b = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if urlsplit(self.path).path in ('/', '/index.html'):
            page = (Path(__file__).resolve().parent.parent / 'index.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Length', str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return
        try:
            dispatch('GET', self.path, self, {})
        except (OSError, sqlite3.Error):
            self._send(503, {'ok': False, 'error': 'CONTEXT_STORE_UNAVAILABLE'})

    def do_POST(self) -> None:
        try:
            n = int(self.headers.get('Content-Length', 0))
            if n < 0 or n > 262144:
                self._send(413, {'ok': False, 'error': 'REQUEST_TOO_LARGE'})
                return
            raw = self.rfile.read(n) if n > 0 else b'{}'
            body = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(body, dict):
                raise ValueError('object required')
        except (ValueError, UnicodeError, RecursionError):
            self._send(400, {'ok': False, 'error': 'JSON_OBJECT_REQUIRED'})
            return
        authenticated, user = check_auth(self.headers)
        if not authenticated:
            self._send(401, {'ok': False, 'error': 'Unauthorized'})
            return
        token = None
        self._context_finished = False
        try:
            request_id = body.pop('requestId', None)
            retain = body.pop('retainPrompt', False)
            refs = body.pop('contextRefs', [])
            if not isinstance(retain, bool):
                raise ContextError('CONTEXT_RETENTION_INVALID')
            body.pop('_context', None)
            store = default_store()
            context = store.begin(user['name'], self.path, body, request_id, retain, refs)
            context['refs'] = refs
            token = ACTIVE.set(context)
            if self.path == '/api/conversation':
                from gateway.handlers.proc import handle_conversation
                handle_conversation(self, body)
            else:
                dispatch('POST', self.path, self, body)
        except ContextError as error:
            self._send(409, {'ok': False, 'error': str(error)})
        except (OSError, sqlite3.Error):
            self._send(503, {'ok': False, 'error': 'CONTEXT_STORE_UNAVAILABLE'})
        except (ValueError, TypeError, KeyError):
            self._send(400, {'ok': False, 'error': 'REQUEST_CONTRACT_INVALID'})
        finally:
            if token is not None:
                ACTIVE.reset(token)

    def log_message(self, format, *args):
        # Silence default stderr spam during normal testing
        if os.environ.get("TASKAND_DEBUG"):
            # Developer bootstrap parameters must not enter access logs.
            safe_args = tuple(arg.replace(self.path, self.path.split('?', 1)[0])
                              if isinstance(arg, str) else arg for arg in args)
            super().log_message(format, *safe_args)

def main() -> None:
    port = int(os.environ.get("PORT", 8077))
    bind = bind_address()
    print(f"Taskand Gateway listening on {bind}:{port}")
    if not is_loopback_bind():
        print("UWAGA: bind poza loopback — domyślne tokeny z grants.yaml są odrzucane; ustaw własne tokeny.")
    server = ThreadingHTTPServer((bind, port), GatewayHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGateway stopped.")
