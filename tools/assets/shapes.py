"""Procedural pixel art for sprites too big to type as pixel maps (CC0, original)."""

from __future__ import annotations

import math
import random

import art

Pixel = tuple[int, int, int, int]
Image = list[list[Pixel]]
CLEAR: Pixel = (0, 0, 0, 0)


def color(char: str, alpha: int = 255) -> Pixel:
    return (*art.PALETTE[char], alpha)


class Canvas:
    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height
        self.pixels: Image = [[CLEAR] * width for _ in range(height)]

    def set(self, x: int, y: int, char: str) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            self.pixels[y][x] = color(char)

    def rect(self, x: int, y: int, width: int, height: int, char: str) -> None:
        for yy in range(y, y + height):
            for xx in range(x, x + width):
                self.set(xx, yy, char)

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, char: str) -> None:
        for y in range(self.height):
            for x in range(self.width):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.set(x, y, char)

    def line(self, x0: int, y0: int, x1: int, y1: int, char: str, width: int = 1) -> None:
        steps = max(abs(x1 - x0), abs(y1 - y0), 1)
        for step in range(steps + 1):
            x = round(x0 + (x1 - x0) * step / steps)
            y = round(y0 + (y1 - y0) * step / steps)
            self.rect(x - width // 2, y - width // 2, width, width, char)

    def outlined(self) -> Image:
        """Copy with a dark outline around every opaque pixel."""
        result = [list(row) for row in self.pixels]
        dark = color("K")
        for y in range(self.height):
            for x in range(self.width):
                if self.pixels[y][x][3]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.width and 0 <= ny < self.height and self.pixels[ny][nx][3]:
                        result[y][x] = dark
                        break
        return result


def junk_king(frame: int) -> Image:
    """48x48 boss: a scrap golem with a rebar crown, one glowing eye and treads."""
    canvas = Canvas(48, 48)
    rng = random.Random(84)
    swing = (0, 1, 0, -1)[frame]
    # treads with moving links
    canvas.rect(8, 38, 32, 7, "M")
    canvas.rect(9, 39, 30, 5, "A")
    for x in range(9 + frame % 2 * 2, 39, 4):
        canvas.rect(x, 39, 2, 5, "m")
    # pipe arms with claws
    canvas.line(10, 22, 3, 31 + swing, "M", 3)
    canvas.line(37, 22, 44, 31 - swing, "M", 3)
    for side, x in ((-1, 3), (1, 44)):
        claw_y = 32 + (swing if side < 0 else -swing)
        canvas.line(x, claw_y, x - 2 * side, claw_y + 4, "m", 2)
        canvas.line(x, claw_y, x + 2 * side, claw_y + 4, "m", 2)
    # body made of rusty plates
    canvas.ellipse(24, 27, 16, 13, "r")
    for _ in range(14):
        x, y = rng.randrange(10, 37), rng.randrange(17, 37)
        if ((x - 24) / 15) ** 2 + ((y - 27) / 12) ** 2 > 0.8:
            continue
        canvas.rect(x, y, rng.randrange(3, 7), rng.randrange(2, 4), rng.choice("RmMrB"))
    canvas.ellipse(24, 30, 9, 6, "R")
    canvas.rect(18, 29, 12, 2, "y")
    # head and eye
    canvas.ellipse(24, 13, 9, 7, "m")
    canvas.ellipse(24, 15, 8, 4, "M")
    canvas.ellipse(26, 12, 3.2, 2.4, "g")
    canvas.set(25, 11, "w")
    canvas.set(26, 11, "w")
    # rebar crown
    for index, x in enumerate((16, 20, 24, 28, 32)):
        top = 2 + (index % 2) * 2
        canvas.line(x, 7, x, top, "y" if index % 2 else "o")
    return canvas.outlined()


def asphalt() -> Image:
    canvas = Canvas(48, 32)
    rng = random.Random(11)
    for y in range(32):
        for x in range(48):
            edge = ((x - 23.5) / 23) ** 2 + ((y - 15.5) / 15) ** 2 + rng.uniform(-0.25, 0.1)
            if edge <= 1:
                canvas.set(x, y, "a" if rng.random() > 0.12 else "A")
    for x in range(6, 42, 8):  # faded lane marking
        canvas.rect(x, 15, 4, 2, "s")
    for _ in range(3):  # cracks
        x, y = rng.randrange(8, 40), rng.randrange(5, 27)
        for _ in range(rng.randrange(5, 10)):
            if canvas.pixels[y][x][3]:
                canvas.set(x, y, "k")
            x += rng.choice((-1, 1, 1))
            y += rng.choice((-1, 0, 1))
    return canvas.pixels


def crater() -> Image:
    canvas = Canvas(36, 24)
    canvas.ellipse(18, 12, 17.5, 11.5, "d")
    canvas.ellipse(18, 12.5, 15, 9, "e")
    canvas.ellipse(18, 13.5, 11, 6, "k")
    canvas.ellipse(16, 11, 5, 2.5, "e")
    rng = random.Random(7)
    for _ in range(14):
        angle = rng.uniform(0, math.tau)
        canvas.set(round(18 + math.cos(angle) * 17), round(12 + math.sin(angle) * 11), "S")
    return canvas.pixels


def rad_puddle(frame: int) -> Image:
    canvas = Canvas(28, 14)
    canvas.ellipse(14, 7, 13.5, 6.5, "G")
    canvas.ellipse(13, 7, 11, 4.5, "g")
    shine = ((7, 5), (12, 4), (18, 6))[frame % 3]
    canvas.rect(shine[0], shine[1], 3, 1, "w")
    rng = random.Random(3 + frame)
    for _ in range(4):
        canvas.set(rng.randrange(4, 24), rng.randrange(3, 11), "G")
    return canvas.pixels


def dune() -> Image:
    canvas = Canvas(48, 20)
    canvas.ellipse(24, 12, 23.5, 8, "S")
    canvas.ellipse(22, 10, 18, 5.5, "s")
    for y, (start, end) in ((9, (10, 30)), (12, (14, 38)), (15, (20, 34))):
        for x in range(start, end, 2):
            canvas.set(x, y, "D")
    return canvas.pixels


def explosion(frame: int) -> Image:
    """32x32 blast: white flash, fireball, then smoke."""
    canvas = Canvas(32, 32)
    rng = random.Random(40 + frame)
    radius = (6, 10, 13, 14, 15)[frame]
    layers = (
        ("w", "y", "o"), ("y", "o", "r"), ("o", "r", "R"), ("M", "R", "k"), ("M", "A", "A"),
    )[frame]
    for index, char in enumerate(layers[::-1]):
        canvas.ellipse(16, 16, radius - index * radius / 3.2, radius - index * radius / 3.2, char)
    if frame >= 3:  # holes in the smoke
        for _ in range(40 + frame * 30):
            canvas.pixels[rng.randrange(32)][rng.randrange(32)] = CLEAR
    return canvas.pixels
