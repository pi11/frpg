"""Procedural pixel art for the city and marsh locations (CC0, original).

Every sprite faces right (the game flips it), walk cycles have four frames and all
randomness is seeded, so rebuilding gives identical bytes.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable

import art
from shapes import CLEAR, Canvas, Image, color

# --- city enemies ------------------------------------------------------------------


def wild_dog(frame: int) -> Image:
    """16x16 feral dog: lean body, raised hackles, running legs."""
    c = Canvas(16, 16)
    bob = (0, -1, 0, -1)[frame]
    legs = ((2, -2, 1, -1), (0, 0, 0, 0), (-2, 2, -1, 1), (0, 0, 0, 0))[frame]
    for index, (x, swing) in enumerate(zip((4, 6, 10, 12), legs, strict=True)):
        c.line(x, 10 + bob, x + swing, 13, "b" if index % 2 else "B")
    c.ellipse(8, 8.5 + bob, 5.5, 2.6, "B")
    c.rect(4, 7 + bob, 8, 1, "c")  # back highlight
    c.line(2, 7 + bob, 0, 4 + bob, "B")  # tail
    c.ellipse(12.5, 6.5 + bob, 2.4, 2, "B")  # head
    c.rect(13, 7 + bob, 3, 1, "b")  # snout
    c.set(12, 4 + bob, "b")  # ear
    c.set(13, 6 + bob, "o")  # eye
    c.set(15, 8 + bob, "w")  # teeth
    for x in (6, 8, 10):  # hackles
        c.set(x, 6 + bob, "b")
    return c.outlined()


def rad_bat(frame: int) -> Image:
    """16x16 mutant bat: purple body, wing flap cycle, glowing eyes."""
    c = Canvas(16, 16)
    lift = (-4, -1, 3, -1)[frame]
    for side in (-1, 1):
        tip_x = 8 + side * 7
        c.line(8, 8, tip_x, 8 + lift, "P", 2)
        c.line(8 + side * 2, 9, tip_x, 8 + lift, "p")
        c.line(tip_x, 8 + lift, 8 + side * 4, 10 + lift // 2, "P")
    c.ellipse(8, 8.5, 2.5, 3, "p")
    c.set(7, 5, "P")
    c.set(9, 5, "P")
    c.set(7, 7, "g")
    c.set(9, 7, "g")
    c.set(8, 10, "v")
    return c.outlined()


def medic(frame: int) -> Image:
    """16x16 wasteland medic: hooded coat with a green cross bag and a syringe."""
    c = Canvas(16, 16)
    step = (1, 0, -1, 0)[frame]
    c.line(6, 11, 6 - step, 14, "k", 2)
    c.line(9, 11, 9 + step, 14, "k", 2)
    c.rect(5, 6, 6, 6, "n")  # coat
    c.rect(5, 10, 6, 2, "m")
    c.ellipse(8, 4, 2.6, 2.6, "t")  # hood
    c.rect(8, 3, 2, 2, "f")  # face
    c.set(9, 3, "K")
    c.rect(3, 7, 3, 3, "h")  # bag
    c.set(4, 8, "g")
    c.set(4, 7, "G")
    c.set(4, 9, "G")
    c.line(11, 8, 14, 6, "m")  # syringe
    c.set(14, 6, "g")
    return c.outlined()


def riot_mech(frame: int) -> Image:
    """24x24 elite: walking riot mech with a plated shield in front."""
    c = Canvas(24, 24)
    step = (2, 0, -2, 0)[frame]
    c.line(8, 15, 7 - step, 21, "M", 3)
    c.line(14, 15, 15 + step, 21, "M", 3)
    c.rect(5 - step, 21, 5, 2, "A")
    c.rect(13 + step, 21, 5, 2, "A")
    c.rect(5, 6, 12, 10, "H")  # hull
    c.rect(6, 7, 10, 3, "h")
    c.rect(8, 3, 6, 4, "M")  # cabin
    c.rect(10, 4, 3, 1, "o")  # visor
    c.rect(17, 5, 4, 14, "m")  # shield
    c.rect(18, 6, 2, 12, "n")
    for y in (8, 12, 16):
        c.rect(17, y, 4, 1, "M")
    c.set(4, 9, "y")  # warning light
    return c.outlined()


def iron_mayor(frame: int) -> Image:
    """48x48 boss: a walking city machine with a chimney hat, sash and cannon arms."""
    c = Canvas(48, 48)
    rng = random.Random(1961)
    step = (3, 0, -3, 0)[frame]
    # legs
    c.line(17, 32, 15 - step, 44, "M", 5)
    c.line(30, 32, 32 + step, 44, "M", 5)
    c.rect(11 - step, 43, 9, 3, "A")
    c.rect(28 + step, 43, 9, 3, "A")
    # cannon arms
    swing = (0, 1, 0, -1)[frame]
    c.line(9, 20, 3, 28 + swing, "M", 4)
    c.rect(0, 27 + swing, 6, 4, "a")
    c.line(39, 20, 45, 28 - swing, "M", 4)
    c.rect(42, 27 - swing, 6, 4, "a")
    # torso of riveted plates
    c.ellipse(24, 24, 15, 11, "m")
    for _ in range(12):
        x, y = rng.randrange(12, 36), rng.randrange(16, 33)
        if ((x - 24) / 14) ** 2 + ((y - 24) / 10) ** 2 < 0.8:
            c.rect(x, y, rng.randrange(3, 6), 2, rng.choice("nMa"))
    c.line(13, 17, 33, 32, "r", 3)  # sash
    c.line(14, 17, 34, 32, "o")
    c.ellipse(24, 26, 4, 4, "y")  # medal
    c.set(24, 26, "o")
    # head with a chimney top hat
    c.ellipse(24, 11, 8, 5, "n")
    c.rect(18, 10, 12, 3, "A")
    c.rect(20, 11, 3, 1, "o")
    c.rect(26, 11, 3, 1, "o")
    c.rect(17, 6, 14, 2, "k")  # brim
    c.rect(19, 0, 10, 6, "k")
    c.rect(19, 4, 10, 1, "r")
    rng2 = random.Random(frame)
    for _ in range(3):  # smoke puffs
        c.set(22 + rng2.randrange(4), rng2.randrange(0, 2), "m")
    return c.outlined()


# --- marsh enemies -----------------------------------------------------------------


def slime(frame: int, size: int, core: str = "G") -> Image:
    """Glowing blob that squashes as it crawls; `size` is the canvas edge."""
    c = Canvas(size, size)
    squash = (0.0, 0.08, 0.14, 0.08)[frame]
    rx = size * (0.4 + squash)
    ry = size * (0.34 - squash * 0.8)
    cy = size - ry - 1.5
    c.ellipse(size / 2, cy, rx, ry, core)
    c.ellipse(size / 2 - 0.5, cy - 0.5, rx - 1.5, ry - 1.5, "g")
    c.ellipse(size / 2 + 1, cy + ry * 0.2, rx * 0.35, ry * 0.35, core)  # dark core
    c.set(round(size / 2 - rx * 0.4), round(cy - ry * 0.5), "w")  # shine
    c.set(round(size / 2 + rx * 0.3), round(cy - ry * 0.1), "K")  # eyes
    c.set(round(size / 2 + rx * 0.55), round(cy - ry * 0.1), "K")
    return c.outlined()


def slime_queen(frame: int) -> Image:
    image = slime(frame, 24, "T")
    crown = Canvas(24, 24)
    lift = (0, 1, 2, 1)[frame]
    for index, x in enumerate((8, 11, 14, 17)):
        crown.line(x, 7 + lift, x, 4 + lift - index % 2, "y")
    crown.rect(8, 7 + lift, 10, 1, "o")
    for y, row in enumerate(crown.pixels):
        for x, pixel in enumerate(row):
            if pixel[3]:
                image[y][x] = pixel
    return image


def worm(frame: int, size: int) -> Image:
    """Mire worm rearing out of a mud mound; the body sways with the frame."""
    c = Canvas(size, size)
    unit = size / 16
    sway = (0, 1, 0, -1)[frame] * unit
    c.ellipse(size / 2, size - 2.5 * unit, 6.5 * unit, 2.2 * unit, "u")  # mound
    c.ellipse(size / 2, size - 3 * unit, 5 * unit, 1.2 * unit, "U")
    segments = 5
    for index in range(segments):
        t = index / (segments - 1)
        x = size / 2 + math.sin(t * 2.4) * sway * 2 + t * 2 * unit
        y = size - 3.5 * unit - t * 9 * unit
        radius = (2.6 - t * 0.7) * unit
        c.ellipse(x, y, radius, radius, "F" if index % 2 else "f")
    head_x = size / 2 + math.sin(2.4) * sway * 2 + 2 * unit
    head_y = size - 12.5 * unit
    c.ellipse(head_x + unit, head_y, 1.4 * unit, 1.2 * unit, "R")  # maw
    c.set(round(head_x + 2 * unit), round(head_y - unit), "w")
    c.set(round(head_x + 2 * unit), round(head_y + unit), "w")
    return c.outlined()


def toad(frame: int) -> Image:
    """16x16 swollen toad with glowing warts; hops by stretching its legs."""
    c = Canvas(16, 16)
    hop = (0, -1, -2, -1)[frame]
    stretch = (0, 1, 2, 1)[frame]
    c.line(4, 12 + hop, 2 - stretch, 14, "T", 2)  # hind leg
    c.line(11, 12 + hop, 12, 14, "T")
    c.ellipse(8, 10 + hop, 5.5, 3.6, "T")
    c.ellipse(8, 9 + hop, 4.5, 2.5, "t")
    c.ellipse(11, 7 + hop, 2.6, 2, "t")  # head
    c.set(11, 6 + hop, "y")  # eye
    c.set(12, 6 + hop, "K")
    c.rect(11, 9 + hop, 4, 1, "T")  # mouth
    for x, y in ((5, 9), (8, 8), (6, 11)):
        c.set(x, y + hop, "g")
    return c.outlined()


def marsh_mother(frame: int) -> Image:
    """48x48 boss: a bloated swamp mother covered in eyes and glowing sacs."""
    c = Canvas(48, 48)
    rng = random.Random(77)
    pulse = (0, 1, 2, 1)[frame]
    for index in range(4):  # tentacle legs
        x = 10 + index * 9
        sway = ((index + frame) % 4 - 1.5)
        c.line(x, 36, round(x + sway * 2), 46, "P", 3)
    c.ellipse(24, 26, 19 + pulse * 0.5, 15 + pulse * 0.5, "P")
    c.ellipse(23, 24, 16, 12, "p")
    for _ in range(9):  # glowing sacs
        x, y = rng.randrange(10, 38), rng.randrange(16, 36)
        if ((x - 24) / 17) ** 2 + ((y - 26) / 13) ** 2 < 0.75:
            c.ellipse(x, y, 2.2, 2.2, "G")
            c.set(x, y, "g")
    eyes = ((30, 15), (36, 19), (25, 13), (34, 26))
    for index, (x, y) in enumerate(eyes):
        c.ellipse(x, y, 2.6, 2.6, "w")
        c.set(x + (1 if (frame + index) % 2 else 0), y, "K")
    c.ellipse(38, 31, 5, 2.5, "R")  # maw
    for x in range(35, 42, 2):
        c.set(x, 30, "w")
    c.set(14, 18, "v")
    c.set(15, 17, "v")
    return c.outlined()


# --- effects and projectiles -------------------------------------------------------


def dust(frame: int) -> Image:
    """24x24 ground burst for a surfacing worm."""
    c = Canvas(24, 24)
    rng = random.Random(90 + frame)
    radius = (4, 7, 10, 11, 12)[frame]
    for _ in range(28 - frame * 3):
        angle = rng.uniform(0, math.tau)
        distance = rng.uniform(radius * 0.5, radius)
        x = round(12 + math.cos(angle) * distance)
        y = round(12 + math.sin(angle) * distance * 0.7)
        c.rect(x, y, 2, 2, rng.choice("uUde" if frame < 3 else "ue"))
    return c.pixels


def heal_ring(frame: int) -> Image:
    """20x20 expanding green ring with little crosses (enemy healer pulse)."""
    c = Canvas(20, 20)
    radius = (3, 5, 7, 9)[frame]
    for step in range(28):
        angle = step / 28 * math.tau
        c.set(round(10 + math.cos(angle) * radius), round(10 + math.sin(angle) * radius),
              "g" if frame < 3 else "G")
    for x, y in ((10, 10 - radius // 2), (10 - radius // 2, 11)):
        c.set(x, y, "g")
        c.set(x - 1, y, "G")
        c.set(x + 1, y, "G")
        c.set(x, y - 1, "G")
        c.set(x, y + 1, "G")
    return c.pixels


def spit() -> Image:
    c = Canvas(7, 7)
    c.ellipse(3.5, 3.5, 3, 3, "G")
    c.ellipse(3, 3, 2, 2, "g")
    c.set(2, 2, "w")
    return c.pixels


# --- decor ---------------------------------------------------------------------------


def concrete_block() -> Image:
    c = Canvas(18, 14)
    c.rect(1, 3, 16, 10, "M")
    c.rect(1, 3, 16, 3, "n")
    c.rect(3, 6, 2, 2, "a")  # rebar holes
    c.rect(12, 7, 2, 2, "a")
    c.line(14, 2, 16, 0, "r")
    c.line(4, 2, 3, 0, "r")
    return c.outlined()


def lamp_post() -> Image:
    c = Canvas(12, 30)
    c.rect(5, 6, 2, 22, "M")
    c.rect(3, 27, 6, 2, "a")
    c.line(6, 6, 10, 3, "M", 2)
    c.rect(8, 3, 4, 2, "m")
    c.set(10, 5, "y")
    return c.outlined()


def ruin_wall() -> Image:
    c = Canvas(36, 26)
    rng = random.Random(5)
    heights = [rng.randrange(6, 20) for _ in range(9)]
    for column, height in enumerate(heights):
        for row in range(height):
            y = 24 - row
            for x in range(column * 4, column * 4 + 4):
                offset = 2 if (y // 3) % 2 else 0
                c.set(x, y, "R" if (x + offset) % 4 == 0 or y % 3 == 0 else "r")
    for y in range(12, 17):  # window hole
        for x in range(10, 16):
            c.pixels[y][x] = CLEAR
    return c.outlined()


def rubble() -> Image:
    c = Canvas(32, 20)
    rng = random.Random(14)
    for _ in range(30):
        x, y = rng.randrange(2, 30), rng.randrange(3, 18)
        if ((x - 16) / 15) ** 2 + ((y - 10) / 8) ** 2 > 1:
            continue
        c.rect(x, y, rng.randrange(1, 4), rng.randrange(1, 3), rng.choice("nmMaR"))
    return c.pixels


def oil_puddle() -> Image:
    c = Canvas(30, 14)
    c.ellipse(15, 7, 14.5, 6.5, "A")
    c.ellipse(14, 7, 11, 4.5, "k")
    c.rect(9, 5, 3, 1, "p")
    c.rect(16, 8, 4, 1, "t")
    return c.pixels


def reeds() -> Image:
    c = Canvas(16, 22)
    rng = random.Random(21)
    for index in range(6):
        x = 2 + index * 2 + rng.randrange(2)
        top = rng.randrange(2, 9)
        c.line(x, 21, x + rng.choice((-1, 0, 1)), top, "h" if index % 2 else "H")
        if index % 2 == 0:
            c.rect(x - 1 + rng.choice((-1, 0, 1)) // 2, top, 2, 3, "B")
    return c.outlined()


def stump() -> Image:
    c = Canvas(16, 14)
    c.rect(3, 5, 10, 8, "B")
    c.rect(4, 6, 2, 6, "b")
    c.ellipse(8, 5, 5, 1.6, "c")
    c.ellipse(8, 5, 2.5, 0.8, "b")
    c.line(2, 13, 0, 13, "b")
    c.line(13, 12, 15, 13, "b")
    c.set(11, 9, "g")  # glowing moss
    c.set(5, 11, "g")
    return c.outlined()


def mushrooms() -> Image:
    c = Canvas(14, 12)
    for x, y, r in ((4, 5, 3.2), (10, 7, 2.6), (7, 9, 1.8)):
        c.line(round(x), round(y), round(x), 11, "s")
        c.ellipse(x, y, r, r * 0.6, "p")
        c.set(round(x - 1), round(y - 1), "g")
    return c.outlined()


def toxic_pool() -> Image:
    c = Canvas(40, 22)
    c.ellipse(20, 11, 19.5, 10, "U")
    c.ellipse(20, 11, 17, 8, "G")
    c.ellipse(19, 10, 13, 5.5, "g")
    rng = random.Random(8)
    for _ in range(6):
        c.set(rng.randrange(10, 30), rng.randrange(6, 16), "w")
    return c.pixels


def moss() -> Image:
    c = Canvas(40, 20)
    rng = random.Random(31)
    for _ in range(140):
        x, y = rng.randrange(40), rng.randrange(20)
        if ((x - 20) / 19) ** 2 + ((y - 10) / 9) ** 2 + rng.uniform(-0.2, 0.2) <= 1:
            c.set(x, y, rng.choice("TTHu"))
    return c.pixels


# --- ground tiles --------------------------------------------------------------------


def periodic_noise(size: int, cells: int, rng: random.Random) -> Callable[[int, int], float]:
    """Smooth value noise on a `cells` grid that wraps, so tiles are seamless."""
    grid = [[rng.random() for _ in range(cells)] for _ in range(cells)]

    def noise(x: int, y: int) -> float:
        fx, fy = x * cells / size, y * cells / size
        x0, y0 = int(fx), int(fy)
        tx, ty = fx - x0, fy - y0
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        a = grid[y0 % cells][x0 % cells]
        b = grid[y0 % cells][(x0 + 1) % cells]
        c = grid[(y0 + 1) % cells][x0 % cells]
        d = grid[(y0 + 1) % cells][(x0 + 1) % cells]
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

    return noise


def city_ground(size: int = 128) -> Image:
    """Seamless cracked concrete slabs with grime and weeds."""
    rng = random.Random(1999)
    noise = periodic_noise(size, 4, rng)
    base, light, dark = (art.PALETTE[c] for c in "aMA")
    image: Image = []
    for y in range(size):
        row = []
        for x in range(size):
            value = noise(x, y) + (rng.random() - 0.5) * 0.1
            tone = light if value > 0.72 else dark if value < 0.18 else base
            row.append((*tone, 255))
        image.append(row)
    seam = (*art.PALETTE["k"], 255)
    for i in range(size):  # slab joints every 32 px
        for line in range(0, size, 32):
            image[line][i] = seam
            image[i][line] = seam
    crack = (*art.PALETTE["k"], 255)
    for _ in range(6):
        x, y = rng.randrange(size), rng.randrange(size)
        for _ in range(rng.randrange(8, 18)):
            image[y % size][x % size] = crack
            x += rng.choice((-1, 0, 1, 1))
            y += rng.choice((-1, 0, 1))
    weed = [(*art.PALETTE[c], 255) for c in "Hh"]
    for _ in range(4):
        x, y = rng.randrange(0, size, 32), rng.randrange(size)
        for dy in range(3):
            image[(y + dy) % size][x] = weed[dy % 2]
    return image


def marsh_ground(size: int = 128) -> Image:
    """Seamless dark mud with damp patches and glowing specks."""
    rng = random.Random(2077)
    noise = periodic_noise(size, 4, rng)
    base, light, dark = (art.PALETTE[c] for c in "uHU")
    image: Image = []
    for y in range(size):
        row = []
        for x in range(size):
            value = noise(x, y) + (rng.random() - 0.5) * 0.12
            tone = light if value > 0.72 else dark if value < 0.3 else base
            row.append((*tone, 255))
        image.append(row)
    for _ in range(int(size * size * 0.015)):
        x, y = rng.randrange(size), rng.randrange(size)
        image[y][x] = (*rng.choice((art.PALETTE["T"], art.PALETTE["U"])), 255)
    for _ in range(10):
        x, y = rng.randrange(size), rng.randrange(size)
        image[y][x] = color("G")
    return image
