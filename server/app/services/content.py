"""Shared JSON content and deterministic bundle digest."""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

CONTENT_ROOT = Path(__file__).resolve().parents[3] / "content"


def content_digest(raw_files: Mapping[str, bytes]) -> str:
    """SHA-256 over raw file bytes; mirrored by contentDigest in client/src/content/hash.ts.

    Each file contributes ``<path>\\n<byte length>\\n<bytes>`` in path order, so the
    digest does not depend on how either language re-serializes JSON.
    """
    digest = hashlib.sha256()
    for path in sorted(raw_files):
        data = raw_files[path]
        digest.update(f"{path}\n{len(data)}\n".encode())
        digest.update(data)
    return digest.hexdigest()


@dataclass(frozen=True)
class Content:
    files: dict[str, Any]
    hash: str

    def category(self, name: str) -> dict[str, dict[str, Any]]:
        return {
            value["id"]: value for path, value in self.files.items()
            if path.startswith(f"content/{name}/")
        }

    @property
    def balance(self) -> dict[str, Any]:
        return cast(dict[str, Any], self.files["content/balance.json"])


@lru_cache
def get_content() -> Content:
    raw = {
        f"content/{path.relative_to(CONTENT_ROOT).as_posix()}": path.read_bytes()
        for path in sorted(CONTENT_ROOT.rglob("*.json"))
    }
    files = {path: json.loads(data) for path, data in raw.items()}
    return Content(files=files, hash=content_digest(raw))
