"""Shared formula vectors; client/src/economy.test.ts checks the same file."""

import json
from pathlib import Path
from typing import Any

from app.services.content import content_digest, get_content
from app.services.economy import run_reward, upgrade_cost

VECTORS: dict[str, list[dict[str, Any]]] = json.loads(
    (Path(__file__).resolve().parents[2] / "testdata" / "economy_vectors.json").read_text()
)


def test_upgrade_cost_vectors() -> None:
    for case in VECTORS["upgradeCost"]:
        assert upgrade_cost({"cost": case["cost"]}, case["level"]) == case["expected"], case


def test_run_reward_vectors() -> None:
    for case in VECTORS["runReward"]:
        assert run_reward(
            case["rules"], case["duration"], case["kills"], case["wave"],
            case["boss_killed"], case["picked_caps"],
        ) == case["expected"], case


def test_content_digest_vectors() -> None:
    for case in VECTORS["contentDigest"]:
        raw = {path: text.encode() for path, text in case["files"].items()}
        assert content_digest(raw) == case["expected"]


def test_bundle_hash_covers_every_content_file() -> None:
    content = get_content()
    assert "content/balance.json" in content.files
    assert len(content.hash) == 64
