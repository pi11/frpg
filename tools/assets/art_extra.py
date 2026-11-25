"""Procedural pixel art for extra weapons, bonuses, landmarks and structures (CC0, original)."""

from __future__ import annotations

import math
import random
from collections.abc import Callable

import art
from shapes import Canvas, Image, color


def icon(draw: Callable[[Canvas], None], width: int = 16, height: int = 16) -> Image:
    canvas = Canvas(width, height)
    draw(canvas)
    return canvas.outlined()


def recolored(image: Image, table: dict[str, str]) -> Image:
    """Evolved weapon icon: swapped colours plus the gold star used by all evolutions."""
    swap = {color(old): color(new) for old, new in table.items()}
    result = [[swap.get(pixel, pixel) for pixel in row] for row in image]
    for (x, y), char in {(13, 0): "y", (12, 1): "y", (13, 1): "w", (14, 1): "y",
                         (13, 2): "y"}.items():
        result[y][x] = color(char)
    return result


# --- weapons -------------------------------------------------------------------------

def tesla_coil() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(4, 12, 8, 3, "M")
        for y in range(6, 12, 2):
            c.rect(6, y, 4, 1, "c")
        c.rect(7, 5, 2, 7, "r")
        c.ellipse(8, 4, 4, 2.2, "m")
        c.line(12, 3, 14, 6, "t")
        c.line(3, 3, 1, 6, "t")
    return icon(draw)


def saw_icon() -> Image:
    return saw(0, 16)


def saw(frame: int, size: int = 12) -> Image:
    c = Canvas(size, size)
    mid = size / 2
    for tooth in range(8):
        angle = tooth * math.tau / 8 + frame * math.tau / 32
        c.set(round(mid - 0.5 + math.cos(angle) * (mid - 1.6)),
              round(mid - 0.5 + math.sin(angle) * (mid - 1.6)), "w")
    c.ellipse(mid, mid, mid - 2, mid - 2, "m")
    c.ellipse(mid, mid, mid - 3.6, mid - 3.6, "M")
    c.ellipse(mid, mid, 1.2, 1.2, "r")
    return c.outlined()


def trap_mine() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(8, 10, 6, 3.6, "H")
        c.ellipse(8, 9, 5, 2.6, "h")
        c.rect(7, 5, 2, 3, "m")
        c.rect(7, 4, 2, 1, "r")
    return icon(draw)


def mine_projectile(frame: int) -> Image:
    c = Canvas(10, 8)
    c.ellipse(5, 5, 4, 2.6, "H")
    c.ellipse(5, 4.5, 2.6, 1.4, "h")
    c.set(4, 2, "r" if frame else "R")
    c.set(5, 2, "o" if frame else "R")
    return c.outlined()


def rocket_tube() -> Image:
    def draw(c: Canvas) -> None:
        c.line(2, 11, 12, 5, "H", 3)
        c.line(2, 11, 11, 6, "h")
        c.rect(6, 10, 2, 4, "B")
        c.rect(12, 3, 3, 3, "r")
        c.set(14, 3, "y")
    return icon(draw)


def rocket_projectile() -> Image:
    c = Canvas(12, 7)
    c.rect(3, 2, 6, 3, "m")
    c.rect(9, 2, 2, 3, "r")
    c.rect(2, 1, 2, 1, "R")
    c.rect(2, 5, 2, 1, "R")
    c.rect(0, 3, 2, 1, "y")
    return c.outlined()


def flamethrower() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(1, 5, 5, 8, "r")
        c.rect(2, 4, 3, 1, "m")
        c.line(6, 9, 11, 7, "M", 2)
        c.rect(8, 9, 2, 4, "B")
        c.rect(12, 5, 2, 3, "o")
        c.set(14, 5, "y")
    return icon(draw)


def flame_projectile(frame: int) -> Image:
    c = Canvas(10, 10)
    r = (4.4, 4.0, 3.6)[frame]
    c.ellipse(5, 5, r, r, "r")
    c.ellipse(5.5, 5, r - 1.2, r - 1.2, "o")
    c.ellipse(6, 5, r - 2.4, r - 2.4, "y")
    return c.pixels


def spark() -> Image:
    c = Canvas(6, 6)
    c.line(0, 3, 5, 3, "t")
    c.line(3, 0, 3, 5, "t")
    c.rect(2, 2, 2, 2, "w")
    return c.pixels


# --- passives ------------------------------------------------------------------------

def capacitor() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(4, 3, 8, 9, "t")
        c.rect(5, 4, 1, 7, "w")
        c.rect(4, 9, 8, 2, "T")
        c.rect(5, 12, 1, 3, "m")
        c.rect(10, 12, 1, 3, "m")
    return icon(draw)


def thick_hide() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(3, 3, 10, 10, "B")
        c.rect(5, 2, 6, 12, "B")
        c.rect(5, 5, 6, 6, "c")
        c.rect(7, 4, 2, 8, "r")
        c.rect(4, 7, 8, 2, "r")
    return icon(draw)


def scrap_plating() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(3, 2, 10, 7, "m")
        c.rect(4, 9, 8, 3, "m")
        c.rect(6, 12, 4, 2, "m")
        c.rect(8, 3, 4, 8, "M")
        for x, y in ((4, 3), (11, 3), (7, 11)):
            c.set(x, y, "y")
    return icon(draw)


def field_notes() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(3, 2, 10, 12, "B")
        c.rect(5, 3, 8, 10, "s")
        for y in (5, 7, 9):
            c.rect(6, y, 5, 1, "d")
        c.rect(3, 2, 1, 12, "b")
        c.rect(10, 2, 1, 4, "r")
    return icon(draw)


def scope() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(8, 8, 6, 6, "M")
        c.ellipse(8, 8, 4.4, 4.4, "T")
        c.rect(8, 3, 1, 10, "r")
        c.rect(3, 8, 10, 1, "r")
        c.set(8, 8, "y")
    return icon(draw)


# --- pickups -------------------------------------------------------------------------

def syringe(char: str, dark: str) -> Image:
    def draw(c: Canvas) -> None:
        c.line(2, 11, 4, 9, "m")
        c.line(4, 9, 9, 4, char, 3)
        c.line(5, 9, 9, 5, dark)
        c.line(10, 3, 11, 2, "m", 2)
    return icon(draw, 14, 14)


def shield_cell() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(7, 7, 5.6, 5.6, "T")
        c.ellipse(7, 7, 4.2, 4.2, "t")
        c.ellipse(5.5, 5.5, 1.4, 1.4, "w")
    return icon(draw, 14, 14)


def ammo_belt() -> Image:
    def draw(c: Canvas) -> None:
        for index in range(4):
            x = 2 + index * 3
            c.rect(x, 4, 2, 7, "y")
            c.rect(x, 2, 2, 2, "r")
        c.rect(1, 8, 12, 2, "B")
    return icon(draw, 14, 14)


def data_disk() -> Image:
    def draw(c: Canvas) -> None:
        c.rect(2, 2, 10, 10, "G")
        c.rect(4, 2, 5, 3, "m")
        c.rect(4, 7, 6, 5, "s")
        c.rect(5, 9, 4, 1, "g")
    return icon(draw, 14, 14)


def cryo_bomb() -> Image:
    def draw(c: Canvas) -> None:
        c.ellipse(7, 8, 4.6, 4.6, "t")
        c.ellipse(6, 7, 1.6, 1.6, "w")
        c.rect(6, 1, 2, 3, "m")
        c.rect(3, 8, 8, 1, "n")
    return icon(draw, 14, 14)


# --- landmarks (the `used` variant is dark and spent) ---------------------------------

def vending(used: bool) -> Image:
    c = Canvas(20, 28)
    c.rect(2, 2, 16, 24, "R" if used else "r")
    c.rect(4, 4, 12, 4, "A" if used else "y")
    c.rect(4, 10, 8, 10, "A" if used else "T")
    if not used:
        for y in range(11, 19, 3):
            for x, char in ((5, "g"), (8, "o"), (10, "w")):
                c.rect(x, y, 1, 2, char)
    c.rect(14, 11, 2, 4, "M")
    c.set(14, 12, "K" if used else "g")
    c.rect(5, 22, 9, 2, "K")
    return c.outlined()


def generator(used: bool) -> Image:
    c = Canvas(26, 24)
    c.rect(2, 10, 22, 11, "H")
    c.rect(3, 11, 20, 4, "h")
    c.rect(5, 4, 4, 7, "M")
    c.rect(4, 2, 6, 2, "m")
    c.ellipse(17, 14, 4, 4, "M")
    c.ellipse(17, 14, 2.6, 2.6, "A" if used else "g")
    c.rect(12, 5, 8, 4, "A" if used else "y")
    c.rect(4, 21, 4, 2, "K")
    c.rect(18, 21, 4, 2, "K")
    return c.outlined()


def hatch(used: bool) -> Image:
    c = Canvas(26, 18)
    c.ellipse(13, 10, 12, 7, "e")
    c.ellipse(13, 9, 9, 5.5, "K" if used else "M")
    if used:
        c.ellipse(13, 10, 7, 3.6, "k")
        c.rect(5, 1, 14, 2, "m")
    else:
        c.ellipse(13, 8.5, 7, 4, "m")
        c.rect(12, 5, 2, 7, "r")
        c.rect(9, 8, 8, 1, "r")
    return c.outlined()


def med_station(used: bool) -> Image:
    c = Canvas(20, 26)
    c.rect(3, 3, 14, 20, "n")
    c.rect(5, 5, 10, 8, "A" if used else "T")
    if not used:
        c.line(6, 9, 8, 9, "g")
        c.line(8, 9, 9, 6, "g")
        c.line(9, 6, 11, 11, "g")
        c.line(11, 11, 13, 9, "g")
    c.rect(9, 15, 2, 6, "M" if used else "r")
    c.rect(7, 17, 6, 2, "M" if used else "r")
    c.rect(4, 23, 12, 2, "M")
    return c.outlined()


def workbench(used: bool) -> Image:
    c = Canvas(28, 20)
    c.rect(2, 8, 24, 4, "B")
    c.rect(3, 12, 3, 7, "b")
    c.rect(22, 12, 3, 7, "b")
    if not used:
        c.rect(5, 4, 6, 4, "m")
        c.rect(13, 6, 7, 2, "r")
        c.rect(21, 3, 2, 5, "y")
        c.rect(6, 2, 3, 2, "o")
    else:
        c.rect(8, 7, 4, 1, "M")
    return c.outlined()


# --- objects -------------------------------------------------------------------------

def tent() -> Image:
    c = Canvas(34, 22)
    for y in range(18):
        half = 2 + round(y * 0.8)
        c.rect(17 - half, 2 + y, half * 2, 1, "h" if y % 5 else "H")
    for y in range(11):
        c.rect(17 - y // 3, 9 + y, max(1, y // 3 * 2), 1, "k")
    c.line(4, 20, 0, 21, "d")
    c.line(30, 20, 33, 21, "d")
    return c.outlined()


def campfire() -> Image:
    c = Canvas(16, 14)
    for angle in range(8):
        c.ellipse(8 + math.cos(angle * math.tau / 8) * 5.6,
                  10 + math.sin(angle * math.tau / 8) * 2.6, 1.3, 1.1, "m")
    c.line(5, 10, 11, 9, "b")
    c.ellipse(8, 7, 2.6, 3.6, "o")
    c.ellipse(8, 8, 1.4, 2.2, "y")
    return c.outlined()


def signpost() -> Image:
    c = Canvas(18, 24)
    c.rect(8, 4, 2, 19, "B")
    c.rect(2, 3, 13, 4, "c")
    c.rect(5, 9, 12, 4, "c")
    c.rect(4, 5, 7, 1, "b")
    c.rect(8, 11, 6, 1, "b")
    return c.outlined()


def fence() -> Image:
    c = Canvas(34, 16)
    for x in (2, 16, 30):
        c.rect(x, 3, 2, 12, "B")
    for x in range(3, 31):
        if x not in (20, 21, 22):
            c.set(x, 6 + (x % 4 == 0), "m")
            c.set(x, 11 - (x % 5 == 0), "m")
    return c.outlined()


def grave() -> Image:
    c = Canvas(16, 20)
    c.ellipse(8, 17, 7, 2.6, "e")
    c.rect(7, 2, 2, 14, "B")
    c.rect(3, 5, 10, 2, "c")
    return c.outlined()


def bus() -> Image:
    c = Canvas(64, 28)
    c.rect(2, 4, 58, 18, "r")
    c.rect(2, 4, 58, 3, "o")
    for x in range(6, 56, 9):
        c.rect(x, 9, 6, 6, "A" if x % 2 else "T")
    rng = random.Random(5)
    for _ in range(16):
        c.rect(rng.randrange(3, 58), rng.randrange(6, 20), rng.randrange(2, 5), 1, "R")
    for x in (12, 46):
        c.ellipse(x, 22, 5, 5, "K")
        c.ellipse(x, 22, 2.4, 2.4, "m")
    c.rect(59, 13, 3, 4, "y")
    return c.outlined()


def plane_tail() -> Image:
    c = Canvas(48, 34)
    for y in range(26):
        c.rect(10 + y // 2, 2 + y, 12, 1, "m" if y % 7 else "M")
    c.ellipse(28, 27, 18, 5.6, "m")
    c.ellipse(28, 29, 17, 3.6, "M")
    c.rect(2, 17, 18, 3, "n")
    c.rect(15, 6, 6, 4, "t")
    for x in range(24, 42, 5):
        c.rect(x, 25, 2, 2, "A")
    return c.outlined()


def sandbags() -> Image:
    c = Canvas(34, 16)
    for row, (start, y) in enumerate(((2, 10), (6, 6), (10, 3))):
        for x in range(start, 32 - start, 8):
            c.ellipse(x + 4, y + 2, 4, 2.6, "S" if (x + row) % 2 else "s")
    return c.outlined()


def container() -> Image:
    c = Canvas(52, 26)
    c.rect(2, 3, 48, 20, "T")
    for x in range(4, 49, 4):
        c.rect(x, 5, 1, 16, "t")
    c.rect(2, 3, 48, 2, "t")
    c.rect(38, 8, 9, 5, "n")
    rng = random.Random(9)
    for _ in range(12):
        c.rect(rng.randrange(3, 46), rng.randrange(6, 20), 2, 2, "r")
    return c.outlined()


def radio_mast() -> Image:
    c = Canvas(26, 48)
    c.line(5, 46, 12, 4, "m")
    c.line(20, 46, 13, 4, "m")
    for y in range(10, 46, 6):
        half = round((y - 4) * 0.17)
        c.line(13 - half, y, 13 + half, y + 5, "M")
        c.line(13 + half, y, 13 - half, y + 5, "M")
    c.rect(12, 1, 2, 4, "r")
    c.ellipse(19, 14, 4, 4, "n")
    return c.outlined()


def billboard() -> Image:
    c = Canvas(44, 34)
    c.rect(8, 20, 2, 13, "M")
    c.rect(34, 20, 2, 13, "M")
    c.rect(2, 3, 40, 18, "n")
    c.rect(4, 5, 36, 14, "t")
    c.ellipse(14, 12, 5, 5, "y")
    c.rect(22, 9, 14, 2, "w")
    c.rect(22, 13, 10, 2, "w")
    for x, y in ((31, 5), (34, 8), (36, 12), (5, 15), (8, 17)):
        c.rect(x, y, 4, 3, "a")
    return c.outlined()


def boat() -> Image:
    c = Canvas(44, 20)
    c.ellipse(22, 11, 20, 7.6, "B")
    c.ellipse(22, 10, 17, 5, "b")
    for x in (12, 22, 31):
        c.rect(x, 5, 3, 10, "c")
    c.rect(26, 11, 7, 3, "U")
    return c.outlined()


def hut() -> Image:
    c = Canvas(42, 40)
    c.rect(8, 18, 26, 14, "B")
    for x in range(10, 34, 4):
        c.rect(x, 18, 1, 14, "b")
    for y in range(14):
        c.rect(20 - y - 4, 5 + y, (y + 5) * 2, 1, "H" if y % 3 else "h")
    c.rect(17, 22, 7, 10, "K")
    c.rect(27, 22, 4, 4, "o")
    for x in (9, 20, 32):
        c.rect(x, 32, 2, 6, "b")
    return c.outlined()


def walkway() -> Image:
    c = Canvas(48, 18)
    for x in range(1, 47, 5):
        if x != 26:
            c.rect(x, 2 + (x % 3), 4, 13, "B")
            c.rect(x, 2 + (x % 3), 1, 13, "c")
    c.rect(0, 4, 48, 1, "b")
    c.rect(0, 13, 48, 1, "b")
    return c.outlined()


def crystal() -> Image:
    c = Canvas(20, 24)
    for x, top, base, char in ((6, 9, 22, "P"), (10, 2, 22, "p"), (14, 11, 22, "P")):
        c.line(x, base, x, top, char, 4)
        c.line(x - 1, base, x - 1, top + 1, "v")
    c.set(10, 2, "w")
    return c.outlined()


def mangrove() -> Image:
    c = Canvas(34, 40)
    for dx in (-9, -4, 4, 9):
        c.line(17, 24, 17 + dx, 38, "b", 2)
    c.line(17, 26, 17, 12, "B", 4)
    rng = random.Random(12)
    for _ in range(9):
        c.ellipse(rng.randrange(8, 27), rng.randrange(5, 15), 6, 4, rng.choice("HuT"))
    c.set(11, 9, "g")
    c.set(22, 7, "g")
    return c.outlined()


def cactus() -> Image:
    c = Canvas(16, 24)
    c.rect(6, 3, 4, 20, "G")
    c.rect(7, 4, 1, 18, "g")
    c.rect(2, 9, 2, 6, "G")
    c.rect(2, 14, 5, 2, "G")
    c.rect(12, 6, 2, 6, "G")
    c.rect(9, 11, 5, 2, "G")
    return c.outlined()


def pipe() -> Image:
    c = Canvas(44, 16)
    c.rect(4, 4, 36, 8, "m")
    c.rect(4, 9, 36, 3, "M")
    for x in (8, 22, 34):
        c.rect(x, 3, 2, 10, "r")
    c.ellipse(5, 8, 3, 4.4, "M")
    c.ellipse(5, 8, 1.8, 3, "K")
    return c.outlined()


# --- patches -------------------------------------------------------------------------

def blotch(width: int, height: int, seed: int, chars: str, rough: float = 0.25) -> Image:
    c = Canvas(width, height)
    rng = random.Random(seed)
    for y in range(height):
        for x in range(width):
            dx, dy = (x + 0.5 - width / 2) / (width / 2), (y + 0.5 - height / 2) / (height / 2)
            if dx * dx + dy * dy + rng.uniform(-rough, rough * 0.4) <= 0.9:
                c.set(x, y, chars[0] if rng.random() > 0.16 else rng.choice(chars))
    return c.pixels


def road() -> Image:
    """128x40 road segment; structures put segments side by side."""
    c = Canvas(128, 40)
    rng = random.Random(66)
    for x in range(128):
        top, bottom = 2 + rng.randrange(3), 38 - rng.randrange(3)
        for y in range(top, bottom):
            c.set(x, y, "a" if rng.random() > 0.08 else "A")
    for x in range(4, 124, 16):
        c.rect(x, 19, 8, 2, "S")
    for _ in range(5):
        x, y = rng.randrange(128), rng.randrange(6, 34)
        for _ in range(12):
            if 0 <= x < 128 and 0 <= y < 40:
                c.set(x, y, "k")
            x += rng.choice((-1, 1, 1))
            y += rng.choice((-1, 0, 1))
    return c.pixels


def lava_crack() -> Image:
    c = Canvas(44, 24)
    c.ellipse(22, 12, 21, 11, "k")
    rng = random.Random(77)
    for start in (6, 18, 30):
        x, y = start, rng.randrange(8, 16)
        for _ in range(16):
            c.rect(x, y, 2, 2, "r")
            c.set(x, y, "o" if rng.random() > 0.4 else "y")
            x += rng.choice((0, 1, 1))
            y = max(4, min(19, y + rng.choice((-1, 0, 1))))
    return c.pixels


def tracks() -> Image:
    c = Canvas(64, 16)
    for x in range(0, 64, 3):
        c.rect(x, 2, 2, 3, "e")
        c.rect(x, 11, 2, 3, "e")
    return c.pixels


def lily_pads() -> Image:
    c = Canvas(44, 24)
    c.ellipse(22, 12, 21.5, 11.5, "T")
    c.ellipse(22, 12, 19, 9.5, "U")
    for x, y in ((10, 9), (20, 15), (30, 8), (35, 14)):
        c.ellipse(x, y, 4, 2.4, "G")
        c.set(x + 1, y - 1, "v")
    return c.pixels


def frames() -> dict[str, Image]:
    """Static frames; animated ones are listed in animations()."""
    tesla, saw_base, mine, rocket, flame = (
        tesla_coil(), saw_icon(), trap_mine(), rocket_tube(), flamethrower())
    result: dict[str, Image] = {
        "weapons/tesla_coil": tesla,
        "weapons/saw_blade": saw_base,
        "weapons/trap_mine": mine,
        "weapons/rocket_tube": rocket,
        "weapons/flamethrower": flame,
        "weapons/storm_core": recolored(tesla, {"m": "y", "r": "p", "c": "v", "t": "w"}),
        "weapons/buzz_storm": recolored(saw_base, {"m": "y", "M": "o"}),
        "weapons/minefield": recolored(mine, {"h": "r", "H": "R", "r": "y"}),
        "weapons/rocket_barrage": recolored(rocket, {"h": "y", "H": "o", "r": "g"}),
        "weapons/furnace": recolored(flame, {"r": "t", "o": "w", "M": "y"}),
        "passives/capacitor": capacitor(),
        "passives/thick_hide": thick_hide(),
        "passives/scrap_plating": scrap_plating(),
        "passives/field_notes": field_notes(),
        "passives/scope": scope(),
        "projectiles/rocket": rocket_projectile(),
        "projectiles/spark": spark(),
        "pickups/rage_shot": syringe("r", "R"),
        "pickups/adrenaline": syringe("g", "G"),
        "pickups/shield_cell": shield_cell(),
        "pickups/ammo_belt": ammo_belt(),
        "pickups/data_disk": data_disk(),
        "pickups/cryo_bomb": cryo_bomb(),
        "decor/ash": blotch(48, 28, 1, "kAK"),
        "decor/dry_grass": blotch(44, 24, 2, "hHS", 0.6),
        "decor/salt_flat": blotch(60, 32, 3, "snS"),
        "decor/scorch": blotch(30, 20, 4, "Kke"),
        "decor/plaza": blotch(60, 36, 6, "nma", 0.1),
        "decor/shallow_water": blotch(56, 30, 8, "Ttu"),
        "decor/violet_slime": blotch(40, 22, 10, "Ppv"),
        "decor/road": road(),
        "decor/lava_crack": lava_crack(),
        "decor/tracks": tracks(),
        "decor/lily_pads": lily_pads(),
    }
    for maker in (tent, campfire, signpost, fence, grave, bus, plane_tail, sandbags, container,
                  radio_mast, billboard, boat, hut, walkway, crystal, mangrove, cactus, pipe):
        result[f"decor/{maker.__name__}"] = maker()
    for landmark in (vending, generator, hatch, med_station, workbench):
        result[f"landmarks/{landmark.__name__}"] = landmark(False)
        result[f"landmarks/{landmark.__name__}_used"] = landmark(True)
    return result


def animations() -> dict[str, dict[str, Image]]:
    return {
        "projectiles/saw": {f"spin_{i}": saw(i) for i in range(4)},
        "projectiles/mine": {f"idle_{i}": mine_projectile(i) for i in range(2)},
        "projectiles/flame": {f"burn_{i}": flame_projectile(i) for i in range(3)},
    }


assert set("KkwsSDderRoyhHtTgG") <= set(art.PALETTE)
