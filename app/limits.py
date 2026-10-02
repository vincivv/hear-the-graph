"""Request limits for a public deployment, so a shared URL cannot use up the Gemini budget.

Per visitor (by IP address) over a sliding hour, and a daily cap on new documents for the
whole server. In-memory, which matches the one-instance deployment. Configured with
environment variables; 0 turns a limit off.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)) or default)
    except ValueError:
        return default


class Limits:
    def __init__(self):
        self.per_hour = {
            "document": _int("LIMIT_DOCUMENTS_PER_HOUR", 20),  # uploads and samples
            "ask": _int("LIMIT_QUESTIONS_PER_HOUR", 120),
            "retry": _int("LIMIT_RETRIES_PER_HOUR", 30),
        }
        self.documents_per_day = _int("LIMIT_DOCUMENTS_PER_DAY", 500)
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._day: tuple[str, int] = ("", 0)
        self._lock = threading.Lock()

    def check(self, kind: str, client: str) -> str | None:
        """Record a request. Returns a plain-language refusal, or None if it may go ahead."""
        now = time.time()
        with self._lock:
            limit = self.per_hour.get(kind, 0)
            q = self._hits[(kind, client)]
            while q and now - q[0] > 3600:
                q.popleft()
            if limit and len(q) >= limit:
                wait = int(3600 - (now - q[0])) // 60 + 1
                what = {"document": "files", "ask": "questions", "retry": "retries"}.get(kind, "requests")
                return f"Too many {what} from this connection in the last hour. Try again in about {wait} minutes."
            if kind == "document" and self.documents_per_day:
                today = time.strftime("%Y-%m-%d")
                day, n = self._day if self._day[0] == today else (today, 0)
                if n >= self.documents_per_day:
                    return "This server has reached its daily limit of new files. Try again tomorrow."
                self._day = (day, n + 1)
            q.append(now)
            return None


def client_id(request) -> str:
    """The visitor's address. Behind Cloud Run's front end it is the X-Forwarded-For entry the
    front end added, the last one; earlier entries come from the client and can be made up."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"
