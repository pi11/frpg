"""Minimal JSON check until the content schemas arrive in stage 2."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "content"


def main() -> None:
    seen: set[str] = set()
    for path in sorted(ROOT.rglob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if path.name == "balance.json":
            continue
        if not isinstance(data, dict) or not isinstance(data.get("id"), str):
            raise TypeError(f"{path}: expected an object with a string id")
        content_id = data["id"]
        if content_id in seen:
            raise ValueError(f"{path}: duplicate id {content_id}")
        seen.add(content_id)
    print(f"Checked {len(seen)} content records")


if __name__ == "__main__":
    main()
