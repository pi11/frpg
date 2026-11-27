"""Procedural pixel art for the base, forest, dungeon, frozen pass and desert (CC0, original).

Every sprite faces right (the game flips it), walk cycles have four frames and all
randomness is seeded, so rebuilding gives identical bytes.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable

import art_more as more
from art_extra import blotch
from art_more import periodic_noise
from shapes import Canvas, Image, color

Draw = Callable[[int], Image]


def recolor(image: Image, table: dict[str, str]) -> Image:
    swap = {color(old): color(new) for old, new in table.items()}
    return [[swap.get(pixel, pixel) for pixel in row] for row in image]


# --- ordinary enemies (16x16 unless noted) -------------------------------------------


def soldier(frame: int) -> Image:
    """Feral conscript: khaki uniform, round helmet, ashen face and a rifle."""
    c = Canvas(16, 16)
    step = (1, 0, -1, 0)[frame]
    c.line(6, 11, 6 - step, 14, "H", 2)
    c.line(9, 11, 9 + step, 14, "H", 2)
    c.rect(5 - step, 14, 2, 2, "k")
    c.rect(9 + step, 14, 2, 2, "k")
    c.rect(5, 6, 6, 6, "h")
    c.rect(5, 9, 6, 1, "k")
    c.set(6, 7, "H")
    c.set(9, 7, "H")
    c.rect(7, 3, 3, 3, "q")
    c.set(9, 4, "O")
    c.ellipse(8, 2.5, 3.2, 2, "H")
    c.rect(4, 3, 8, 1, "H")
    c.line(7, 8, 15, 8, "M")
    c.set(15, 8, "m")
    c.rect(6, 9, 2, 1, "B")
    return c.outlined()


def sentry_drone(frame: int) -> Image:
    """Hovering sentry: metal saucer, spinning rotor blur and a red eye."""
    c = Canvas(16, 16)
    bob = (0, -1, 0, 1)[frame]
    blades = ((1, 3, 14, 3), (3, 2, 12, 4), (1, 3, 14, 3), (3, 4, 12, 2))[frame]
    c.line(blades[0], blades[1] + bob, blades[2], blades[3] + bob, "n")
    c.rect(7, 3 + bob, 2, 3, "M")
    c.ellipse(8, 8 + bob, 6, 3, "M")
    c.ellipse(8, 7.5 + bob, 5, 2, "m")
    c.ellipse(10, 9 + bob, 2, 1.6, "K")
    c.set(10, 9 + bob, "O" if frame % 2 else "J")
    c.line(4, 11 + bob, 3, 13 + bob, "M")
    c.line(12, 11 + bob, 13, 13 + bob, "M")
    return c.outlined()


def mine_crawler(frame: int) -> Image:
    """Walking land mine on crab legs; its lamp blinks faster as it nears."""
    c = Canvas(16, 16)
    step = (1, 0, -1, 0)[frame]
    for index, x in enumerate((3, 6, 10, 13)):
        swing = step if index % 2 else -step
        c.line(x, 10, x + swing * 2 - (1 if x < 8 else -1), 14, "M")
    c.ellipse(8, 9, 6, 3.4, "H")
    c.ellipse(8, 8, 5, 2.4, "h")
    c.rect(4, 10, 8, 1, "y")
    c.rect(7, 4, 2, 3, "M")
    c.set(7, 3, "O" if frame % 2 else "y")
    c.set(8, 3, "O" if frame % 2 else "y")
    return c.outlined()


def wolf(frame: int, fur: str = "z", dark: str = "Z", eye: str = "y") -> Image:
    """Mutant wolf: heavy shoulders, bony ridge and a long running stride."""
    c = Canvas(18, 16)
    bob = (0, -1, 0, -1)[frame]
    legs = ((2, -2, 2, -2), (0, 0, 0, 0), (-2, 2, -2, 2), (0, 0, 0, 0))[frame]
    for index, (x, swing) in enumerate(zip((4, 6, 11, 13), legs, strict=True)):
        c.line(x, 10 + bob, x + swing, 14, dark if index % 2 else fur, 2 if index in (2, 3) else 1)
    c.ellipse(9, 8.5 + bob, 6, 3, fur)
    c.ellipse(11, 7.5 + bob, 3.5, 3, fur)
    c.rect(4, 7 + bob, 9, 1, dark)
    c.line(3, 8 + bob, 0, 6 + bob, fur, 2)
    c.ellipse(14.5, 6.5 + bob, 2.6, 2.2, fur)
    c.rect(15, 7 + bob, 3, 2, dark)
    c.set(14, 3 + bob, dark)
    c.set(15, 4 + bob, dark)
    c.set(15, 6 + bob, eye)
    c.set(17, 9 + bob, "w")
    for x in (6, 8, 10, 12):
        c.set(x, 5 + bob, "w")
    return c.outlined()


def polar_wolf(frame: int) -> Image:
    return wolf(frame, "l", "L", "I")


def tick(frame: int) -> Image:
    """12x12 forest tick: a bloated red body on scrabbling legs."""
    c = Canvas(12, 12)
    step = (1, 0, -1, 0)[frame]
    for index, x in enumerate((3, 5, 7, 9)):
        swing = step if index % 2 else -step
        c.line(x, 6, x + swing - 1, 10, "b")
        c.line(x, 6, x - swing + 1, 2, "b")
    c.ellipse(6, 6, 4, 3.4, "O")
    c.ellipse(5.5, 5.5, 2.6, 2, "J")
    c.rect(9, 5, 2, 2, "b")
    c.set(4, 5, "N")
    return c.outlined()


def spore_shroom(frame: int) -> Image:
    """Walking toadstool that coughs spores; the cap puffs up between shots."""
    c = Canvas(16, 16)
    step = (1, 0, -1, 0)[frame]
    puff = (0, 0.5, 1, 0.5)[frame]
    c.line(6, 11, 6 - step, 14, "f", 2)
    c.line(10, 11, 10 + step, 14, "f", 2)
    c.rect(6, 7, 5, 6, "s")
    c.rect(6, 11, 5, 1, "S")
    c.set(9, 9, "K")
    c.set(10, 9, "K")
    c.ellipse(8, 5, 6.5 + puff, 3.8 + puff / 2, "c")
    c.ellipse(8, 4, 5, 2.4, "o")
    for x, y in ((5, 4), (9, 3), (11, 5), (7, 6)):
        c.set(x, y, "y")
    return c.outlined()


def cave_rat(frame: int) -> Image:
    """14x12 tunnel rat: grey fur, pink tail and ears, red eye."""
    c = Canvas(14, 12)
    bob = (0, -1, 0, -1)[frame]
    legs = ((1, -1), (0, 0), (-1, 1), (0, 0))[frame]
    c.line(4, 8 + bob, 4 + legs[0], 11, "Z")
    c.line(9, 8 + bob, 9 + legs[1], 11, "Z")
    c.ellipse(7, 7 + bob, 4.6, 2.8, "z")
    c.rect(4, 5 + bob, 6, 1, "n")
    c.line(2, 8 + bob, 0, 5 + bob + (frame % 2), "N")
    c.ellipse(11, 6.5 + bob, 2.3, 1.8, "z")
    c.set(13, 7 + bob, "N")
    c.set(10, 4 + bob, "N")
    c.set(11, 6 + bob, "O")
    return c.outlined()


def cave_spider(frame: int) -> Image:
    """Pale cave spider: eight jointed legs that ripple as it scuttles."""
    c = Canvas(16, 16)
    for index in range(4):
        lift = 1 if (index + frame) % 2 else -1
        for side in (-1, 1):
            knee_x = 8 + side * (4 + index % 2)
            c.line(8, 8, knee_x, 4 + index * 2 + lift, "Z")
            c.line(knee_x, 4 + index * 2 + lift, 8 + side * 7, 7 + index * 2, "Z")
    c.ellipse(6.5, 8.5, 3.6, 3, "P")
    c.ellipse(6, 8, 2.4, 1.8, "p")
    c.ellipse(11, 8, 2.4, 2, "P")
    c.set(12, 7, "O")
    c.set(12, 9, "O")
    c.set(13, 8, "J")
    return c.outlined()


def blind_digger(frame: int) -> Image:
    """Blind mole the size of a dog: a mound of dirt, big claws and a pink star nose."""
    c = Canvas(16, 16)
    sway = (0, 1, 0, -1)[frame]
    c.ellipse(8, 14, 7, 2, "e")
    c.ellipse(8, 13.5, 5.5, 1.2, "d")
    c.ellipse(8 + sway * 0.5, 9, 5, 4.4, "b")
    c.ellipse(7 + sway * 0.5, 8, 3.4, 3, "B")
    c.rect(12 + sway, 8, 3, 2, "N")
    c.set(15 + sway, 8, "C")
    c.set(15 + sway, 9, "C")
    for x in (3, 12):
        c.line(x, 11, x + (1 if x > 8 else -1) * 2, 13 - sway, "w")
    return c.outlined()


def snow_beast(frame: int) -> Image:
    """18x18 snow mutant: shaggy white fur, blue face, long arms dragging claws."""
    c = Canvas(18, 18)
    step = (1, 0, -1, 0)[frame]
    c.line(6, 13, 6 - step, 17, "L", 3)
    c.line(11, 13, 11 + step, 17, "L", 3)
    c.ellipse(9, 9, 6, 5.6, "l")
    c.ellipse(8, 10, 4, 4, "L")
    c.line(4, 7, 2, 13 + step, "l", 2)
    c.line(14, 7, 16, 13 - step, "l", 2)
    c.set(1, 14 + step, "w")
    c.set(17, 14 - step, "w")
    c.ellipse(11, 4, 3.4, 3, "l")
    c.rect(10, 4, 4, 3, "I")
    c.set(12, 4, "j")
    c.set(13, 6, "w")
    for x, y in ((5, 6), (12, 9), (7, 13)):
        c.set(x, y, "L")
    return c.outlined()


def ice_beetle(frame: int) -> Image:
    """14x14 beetle with a glassy ice shell that cracks open when it bursts."""
    c = Canvas(14, 14)
    step = (1, 0, -1, 0)[frame]
    for index, x in enumerate((3, 6, 9)):
        swing = step if index % 2 else -step
        c.line(x, 9, x + swing, 12, "j")
        c.line(x, 6, x - swing, 3, "j")
    c.ellipse(6.5, 7.5, 5, 3.8, "I")
    c.ellipse(6, 6.5, 3.4, 2.2, "i")
    c.line(6, 4, 6, 11, "j")
    c.ellipse(11.5, 7.5, 1.8, 1.8, "j")
    c.set(12, 7, "w" if frame % 2 else "i")
    return c.outlined()


def frost_shooter(frame: int) -> Image:
    """Cloaked ice caster: deep blue hood, frosted face and an ice-tipped staff."""
    c = Canvas(16, 16)
    step = (1, 0, -1, 0)[frame]
    c.line(6, 12, 6 - step, 15, "Z", 2)
    c.line(9, 12, 9 + step, 15, "Z", 2)
    for y in range(5, 13):
        half = 2 + (y - 5) // 3
        c.rect(8 - half, y, half * 2, 1, "j")
    c.ellipse(8, 4, 2.8, 2.8, "j")
    c.rect(8, 3, 2, 2, "i")
    c.set(9, 3, "I")
    c.line(12, 2, 12, 14, "B")
    c.ellipse(12, 2, 1.6, 1.6, "i")
    c.set(12, 1, "w")
    return c.outlined()


def vulture(frame: int) -> Image:
    """Desert vulture: wide ragged wings, bald pink head and a hooked beak."""
    c = Canvas(18, 16)
    lift = (-4, -1, 3, -1)[frame]
    for side in (-1, 1):
        tip_x = 9 + side * 8
        c.line(9, 8, tip_x, 7 + lift, "b", 2)
        c.line(9 + side * 2, 9, tip_x, 7 + lift, "B")
        c.set(tip_x, 8 + lift, "k")
    c.ellipse(9, 9, 2.8, 3.2, "B")
    c.rect(8, 11, 2, 2, "b")
    c.ellipse(12, 6, 1.8, 1.6, "N")
    c.set(14, 6, "y")
    c.set(14, 7, "y")
    c.set(12, 5, "K")
    c.rect(10, 7, 2, 1, "w")
    return c.outlined()


def sand_worm(frame: int) -> Image:
    return recolor(more.worm(frame, 16), {"f": "V", "F": "Y", "u": "S", "U": "D", "R": "O"})


def nomad(frame: int) -> Image:
    """Sand nomad: ochre robe, red scarf, brass goggles and a long rifle."""
    c = Canvas(16, 16)
    step = (1, 0, -1, 0)[frame]
    c.line(6, 12, 6 - step, 15, "Y", 2)
    c.line(9, 12, 9 + step, 15, "Y", 2)
    for y in range(6, 13):
        half = 3 + (y - 6) // 4
        c.rect(8 - half, y, half * 2, 1, "V")
    c.rect(5, 8, 6, 1, "Y")
    c.ellipse(8, 4, 2.8, 2.6, "V")
    c.rect(7, 5, 4, 1, "O")
    c.rect(8, 3, 3, 1, "y")
    c.set(10, 3, "w")
    c.line(9, 8, 15, 6, "M")
    c.set(15, 6, "m")
    c.line(4, 5, 3, 9, "O")
    return c.outlined()


# --- mini-bosses (48x48) -------------------------------------------------------------


def bear(frame: int) -> Image:
    """Mutant bear: brown hulk with glowing rad sores, bone back spikes and huge claws."""
    c = Canvas(48, 48)
    step = (3, 0, -3, 0)[frame]
    for index, x in enumerate((12, 18, 28, 34)):
        move = step if index % 2 else -step
        c.line(x, 32, x + move, 44, "b" if index % 2 else "B", 6)
        c.rect(x + move - 3, 43, 7, 3, "k")
        for dx in (-2, 0, 2):
            c.set(x + move + dx + 2, 46, "w")
    c.ellipse(23, 26, 16, 11, "B")
    c.ellipse(21, 23, 13, 8, "c")
    c.ellipse(22, 25, 12, 7, "B")
    for x in (12, 17, 22, 27):
        c.line(x, 16, x - 1, 10 + abs(x - 19) // 3, "w", 2)
    c.ellipse(38, 20, 8, 7, "B")
    c.ellipse(43, 23, 4, 3, "c")
    c.rect(44, 22, 3, 2, "K")
    c.ellipse(34, 13, 2.5, 2.5, "b")
    c.set(40, 18, "y")
    c.set(41, 18, "O")
    c.rect(40, 26, 6, 1, "w")
    rng = random.Random(4)
    for _ in range(5):
        x, y = rng.randrange(12, 32), rng.randrange(22, 32)
        c.ellipse(x, y, 1.6, 1.6, "G")
        c.set(x, y, "g")
    return c.outlined()


def spider_queen(frame: int) -> Image:
    """Brood mother: a bloated violet abdomen full of eggs on eight long legs."""
    c = Canvas(48, 48)
    for index in range(4):
        lift = 2 if (index + frame) % 2 else -2
        for side in (-1, 1):
            knee_x = 24 + side * (12 + index * 2)
            knee_y = 10 + index * 6 + lift
            c.line(24, 22 + index * 2, knee_x, knee_y, "Z", 3)
            c.line(knee_x, knee_y, 24 + side * 22, 30 + index * 4, "Z", 2)
            c.set(24 + side * 22, 30 + index * 4, "w")
    c.ellipse(18, 27, 13, 11, "P")
    c.ellipse(16, 25, 9, 7, "p")
    rng = random.Random(19)
    for _ in range(7):
        x, y = rng.randrange(9, 26), rng.randrange(20, 34)
        c.ellipse(x, y, 1.8, 1.6, "v")
        c.set(x, y, "w")
    c.ellipse(34, 23, 7, 6, "P")
    for x, y in ((37, 20), (40, 22), (37, 24), (40, 25)):
        c.set(x, y, "O")
    c.set(38, 21, "J")
    c.line(39, 28, 42, 32, "w", 2)
    c.line(35, 28, 34, 32, "w", 2)
    return c.outlined()


def ice_golem(frame: int) -> Image:
    """Ice golem: stacked blocks of blue ice with cracks and a cold glowing core."""
    c = Canvas(48, 48)
    step = (3, 0, -3, 0)[frame]
    c.rect(13 - step, 32, 9, 13, "I")
    c.rect(26 + step, 32, 9, 13, "I")
    c.rect(13 - step, 32, 3, 13, "i")
    c.rect(26 + step, 32, 3, 13, "i")
    c.rect(9, 14, 30, 20, "I")
    c.rect(11, 15, 12, 8, "i")
    c.rect(2, 14 + step // 2, 8, 20, "I")
    c.rect(38, 14 - step // 2, 8, 20, "I")
    c.rect(2, 30 + step // 2, 8, 5, "j")
    c.rect(38, 30 - step // 2, 8, 5, "j")
    c.rect(16, 3, 16, 12, "I")
    c.rect(17, 4, 7, 4, "i")
    c.rect(24, 8, 7, 3, "j")
    c.rect(26, 8, 2, 2, "w")
    c.rect(29, 8, 2, 2, "w")
    c.ellipse(24, 25, 4, 4, "j")
    c.ellipse(24, 25, 2.4, 2.4, "l" if frame % 2 else "i")
    for x0, y0, x1, y1 in ((12, 18, 18, 28), (33, 15, 30, 24), (20, 6, 22, 12)):
        c.line(x0, y0, x1, y1, "j")
    return c.outlined()


def scorpion_king(frame: int) -> Image:
    """Giant ochre scorpion with a brass crown of shrapnel and a dripping stinger."""
    c = Canvas(48, 48)
    step = (2, 0, -2, 0)[frame]
    for index in range(4):
        move = step if index % 2 else -step
        x = 14 + index * 6
        c.line(x, 32, x - 4 + move, 42, "Y", 2)
        c.line(x, 32, x + 4 - move, 42, "Y", 2)
    c.ellipse(24, 31, 13, 6, "V")
    for x in range(14, 34, 4):
        c.rect(x, 27, 2, 8, "Y")
    tail = [(12, 30), (6, 24), (5, 15), (9, 8), (16, 5)]
    for index, (x, y) in enumerate(tail):
        c.ellipse(x, y + (frame % 2 if index > 2 else 0), 4 - index * 0.4, 4 - index * 0.4, "V")
        c.set(x, y - 2, "s")
    c.line(16, 5, 20, 9, "K", 2)
    c.set(21, 10, "C")
    c.ellipse(37, 29, 5, 4, "V")
    for side in (-1, 1):
        claw_y = 29 + side * 6
        c.line(38, 29, 43, claw_y, "Y", 3)
        c.ellipse(44, claw_y, 3.4, 2.6, "V")
        c.line(45, claw_y, 47, claw_y - side * 2 + step // 2, "Y", 2)
    c.set(39, 27, "K")
    c.set(41, 27, "K")
    for x in (34, 37, 40):
        c.line(x, 25, x, 22, "y", 2)
    return c.outlined()


# --- bosses (48x48) ------------------------------------------------------------------


def steel_general(frame: int) -> Image:
    """Steel general: a tank hull with a medal-covered torso, peaked cap and twin cannon."""
    c = Canvas(48, 48)
    c.rect(4, 36, 40, 9, "A")
    c.rect(5, 37, 38, 7, "M")
    for x in range(6 + frame % 2 * 2, 42, 4):
        c.rect(x, 38, 2, 5, "A")
    for x in (9, 18, 27, 36):
        c.ellipse(x + 1, 40.5, 2.4, 2.4, "m")
    c.rect(6, 28, 36, 9, "H")
    c.rect(6, 28, 36, 2, "h")
    for x in range(8, 40, 6):
        c.set(x, 33, "K")
    c.rect(13, 13, 20, 16, "H")
    c.rect(15, 14, 7, 6, "h")
    c.line(14, 14, 31, 27, "O", 2)
    for index, x in enumerate((24, 27, 30)):
        c.rect(x, 18 + index % 2, 2, 3, "y")
        c.set(x, 17 + index % 2, "O")
    swing = (0, 1, 0, -1)[frame]
    c.rect(28, 18 + swing, 19, 4, "M")
    c.rect(28, 23 - swing, 17, 3, "M")
    c.rect(44, 17 + swing, 3, 6, "A")
    c.ellipse(23, 9, 6, 5, "q")
    c.rect(23, 8, 6, 2, "K")
    c.set(26, 8, "O")
    c.rect(15, 3, 16, 3, "H")
    c.rect(19, 1, 10, 3, "H")
    c.rect(22, 2, 3, 2, "y")
    c.rect(26, 6, 9, 1, "k")
    return c.outlined()


def forest_lord(frame: int) -> Image:
    """Lord of the woods: a walking oak with antlers of branches and moss-hung eyes."""
    c = Canvas(48, 48)
    sway = (0, 1, 0, -1)[frame]
    for index, x in enumerate((14, 20, 28, 34)):
        root = (index + frame) % 4 - 1.5
        c.line(x, 34, round(x + root * 2), 46, "b", 3)
    c.ellipse(24, 26, 13, 13, "B")
    c.ellipse(22, 24, 9, 10, "c")
    c.ellipse(24, 27, 8, 9, "B")
    for x0, y0 in ((14, 20), (30, 18), (20, 32)):
        c.line(x0, y0, x0 + 4, y0 + 3, "b")
    c.line(12, 20, 3, 28 + sway, "b", 3)
    c.line(36, 20, 45, 28 - sway, "b", 3)
    c.line(3, 28 + sway, 1, 33 + sway, "B", 2)
    c.line(45, 28 - sway, 47, 33 - sway, "B", 2)
    for side in (-1, 1):
        c.line(24 + side * 4, 12, 24 + side * 12, 2 + sway, "b", 2)
        c.line(24 + side * 9, 6, 24 + side * 15, 7, "b", 2)
        c.line(24 + side * 6, 9, 24 + side * 6, 3, "b")
    rng = random.Random(31)
    for _ in range(10):
        c.ellipse(rng.randrange(10, 38), rng.randrange(8, 20), 3, 2.4, rng.choice("XxE"))
    c.ellipse(22, 22, 2.4, 2, "K")
    c.ellipse(29, 22, 2.4, 2, "K")
    c.set(22, 22, "g")
    c.set(29, 22, "g")
    c.rect(22, 29, 8, 2, "K")
    for x in (23, 26, 29):
        c.set(x, 29, "s")
    for x in (12, 18, 31, 36):
        c.line(x, 24, x, 30 + (x % 3), "X")
    return c.outlined()


def rat_king(frame: int) -> Image:
    """Rat king: a fat grey rat in a tin crown on a knot of tangled tails and bones."""
    c = Canvas(48, 48)
    rng = random.Random(5)
    for index in range(7):
        x = 6 + index * 6
        wave = ((index + frame) % 4 - 1.5) * 2
        c.line(x, 40, round(x + wave), 47, "N")
        c.line(x, 40, 24, 35, "N")
    for _ in range(6):
        x = rng.randrange(6, 42)
        c.line(x, 42, x + 4, 40, "w", 2)
    c.ellipse(24, 30, 16, 11, "z")
    c.ellipse(22, 27, 12, 7, "n")
    c.ellipse(24, 31, 11, 7, "z")
    c.ellipse(20, 33, 6, 4, "N")
    c.line(8, 26, 3, 34, "z", 3)
    c.line(40, 26, 45, 34, "z", 3)
    c.rect(1, 34, 4, 2, "N")
    c.rect(43, 34, 4, 2, "N")
    c.ellipse(30, 15, 9, 7, "z")
    c.ellipse(37, 17, 4, 3, "n")
    c.set(41, 17, "N")
    c.set(40, 16, "N")
    c.ellipse(24, 9, 3, 3, "N")
    c.ellipse(34, 9, 3, 3, "N")
    c.set(31, 14, "O")
    c.set(35, 14, "O")
    c.rect(36, 20, 2, 2, "w")
    c.rect(23, 4, 13, 4, "y")
    for x in (23, 27, 31, 35):
        c.rect(x, 1, 2, 3, "y")
    c.set(29, 5, "O")
    c.set(33, 5, "t")
    return c.outlined()


def frost_queen(frame: int) -> Image:
    """Queen of the cold: a floating ice witch in a crystal crown and a frost-torn cape."""
    c = Canvas(48, 48)
    bob = (0, -1, 0, 1)[frame]
    for y in range(14, 44):
        half = 5 + (y - 14) * 0.42
        tatter = (y + frame) % 5 == 0
        c.rect(round(24 - half), y + bob, round(half * 2), 1, "j" if not tatter else "I")
    for x in range(round(24 - 17), round(24 + 17), 4):
        c.rect(x, 43 + bob, 2, 3 + (x + frame) % 3, "j")
    c.rect(18, 16 + bob, 12, 14, "I")
    c.rect(19, 17 + bob, 5, 10, "i")
    c.line(18, 18 + bob, 8, 26 + bob, "i", 2)
    c.line(30, 18 + bob, 40, 12 + bob, "i", 2)
    c.ellipse(42, 10 + bob, 3, 3, "l")
    c.set(42, 10 + bob, "w")
    for angle in range(0, 360, 60):
        dx = round(math.cos(math.radians(angle + frame * 15)) * 5)
        dy = round(math.sin(math.radians(angle + frame * 15)) * 5)
        c.set(42 + dx, 10 + bob + dy, "i")
    c.ellipse(24, 10 + bob, 5, 5, "i")
    c.rect(25, 9 + bob, 2, 2, "j")
    c.rect(28, 9 + bob, 2, 2, "j")
    c.rect(24, 13 + bob, 4, 1, "I")
    for index, x in enumerate((19, 22, 25, 28)):
        c.line(x, 6 + bob, x + 1, 1 + bob - index % 2 * 2, "l", 2)
    c.set(24, 0 + bob, "w")
    return c.outlined()


def sand_leviathan(frame: int) -> Image:
    """Sand leviathan: a colossal worm head bursting out of a dune, ringed with teeth."""
    c = Canvas(48, 48)
    rise = (0, 1, 2, 1)[frame]
    c.ellipse(24, 43, 23, 5, "S")
    c.ellipse(24, 42, 19, 3, "s")
    for index in range(4):
        y = 38 - index * 7 - rise
        c.ellipse(22 + index * 2, y, 13 - index, 7, "Y" if index % 2 else "V")
        c.rect(12 + index * 2, y - 1, 20 - index * 2, 1, "s")
    c.ellipse(30, 11 - rise, 13, 10, "V")
    c.ellipse(33, 11 - rise, 8, 7, "O")
    c.ellipse(34, 11 - rise, 5, 4.4, "K")
    for angle in range(0, 360, 30):
        x = round(33 + math.cos(math.radians(angle)) * 7)
        y = round(11 - rise + math.sin(math.radians(angle)) * 6)
        c.set(x, y, "w")
    for x, y in ((20, 6), (22, 14), (19, 10)):
        c.set(x, y - rise, "K")
    rng = random.Random(frame + 40)
    for _ in range(6):
        c.set(rng.randrange(2, 46), rng.randrange(30, 40), "s")
    return c.outlined()


# --- projectiles ---------------------------------------------------------------------


def acid_spit() -> Image:
    """Enemy spit in pink, so it never looks like the green XP crystals."""
    c = Canvas(7, 7)
    c.ellipse(3.5, 3.5, 3, 3, "C")
    c.ellipse(3, 3, 2, 2, "N")
    c.set(2, 2, "w")
    return c.outlined()


def ice_shard() -> Image:
    c = Canvas(9, 6)
    c.line(0, 3, 8, 3, "I", 2)
    c.line(2, 2, 7, 2, "i")
    c.set(8, 2, "w")
    return c.outlined()


def spore() -> Image:
    c = Canvas(7, 7)
    c.ellipse(3.5, 3.5, 3, 3, "c")
    c.ellipse(3, 3, 1.8, 1.8, "o")
    for x, y in ((1, 3), (5, 2), (3, 5)):
        c.set(x, y, "y")
    return c.outlined()


def sand_blast() -> Image:
    c = Canvas(7, 7)
    c.ellipse(3.5, 3.5, 3, 3, "Y")
    c.ellipse(3, 3, 2, 2, "V")
    c.set(2, 2, "s")
    return c.outlined()


def cap() -> Image:
    """Bottle cap: crimped steel rim, red top with a highlight and a small brass star."""
    size = 11
    c = Canvas(size, size)
    centre = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            dx, dy = x - centre, y - centre
            distance = math.hypot(dx, dy)
            tooth = int((math.atan2(dy, dx) + math.pi) / (2 * math.pi) * 16) % 2 == 0
            if distance <= 3.3:
                c.set(x, y, "J" if dx + dy < -2 else "O")
            elif distance <= 4.3:
                c.set(x, y, "n" if dx + dy < 0 else "m")
            elif distance <= 5.1 and tooth:
                c.set(x, y, "M")
    for x, y in ((5, 4), (4, 5), (6, 5), (5, 6)):
        c.set(x, y, "y")
    c.set(5, 5, "w")
    return c.outlined()


# --- decor objects -------------------------------------------------------------------


def barbed_wire() -> Image:
    c = Canvas(34, 14)
    for x in (2, 16, 30):
        c.line(x, 12, x + 2, 2, "B", 2)
    for row in (4, 8):
        for x in range(1, 33):
            y = row + round(math.sin(x * 0.9) * 1.5)
            c.set(x, y, "m")
            if x % 4 == 0:
                c.set(x, y - 1, "n")
                c.set(x, y + 1, "M")
    return c.outlined()


def tank_wreck() -> Image:
    c = Canvas(50, 30)
    c.rect(3, 18, 44, 9, "A")
    for x in range(5, 45, 5):
        c.ellipse(x + 2, 22.5, 2.4, 2.4, "M")
    c.rect(5, 11, 40, 8, "H")
    c.rect(5, 11, 40, 2, "h")
    c.rect(15, 4, 18, 8, "H")
    c.rect(16, 5, 8, 3, "h")
    c.line(32, 7, 48, 3, "M", 3)
    c.ellipse(26, 7, 2, 2, "O")
    rng = random.Random(23)
    for _ in range(10):
        c.rect(rng.randrange(6, 42), rng.randrange(11, 18), 2, 2, rng.choice("rRk"))
    c.ellipse(36, 14, 3, 2.4, "K")
    return c.outlined()


def watchtower() -> Image:
    c = Canvas(28, 46)
    for x0, x1 in ((4, 9), (24, 19)):
        c.line(x0, 45, x1, 14, "B", 2)
    for y in range(20, 44, 8):
        c.line(6, y, 22, y + 6, "b")
        c.line(22, y, 6, y + 6, "b")
    c.rect(4, 9, 20, 7, "c")
    c.rect(4, 9, 20, 2, "B")
    for x in range(5, 24, 4):
        c.rect(x, 11, 2, 5, "b")
    for y in range(9):
        c.rect(13 - y - 2, y, (y + 2) * 2, 1, "H" if y % 2 else "h")
    c.rect(12, 12, 4, 2, "y")
    return c.outlined()


def ammo_crates() -> Image:
    c = Canvas(24, 18)
    for x, y in ((1, 8), (12, 8), (6, 1)):
        c.rect(x, y, 11, 8, "H")
        c.rect(x, y, 11, 2, "h")
        c.rect(x + 4, y + 3, 3, 3, "y")
        c.set(x + 5, y + 4, "K")
    return c.outlined()


def bunker() -> Image:
    c = Canvas(46, 28)
    c.ellipse(23, 22, 22, 15, "z")
    c.ellipse(21, 18, 16, 9, "n")
    c.ellipse(23, 22, 19, 11, "z")
    c.rect(10, 17, 26, 4, "K")
    c.rect(1, 24, 44, 4, "Z")
    for x in range(4, 44, 7):
        c.rect(x, 24, 4, 3, "h")
    rng = random.Random(8)
    for _ in range(6):
        c.set(rng.randrange(8, 38), rng.randrange(9, 16), "Z")
    return c.outlined()


def hedgehog() -> Image:
    c = Canvas(18, 18)
    c.line(2, 16, 15, 3, "M", 2)
    c.line(2, 3, 15, 16, "M", 2)
    c.line(9, 1, 9, 17, "m", 2)
    c.set(3, 15, "r")
    c.set(14, 15, "r")
    return c.outlined()


def pine(snowy: bool = False) -> Image:
    c = Canvas(22, 36)
    c.rect(10, 28, 3, 7, "b")
    for top, width in ((2, 4), (8, 7), (15, 9), (22, 10)):
        for y in range(7):
            half = round(width * (y + 1) / 7)
            c.rect(11 - half, top + y, half * 2 + 1, 1, "x")
            c.rect(11 - half, top + y, max(1, half), 1, "X")
        if snowy:
            c.rect(11 - width // 2, top + 1, width, 1, "l")
            c.rect(11 - width, top + 6, width // 2, 1, "L")
            c.rect(12 + width // 2, top + 6, width // 2, 1, "l")
    if snowy:
        c.set(11, 1, "l")
    return c.outlined()


def oak() -> Image:
    c = Canvas(34, 36)
    c.rect(15, 20, 5, 15, "B")
    c.line(17, 26, 10, 19, "B", 2)
    c.line(18, 24, 25, 18, "B", 2)
    rng = random.Random(61)
    for _ in range(14):
        c.ellipse(rng.randrange(6, 29), rng.randrange(4, 21), rng.randrange(4, 7), 4, "x")
    for _ in range(10):
        c.ellipse(rng.randrange(7, 25), rng.randrange(4, 15), 3, 2.5, "X")
    for _ in range(6):
        c.set(rng.randrange(8, 24), rng.randrange(4, 12), "E")
    return c.outlined()


def bush() -> Image:
    c = Canvas(20, 13)
    rng = random.Random(62)
    for _ in range(7):
        c.ellipse(rng.randrange(4, 16), rng.randrange(5, 10), 4, 3.4, "X")
    for _ in range(4):
        c.ellipse(rng.randrange(5, 14), rng.randrange(4, 7), 2, 1.6, "E")
    c.set(6, 8, "O")
    c.set(13, 6, "O")
    return c.outlined()


def fallen_log() -> Image:
    c = Canvas(38, 13)
    c.rect(4, 3, 30, 8, "B")
    c.rect(4, 3, 30, 2, "c")
    for x in range(8, 32, 6):
        c.line(x, 6, x + 3, 9, "b")
    c.ellipse(34, 7, 3, 4, "c")
    c.ellipse(34, 7, 1.6, 2.4, "B")
    c.ellipse(10, 3, 3, 1.4, "X")
    c.ellipse(24, 3, 2, 1.2, "E")
    return c.outlined()


def fern() -> Image:
    c = Canvas(16, 12)
    for angle in (-60, -30, 0, 30, 60):
        tip_x = 8 + round(math.sin(math.radians(angle)) * 7)
        tip_y = 11 - round(math.cos(math.radians(angle)) * 9)
        c.line(8, 11, tip_x, tip_y, "X")
        c.set(tip_x, tip_y, "E")
    return c.outlined()


def pillar() -> Image:
    c = Canvas(18, 36)
    c.rect(2, 31, 14, 4, "Z")
    c.rect(4, 6, 10, 26, "z")
    c.rect(5, 6, 3, 26, "n")
    c.rect(2, 2, 14, 5, "Z")
    c.rect(3, 2, 12, 2, "z")
    c.line(10, 12, 12, 20, "Z")
    c.line(12, 20, 10, 26, "Z")
    c.ellipse(9, 33, 6, 1.4, "X")
    return c.outlined()


def torch() -> Image:
    c = Canvas(10, 20)
    c.rect(4, 8, 2, 11, "B")
    c.rect(3, 7, 4, 2, "M")
    c.ellipse(5, 4.5, 3, 4, "o")
    c.ellipse(5, 5.5, 1.8, 2.4, "y")
    c.set(5, 6, "w")
    return c.outlined()


def cobweb() -> Image:
    c = Canvas(20, 20)
    for angle in range(0, 360, 45):
        c.line(10, 10, 10 + round(math.cos(math.radians(angle)) * 9),
               10 + round(math.sin(math.radians(angle)) * 9), "L")
    for radius in (3, 6, 9):
        for angle in range(0, 360, 15):
            c.set(10 + round(math.cos(math.radians(angle)) * radius),
                  10 + round(math.sin(math.radians(angle)) * radius), "n")
    return c.pixels


def skull_pile() -> Image:
    c = Canvas(22, 14)
    for x, y in ((5, 9), (11, 10), (17, 9), (8, 5), (14, 5)):
        c.ellipse(x, y, 3.2, 2.8, "w")
        c.set(x - 1, y, "K")
        c.set(x + 1, y, "K")
        c.rect(x - 1, y + 2, 3, 1, "n")
    return c.outlined()


def spikes() -> Image:
    c = Canvas(24, 16)
    c.rect(1, 9, 22, 6, "Z")
    c.rect(2, 10, 20, 4, "K")
    for x in range(3, 22, 4):
        c.line(x, 13, x + 1, 4, "m", 2)
        c.set(x + 1, 3, "n")
    return c.outlined()


def snowdrift() -> Image:
    c = Canvas(32, 14)
    c.ellipse(16, 10, 15, 5, "L")
    c.ellipse(13, 8, 10, 4, "l")
    c.ellipse(23, 9, 6, 3, "l")
    return c.outlined()


def snowman() -> Image:
    c = Canvas(16, 24)
    c.ellipse(8, 18, 6, 5, "l")
    c.ellipse(8, 10, 4.6, 4.2, "l")
    c.ellipse(8, 4.5, 3.4, 3.2, "l")
    c.ellipse(7, 17, 3, 2, "L")
    c.set(7, 4, "K")
    c.set(9, 4, "K")
    c.line(10, 5, 13, 6, "o")
    c.rect(4, 7, 9, 2, "O")
    c.rect(10, 8, 2, 4, "O")
    c.set(8, 10, "K")
    c.set(8, 13, "K")
    c.line(4, 10, 0, 7, "B")
    c.line(12, 10, 15, 7, "B")
    c.rect(5, 0, 6, 2, "k")
    return c.outlined()


def ice_crystal() -> Image:
    c = Canvas(20, 24)
    for x, top, char in ((6, 9, "I"), (10, 2, "i"), (14, 11, "I")):
        c.line(x, 22, x, top, char, 4)
        c.line(x - 1, 22, x - 1, top + 1, "l")
    c.set(10, 2, "w")
    return c.outlined()


def frozen_car() -> Image:
    c = Canvas(40, 22)
    c.rect(3, 9, 34, 9, "j")
    c.rect(9, 3, 20, 7, "j")
    c.rect(11, 4, 7, 5, "I")
    c.rect(20, 4, 7, 5, "I")
    c.ellipse(10, 18, 3.4, 3.4, "K")
    c.ellipse(30, 18, 3.4, 3.4, "K")
    c.rect(9, 2, 20, 2, "l")
    c.rect(3, 8, 34, 2, "l")
    c.rect(1, 18, 38, 3, "L")
    for x in (6, 15, 33):
        c.line(x, 10, x, 13, "i")
    return c.outlined()


def cow_skull() -> Image:
    c = Canvas(20, 12)
    c.ellipse(10, 7, 4, 3.4, "w")
    c.rect(8, 9, 5, 2, "n")
    c.set(8, 6, "K")
    c.set(12, 6, "K")
    c.line(6, 5, 1, 2, "s", 2)
    c.line(14, 5, 19, 2, "s", 2)
    return c.outlined()


def palm() -> Image:
    c = Canvas(30, 38)
    for y in range(10, 37):
        x = 14 + round(math.sin(y * 0.12) * 2)
        c.rect(x, y, 3, 1, "B" if y % 3 else "c")
    for angle in (-150, -110, -70, -30, 10):
        for step in range(1, 13):
            x = 15 + round(math.cos(math.radians(angle)) * step)
            y = 10 + round(math.sin(math.radians(angle)) * step * 0.6 + step * step * 0.04)
            c.set(x, y, "X")
            c.set(x, y + 1, "x")
    c.ellipse(15, 11, 2, 2, "B")
    c.set(14, 12, "Y")
    return c.outlined()


def sandstone() -> Image:
    c = Canvas(30, 22)
    c.ellipse(15, 14, 14, 7, "Y")
    c.ellipse(13, 11, 11, 7, "V")
    c.ellipse(20, 9, 6, 5, "V")
    for y in (9, 13, 16):
        c.line(5, y, 25, y + 1, "Y")
    c.ellipse(11, 7, 3, 1.6, "s")
    return c.outlined()


def cave_rock() -> Image:
    c = Canvas(26, 18)
    c.ellipse(13, 12, 12, 6, "Z")
    c.ellipse(11, 9, 8, 6, "z")
    c.ellipse(19, 10, 5, 4, "z")
    c.ellipse(9, 7, 3, 1.6, "n")
    c.set(17, 8, "I")
    return c.outlined()


def objects() -> dict[str, Image]:
    makers: dict[str, Callable[[], Image]] = {
        "barbed_wire": barbed_wire, "tank_wreck": tank_wreck, "watchtower": watchtower,
        "ammo_crates": ammo_crates, "bunker": bunker, "hedgehog": hedgehog,
        "pine": pine, "snow_pine": lambda: pine(True), "oak": oak, "bush": bush,
        "fallen_log": fallen_log, "fern": fern, "pillar": pillar, "torch": torch,
        "cobweb": cobweb, "skull_pile": skull_pile, "spikes": spikes, "snowdrift": snowdrift,
        "snowman": snowman, "ice_crystal": ice_crystal, "frozen_car": frozen_car,
        "cow_skull": cow_skull, "palm": palm, "sandstone": sandstone, "cave_rock": cave_rock,
    }
    return {f"decor/{name}": maker() for name, maker in makers.items()}


def patches() -> dict[str, Image]:
    return {
        "decor/helipad": helipad(),
        "decor/concrete_pad": blotch(56, 32, 21, "nzm", 0.08),
        "decor/leaf_litter": blotch(48, 28, 22, "BcXo", 0.5),
        "decor/forest_moss": blotch(40, 24, 23, "xXE", 0.45),
        "decor/pond": blotch(56, 30, 24, "jIj"),
        "decor/flagstones": flagstones(),
        "decor/dark_water": blotch(52, 28, 25, "jKj"),
        "decor/ember_pit": blotch(36, 22, 26, "Kory", 0.3),
        "decor/ice_sheet": blotch(58, 30, 27, "iIl", 0.15),
        "decor/snow_patch": blotch(52, 28, 28, "lLl", 0.2),
        "decor/frost_vent": blotch(30, 20, 29, "Ijil", 0.3),
        "decor/quicksand": blotch(50, 28, 30, "YVY", 0.2),
        "decor/sand_ripples": sand_ripples(),
        "decor/scorched_sand": blotch(40, 22, 31, "YeK", 0.4),
    }


def helipad() -> Image:
    c = Canvas(56, 36)
    c.ellipse(28, 18, 27, 17, "z")
    c.ellipse(28, 18, 22, 13, "n")
    c.ellipse(28, 18, 20, 11, "z")
    c.rect(20, 10, 3, 16, "y")
    c.rect(33, 10, 3, 16, "y")
    c.rect(20, 17, 16, 3, "y")
    return c.pixels


def flagstones() -> Image:
    c = Canvas(56, 32)
    rng = random.Random(32)
    for y in range(0, 32, 8):
        offset = 0 if (y // 8) % 2 else 6
        for x in range(-offset, 56, 12):
            dx, dy = (x + 6 - 28) / 28, (y + 4 - 16) / 16
            if dx * dx + dy * dy > 0.95:
                continue
            c.rect(x, y, 11, 7, rng.choice("zzZ"))
            c.rect(x, y, 11, 1, "n")
    return c.pixels


def sand_ripples() -> Image:
    c = Canvas(56, 26)
    for y in range(3, 24, 4):
        for x in range(56):
            dx, dy = (x - 28) / 28, (y - 13) / 13
            if dx * dx + dy * dy <= 0.95:
                c.set(x, y + round(math.sin(x * 0.35 + y) * 1.2), "V")
    return c.pixels


# --- ground tiles (128x128, seamless) ------------------------------------------------


def noisy_ground(seed: int, chars: str, cuts: tuple[float, float]) -> Image:
    """Three tones of periodic noise: light above cuts[1], dark below cuts[0]."""
    size = 128
    rng = random.Random(seed)
    noise = periodic_noise(size, 4, rng)
    base, light, dark = (color(char) for char in chars)
    return [[light if (value := noise(x, y) + (rng.random() - 0.5) * 0.12) > cuts[1]
             else dark if value < cuts[0] else base for x in range(size)] for y in range(size)]


def scatter(image: Image, rng: random.Random, chars: str, count: int) -> None:
    size = len(image)
    for _ in range(count):
        image[rng.randrange(size)][rng.randrange(size)] = color(rng.choice(chars))


def military_ground() -> Image:
    """Packed khaki dirt with tyre ruts and gravel."""
    image = noisy_ground(3101, "eHd", (0.25, 0.72))
    rng = random.Random(3102)
    scatter(image, rng, "dkn", 260)
    for start in (30, 92):
        for x in range(128):
            for offset in (0, 10):
                y = (start + offset + round(math.sin(x / 128 * math.tau) * 6)) % 128
                if x % 3:
                    image[y][x] = color("k")
    return image


def forest_ground() -> Image:
    """Dark forest floor: moss, needles and fallen leaves."""
    image = noisy_ground(3201, "xXU", (0.22, 0.8))
    rng = random.Random(3202)
    scatter(image, rng, "BcEU", 420)
    for _ in range(30):
        x, y = rng.randrange(128), rng.randrange(128)
        for step in range(3):
            image[(y + step) % 128][(x + step) % 128] = color("b")
    return image


def dungeon_ground() -> Image:
    """Worn stone tiles with dark joints and damp moss."""
    image = noisy_ground(3301, "zZz", (0.3, 0.75))
    rng = random.Random(3302)
    joint = color("K")
    for y in range(128):
        for x in range(128):
            row = y // 16
            if y % 16 == 0 or (x + (8 if row % 2 else 0)) % 32 == 0:
                image[y][x] = joint
            elif y % 16 == 1:
                image[y][x] = color("n") if rng.random() < 0.3 else image[y][x]
    scatter(image, rng, "ZxA", 220)
    return image


def snow_ground() -> Image:
    """Wind-packed snow with blue shadows and icy glints."""
    image = noisy_ground(3401, "LlW", (0.28, 0.8))
    rng = random.Random(3402)
    scatter(image, rng, "iWl", 260)
    for _ in range(12):
        x, y = rng.randrange(128), rng.randrange(128)
        for step in range(rng.randrange(6, 14)):
            image[y % 128][(x + step) % 128] = color("W")
            y += rng.choice((0, 0, 1))
    return image


def desert_ground() -> Image:
    """Hot ochre sand with wavy ripples and pebbles."""
    image = noisy_ground(3501, "VsY", (0.22, 0.84))
    rng = random.Random(3502)
    for row in range(0, 128, 16):
        for x in range(128):
            y = (row + round(math.sin(x / 128 * math.tau * 2 + row) * 2)) % 128
            if rng.random() < 0.55:
                image[y][x] = color("Y")
    scatter(image, rng, "eS", 120)
    return image


GROUNDS: dict[str, Callable[[], Image]] = {
    "military": military_ground, "forest": forest_ground, "dungeon": dungeon_ground,
    "snow": snow_ground, "desert": desert_ground,
}

#: Animated enemies: draw function, death residue colour, seed.
ENEMIES: dict[str, tuple[Draw, str, int]] = {
    "soldier": (soldier, "R", 301), "sentry_drone": (sentry_drone, "M", 302),
    "mine_crawler": (mine_crawler, "k", 303), "mutant_wolf": (wolf, "R", 304),
    "tick": (tick, "O", 305), "spore_shroom": (spore_shroom, "c", 306),
    "cave_rat": (cave_rat, "R", 307), "cave_spider": (cave_spider, "P", 308),
    "blind_digger": (blind_digger, "e", 309), "snow_beast": (snow_beast, "I", 310),
    "ice_beetle": (ice_beetle, "I", 311), "frost_shooter": (frost_shooter, "j", 312),
    "polar_wolf": (polar_wolf, "R", 313), "vulture": (vulture, "b", 314),
    "sand_worm": (sand_worm, "Y", 315), "nomad": (nomad, "R", 316),
    "bear": (bear, "R", 317), "spider_queen": (spider_queen, "P", 318),
    "ice_golem": (ice_golem, "I", 319), "scorpion_king": (scorpion_king, "Y", 320),
    "steel_general": (steel_general, "M", 321), "forest_lord": (forest_lord, "b", 322),
    "rat_king": (rat_king, "R", 323), "frost_queen": (frost_queen, "I", 324),
    "sand_leviathan": (sand_leviathan, "Y", 325),
}


# --- one-run boosts (16x16 icons) ------------------------------------------------------


def boost_icons() -> dict[str, Image]:
    def stim(c: Canvas) -> None:
        c.line(3, 13, 11, 5, "n", 3)
        c.line(4, 12, 10, 6, "O", 1)
        c.line(11, 5, 14, 2, "m")
        c.rect(1, 13, 3, 2, "M")
        c.set(9, 6, "J")

    def armor(c: Canvas) -> None:
        c.rect(3, 3, 10, 11, "H")
        c.rect(3, 3, 3, 3, "k")
        c.rect(10, 3, 3, 3, "k")
        c.rect(6, 2, 4, 3, "K")
        c.rect(4, 7, 8, 1, "h")
        c.rect(4, 10, 8, 1, "h")
        c.rect(7, 6, 2, 7, "M")

    def heart(c: Canvas) -> None:
        c.ellipse(5.5, 6, 3.4, 3.4, "O")
        c.ellipse(10.5, 6, 3.4, 3.4, "O")
        for y in range(7, 14):
            half = 13 - y
            c.rect(8 - half, y, half * 2, 1, "O")
        c.ellipse(5, 5, 1.4, 1.4, "J")
        c.line(9, 8, 13, 12, "y")
        c.set(13, 13, "w")

    def bag(c: Canvas) -> None:
        c.ellipse(8, 10, 6, 5, "B")
        c.ellipse(7, 9, 4, 3, "c")
        c.rect(6, 3, 4, 3, "B")
        c.rect(5, 5, 6, 1, "y")
        c.ellipse(8, 11, 2.4, 2.4, "O")
        c.set(8, 11, "y")

    def notes(c: Canvas) -> None:
        c.rect(3, 2, 10, 13, "w")
        c.rect(3, 2, 2, 13, "t")
        for y in (5, 8, 11):
            c.rect(6, y, 6, 1, "M")
        c.line(9, 12, 14, 7, "y", 2)

    def foot(c: Canvas) -> None:
        c.ellipse(8, 10, 4, 4.4, "w")
        c.ellipse(8, 11, 2.6, 2.6, "N")
        for x in (5, 8, 11):
            c.ellipse(x, 5, 1.4, 1.6, "N")
        c.line(8, 14, 8, 15, "y")
        c.rect(6, 14, 5, 1, "y")

    def boots(c: Canvas) -> None:
        c.rect(3, 4, 5, 8, "B")
        c.rect(3, 11, 9, 3, "b")
        c.rect(8, 11, 4, 3, "B")
        c.rect(2, 6, 2, 5, "M")
        c.set(1, 12, "o")
        c.set(1, 13, "y")
        c.set(2, 14, "o")
        c.rect(3, 4, 5, 1, "c")

    draws = {"combat_stim": stim, "body_armor": armor, "spare_heart": heart, "caps_bag": bag,
             "cram_notes": notes, "rabbit_foot": foot, "jet_boots": boots}
    result = {}
    for name, draw in draws.items():
        c = Canvas(16, 16)
        draw(c)
        result[f"boosts/{name}"] = c.outlined()
    return result


def frames() -> dict[str, Image]:
    return {
        **objects(), **patches(), **boost_icons(),
        "projectiles/spit": acid_spit(), "projectiles/ice_shard": ice_shard(),
        "projectiles/spore": spore(), "projectiles/sand": sand_blast(),
        "ui/cap": cap(), "pickups/cap": cap(),
    }
