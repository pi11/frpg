"""Projectiles of evolved weapons.

Each evolved weapon gets its own projectile: the base weapon's sprite (every animation
frame) repainted in the evolution's colour, with a light glow outline, and doubled in size
for the small ones. So an evolution is visible on screen at once, not only in the numbers.
"""

from __future__ import annotations

Pixel = tuple[int, int, int, int]
Image = list[list[Pixel]]

# Evolved weapon id -> (base sprite, colour, size factor). Green stays the colour of XP and
# pink the colour of enemy spit, so neither is used here.
LOOKS: dict[str, tuple[str, str, int]] = {
    "twin_pistols": ("projectiles/bullet", "#ffd84a", 2),
    "scrap_cannon": ("projectiles/pellet", "#ff9a3c", 2),
    "buckshot_ram": ("projectiles/pellet", "#fff2a6", 2),
    "prism_emitter": ("projectiles/laser", "#c58cff", 2),
    "sniper_beam": ("projectiles/laser", "#e8f6ff", 2),
    "furnace": ("projectiles/flame", "#5aa8ff", 1),
    "fire_ring": ("projectiles/flame", "#ffe27a", 1),
    "napalm": ("projectiles/bottle", "#ff7a1a", 2),
    "fire_rain": ("projectiles/bottle", "#7fb8ff", 2),
    "buzz_storm": ("projectiles/saw", "#8fd8ff", 1),
    "ripper": ("projectiles/saw", "#ff6a4a", 2),
    "storm_core": ("projectiles/spark", "#b98cff", 2),
    "arc_welder": ("projectiles/spark", "#ffffff", 2),
    "minefield": ("projectiles/mine", "#ffb347", 1),
    "demo_charge": ("projectiles/mine", "#ff5a3c", 2),
    "rocket_barrage": ("projectiles/rocket", "#ffd84a", 1),
    "smart_warhead": ("projectiles/rocket", "#ff6a4a", 2),
    "drone_swarm": ("projectiles/drone", "#ffd84a", 1),
    "shield_drones": ("projectiles/drone", "#8fd8ff", 2),
    "reactor_core": ("projectiles/rad", "#ffd84a", 2),
    "rad_halo": ("projectiles/rad", "#c58cff", 2),
}

# Fire left on the ground by the evolved bottles.
FIRES: dict[str, str] = {
    "fx/napalm_fire": "#ff7a1a",
    "fx/blue_fire": "#7fb8ff",
}


def rgb(color: str) -> tuple[int, int, int]:
    return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)


def shade(channel: int, tone: float, white: float) -> int:
    return min(255, round(channel * tone * (1 - white) + 255 * white))


def repaint(image: Image, color: str) -> Image:
    """Keeps the shading of the sprite but moves every opaque pixel to the new colour."""
    red, green, blue = rgb(color)
    result: Image = []
    for row in image:
        line: list[Pixel] = []
        for r, g, b, a in row:
            if not a:
                line.append((0, 0, 0, 0))
                continue
            light = (0.3 * r + 0.59 * g + 0.11 * b) / 255
            tone = 0.45 + 0.75 * light
            white = max(0.0, light - 0.75) * 2.4
            new = [shade(channel, tone, white) for channel in (red, green, blue)]
            line.append((new[0], new[1], new[2], a))
        result.append(line)
    return result


def enlarge(image: Image, factor: int) -> Image:
    return [[pixel for pixel in row for _ in range(factor)] for row in image for _ in range(factor)]


def glow(image: Image, color: str) -> Image:
    """One pixel of half-transparent light around the sprite (the canvas grows by 2)."""
    red, green, blue = rgb(color)
    height, width = len(image), len(image[0])
    result: Image = [[(0, 0, 0, 0)] * (width + 2) for _ in range(height + 2)]
    for y in range(height):
        for x in range(width):
            if image[y][x][3]:
                result[y + 1][x + 1] = image[y][x]
    for y in range(height + 2):
        for x in range(width + 2):
            if result[y][x][3]:
                continue
            near = any(
                0 <= y + dy < height + 2 and 0 <= x + dx < width + 2
                and result[y + dy][x + dx][3] == 255
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if near:
                result[y][x] = (red, green, blue, 110)
    return result


def restyle(image: Image, color: str, factor: int) -> Image:
    return glow(enlarge(repaint(image, color), factor), color)


def copy_set(
    frames: dict[str, Image], base: str, key: str, color: str, factor: int,
) -> dict[str, Image]:
    """The static frame and every animation frame (`base/<name>_<n>`) under the new key."""
    result = {key: restyle(frames[base], color, factor)}
    for name, image in frames.items():
        if name.startswith(base + "/"):
            result[key + name[len(base):]] = restyle(image, color, factor)
    return result


def nail() -> Image:
    """A steel nail pointing right (projectiles turn along their flight): flat head, shaft, tip."""
    rows = [
        "H...........",
        "HSSSSSSSSSs.",
        "HDDDDDDDDDdT",
        "H...........",
    ]
    colors: dict[str, Pixel] = {
        "H": (150, 160, 172, 255), "S": (226, 234, 242, 255), "s": (190, 200, 210, 255),
        "L": (176, 188, 200, 255), "T": (240, 246, 252, 255), "D": (96, 106, 118, 255),
        "d": (120, 130, 142, 255), ".": (0, 0, 0, 0),
    }
    return [[colors[char] for char in row] for row in rows]


def frames(existing: dict[str, Image]) -> dict[str, Image]:
    result: dict[str, Image] = {"projectiles/nail_gun": nail()}
    for weapon, (base, color, factor) in LOOKS.items():
        result.update(copy_set(existing, base, f"projectiles/{weapon}", color, factor))
    for key, color in FIRES.items():
        result.update(copy_set(existing, "fx/fire", key, color, 1))
    return result
