"""Playable heroes (24x28) and the shelter picture: painted parts plus an automatic light pass.

Every hero is drawn facing right from flat shapes; `lit` adds a rim of light from the upper left,
shadow on the lower right and an outline tinted by the colour it borders (CC0, original).
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable

Pixel = tuple[int, int, int, int]
Image = list[list[Pixel]]
Color = tuple[int, int, int]
CLEAR: Pixel = (0, 0, 0, 0)
WIDTH, HEIGHT = 24, 28
WALK_FRAMES, IDLE_FRAMES = 6, 4
# Feet during a step: horizontal shift and lift of the near leg; the far leg is half a cycle away.
STRIDE = ((3, 0), (2, 0), (0, 0), (-2, 0), (-3, 1), (0, 2))
BOB = (0, -1, 0, 0, -1, 0)


def rgb(code: str) -> Color:
    return int(code[0:2], 16), int(code[2:4], 16), int(code[4:6], 16)


def blend(a: Color, b: Color, t: float) -> Color:
    return (round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t),
            round(a[2] + (b[2] - a[2]) * t))


class Paint:
    def __init__(self, width: int = WIDTH, height: int = HEIGHT) -> None:
        self.width, self.height = width, height
        self.pixels: list[list[Color | None]] = [[None] * width for _ in range(height)]
        # Pixels that glow keep their colour in the light pass.
        self.glow: set[tuple[int, int]] = set()

    def set(self, x: int, y: int, code: str, glow: bool = False) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            self.pixels[y][x] = rgb(code)
            (self.glow.add if glow else self.glow.discard)((x, y))

    def rect(self, x: int, y: int, w: int, h: int, code: str, glow: bool = False) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, code, glow)

    def rows(self, y: int, spans: list[tuple[int, int]], code: str) -> None:
        """One horizontal span (first x, last x) per row."""
        for offset, (start, end) in enumerate(spans):
            self.rect(start, y + offset, end - start + 1, 1, code)

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, code: str) -> None:
        for y in range(self.height):
            for x in range(self.width):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.set(x, y, code)

    def line(self, x0: float, y0: float, x1: float, y1: float, code: str, width: int = 1) -> None:
        steps = max(round(max(abs(x1 - x0), abs(y1 - y0))), 1)
        for step in range(steps + 1):
            x, y = x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps
            self.rect(round(x) - width // 2, round(y) - width // 2, width, width, code)

    def lit(self) -> Image:
        def solid(x: int, y: int) -> bool:
            return 0 <= x < self.width and 0 <= y < self.height and self.pixels[y][x] is not None

        result: Image = [[CLEAR] * self.width for _ in range(self.height)]
        for y in range(self.height):
            for x in range(self.width):
                color = self.pixels[y][x]
                if color is None:
                    near = [self.pixels[y + dy][x + dx]
                            for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))
                            if solid(x + dx, y + dy)]
                    if near and near[0] is not None:
                        result[y][x] = (*blend(near[0], (14, 10, 14), 0.82), 255)
                    continue
                if (x, y) not in self.glow:
                    if not solid(x, y - 1) or not solid(x - 1, y):
                        color = blend(color, (255, 240, 205), 0.22)
                    elif not solid(x, y + 1) or not solid(x + 1, y):
                        color = blend(color, (34, 20, 44), 0.34)
                    elif not solid(x + 2, y) or not solid(x, y + 2):
                        color = blend(color, (34, 20, 44), 0.16)
                result[y][x] = (*color, 255)
        return result


# --- shared body parts ----------------------------------------------------------------

def legs(p: Paint, frame: int | None, pants: str, far: str, boots: str, sole: str,
         hips: tuple[int, int] = (9, 13), top: int = 19, width: int = 3) -> None:
    for index, (hip, cloth) in enumerate(((hips[1], far), (hips[0], pants))):
        shift, lift = (0, 0) if frame is None else STRIDE[(frame + 3 * (1 - index)) % WALK_FRAMES]
        shift = round(shift * 0.8)
        foot = 25 - lift
        knee = (top + foot) // 2
        p.line(hip + 1, top, hip + 1 + shift * 0.5, knee, cloth, width)
        p.line(hip + 1 + shift * 0.5, knee, hip + 1 + shift, foot - 2, cloth, width)
        p.rect(hip + shift, foot - 2, 3, 2, boots)
        p.rect(hip + shift, foot, 4, 1, boots)
        p.rect(hip + shift, foot + 1, 4, 1, sole)


def arm(p: Paint, shoulder: tuple[int, int], hand: tuple[int, int], sleeve: str, skin: str) -> None:
    p.line(*shoulder, *hand, sleeve, 2)
    p.rect(hand[0], hand[1] - 1, 2, 2, skin)


def swing(frame: int | None, amount: float = 2) -> int:
    return 0 if frame is None else round(math.sin(frame / WALK_FRAMES * math.tau) * amount)


def bob(frame: int | None, breath: int) -> int:
    return (1 if breath in (2, 3) else 0) if frame is None else BOB[frame]


# --- heroes ---------------------------------------------------------------------------

def wanderer(frame: int | None, breath: int = 0) -> Image:
    """Dust coat, wide hat, a long red scarf in the wind and a rifle on the back."""
    p = Paint()
    b = bob(frame, breath)
    wave = (frame if frame is not None else breath) or 0
    s = swing(frame)
    legs(p, frame, "5a4b3a", "43372c", "3a2a20", "201612")
    p.line(5, 21 + b, 16, 7 + b, "6b4a2e", 2)  # rifle on the back
    p.line(13, 11 + b, 17, 6 + b, "7d828c")
    p.rows(11 + b, [(8, 14), (7, 15), (7, 15), (7, 15), (7, 15), (7, 15), (7, 15), (6, 15),
                    (6, 16), (5, 16), (5, 16)], "8d7347")  # coat
    p.rows(18 + b, [(5, 9), (5, 9), (4, 9), (4, 8)], "7b6239")  # back tail
    p.rows(19 + b, [(13, 16), (14, 17 + (s > 0)), (14, 17 + (s > 0))], "9a8051")
    p.rect(11, 13 + b, 1, 8, "5f4a2c")
    p.rect(7, 17 + b, 9, 1, "3f2c1e")  # belt
    p.rect(12, 17 + b, 2, 1, "e0b453")
    p.rect(8, 13 + b, 2, 2, "a88d5c")
    p.rect(13, 18 + b, 2, 2, "5f4a2c")
    # scarf
    p.rows(10 + b, [(8, 15), (8, 15)], "b8432f")
    tail = (0, 1, 2, 1, 0, -1)[wave % 6]
    p.line(8, 11 + b, 4, 11 + b + tail // 2, "b8432f", 2)
    p.line(4, 11 + b + tail // 2, 1, 12 + b + tail, "9c3426", 2)
    arm(p, (9, 13 + b), (8 - s, 18 + b), "80683f", "c98f68")
    arm(p, (15, 13 + b), (17 + s // 2, 17 + b), "9a8051", "dba27c")
    # head and hat
    p.rows(6 + b, [(9, 15), (9, 16), (9, 16), (9, 15)], "dba27c")
    p.rect(9, 6 + b, 2, 4, "5b3a24")
    p.rect(14, 7 + b, 1, 1, "2a1a14")
    p.rect(12, 9 + b, 4, 1, "a5694a")
    p.rows(1 + b, [(10, 14), (9, 15), (9, 15)], "7a5c36")
    p.rect(9, 4 + b, 7, 1, "3f2c1e")
    p.rows(5 + b, [(5, 19), (4, 20)], "8f6d41")
    p.rect(9, 6 + b, 8, 1, "5e4527")
    p.rect(11, 2 + b, 1, 2, "5e4527")
    return p.lit()


def spark(frame: int | None, breath: int = 0) -> Image:
    """Mechanic: copper ponytail, brass goggles, teal overalls, wrench and an antenna pack."""
    p = Paint()
    b = bob(frame, breath)
    tick = (frame if frame is not None else breath) or 0
    s = swing(frame)
    legs(p, frame, "2f6f70", "235558", "6a4428", "2c1c14")
    # backpack with a blinking antenna
    p.rect(4, 11 + b, 4, 8, "6f747c")
    p.rect(4, 13 + b, 4, 1, "4c5058")
    p.rect(5, 15 + b, 2, 2, "e0a03c")
    p.rect(4, 4 + b, 1, 7, "8a8f98")
    p.rect(4, 3 + b, 1, 1, "ff5a3c" if tick % 2 else "7a2a20", glow=bool(tick % 2))
    p.rows(11 + b, [(8, 14), (7, 15), (7, 15), (8, 14), (8, 14), (8, 14), (8, 14), (8, 15),
                    (8, 15)], "37888a")
    p.rect(8, 11 + b, 7, 3, "e4d3ad")  # shirt
    p.rect(9, 11 + b, 1, 4, "37888a")
    p.rect(13, 11 + b, 1, 4, "37888a")
    p.rect(9, 14 + b, 5, 3, "2f7678")
    p.rect(11, 14 + b, 2, 2, "e0b453")
    p.rect(8, 18 + b, 8, 1, "7a4b2a")  # tool belt
    p.rect(8, 19 + b, 2, 2, "8f5c34")
    p.rect(13, 19 + b, 2, 2, "8f5c34")
    arm(p, (8, 12 + b), (7 - s, 17 + b), "d6c195", "6a4428")
    # wrench in the near hand
    hx, hy = 17 + s // 2, 16 + b
    p.line(hx + 1, hy + 3, hx + 3, hy - 6, "a3a9b3", 2)
    p.rect(hx + 1, hy - 8, 2, 2, "c3c9d2")
    p.rect(hx + 4, hy - 8, 2, 2, "c3c9d2")
    p.rect(hx + 2, hy - 6, 3, 1, "c3c9d2")
    arm(p, (14, 12 + b), (hx, hy), "e4d3ad", "8f5c34")
    # head, hair and goggles
    sway = (0, 0, 1, 1, 0, -1)[tick % 6]
    p.line(8, 5 + b, 5, 8 + b + sway, "c4622a", 3)
    p.line(5, 8 + b + sway, 4, 11 + b + sway, "a84c20", 2)
    p.rows(5 + b, [(9, 15), (9, 16), (9, 16), (9, 16), (10, 15)], "e9b48c")
    p.rows(1 + b, [(10, 14), (8, 15), (8, 16), (8, 16)], "d9752f")
    p.rect(8, 5 + b, 2, 4, "d9752f")
    p.rect(15, 5 + b, 1, 1, "d9752f")
    p.rect(8, 4 + b, 9, 1, "4a2f20")
    for x in (11, 14):
        p.rect(x, 3 + b, 3, 3, "c99a3e")
        p.rect(x, 3 + b, 2, 2, "8ff0e0", glow=True)
    p.rect(12, 7 + b, 1, 1, "2a1a14")
    p.rect(15, 7 + b, 1, 1, "2a1a14")
    p.rect(13, 9 + b, 2, 1, "b8543f")
    p.set(11, 8 + b, "d98a68")
    return p.lit()


def bruiser(frame: int | None, breath: int = 0) -> Image:
    """Huge scrap knight: welding mask, tyre shoulder guard, chain and a piston fist."""
    p = Paint()
    b = bob(frame, breath)
    s = swing(frame, 1.6)
    legs(p, frame, "4a4f43", "393d35", "3a3230", "1e1a1a", hips=(7, 13), top=19, width=4)
    p.rows(9 + b, [(5, 17), (4, 18), (4, 18), (4, 18), (4, 18), (5, 18), (5, 17), (5, 17),
                   (6, 17), (6, 17), (6, 17)], "8a5a3c")  # leather torso
    p.rows(11 + b, [(8, 15), (7, 16), (7, 16), (7, 16), (8, 15)], "878d94")  # plate
    p.rect(8, 12 + b, 3, 1, "aeb4bb")
    for x, y in ((8, 11), (15, 11), (7, 14), (16, 14)):
        p.set(x, y + b, "4a4e55")
    p.line(7, 16 + b, 16, 18 + b, "b9a25a")  # chain
    p.rect(6, 18 + b, 12, 2, "4a3524")
    p.rect(11, 18 + b, 3, 2, "c9a544")
    # far arm
    p.line(5, 12 + b, 3 - s, 18 + b, "a9724f", 4)
    p.rect(1 - s, 18 + b, 4, 3, "c98f68")
    # tyre shoulder
    p.ellipse(5.5, 10.5 + b, 4, 3.4, "2c2b2f")
    p.ellipse(5.5, 10.5 + b, 1.8, 1.5, "6d4b34")
    for x in (2, 5, 8):
        p.set(x, 8 + b, "4d4c52")
    # piston fist
    hx, hy = 19 + s // 2, 17 + b
    p.line(18, 11 + b, hx, hy - 2, "8a5a3c", 4)
    p.rect(hx - 2, hy - 3, 5, 3, "c0533a")
    p.rect(hx - 3, hy, 7, 5, "9aa0a8")
    p.rect(hx - 3, hy + 2, 7, 1, "6a7078")
    for x in (hx - 3, hx - 1, hx + 1, hx + 3):
        p.set(x, hy + 4, "d8dde2")
    p.set(hx - 1, hy - 2, "ffcf5a", glow=True)
    # head with a welding mask
    p.rows(2 + b, [(9, 15), (8, 16), (8, 16), (8, 16), (8, 17), (8, 17), (9, 17), (10, 16)],
           "5e646c")
    p.rows(1 + b, [(10, 14)], "747b84")
    p.rect(8, 3 + b, 2, 5, "454a52")
    p.rect(11, 4 + b, 6, 2, "1c2226")
    p.rect(12, 4 + b, 4, 1, "ff9a3c", glow=True)
    p.rect(12, 8 + b, 4, 1, "3f444b")
    p.set(12, 7 + b, "3f444b")
    p.set(14, 7 + b, "3f444b")
    p.set(16, 7 + b, "3f444b")
    p.line(10, 2 + b, 12, 2 + b, "b8432f")
    return p.lit()


def marksman(frame: int | None, breath: int = 0) -> Image:
    """Scout: ragged teal cloak and hood, glowing eyepiece and a very long rifle."""
    p = Paint()
    b = bob(frame, breath)
    tick = (frame if frame is not None else breath) or 0
    flap = (0, 1, 2, 2, 1, 0)[tick % 6]
    legs(p, frame, "3d4048", "2f3138", "594030", "261a16", hips=(9, 12))
    # cloak
    p.rows(9 + b, [(7, 14), (6, 15), (6, 15), (5, 15), (5, 15), (5, 15), (4, 15), (4, 15),
                   (4, 15), (3, 14), (3, 14), (3, 13)], "2f6a66")
    for index, x in enumerate((3, 5, 7, 9)):
        p.rect(x - flap // 2, 21 + b, 2, 1 + (index + flap) % 2, "275854")
    p.line(6, 12 + b, 4, 20 + b, "24524f")
    p.line(9, 13 + b, 8, 20 + b, "24524f")
    p.rows(12 + b, [(12, 16), (12, 16), (12, 16), (12, 15), (12, 15), (12, 15)], "6b5a3f")  # vest
    p.rect(12, 14 + b, 4, 1, "3a2c20")
    p.rect(13, 16 + b, 2, 2, "8a744c")
    # rifle
    ry = 14 + b
    p.rect(9, ry + 1, 5, 2, "6b452b")
    p.rect(13, ry, 5, 2, "4a4e57")
    p.rect(18, ry, 6, 1, "7d838e")
    p.rect(14, ry - 2, 4, 1, "30333a")
    p.set(17, ry - 2, "ff5a3c", glow=True)
    p.rect(15, ry + 2, 1, 2, "30333a")
    p.line(8, 12 + b, 10, ry + 2, "2f6a66", 3)
    p.rect(11, ry + 1, 2, 2, "8a5a42")
    p.rect(16, ry + 1, 2, 2, "d39a76")
    # hood
    p.rows(1 + b, [(10, 13), (8, 15), (7, 16), (7, 16), (7, 16), (7, 16), (7, 15), (7, 14), (7,
           14)],
           "3a7f79")
    p.rows(3 + b, [(12, 16), (12, 16), (12, 16), (12, 16), (12, 15)], "1c2b2b")
    p.rows(5 + b, [(13, 16), (12, 16), (13, 15)], "c48f6c")
    p.rect(12, 7 + b, 4, 2, "5c4a36")  # face wrap
    p.rect(14, 4 + b, 3, 2, "4a4e57")
    p.rect(15, 4 + b, 2, 1, "6dffe0", glow=True)
    p.set(7, 2 + b, "4b958e")
    p.line(8, 9 + b, 14, 10 + b, "c9a544")
    return p.lit()


def chemist(frame: int | None, breath: int = 0) -> Image:
    """Toxic brewer: twin-filter gas mask, stained coat and a bubbling tank on the back."""
    p = Paint()
    b = bob(frame, breath)
    tick = (frame if frame is not None else breath) or 0
    s = swing(frame)
    legs(p, frame, "4c5a3a", "3a462e", "2f2b28", "171514", hips=(9, 12))
    # glass tank
    p.rect(2, 8 + b, 6, 11, "5c636b")
    p.rect(3, 9 + b, 4, 9, "2f5a30")
    level = 11 + (tick % 3 == 1)
    p.rect(3, level + b, 4, 18 - level, "6ee04a", glow=True)
    for x, y in ((3 + tick % 4, 13 + (tick * 2) % 4), (5 - tick % 2, 16 - tick % 3)):
        p.set(x, y + b, "d8ffb0", glow=True)
    p.rect(3, 9 + b, 1, 7, "bfe8c8")
    p.rect(2, 7 + b, 6, 1, "7d858e")
    p.line(5, 7 + b, 10, 8 + b, "4a4038")  # hose
    # coat
    p.rows(11 + b, [(8, 15), (8, 16), (8, 16), (8, 16), (8, 16), (8, 16), (8, 16), (8, 16),
                    (7, 16), (7, 17), (7, 17), (7, 16)], "cfc39a")
    p.rect(12, 12 + b, 1, 11, "94875f")
    for x, y in ((9, 17), (10, 18), (14, 20), (15, 20), (9, 21), (14, 14)):
        p.set(x, y + b, "8ea552")
    p.rect(8, 17 + b, 9, 1, "5b4a33")
    for x, code in ((9, "e0503c"), (11, "59c8d8"), (14, "e8c93c")):  # vials on the belt
        p.rect(x, 16 + b, 1, 3, code, glow=True)
    arm(p, (9, 13 + b), (8 - s, 18 + b), "b5a87e", "39502f")
    # flask in the near hand
    hx, hy = 17 + s // 2, 17 + b
    arm(p, (15, 13 + b), (hx, hy), "cfc39a", "4a6a3a")
    p.rect(hx + 1, hy - 5, 2, 2, "dff3ee")
    p.rect(hx, hy - 3, 4, 3, "dff3ee")
    p.rect(hx, hy - 2, 4, 2, "b45fe0", glow=True)
    p.set(hx + 1 + tick % 2, hy - 6 - tick % 2, "d9a6ff", glow=True)
    # hooded gas mask
    p.rows(1 + b, [(10, 14), (9, 15), (8, 16), (8, 16), (8, 16), (8, 16), (8, 16), (9, 15), (9,
           14)],
           "6f7d3f")
    p.rows(3 + b, [(11, 16), (11, 17), (11, 17), (11, 17), (12, 16)], "3a3d36")
    p.rect(11, 4 + b, 2, 2, "c8ff6a", glow=True)
    p.rect(15, 4 + b, 2, 2, "c8ff6a", glow=True)
    p.set(11, 4 + b, "f4ffd8", glow=True)
    p.set(15, 4 + b, "f4ffd8", glow=True)
    p.rect(13, 7 + b, 3, 2, "52564c")
    p.ellipse(12, 9 + b, 1.6, 1.6, "8b8f86")
    p.ellipse(17.2, 8.6 + b, 1.6, 1.6, "8b8f86")
    p.set(12, 9 + b, "4a4d46")
    p.set(17, 8 + b, "4a4d46")
    return p.lit()


HEROES: dict[str, tuple[Callable[..., Image], str, int]] = {
    "wanderer": (wanderer, "R", 3), "spark": (spark, "R", 103), "bruiser": (bruiser, "R", 107),
    "marksman": (marksman, "R", 109), "chemist": (chemist, "G", 113),
}


def animations(draw: Callable[..., Image]) -> tuple[list[Image], list[Image]]:
    """Walk and idle frames."""
    return ([draw(frame) for frame in range(WALK_FRAMES)],
            [draw(None, breath) for breath in range(IDLE_FRAMES)])


# --- shelter picture -----------------------------------------------------------------

SCENE_WIDTH, SCENE_HEIGHT, SCENE_FRAMES = 320, 120, 4
BAYER = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))


def shelter(frame: int) -> Image:
    """Dusk over the wasteland: ruins on the horizon and the lit door of the shelter in a hill."""
    w, h = SCENE_WIDTH, SCENE_HEIGHT
    p = Paint(w, h)
    rng = random.Random(77)
    sky = [rgb(code) for code in ("1b1830", "2c2143", "4a2c52", "7a3c50", "b45a48",
                                  "e08a4a", "f2bd6a")]
    horizon = 78

    def put(x: int, y: int, color: Color) -> None:
        if 0 <= x < w and 0 <= y < h:
            p.pixels[y][x] = color

    for y in range(h):
        for x in range(w):
            t = min(0.999, y / horizon) * (len(sky) - 1)
            index = int(t)
            step = 1 if t - index > (BAYER[y % 4][x % 4] + 0.5) / 16 else 0
            put(x, y, sky[min(index + step, len(sky) - 1)])
    for _ in range(46):  # stars
        x, y = rng.randrange(w), rng.randrange(30)
        bright = (x + frame) % 4
        put(x, y, rgb(("8a86a8", "c9c4dc", "fff4d8", "c9c4dc")[bright]))
    for y in range(46, horizon):  # low sun with a halo
        for x in range(50, 150):
            distance = math.hypot(x - 98, (y - 70) * 1.05)
            base = p.pixels[y][x]
            if distance < 17:
                put(x, y, rgb("ffe7a0") if distance < 14 else rgb("ffd27a"))
            elif distance < 34 and base and (34 - distance) / 34 > BAYER[y % 4][x % 4] / 16:
                put(x, y, blend(base, rgb("ffd27a"), 0.45))
    for cx, cy, length in ((60, 24, 46), (190, 16, 60), (128, 37, 34), (250, 33, 40)):  # clouds
        drift = frame % 2
        for layer, code in enumerate(("6a3a58", "8e4b58", "c27052")):
            span = length - layer * 12
            p.rect(cx - span // 2 + drift, cy + layer, span, 1, code)

    def ridge(base: float, height: float, seed: int, code: str, light: str) -> None:
        r = random.Random(seed)
        phases = [(r.uniform(0.5, 3.4), r.uniform(0, 6.28), r.uniform(0.3, 1)) for _ in range(4)]
        for x in range(w):
            wave = sum(a * math.sin(x / w * math.tau * f + o) for f, o, a in phases) / 2.2
            top = round(base - height * (0.5 + 0.5 * wave))
            for y in range(top, h):
                p.set(x, y, light if y == top else code)

    ridge(74, 13, 4, "5c3350", "7d4458")
    # ruined city
    r = random.Random(12)
    x = 4
    while x < 200:
        width, tall = r.randrange(6, 15), r.randrange(8, 34)
        for column in range(width):
            broken = r.randrange(0, 5)
            for y in range(horizon - tall + broken, horizon + 4):
                p.set(x + column, y, "3c2440")
        for wy in range(horizon - tall + 6, horizon - 2, 4):
            for wx in range(x + 2, x + width - 1, 3):
                if r.random() < 0.28:
                    lit_window = r.random() < 0.12 and (frame + wx) % 4
                    spot = "e08a4a" if r.random() < 0.3 else "27172f"
                    p.set(wx, wy, "ffca6a" if lit_window else spot)
        x += width + r.randrange(1, 7)
    p.line(150, 78, 150, 34, "2f1c36")  # leaning radio tower
    p.line(156, 78, 151, 34, "2f1c36")
    for y in range(40, 78, 6):
        p.line(150, y, 154, y + 4, "2f1c36")
    if frame in (0, 1):
        p.rect(150, 32, 2, 2, "ff4a3a")
    ridge(90, 9, 9, "47302f", "8a5540")
    ridge(101, 7, 21, "5f4234", "a8704a")

    # the hill with the shelter
    for x in range(176, w):
        t = (x - 176) / (w - 176)
        top = round(98 - 62 * math.sin(min(1.0, t * 1.15) * math.pi / 2) + 2 * math.sin(x / 7))
        for y in range(max(0, top), h):
            depth = y - top
            shade = "a8704a" if depth == 0 else "80563c" if depth < 3 else "6a4a38"
            if depth >= 3 and (x * 7 + y * 13) % 29 == 0:
                shade = "7a563f"
            if depth > 22 and (x * 5 + y * 3) % 17 == 0:
                shade = "573c30"
            p.set(x, y, shade)
    for x, y in ((206, 66), (224, 54), (300, 40), (190, 88)):  # dry bushes
        for dx, dy in ((0, 0), (-2, -2), (2, -2), (0, -3), (-3, 0), (3, 0)):
            p.line(x, y + 2, x + dx, y + dy - 1, "4a3a26")
    # concrete portal
    p.rows(62, [(236, 288), (233, 291), (231, 293)], "a39b8c")
    p.rect(231, 65, 63, 44, "857d70")
    p.rect(231, 65, 63, 2, "b9b1a2")
    for x, y in ((234, 70), (289, 72), (235, 96), (286, 100), (233, 84), (290, 88)):
        p.rect(x, y, 3, 1, "6a6358")
    p.line(238, 66, 241, 76, "5e574e")
    p.line(288, 80, 285, 92, "5e574e")
    p.rect(243, 72, 39, 37, "3a322c")  # doorway
    p.rect(258, 74, 14, 35, "ffd98a")  # warm light between the doors
    p.rect(261, 76, 8, 33, "fff0c0")
    p.rect(263, 84, 1, 18, "d9a85a")  # ladder lamp post inside
    for x in (244, 270):  # riveted sliding doors
        p.rect(x, 73, 12 if x == 244 else 11, 36, "6b4a3a")
        p.rect(x, 73, 12 if x == 244 else 11, 1, "96664a")
        for y in (80, 90, 100):
            p.rect(x, y, 12 if x == 244 else 11, 2, "553a2e")
        for y in (76, 86, 96, 106):
            p.set(x + 2, y, "b98a62")
            p.set(x + 8, y, "b98a62")
        p.line(x + 1, 108, x + 9, 100, "c9a544", 2)
    # lamp and its glow
    p.rect(261, 64, 8, 2, "4a443c")
    p.rect(262, 66, 6, 3, "fff2b8" if frame != 2 else "e8b860")
    for y in range(109, h):  # light on the ground
        half = 12 + (y - 109) * 2
        for x in range(264 - half, 264 + half):
            base = p.pixels[y][x] if 0 <= x < w else None
            if base and BAYER[y % 4][x % 4] < 11 - (y - 109) // 2:
                put(x, y, blend(base, rgb("ffcf7a"), 0.5))
    # things around the door
    for index in range(5):  # sandbags
        p.ellipse(222 + index * 5 - (index // 3) * 9, 108 - (index // 3) * 4, 4, 2.6, "a08a5c")
        p.rect(220 + index * 5 - (index // 3) * 9, 106 - (index // 3) * 4, 3, 1, "c4ad78")
    p.rect(298, 92, 12, 17, "8a4a36")  # barrels
    for y in (95, 101, 106):
        p.rect(298, y, 12, 1, "5f3226")
    p.rect(298, 92, 12, 1, "b86a4c")
    p.rect(311, 97, 8, 12, "4f6a58")
    p.rect(311, 97, 8, 1, "7f9a80")
    p.rect(302, 18, 1, 25, "5a5560")  # antenna on the hill
    p.line(297, 22, 307, 22, "5a5560")
    p.line(299, 27, 305, 27, "5a5560")
    if frame in (2, 3):
        p.rect(302, 16, 1, 2, "6dff9a")
    p.line(212, 84, 212, 108, "4a3626", 2)  # wind turbine made of scrap
    angle = frame * math.tau / 12
    for blade in range(3):
        a = angle + blade * math.tau / 3
        p.line(212, 84, 212 + math.cos(a) * 11, 84 + math.sin(a) * 11, "c9b48a")
    p.rect(211, 83, 3, 3, "8a4a36")
    # camp fire and a traveller
    fx, fy = 176, 110
    for radius, strength in ((20, 0.18), (13, 0.3)):
        for y in range(fy - radius // 2, min(h, fy + radius // 2)):
            for x in range(fx - radius, fx + radius):
                inside = ((x - fx) / radius) ** 2 + ((y - fy) / (radius / 2)) ** 2 < 1
                base = p.pixels[y][x]
                if inside and base:
                    put(x, y, blend(base, rgb("ff9a4a"), strength))
    p.line(fx - 5, fy + 1, fx + 5, fy - 1, "3a2418", 2)
    p.line(fx - 5, fy - 1, fx + 5, fy + 1, "4a2f20", 2)
    tall = (8, 10, 7, 9)[frame]
    for layer, (code, size) in enumerate((("d9502a", 4), ("f2953a", 3), ("ffe08a", 1))):
        for row in range(tall - layer * 2):
            half = max(0, round(size * (1 - row / (tall - layer * 2))))
            lean = round(math.sin(frame * 1.6 + row * 0.5))
            p.rect(fx - half + lean, fy - 2 - row, half * 2 + 1, 1, code)
    for index in range(3):
        rise = (index * 7 + frame * 4) % 14
        p.set(fx - 4 + (index * 5 + frame * 3) % 9, fy - 14 - rise, "ffb45a")
    figure = wanderer(None, frame)
    for y, line in enumerate(figure):
        for x, pixel in enumerate(line):
            if pixel[3]:
                put(140 + x, 86 + y, blend(pixel[:3], rgb("2a1a24"), 0.18))
    for x in range(146, 160):  # ground shadow
        base = p.pixels[113][x]
        if base:
            put(x, 113, blend(base, (20, 12, 16), 0.5))
    for x in range(0, w, 3):  # foreground grass
        if (x * 37) % 11 < 5:
            tip = (x * 13) % 5 + 2
            p.line(x, h - 1, x + (frame % 2 and x % 2), h - tip, "3a2a22")
    return [[(*(color or (0, 0, 0)), 255) for color in row] for row in p.pixels]


def shelter_strip() -> Image:
    """All frames one under another; CSS steps through them."""
    return [row for frame in range(SCENE_FRAMES) for row in shelter(frame)]
