"""Shared test setup.

Since 1.4.3 the client falls back to ``IBANFORGE_API_KEY`` and
``IBANFORGE_API_BASE`` when neither is passed. That is the point — it is how the
README can be executed verbatim — but it also means a developer machine with
either variable exported would silently change what every test measures:
``test_client.py`` mocks ``https://api.ibanforge.com`` with respx, and a client
pointed elsewhere would sail past the mock and try the network.

So the suite starts from a clean environment, always. A test that wants one of
these set does it itself, explicitly.
"""

from __future__ import annotations

import os
from typing import Iterator

import pytest

_ENV = ("IBANFORGE_API_BASE", "IBANFORGE_API_KEY")


@pytest.fixture(autouse=True, scope="session")
def _neutral_environment() -> Iterator[None]:
    saved = {k: os.environ.pop(k, None) for k in _ENV}
    yield
    for key, value in saved.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
