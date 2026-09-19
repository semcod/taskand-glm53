"""Sign bounded MCP operation grants using authenticated gateway identity."""
import hashlib
import hmac
import json
import os
import time
import uuid

from gateway.auth import check_grant

URI = 'proc://taskand.dev/mcp/control/v1'
ACTIONS = {'list', 'register', 'configure', 'discover', 'admit', 'call', 'runs'}


def authorize(handler, user, data):
    if not isinstance(data, dict) or set(data) - {'action', 'data'} or data.get('action') not in ACTIONS or not isinstance(data.get('data', {}), dict):
        handler._send(400, {'ok': False, 'error': 'MCP_REQUEST_INVALID'})
        return None
    action = data['action']
    if not check_grant(user, URI, 'mcp:' + action):
        handler._send(403, {'ok': False, 'error': 'MCP_ACTION_DENIED'})
        return None
    key = os.environ.get('TASKAND_MCP_KEY', '')
    if len(key) < 32:
        handler._send(503, {'ok': False, 'error': 'MCP_CONTROL_NOT_CONFIGURED'})
        return None
    payload = {'uri': URI, 'actor': user['name'], 'action': action, 'data': data.get('data', {}),
               'expires': time.time() + 60, 'nonce': uuid.uuid4().hex}
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    return {'payload': payload, 'signature': hmac.new(key.encode(), raw.encode(), hashlib.sha256).hexdigest()}
