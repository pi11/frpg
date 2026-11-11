"""Pure formulas shared with the client (client/src/economy.ts).

Both sides must produce identical integers for identical inputs, so the
operations and their order are mirrored exactly. Exponentiation is done by
repeated multiplication because ``**`` in CPython and ``Math.pow`` in V8 may
round the last bit differently; plain IEEE-754 multiplication and addition are
identical everywhere. The shared vectors live in testdata/economy_vectors.json.
"""

import math
from collections.abc import Mapping
from typing import Any


def round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def upgrade_cost(upgrade: Mapping[str, Any], current_level: int) -> int:
    base = float(upgrade["cost"]["base"])
    growth = float(upgrade["cost"]["growth"])
    price = base
    for _ in range(current_level):
        price *= growth
    return round_half_up(price)


def run_reward(
    reward: Mapping[str, Any], duration: int, kills: int, wave: int,
    boss_killed: bool, picked_caps: int,
) -> int:
    total = float(reward["base"])
    total += duration * float(reward["perSecond"])
    total += kills * float(reward["perKill"])
    total += wave * float(reward["perWave"])
    if boss_killed:
        total += float(reward["bossBonus"])
    total += picked_caps
    return round_half_up(total)
