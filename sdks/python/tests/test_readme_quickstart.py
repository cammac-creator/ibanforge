"""Runs the README. Every block, every line, every claim.

─── why this file exists ────────────────────────────────────────────────────
The 1.3.3 quickstart raised ``TypeError`` on its third line. It read
``out["bic"]["bankName"]`` — a camelCase field that has never existed — on
``CH9300762011623852957``, an IBAN whose bank code is allocated to nobody, so
``bic`` was ``None`` anyway. Two independent bugs in one line, published to
PyPI for six weeks. Nothing was broken in the SDK: the guide was simply never
executed by anything.

So this test does not re-implement the quickstart, and does not paste a copy of
it (a copy diverges, which is the same failure one level down). It reads
``../README.md``, ``exec()``s the text of every ```python block, and checks each
``print`` against the ``#`` comment the README puts next to it. The comments in
the README are the assertions.

─── why a stub and not the real API ─────────────────────────────────────────
CI runs this package alone (``working-directory: sdks/python``, no Node, no
server, no database). The responses come from ``../fixtures/quickstart-api.json``,
recorded from a real IBANforge server and shared with the TypeScript SDK's
identical test. That moves the rot one step rather than removing it — a frozen
fixture can drift from the API exactly like a frozen README — which is why the
fixture carries a re-recorder with a ``--check`` mode, run before every publish:

    node sdks/fixtures/record.mjs --check http://127.0.0.1:3300
"""

from __future__ import annotations

import ast
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional
from urllib.parse import parse_qs, urlparse

import pytest

README = Path(__file__).resolve().parent.parent / "README.md"
FIXTURE = Path(__file__).resolve().parent.parent.parent / "fixtures" / "quickstart-api.json"


# ─── the README, parsed ──────────────────────────────────────────────────────


class Expectation(NamedTuple):
    line: int
    source: str
    expected: Any


class Block(NamedTuple):
    index: int
    code: str
    expectations: List[Expectation]


_TRAILING_PROSE = re.compile(r"(['\"\]}\d])\s+\(.*\)$")
_PRINT = re.compile(r"\bprint\(")
_COMMENT = re.compile(r"#\s*(.+?)\s*$")
_FENCE = re.compile(r"^```python\n(.*?)^```$", re.MULTILINE | re.DOTALL)


def _parse_expectation(comment: str, where: str) -> Any:
    """Turn ``# 'UBSWCHZH'``, ``# True``, ``# None``, ``# []`` into a value.

    Raises on anything it cannot read: an expectation that quietly stops being
    comparable is how this kind of test dies without anyone noticing.
    """
    text = _TRAILING_PROSE.sub(r"\1", comment).strip()
    try:
        return ast.literal_eval(text)
    except (ValueError, SyntaxError):
        raise AssertionError(
            f"{where}: the README annotates this print with `# {comment}`, which is not a "
            f"comparable value. Every print in the README must state what it outputs "
            f"(`# True`, `# 'UBSWCHZH'`, `# None`, `# 42`), or the line stops being checked "
            f"and the guide starts drifting again."
        ) from None


def parse_readme() -> List[Block]:
    md = README.read_text(encoding="utf-8")
    blocks: List[Block] = []
    for match in _FENCE.finditer(md):
        code = match.group(1)
        expectations: List[Expectation] = []
        for i, line in enumerate(code.split("\n"), start=1):
            if not _PRINT.search(line):
                continue
            where = f"README block #{len(blocks) + 1}, line {i} ({line.strip()})"
            comment = _COMMENT.search(line)
            if not comment:
                raise AssertionError(
                    f"{where}: a print with no `# expected` comment. Add one, or drop the "
                    f"print — an unchecked line is how the quickstart went stale in the "
                    f"first place."
                )
            expectations.append(
                Expectation(line=i, source=line.strip(), expected=_parse_expectation(comment.group(1), where))
            )
        blocks.append(Block(index=len(blocks) + 1, code=code, expectations=expectations))
    return blocks


BLOCKS = parse_readme()


# ─── the stub: recorded responses, replayed ──────────────────────────────────


def _is_subset(expected: Dict[str, Any], actual: Dict[str, Any]) -> bool:
    return all(json.dumps(actual.get(k), sort_keys=True) == json.dumps(v, sort_keys=True)
               for k, v in expected.items())


CALLS: List[Dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))["calls"]
USED: set = set()


class _StubHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:  # keep pytest output readable
        pass

    def _serve(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            body = {}
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        headers = {"authorization": self.headers.get("authorization") or ""}

        # First match wins, so a specific fixture (the wrong-key 401) must be
        # listed above the general one for the same route.
        hit: Optional[Dict[str, Any]] = None
        for call in CALLS:
            req = call["request"]
            if req["method"] != self.command or req["path"] != parsed.path:
                continue
            if "query" in req and not _is_subset(req["query"], query):
                continue
            if "body" in req and not _is_subset(req["body"], body):
                continue
            if "headers" in req:
                want = {k.lower(): v for k, v in req["headers"].items()}
                if not _is_subset(want, headers):
                    continue
            hit = call
            break

        if hit is None:
            payload = {
                "error": "no_fixture",
                "message": (
                    f"The README calls {self.command} {parsed.path} with body {body}, which is "
                    f"not in sdks/fixtures/quickstart-api.json. Add the call there and "
                    f"re-record — never hand-write a response."
                ),
            }
            self._respond(599, payload)
            return

        USED.add(hit["name"])
        self._respond(hit["response"]["status"], hit["response"]["body"])

    def _respond(self, status: int, payload: Any) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _serve
    do_POST = _serve


@pytest.fixture(scope="module", autouse=True)
def stub_server() -> Any:
    """Boot the replay stub and point the SDK at it through the environment.

    Through the environment, so the README blocks run *verbatim* — no rewriting
    of `IBANforge(...)` calls, which is the trick that lets this test check the
    published text rather than a paraphrase of it. `conftest.py` has already
    removed any ambient value; a block that hardcoded its own `base_url` would
    bypass the stub and be caught by the fixture-coverage test below, which
    would then see that call go unused.
    """
    server = HTTPServer(("127.0.0.1", 0), _StubHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    os.environ["IBANFORGE_API_BASE"] = f"http://127.0.0.1:{server.server_address[1]}"
    yield server
    os.environ.pop("IBANFORGE_API_BASE", None)
    server.shutdown()
    server.server_close()


# ─── the tests ───────────────────────────────────────────────────────────────


def test_extractor_found_the_blocks():
    """If the fence syntax or the language tag ever changes, every test below
    would pass on an empty set. That is the classic silent death."""
    assert len(BLOCKS) >= 8
    assert sum(len(b.expectations) for b in BLOCKS) >= 40


@pytest.mark.parametrize("block", BLOCKS, ids=[f"block-{b.index}" for b in BLOCKS])
def test_readme_block_runs_and_prints_what_it_claims(block: Block):
    printed: List[Any] = []

    def _print(*args: Any, **_kwargs: Any) -> None:
        printed.append(args[0] if len(args) == 1 else args)

    # `print` in the globals shadows the builtin for the exec'd code, so the
    # block runs exactly as written — no rewriting, no injected helpers.
    namespace: Dict[str, Any] = {"print": _print, "__name__": "__readme__"}
    try:
        exec(compile(block.code, f"README.md#block-{block.index}", "exec"), namespace)
    except SyntaxError as err:  # pragma: no cover - only fires on a broken README
        raise AssertionError(
            f"README block #{block.index} is not executable Python: {err}\n"
            f"--- block ---\n{block.code}"
        ) from None

    assert len(printed) == len(block.expectations), (
        f"block #{block.index} printed {len(printed)} value(s) but annotates "
        f"{len(block.expectations)}. A branch that did not fire prints nothing — which is "
        f"exactly how an example stops being true without failing."
    )
    for got, exp in zip(printed, block.expectations):
        assert got == exp.expected, (
            f"README block #{block.index}, `{exp.source}` claims it prints "
            f"{exp.expected!r} but printed {got!r}."
        )


def test_every_recorded_fixture_is_exercised():
    """The fixture says which README uses each call; this checks both
    directions. An orphan is a deleted example or a block that escaped to the
    real API; an unlisted use means the fixture's own map went stale."""
    mine = {c["name"] for c in CALLS if "python" in c["used_by"]}
    assert sorted(mine - USED) == [], (
        f"listed as used by the Python README but never called: {sorted(mine - USED)}"
    )
    assert sorted(USED - mine) == [], (
        f"called by the Python README but not listed for it in the fixture: {sorted(USED - mine)}"
    )
