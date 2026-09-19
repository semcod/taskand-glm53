"""Bounded MCP sessions and durable receipts. Invoked only with gateway proofs."""
import asyncio
from contextlib import contextmanager
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

from jsonschema import Draft202012Validator
from mcp import Client, StdioServerParameters

URI = "proc://taskand.dev/mcp/control/v1"
LIMIT = 262144
ACTIONS = {"list", "register", "configure", "discover", "admit", "call", "runs"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Rejected(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}", value), "INVALID_ID")
    return value


def failure_code(error):
    if isinstance(error, Rejected):
        return str(error)
    for child in getattr(error, 'exceptions', ()):
        code = failure_code(child)
        if code != 'MCP_TRANSPORT_ERROR':
            return code
    return 'MCP_TRANSPORT_ERROR'


def local_schema(value):
    if isinstance(value, dict):
        for key, child in value.items():
            require(key not in {'$ref', '$dynamicRef'} or (isinstance(child, str) and child.startswith('#')), 'EXTERNAL_SCHEMA_REFERENCE')
            local_schema(child)
    elif isinstance(value, list):
        for child in value:
            local_schema(child)


def envelope(value):
    require(isinstance(value, dict) and set(value) == {"payload", "signature"}, "GATEWAY_PROOF_REQUIRED")
    key = os.environ.get("TASKAND_MCP_KEY", "")
    require(len(key) >= 32, "CONTROL_NOT_CONFIGURED")
    p = value["payload"]
    require(isinstance(p, dict) and set(p) == {"uri", "actor", "action", "data", "expires", "nonce"}, "INVALID_PROOF")
    expected = hmac.new(key.encode(), canonical(p).encode(), hashlib.sha256).hexdigest()
    require(isinstance(value["signature"], str) and hmac.compare_digest(expected, value["signature"]), "INVALID_PROOF")
    require(p["uri"] == URI and p["action"] in ACTIONS, "INVALID_PROOF")
    require(isinstance(p["expires"], (float, int)) and time.time() < p["expires"] < time.time() + 120, "EXPIRED_PROOF")
    require(isinstance(p["actor"], str) and 0 < len(p["actor"]) <= 128, "INVALID_ACTOR")
    require(isinstance(p["data"], dict), "INVALID_INPUT")
    identifier(p["nonce"])
    return p


class Control:
    def __init__(self, actor):
        self.actor = actor
        self.root = Path(os.environ["TASKAND_MCP_STATE"])
        require(self.root.is_absolute(), "INVALID_STATE_PATH")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / "control.sqlite3", timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS servers(actor TEXT,id TEXT,profile TEXT,pin TEXT,enabled INTEGER,revision INTEGER,
            PRIMARY KEY(actor,id));
          CREATE TABLE IF NOT EXISTS tools(actor TEXT,server TEXT,name TEXT,pin TEXT,description TEXT,
            PRIMARY KEY(actor,server,name));
          CREATE TABLE IF NOT EXISTS runs(actor TEXT,id TEXT,request_hash TEXT,state TEXT,result TEXT,created REAL,
            PRIMARY KEY(actor,id));
          CREATE TABLE IF NOT EXISTS nonces(id TEXT PRIMARY KEY,expires REAL);
        """)
        os.chmod(self.root / "control.sqlite3", 0o600)

    def close(self):
        self.db.close()

    def consume(self, p):
        with self.db:
            self.db.execute("DELETE FROM nonces WHERE expires < ?", (time.time(),))
            try:
                self.db.execute("INSERT INTO nonces VALUES(?,?)", (p["nonce"], p["expires"]))
            except sqlite3.IntegrityError:
                raise Rejected("PROOF_REPLAY")

    @contextmanager
    def lock(self, kind, name, exclusive=True, nonblocking=False):
        path = self.root / (digest([self.actor, kind, name]) + ".lock")
        with path.open("a") as stream:
            op = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
            try:
                fcntl.flock(stream, op | (fcntl.LOCK_NB if nonblocking else 0))
            except BlockingIOError:
                raise Rejected("BUSY")
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def profiles(self):
        path = Path(os.environ["TASKAND_MCP_PROFILES"])
        require(path.is_absolute() and path.stat().st_size <= LIMIT, "INVALID_PROFILE_FILE")
        profiles = json.loads(path.read_text())
        require(isinstance(profiles, dict), "INVALID_PROFILES")
        return {k: v for k, v in profiles.items() if isinstance(v, dict) and self.actor in v.get("actors", [])}

    def profile(self, name, pin=None):
        profile = self.profiles().get(name)
        require(profile is not None, "PROFILE_DENIED")
        require(pin is None or pin == digest(profile), "PROFILE_CHANGED")
        require(profile.get("transport") in {"stdio", "http"}, "UNSUPPORTED_TRANSPORT")
        if profile["transport"] == "stdio":
            command = profile.get("command", "")
            require(Path(command).is_absolute(), "UNPINNED_COMMAND")
            files = profile.get("files", {})
            require(command in files, "UNPINNED_COMMAND")
            for path, sha in files.items():
                require(Path(path).is_absolute() and hashlib.sha256(Path(path).read_bytes()).hexdigest() == sha, "PROFILE_FILES_CHANGED")
        else:
            require(isinstance(profile.get("url"), str) and profile["url"].startswith(("https://", "http://127.0.0.1:", "http://localhost:")), "INVALID_ENDPOINT")
        return profile

    def server(self, server, enabled=False):
        row = self.db.execute("SELECT * FROM servers WHERE actor=? AND id=?", (self.actor, identifier(server))).fetchone()
        require(row is not None, "SERVER_NOT_FOUND")
        require(not enabled or row["enabled"], "SERVER_DISABLED")
        return dict(row)

    def client(self, profile):
        if profile["transport"] == "stdio":
            # Do not pass the gateway proof key, account tokens or inherited environment.
            target = StdioServerParameters(command=profile["command"], args=profile.get("args", []),
                                           env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
                                           cwd=profile.get("cwd"))
        else:
            target = profile["url"]
        return Client(target, read_timeout_seconds=20)

    async def tools(self, client):
        items, cursor, seen = [], None, set()
        while True:
            result = await client.list_tools(cursor=cursor)
            items.extend(t.model_dump(by_alias=True, exclude_none=True) for t in result.tools)
            require(len(items) <= 500 and len(canonical(items)) <= LIMIT, "CATALOG_TOO_LARGE")
            cursor = result.next_cursor
            if not cursor:
                break
            require(cursor not in seen, "INVALID_PAGINATION")
            seen.add(cursor)
        names = [t["name"] for t in items]
        require(len(names) == len(set(names)), "DUPLICATE_TOOL_NAME")
        return items

    def receipt(self, run_id):
        row = self.db.execute("SELECT * FROM runs WHERE actor=? AND id=?", (self.actor, identifier(run_id))).fetchone()
        require(row is not None, "RUN_NOT_FOUND")
        if row["state"] == "RUNNING":
            try:
                with self.lock("run", run_id, nonblocking=True):
                    with self.db:
                        self.db.execute("UPDATE runs SET state='OUTCOME_UNKNOWN' WHERE actor=? AND id=? AND state='RUNNING'", (self.actor, run_id))
                    row = self.db.execute("SELECT * FROM runs WHERE actor=? AND id=?", (self.actor, run_id)).fetchone()
            except Rejected as e:
                if str(e) != "BUSY":
                    raise
        state = row["state"]
        return {"runId": run_id, "state": state, "ok": state == "SUCCEEDED",
                "outcomeKnown": state in {"SUCCEEDED", "FAILED", "REJECTED"},
                "result": json.loads(row["result"]) if row["result"] else None,
                "acceptance": "NOT_EVALUATED", "created": row["created"]}

    async def remote(self, server_id, operation, data):
        row = self.server(server_id, enabled=True)
        profile = self.profile(row["profile"], row["pin"])
        async with asyncio.timeout(25):
            async with self.client(profile) as client:
                tools = await self.tools(client)
                if operation == "discover":
                    admitted = {r["name"]: r["pin"] for r in self.db.execute("SELECT name,pin FROM tools WHERE actor=? AND server=?", (self.actor, server_id))}
                    return {"ok": True, "tools": [{**t, "schemaPin": digest(t), "admitted": admitted.get(t["name"]) == digest(t)} for t in tools]}
                tool = next((t for t in tools if t["name"] == data.get("tool")), None)
                require(tool is not None, "TOOL_NOT_FOUND")
                require(data.get("schemaPin") == digest(tool), "TOOL_SCHEMA_CHANGED")
                if operation == "admit":
                    with self.db:
                        self.db.execute("INSERT OR REPLACE INTO tools VALUES(?,?,?,?,?)", (self.actor, server_id, tool["name"], digest(tool), str(tool.get("description", ""))[:1000]))
                    return {"ok": True, "admitted": tool["name"], "schemaPin": digest(tool)}
                admission = self.db.execute("SELECT pin FROM tools WHERE actor=? AND server=? AND name=?", (self.actor, server_id, tool["name"])).fetchone()
                require(admission is not None and admission["pin"] == digest(tool), "TOOL_NOT_ADMITTED")
                arguments = data.get("arguments", {})
                require(isinstance(arguments, dict), "ARGUMENTS_OBJECT_REQUIRED")
                local_schema(tool["inputSchema"])
                local_schema(tool.get("outputSchema", {}))
                validator = Draft202012Validator(tool["inputSchema"])
                require(not list(validator.iter_errors(arguments)), "ARGUMENT_SCHEMA_INVALID")
                # From this point onward failure may follow an already applied remote effect.
                self.dispatched = True
                result = await client.call_tool(tool["name"], arguments)
                value = result.model_dump(by_alias=True, exclude_none=True)
                require(len(canonical(value).encode()) <= LIMIT, "RESULT_TOO_LARGE")
                if tool.get("outputSchema") and not result.is_error:
                    require(result.structured_content is not None and not list(Draft202012Validator(tool["outputSchema"]).iter_errors(result.structured_content)), "OUTPUT_SCHEMA_INVALID")
                return {"ok": not result.is_error, "mcp": value}

    async def execute(self, data):
        run_id = identifier(data.get("runId"))
        server_id = identifier(data.get("server"))
        request_hash = digest(data)
        previous = self.db.execute("SELECT request_hash FROM runs WHERE actor=? AND id=?", (self.actor, run_id)).fetchone()
        if previous:
            require(previous[0] == request_hash, "RUN_ID_CONFLICT")
            return self.receipt(run_id)
        with self.lock("run", run_id, nonblocking=True):
            previous = self.db.execute("SELECT request_hash FROM runs WHERE actor=? AND id=?", (self.actor, run_id)).fetchone()
            if previous:
                require(previous[0] == request_hash, "RUN_ID_CONFLICT")
                return self.receipt(run_id)
            self.dispatched = False
            with self.db:
                self.db.execute("INSERT INTO runs VALUES(?,?,?,?,?,?)", (self.actor, run_id, request_hash, "RUNNING", None, time.time()))
            try:
                # A configuration change waits until existing executions finish.
                with self.lock("server", server_id, nonblocking=True):
                    value = await self.remote(server_id, "call", data)
                state = "SUCCEEDED" if value["ok"] else "FAILED"
            except Exception as error:
                state = "OUTCOME_UNKNOWN" if self.dispatched else "REJECTED"
                value = {"ok": False, "errorType": failure_code(error)}
            with self.db:
                self.db.execute("UPDATE runs SET state=?,result=? WHERE actor=? AND id=?", (state, canonical(value), self.actor, run_id))
        return self.receipt(run_id)

    async def run(self, action, data):
        allowed = {"list": set(), "register": {"server", "profile"}, "configure": {"server", "enabled", "revision", "profile"},
                   "discover": {"server"}, "admit": {"server", "tool", "schemaPin"},
                   "call": {"server", "tool", "schemaPin", "arguments", "runId"}, "runs": {"runId"}}
        require(action in allowed and not (set(data) - allowed[action]), "UNKNOWN_FIELDS")
        if action == "list":
            return {"ok": True, "profiles": [{"id": k, "transport": v.get("transport")} for k, v in self.profiles().items()],
                    "servers": [dict(r) for r in self.db.execute("SELECT id,profile,enabled,revision FROM servers WHERE actor=? ORDER BY id", (self.actor,))],
                    "lifecycle": "session-per-operation", "uri": URI}
        if action == "runs":
            if data.get("runId"):
                return self.receipt(data["runId"])
            ids = [r[0] for r in self.db.execute("SELECT id FROM runs WHERE actor=? ORDER BY created DESC LIMIT 50", (self.actor,))]
            return {"ok": True, "runs": [self.receipt(i) for i in ids]}
        if action == "register":
            server = identifier(data.get("server")); profile = self.profile(data.get("profile"))
            with self.lock("server", server, nonblocking=True):
                try:
                    with self.db:
                        self.db.execute("INSERT INTO servers VALUES(?,?,?,?,?,?)", (self.actor, server, data["profile"], digest(profile), 1, 1))
                except sqlite3.IntegrityError:
                    raise Rejected("SERVER_ALREADY_EXISTS")
            return {"ok": True, "server": server}
        if action == "configure":
            require(type(data.get("enabled")) is bool and type(data.get("revision")) is int, "INVALID_CONFIGURATION")
            server = identifier(data.get("server"))
            with self.lock("server", server, nonblocking=True):
                current = self.server(server)
                profile_id = data.get("profile", current['profile'])
                profile_pin = digest(self.profile(profile_id)) if 'profile' in data else current['pin']
                with self.db:
                    n = self.db.execute("UPDATE servers SET enabled=?,profile=?,pin=?,revision=revision+1 WHERE actor=? AND id=? AND revision=?", (data["enabled"], profile_id, profile_pin, self.actor, server, data["revision"])).rowcount
                    require(n == 1, "CONFIGURATION_CONFLICT")
                    if 'profile' in data:
                        self.db.execute('DELETE FROM tools WHERE actor=? AND server=?', (self.actor, server))
            return {"ok": True, "server": self.server(server)}
        if action == "call":
            return await self.execute(data)
        with self.lock("server", identifier(data.get("server")), nonblocking=True):
            return await self.remote(data["server"], action, data)


def main():
    os.umask(0o077)
    control = None
    try:
        raw = sys.stdin.buffer.read(LIMIT + 1)
        require(len(raw) <= LIMIT, "REQUEST_TOO_LARGE")
        p = envelope(json.loads(raw))
        control = Control(p["actor"])
        control.consume(p)
        # Fixed number of concurrent local sessions; queueing belongs to Taskand.
        slots = []
        try:
            for n in range(4):
                f = (control.root / f"slot-{n}.lock").open("a")
                try:
                    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    slots.append(f); break
                except BlockingIOError:
                    f.close()
            require(bool(slots) or p["action"] in {"list", "runs"}, "CAPACITY_BUSY")
            value = asyncio.run(control.run(p["action"], p["data"]))
        finally:
            for f in slots:
                f.close()
    except Exception as error:
        value = {"ok": False, "errorType": failure_code(error)}
    finally:
        if control:
            control.close()
    print(canonical(value))


if __name__ == "__main__":
    main()
