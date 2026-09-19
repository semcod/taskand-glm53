"""Real MCP fixture; all effects confined to a caller-created disposable directory."""
import json
import os
from pathlib import Path
import sys
import time
from mcp.server import MCPServer

root = Path(sys.argv[1])
server = MCPServer('Taskand acceptance fixture', log_level='ERROR')


@server.tool()
def sum_report(values: list[int]) -> dict:
    """Create report.json and return its total; input is a list of integer amounts."""
    total = sum(values)
    (root / 'report.json').write_text(json.dumps({'total': total}))
    count = root / 'count'
    count.write_text(str(int(count.read_text()) + 1 if count.exists() else 1))
    return {'total': total, 'writes': int(count.read_text())}


@server.tool()
def fail_after_write() -> dict:
    """Simulate a worker disconnect immediately after writing an artifact."""
    (root / 'uncertain').write_text('effect applied once')
    os._exit(1)


@server.tool()
def slow_report() -> dict:
    """Write then remain busy long enough to exercise concurrent receipt reads."""
    (root / 'started').write_text('yes')
    time.sleep(2)
    return {'done': True}


if len(sys.argv) > 2:
    server.run(transport='streamable-http', host='127.0.0.1', port=int(sys.argv[2]))
else:
    server.run()
