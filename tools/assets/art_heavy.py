"""Procedural pixel art for mini-bosses, heavy weapons and new perks (CC0, original)."""

from __future__ import annotations

import math
import random

from art_extra import icon
from shapes import Canvas, Image

# --- mini-bosses (48x48) -------------------------------------------------------------


def brute(frame: int) -> Image:
    """Hulking mutant: purple hide, bone spikes, one giant arm with a wrecking ball."""
    c = Canvas(48, 48)
    step = (3, 0, -3, 0)[frame]
    c.line(17, 34, 15 - step, 44, "P", 7)
    c.line(28, 34, 30 + step, 44, "P", 7)
    c.rect(9 - step, 43, 11, 4, "k")
    c.rect(26 + step, 43, 11, 4, "k")
    c.ellipse(22, 25, 15, 13, "p")
    c.ellipse(20, 30, 10, 8, "v")
    c.ellipse(20, 32, 7, 5, "p")
    c.line(10, 20, 5, 33 + step, "P", 6)
    c.ellipse(5, 35 + step, 4.5, 4.5, "p")
    c.line(33, 18, 41, 24 - step, "p", 8)
    c.line(41, 24 - step, 41, 33 - step, "m", 2)
    c.ellipse(41, 37 - step, 6, 6, "M")
    c.ellipse(40, 35 - step, 3, 3, "m")
    for x, y in ((35, 37), (47, 37), (41, 43)):
        c.rect(x - 1, y - step, 2, 2, "n")
    for x in (10, 15, 20, 25, 30):
        c.line(x, 14, x - 2, 7 + abs(x - 20) // 3, "w", 2)
    c.ellipse(27, 12, 7, 6.5, "p")
    c.rect(28, 10, 4, 3, "y")
    c.rect(30, 11, 2, 2, "R")
    c.rect(25, 16, 8, 2, "K")
    for x in (26, 29, 32):
        c.set(x, 16, "w")
    c.line(14, 25, 24, 22, "R")
    return c.outlined()


def war_bot(frame: int) -> Image:
    """Four-legged gun platform: orange hull, twin barrels, red eye and an antenna dish."""
    c = Canvas(48, 48)
    step = (3, 0, -3, 0)[frame]
    for index, (hip, foot) in enumerate(((14, 6), (19, 15), (28, 32), (33, 41))):
        move = step if index % 2 else -step
        c.line(hip, 28, foot + move // 2, 36, "M", 4)
        c.line(foot + move // 2, 36, foot + move, 44, "m", 3)
        c.rect(foot + move - 3, 44, 7, 3, "A")
    c.ellipse(24, 25, 15, 9, "o")
    c.rect(10, 25, 28, 5, "r")
    for x in range(11, 37, 6):
        c.rect(x, 26, 3, 3, "y" if (x // 6) % 2 else "K")
    c.rect(16, 11, 16, 11, "m")
    c.rect(16, 18, 16, 4, "M")
    c.ellipse(27, 15, 4, 3.5, "K")
    c.ellipse(28, 15, 2.4, 2.4, "r")
    c.set(28, 14, "w")
    for y in (20, 25):
        c.rect(33, y, 14, 3, "M")
        c.rect(44, y - 1, 3, 5, "A")
        c.rect(34, y, 8, 1, "n")
    c.line(19, 10, 15, 3, "n")
    c.ellipse(14, 4, 4, 3, "n")
    c.set(14, 4, "r" if frame % 2 else "y")
    return c.outlined()


def riot_mech(frame: int) -> Image:
    """Siege walker with a huge striped ram shield and a smoking back furnace."""
    c = Canvas(48, 48)
    step = (3, 0, -3, 0)[frame]
    c.line(16, 31, 13 - step, 43, "M", 6)
    c.line(27, 31, 28 + step, 43, "M", 6)
    c.rect(7 - step, 43, 12, 4, "A")
    c.rect(23 + step, 43, 12, 4, "A")
    c.rect(9, 13, 24, 20, "T")
    c.rect(11, 15, 20, 6, "t")
    c.rect(9, 27, 24, 3, "M")
    c.rect(2, 10, 8, 18, "a")
    c.rect(3, 19, 5, 6, "r")
    c.rect(4, 20 + frame % 2, 3, 3, "o")
    c.rect(4, 4, 4, 7, "M")
    rng = random.Random(frame)
    for _ in range(4):
        c.set(3 + rng.randrange(5), rng.randrange(0, 4), "n")
    c.rect(16, 5, 13, 9, "m")
    c.rect(22, 8, 7, 3, "o")
    c.rect(24, 8, 2, 3, "w")
    c.rect(36, 4, 9, 40, "m")
    for y in range(4, 44):
        for x in range(37, 44):
            if (x + y) % 10 < 5:
                c.set(x, y, "y")
            else:
                c.set(x, y, "K")
    c.rect(44, 6, 2, 36, "n")
    for y in (10, 22, 34):
        c.line(45, y, 47, y + 2, "w", 2)
    c.line(30, 24, 36, 24, "M", 4)
    return c.outlined()


def slime_queen(frame: int) -> Image:
    """Towering slime with a crystal crown, swallowed bones and dripping arms."""
    c = Canvas(48, 48)
    wobble = (0, 1, 2, 1)[frame]
    c.ellipse(24, 35 + wobble / 2, 22, 12 - wobble / 2, "G")
    c.ellipse(24, 27 + wobble, 16, 15 - wobble, "G")
    c.ellipse(23, 25 + wobble, 12, 11, "g")
    c.ellipse(25, 29 + wobble, 11, 10, "G")
    for x, y in ((14, 36), (30, 38), (22, 41)):
        c.line(x, y, x + 5, y - 2, "w", 2)
    c.ellipse(34, 33, 3, 3, "w")
    c.set(33, 33, "K")
    c.set(35, 33, "K")
    for x in (5, 41):
        c.line(x, 34, x, 43 + wobble, "g", 3)
    for dx in (-7, 4):
        c.ellipse(25 + dx, 22 + wobble, 3.2, 4, "K")
        c.ellipse(25.5 + dx, 21.5 + wobble, 1.5, 2, "y")
    c.rect(20, 29 + wobble, 11, 3, "K")
    for x in (21, 24, 27, 30):
        c.set(x, 29 + wobble, "w")
    for index, x in enumerate((14, 19, 24, 29, 34)):
        height = (6, 9, 12, 9, 6)[index]
        c.line(x, 14 + wobble, x, 14 + wobble - height, "v", 3)
        c.line(x, 13 + wobble, x, 15 + wobble - height, "w")
    return c.outlined()


def great_worm(frame: int) -> Image:
    """Armoured burrower rearing up: plated rings and a round maw full of teeth."""
    c = Canvas(48, 48)
    sway = (0, 2, 0, -2)[frame]
    c.ellipse(22, 43, 20, 4.5, "e")
    c.ellipse(22, 42, 15, 3, "u")
    points = [(16, 40, 10), (15, 33, 10), (17, 26, 10), (21, 20, 9.5), (26, 15, 9)]
    for index, (x, y, r) in enumerate(points):
        shift = sway * index / 4
        c.ellipse(x + shift, y, r, 5.5, "R")
        c.ellipse(x + shift, y - 1, r - 1, 4, "r" if index % 2 else "B")
        c.ellipse(x + shift - 2, y - 2, r / 2, 1.6, "c")
        c.line(round(x + shift - r), y, round(x + shift - r - 4), y - 3, "w", 2)
    hx = 31 + sway
    c.ellipse(hx, 14, 12, 12, "R")
    c.ellipse(hx + 1, 14, 10, 10.5, "c")
    c.ellipse(hx + 2, 14, 8, 8.5, "K")
    c.ellipse(hx + 2, 14, 4, 4, "r")
    for tooth in range(10):
        angle = tooth * math.tau / 10 + frame * 0.08
        c.line(round(hx + 2 + math.cos(angle) * 8), round(14 + math.sin(angle) * 8),
               round(hx + 2 + math.cos(angle) * 5), round(14 + math.sin(angle) * 5), "w", 2)
    for x, y in ((hx - 8, 5), (hx - 10, 10), (hx - 9, 18)):
        c.rect(round(x), y, 2, 2, "g")
    return c.outlined()


# --- heavy weapons -------------------------------------------------------------------

def rail_gun() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(2, 8, 5, 4, "M")
        c.rect(6, 5, 9, 2, "m")
        c.rect(6, 9, 9, 2, "m")
        c.rect(6, 7, 9, 2, "t")
        for x in (7, 10, 13):
            c.rect(x, 4, 1, 8, "n")
        c.rect(3, 12, 2, 3, "B")
    return icon(draw)


def rotary_gun() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(1, 6, 6, 6, "H")
        c.rect(2, 12, 4, 2, "y")
        for y in (5, 7, 9, 11):
            c.rect(7, y, 8, 1, "m")
        c.rect(9, 4, 1, 9, "M")
        c.rect(13, 4, 1, 9, "M")
        c.rect(3, 3, 3, 3, "r")
    return icon(draw)


def needle_sphere() -> Image:
    def draw(c: Canvas) -> None:
        for n in range(10):
            angle = n * math.tau / 10
            c.line(8, 8, round(7.5 + math.cos(angle) * 6), round(7.5 + math.sin(angle) * 6), "w")
        c.ellipse(8, 8, 4, 4, "M")
        c.ellipse(7, 7, 2, 2, "v")
    return icon(draw)


def mortar() -> Image:
    def draw(c: Canvas) -> None:
        c.line(5, 12, 11, 4, "H", 5)
        c.line(5, 11, 10, 5, "h", 2)
        c.ellipse(12, 3, 2.5, 2, "K")
        c.rect(2, 12, 11, 2, "M")
        c.line(9, 9, 12, 13, "m")
    return icon(draw)


def cryo_cannon() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(1, 5, 7, 7, "T")
        c.rect(2, 6, 5, 3, "t")
        c.rect(8, 7, 5, 3, "m")
        c.line(13, 5, 14, 3, "w")
        c.line(13, 11, 14, 13, "w")
        c.rect(13, 8, 2, 1, "w")
        c.rect(3, 12, 2, 3, "M")
    return icon(draw)


def beam_cutter() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(6, 9, 5, 5, "M")
        c.ellipse(6, 9, 3, 3, "r")
        c.ellipse(6, 9, 1.4, 1.4, "w")
        c.line(9, 7, 14, 2, "o", 2)
        c.line(9, 7, 14, 2, "y")
    return icon(draw)


def gravity_trap() -> Image:
    def draw(c: Canvas) -> None:
        for r, char in ((6.5, "P"), (5, "p"), (3.4, "P"), (2, "K")):
            c.ellipse(8, 8, r, r, char)
        c.set(7, 7, "v")
        for n in range(4):
            angle = n * math.tau / 4 + 0.5
            c.rect(round(7.5 + math.cos(angle) * 5), round(7.5 + math.sin(angle) * 5), 2, 1, "v")
    return icon(draw)


def sentry_turret() -> Image:
    def draw(c: Canvas) -> None:
        c.line(7, 9, 3, 14, "M", 2)
        c.line(8, 9, 12, 14, "M", 2)
        c.rect(4, 4, 7, 6, "h")
        c.rect(5, 5, 2, 2, "g")
        c.rect(11, 5, 4, 1, "m")
        c.rect(11, 8, 4, 1, "m")
    return icon(draw)


def rail_slug() -> Image:
    c = Canvas(20, 5)
    c.rect(0, 2, 20, 1, "t")
    c.rect(4, 1, 15, 3, "t")
    c.rect(6, 2, 14, 1, "w")
    return c.pixels


def needle() -> Image:
    c = Canvas(8, 3)
    c.rect(0, 1, 8, 1, "v")
    c.rect(4, 1, 4, 1, "w")
    return c.pixels


def tracer() -> Image:
    c = Canvas(7, 3)
    c.rect(0, 1, 7, 1, "o")
    c.rect(3, 0, 3, 3, "y")
    c.rect(5, 1, 2, 1, "w")
    return c.pixels


def ice_shard() -> Image:
    c = Canvas(10, 7)
    c.line(0, 3, 9, 3, "t", 2)
    c.rect(3, 2, 5, 3, "w")
    return c.outlined()


def shell() -> Image:
    c = Canvas(8, 12)
    c.ellipse(4, 4, 2.6, 3.6, "h")
    c.rect(2, 6, 4, 3, "H")
    c.rect(1, 9, 6, 2, "r")
    return c.outlined()


def turret(frame: int) -> Image:
    c = Canvas(18, 18)
    c.line(8, 10, 3, 16, "M", 2)
    c.line(9, 10, 14, 16, "M", 2)
    c.rect(4, 4, 8, 7, "h")
    c.rect(4, 8, 8, 2, "H")
    c.rect(6, 5, 2, 2, "g" if frame % 2 else "G")
    kick = frame % 2
    c.rect(12 - kick, 5, 5, 1, "m")
    c.rect(12 - kick, 8, 5, 1, "m")
    return c.outlined()


def vortex(frame: int) -> Image:
    c = Canvas(12, 12)
    for arm in range(3):
        for step in range(9):
            angle = arm * math.tau / 3 + step * 0.35 + frame * math.tau / 9
            r = 1 + step * 0.55
            c.set(round(5.5 + math.cos(angle) * r), round(5.5 + math.sin(angle) * r),
                  "v" if step < 4 else "p")
    return c.pixels


# --- perks ---------------------------------------------------------------------------

def keen_edge() -> Image:
    def draw(c: Canvas) -> None:
        c.line(3, 12, 12, 3, "m", 3)
        c.line(4, 12, 13, 3, "w")
        c.line(2, 11, 5, 14, "y", 2)
        c.rect(1, 13, 2, 2, "B")
    return icon(draw)


def nimble() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(10, 4, 2, 2, "f")
        c.line(9, 6, 7, 10, "t", 3)
        c.line(7, 10, 11, 13, "T", 2)
        c.line(7, 10, 4, 13, "T", 2)
        c.line(1, 5, 5, 5, "n")
        c.line(1, 8, 4, 8, "n")
    return icon(draw)


def spiked_vest() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(4, 4, 8, 9, "k")
        c.rect(5, 5, 6, 7, "B")
        for x, y in ((2, 5), (13, 5), (2, 10), (13, 10), (7, 1), (7, 13)):
            c.rect(x, y, 1, 2, "w")
        c.rect(7, 7, 2, 2, "m")
    return icon(draw)


def lead_lining() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(3, 2, 10, 8, "M")
        c.rect(4, 10, 8, 3, "M")
        c.rect(5, 4, 6, 6, "y")
        c.ellipse(8, 7, 1.2, 1.2, "K")
        for x, y in ((6, 5), (10, 5), (8, 9)):
            c.set(x, y, "K")
    return icon(draw)


def trophy_hunter() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(8, 8, 4, 4, "w")
        c.rect(6, 11, 5, 3, "w")
        c.rect(6, 7, 2, 2, "K")
        c.rect(9, 7, 2, 2, "K")
        c.line(4, 6, 2, 1, "n", 2)
        c.line(12, 6, 14, 1, "n", 2)
        c.set(8, 12, "K")
    return icon(draw)


def field_dressing() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(8, 8, 6, 5, "w")
        c.ellipse(8, 8, 2, 1.6, "s")
        c.rect(7, 3, 2, 5, "r")
        c.rect(5, 5, 6, 2, "r")
        c.rect(11, 11, 4, 2, "s")
    return icon(draw)


def turbo_boots() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(5, 2, 5, 8, "r")
        c.rect(5, 9, 9, 3, "r")
        c.rect(5, 3, 5, 2, "y")
        c.rect(4, 12, 10, 1, "k")
        c.rect(1, 10, 3, 2, "o")
        c.set(1, 12, "y")
    return icon(draw)


def spare_barrel() -> Image:
    def draw(c: Canvas) -> None:
        for y in (3, 7, 11):
            c.rect(2, y, 12, 2, "m")
            c.rect(2, y, 9, 1, "n")
            c.rect(12, y, 2, 2, "o")
    return icon(draw)


# --- interface -----------------------------------------------------------------------

def emerald() -> Image:
    c = Canvas(12, 12)
    for y, (start, end) in enumerate(((4, 8), (3, 9), (2, 10), (2, 10), (2, 10), (3, 9), (4, 8),
                                      (5, 7)), start=2):
        c.rect(start, y, end - start, 1, "G")
    c.rect(4, 3, 3, 3, "g")
    c.set(4, 3, "w")
    c.set(5, 3, "w")
    return c.outlined()


def ray(frame: int) -> Image:
    """Golden sunburst behind an opening chest."""
    c = Canvas(64, 64)
    for n in range(12):
        angle = n * math.tau / 12 + frame * math.tau / 48
        for r in range(10, 31):
            if n % 2 and r > 22:
                continue
            c.rect(round(31.5 + math.cos(angle) * r), round(31.5 + math.sin(angle) * r),
                   2, 2, "y" if r < 20 else "o")
    return c.pixels


def lock() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(5, 2, 6, 2, "m")
        c.rect(4, 3, 2, 5, "m")
        c.rect(10, 3, 2, 5, "m")
        c.rect(3, 7, 10, 7, "y")
        c.rect(7, 9, 2, 3, "K")
    return icon(draw)


ELITES = {
    "brute": (brute, "P", 19), "war_bot": (war_bot, "M", 23), "riot_mech": (riot_mech, "M", 53),
    "slime_queen": (slime_queen, "G", 71), "great_worm": (great_worm, "u", 79),
}


def frames() -> dict[str, Image]:
    result: dict[str, Image] = {
        "projectiles/rail_slug": rail_slug(), "projectiles/needle": needle(),
        "projectiles/tracer": tracer(), "projectiles/ice_shard": ice_shard(),
        "projectiles/shell": shell(), "ui/emerald": emerald(), "ui/lock": lock(),
    }
    for maker in (rail_gun, rotary_gun, needle_sphere, mortar, cryo_cannon, beam_cutter,
                  gravity_trap, sentry_turret):
        result[f"weapons/{maker.__name__}"] = maker()
    for maker in (keen_edge, nimble, spiked_vest, lead_lining, trophy_hunter, field_dressing,
                  turbo_boots, spare_barrel):
        result[f"passives/{maker.__name__}"] = maker()
    return result


def animations() -> dict[str, dict[str, Image]]:
    return {
        "projectiles/turret": {f"spin_{i}": turret(i) for i in range(2)},
        "fx/vortex": {f"burn_{i}": vortex(i) for i in range(3)},
        "fx/ray": {f"idle_{i}": ray(i) for i in range(4)},
    }
