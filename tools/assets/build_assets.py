"""Build the game's original sprites, atlas, SFX and music.

Usage: python3 tools/assets/build_assets.py [--preview DIR]

Only the standard library is needed for images and SFX; music is encoded with
ffmpeg (libvorbis + libmp3lame). Outputs go to client/public/assets and are
committed, so CI and players never run this script. Re-running it gives
byte-identical images and WAVs (all randomness is seeded).
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import art  # noqa: E402
import art_more as more  # noqa: E402
import art_world as world  # noqa: E402
import audio  # noqa: E402
import shapes  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "client" / "public" / "assets"
ANDROID_RES = ROOT / "client" / "android" / "app" / "src" / "main" / "res"
# Launcher icon and splash background (terminal green-black, see client/src/ui/theme.ts).
ICON_BACKGROUND: Pixel = (0x14, 0x2a, 0x1a, 255)

Pixel = tuple[int, int, int, int]
Image = list[list[Pixel]]
CLEAR: Pixel = (0, 0, 0, 0)


# --- image helpers -----------------------------------------------------------------

def parse(source: str) -> Image:
    rows = [line for line in source.strip("\n").split("\n")]
    width = len(rows[0])
    image: Image = []
    for row in rows:
        if len(row) != width:
            raise ValueError(f"ragged pixel map row {row!r}")
        image.append([CLEAR if char == "." else (*art.PALETTE[char], 255) for char in row])
    return image


def evolved(source: str, recolor: dict[str, str]) -> Image:
    """Evolved weapon icon: the base icon in new colours plus a gold star in the corner."""
    table = str.maketrans(recolor)
    image = parse("\n".join(line.translate(table) for line in source.strip("\n").split("\n")))
    star = {(13, 0): "y", (12, 1): "y", (13, 1): "w", (14, 1): "y", (13, 2): "y"}
    for (x, y), char in star.items():
        image[y][x] = (*art.PALETTE[char], 255)
    return image


def blank(width: int, height: int) -> Image:
    return [[CLEAR] * width for _ in range(height)]


def stack(*parts: Image) -> Image:
    return [list(row) for part in parts for row in part]


def overlay(base: Image, top: Image, x: int, y: int) -> Image:
    result = [list(row) for row in base]
    for dy, row in enumerate(top):
        for dx, pixel in enumerate(row):
            if pixel[3] and 0 <= y + dy < len(result) and 0 <= x + dx < len(result[0]):
                result[y + dy][x + dx] = pixel
    return result


def lighten(image: Image, amount: float) -> Image:
    def mix(pixel: Pixel) -> Pixel:
        if not pixel[3]:
            return pixel
        r, g, b = (round(c + (255 - c) * amount) for c in pixel[:3])
        return (r, g, b, pixel[3])

    return [[mix(pixel) for pixel in row] for row in image]


def squash(image: Image, keep: float) -> Image:
    """Shrink vertically towards the bottom edge, keeping roughly `keep` of the rows."""
    height = len(image)
    rows = max(1, round(height * keep))
    content = [image[min(height - 1, int(index * height / rows))] for index in range(rows)]
    return blank(len(image[0]), height - rows) + [list(row) for row in content]


def dissolve(image: Image, fraction: float, seed: int) -> Image:
    rng = random.Random(seed)
    return [[pixel if not pixel[3] or rng.random() > fraction else CLEAR for pixel in row]
            for row in image]


def puddle(width: int, height: int, color: str) -> Image:
    image = blank(width, height)
    rgb = art.PALETTE[color]
    for y in range(height - 4, height - 1):
        spread = 5 - abs(y - (height - 3)) * 2
        for x in range(width // 2 - spread, width // 2 + spread):
            image[y][x] = (*rgb, 255)
    return image


def death_frames(base: Image, residue: str, seed: int) -> list[Image]:
    return [
        lighten(base, 0.7),
        squash(base, 0.75),
        dissolve(squash(base, 0.45), 0.35, seed),
        overlay(puddle(len(base[0]), len(base), residue),
                dissolve(squash(base, 0.2), 0.6, seed + 1), 0, 0),
    ]


def png(image: Image) -> bytes:
    height, width = len(image), len(image[0])
    raw = b"".join(b"\x00" + bytes(c for pixel in row for c in pixel) for row in image)

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


# --- sprites -------------------------------------------------------------------------

def humanoid(top: str, legs: Sequence[str], residue: str, seed: int) -> dict[str, Image]:
    walk = [stack(parse(top), parse(leg)) for leg in legs]
    return with_death(walk, residue, seed)


def with_death(walk: list[Image], residue: str, seed: int) -> dict[str, Image]:
    frames = {f"walk_{index}": frame for index, frame in enumerate(walk)}
    for index, frame in enumerate(death_frames(walk[1], residue, seed)):
        frames[f"death_{index}"] = frame
    return frames


def numbered(name: str, images: Sequence[Image]) -> dict[str, Image]:
    return {f"{name}_{index}": image for index, image in enumerate(images)}


def roach() -> dict[str, Image]:
    body = parse(art.ROACH_BODY)
    walk = []
    for upper, lower in art.ROACH_LEGS:
        frame = overlay(body, parse(upper), 0, 2)
        walk.append(overlay(frame, parse(lower), 0, 11))
    frames = {f"walk_{index}": frame for index, frame in enumerate(walk)}
    for index, frame in enumerate(death_frames(walk[1], "b", 7)):
        frames[f"death_{index}"] = frame
    return frames


def sprite_frames() -> dict[str, Image]:
    """Atlas frame name -> image. `<key>` is always the idle/static frame."""
    animated = {
        "heroes/wanderer": humanoid(art.WANDERER_TOP, art.WANDERER_LEGS, "R", 3),
        "enemies/ghoul": humanoid(art.GHOUL_TOP, art.GHOUL_LEGS, "Q", 5),
        "enemies/roach": roach(),
        "xp/green": {f"idle_{i}": parse(src) for i, src in enumerate(art.XP_FRAMES)},
        "fx/hit": {f"burst_{i}": parse(src) for i, src in enumerate(art.HIT_FRAMES)},
        "enemies/scorpion": humanoid(world.SCORPION_TOP, world.SCORPION_LEGS, "d", 11),
        "enemies/raider": humanoid(world.RAIDER_TOP, art.WANDERER_LEGS, "R", 13),
        "enemies/cleaner_bot": humanoid(
            world.CLEANER_BOT_TOP, world.CLEANER_BOT_TREADS * 2, "M", 17),
        "enemies/brute": humanoid(world.BRUTE_TOP, world.BRUTE_LEGS, "H", 19),
        "enemies/war_bot": humanoid(world.WAR_BOT_TOP, world.WAR_BOT_LEGS, "M", 23),
        "enemies/junk_king": with_death([shapes.junk_king(i) for i in range(4)], "R", 29),
        "projectiles/drone": numbered("spin", [parse(src) for src in world.DRONE_FRAMES]),
        "fx/fire": numbered("burn", [parse(src) for src in world.FIRE_FRAMES]),
        "fx/explosion": numbered("burst", [shapes.explosion(i) for i in range(5)]),
        "pickups/chest": numbered("idle", [parse(src) for src in world.CHEST_FRAMES]),
        "decor/crate": numbered("break", [parse(src) for src in world.CRATE_BREAK]),
        "enemies/wild_dog": with_death([more.wild_dog(i) for i in range(4)], "R", 41),
        "enemies/rad_bat": with_death([more.rad_bat(i) for i in range(4)], "P", 43),
        "enemies/medic": with_death([more.medic(i) for i in range(4)], "R", 47),
        "enemies/riot_mech": with_death([more.riot_mech(i) for i in range(4)], "M", 53),
        "enemies/iron_mayor": with_death([more.iron_mayor(i) for i in range(4)], "M", 59),
        "enemies/glow_slime": with_death([more.slime(i, 16) for i in range(4)], "G", 61),
        "enemies/slimelet": with_death([more.slime(i, 10) for i in range(4)], "G", 67),
        "enemies/slime_queen": with_death([more.slime_queen(i) for i in range(4)], "G", 71),
        "enemies/mire_worm": with_death([more.worm(i, 16) for i in range(4)], "u", 73),
        "enemies/great_worm": with_death([more.worm(i, 24) for i in range(4)], "u", 79),
        "enemies/toad": with_death([more.toad(i) for i in range(4)], "T", 83),
        "enemies/marsh_mother": with_death([more.marsh_mother(i) for i in range(4)], "P", 89),
        "fx/dust": numbered("burst", [more.dust(i) for i in range(5)]),
        "fx/heal": numbered("burst", [more.heal_ring(i) for i in range(4)]),
    }
    frames: dict[str, Image] = {}
    for key, animation in animated.items():
        frames[key] = next(iter(animation.values()))
        for name, image in animation.items():
            frames[f"{key}/{name}"] = image
    frames.update({
        "weapons/scrap_pistol": parse(art.SCRAP_PISTOL),
        "weapons/scattergun": parse(art.SCATTERGUN),
        "passives/heavy_rounds": parse(art.HEAVY_ROUNDS),
        "passives/quickstep": parse(art.QUICKSTEP),
        "projectiles/bullet": parse(art.BULLET),
        "projectiles/pellet": parse(art.PELLET),
        "ui/cap": parse(art.CAP),
        "weapons/laser_rifle": parse(world.LASER_RIFLE),
        "weapons/orbit_drone": parse(world.ORBIT_DRONE),
        "weapons/rad_aura": parse(world.RAD_AURA),
        "weapons/firebomb": parse(world.FIREBOMB),
        "weapons/nail_gun": evolved(art.SCRAP_PISTOL, {"m": "w", "M": "m", "r": "y", "R": "o"}),
        "weapons/scrap_cannon": evolved(art.SCATTERGUN, {"m": "y", "M": "o", "r": "B", "R": "b"}),
        "weapons/prism_emitter": evolved(world.LASER_RIFLE, {"t": "y", "T": "o", "g": "w"}),
        "weapons/drone_swarm": evolved(world.ORBIT_DRONE, {"m": "y", "M": "o", "g": "r"}),
        "weapons/reactor_core": evolved(world.RAD_AURA, {"g": "y", "G": "o"}),
        "weapons/napalm": evolved(world.FIREBOMB, {"t": "r", "T": "R", "o": "y", "y": "w"}),
        "passives/trigger_spring": parse(world.TRIGGER_SPRING),
        "passives/wide_bore": parse(world.WIDE_BORE),
        "passives/extra_mag": parse(world.EXTRA_MAG),
        "passives/rad_sponge": parse(world.RAD_SPONGE),
        "passives/scrap_magnet": parse(world.SCRAP_MAGNET),
        "passives/lucky_cap": parse(world.LUCKY_CAP),
        "projectiles/laser": parse(world.LASER),
        "projectiles/rad": parse(world.RAD),
        "projectiles/bottle": parse(world.BOTTLE),
        "projectiles/slug": parse(world.SLUG),
        "pickups/cap": parse(art.CAP),
        "pickups/caps_stash": parse(world.CAPS_STASH),
        "pickups/medkit": parse(world.MEDKIT),
        "pickups/magnet": parse(world.MAGNET),
        "pickups/pulse_bomb": parse(world.PULSE_BOMB),
        # The crate's static frame is intact; its break_N frames are the shatter animation.
        "decor/crate": parse(world.CRATE),
        "decor/barrel": parse(world.BARREL),
        "decor/dead_tree": parse(world.DEAD_TREE),
        "decor/rocks": parse(world.ROCKS),
        "decor/bones": parse(world.BONES),
        "decor/tires": parse(world.TIRES),
        "decor/car_wreck": parse(world.CAR_WRECK),
        "decor/asphalt": shapes.asphalt(),
        "decor/crater": shapes.crater(),
        "decor/rad_puddle": shapes.rad_puddle(0),
        "decor/dune": shapes.dune(),
        "projectiles/spit": more.spit(),
        "decor/concrete_block": more.concrete_block(),
        "decor/lamp_post": more.lamp_post(),
        "decor/ruin_wall": more.ruin_wall(),
        "decor/rubble": more.rubble(),
        "decor/oil_puddle": more.oil_puddle(),
        "decor/reeds": more.reeds(),
        "decor/stump": more.stump(),
        "decor/mushrooms": more.mushrooms(),
        "decor/toxic_pool": more.toxic_pool(),
        "decor/moss": more.moss(),
    })
    return frames


def pack(frames: dict[str, Image], width: int = 256) -> tuple[Image, dict[str, object]]:
    """Shelf packer with 1px transparent padding; returns the atlas and Phaser JSON Hash."""
    placed: dict[str, tuple[int, int, int, int]] = {}
    x = y = shelf = 1
    for name, image in sorted(frames.items(), key=lambda item: (-len(item[1]), item[0])):
        h, w = len(image), len(image[0])
        if x + w + 1 > width:
            x, y, shelf = 1, y + shelf + 1, 0
        placed[name] = (x, y, w, h)
        x += w + 1
        shelf = max(shelf, h)
    height = 1
    while height < y + shelf + 1:
        height *= 2
    atlas = blank(width, height)
    for name, (px, py, _w, _h) in placed.items():
        atlas = overlay(atlas, frames[name], px, py)
    data: dict[str, object] = {
        "frames": {name: {
            "frame": {"x": px, "y": py, "w": w, "h": h}, "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        } for name, (px, py, w, h) in sorted(placed.items())},
        "meta": {"app": "tools/assets/build_assets.py", "image": "sprites.png",
                 "format": "RGBA8888", "size": {"w": width, "h": height}, "scale": "1"},
    }
    return atlas, data


def wasteland_ground(size: int = 128) -> Image:
    """Seamless dusty ground: soft patches, sparse grit, cracks, pebbles and dry grass."""
    rng = random.Random(1957)
    cells = 4  # periodic value noise on a 4x4 grid keeps the tile seamless
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

    base, light, dark = art.PALETTE["d"], art.PALETTE["D"], art.PALETTE["e"]
    image: Image = []
    for y in range(size):
        row: list[Pixel] = []
        for x in range(size):
            value = noise(x, y) + (rng.random() - 0.5) * 0.12
            tone = light if value > 0.66 else base
            row.append((*tone, 255))
        image.append(row)
    for _ in range(int(size * size * 0.02)):  # sparse grit
        x, y = rng.randrange(size), rng.randrange(size)
        image[y][x] = (*rng.choice((light, dark)), 255)
    crack = (*art.PALETTE["k"], 255)
    for _ in range(4):  # cracks: short random walks that wrap around the tile edges
        x, y = rng.randrange(size), rng.randrange(size)
        for _ in range(rng.randrange(7, 15)):
            image[y % size][x % size] = crack
            x += rng.choice((-1, 0, 1, 1))
            y += rng.choice((-1, 0, 1))
    for _ in range(6):  # pebbles with a lit top
        x, y = rng.randrange(size), rng.randrange(size)
        image[y][x] = (*dark, 255)
        image[(y - 1) % size][x] = (*art.PALETTE["s"], 255)
    grass = [(*art.PALETTE[c], 255) for c in "hH"]
    for _ in range(3):  # dry grass tufts
        x, y = rng.randrange(size), rng.randrange(size)
        for dx, dy in ((0, 0), (-1, -1), (1, -1), (0, -2), (2, -2), (-2, -2)):
            image[(y + dy) % size][(x + dx) % size] = grass[(dx + dy) % 2]
    return image


def scale(image: Image, factor: int) -> Image:
    return [[pixel for pixel in row for _ in range(factor)] for row in image for _ in range(factor)]


def build_images(preview: Path | None) -> None:
    frames = sprite_frames()
    atlas, data = pack(frames)
    (OUT / "atlas").mkdir(parents=True, exist_ok=True)
    (OUT / "atlas" / "sprites.png").write_bytes(png(atlas))
    (OUT / "atlas" / "sprites.json").write_text(json.dumps(data, indent=1) + "\n")
    (OUT / "ground").mkdir(parents=True, exist_ok=True)
    ground = wasteland_ground()
    (OUT / "ground" / "wasteland.png").write_bytes(png(ground))
    (OUT / "ground" / "city.png").write_bytes(png(more.city_ground()))
    (OUT / "ground" / "marsh.png").write_bytes(png(more.marsh_ground()))
    build_android(frames)
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        backdrop = [[(*art.PALETTE["S"], 255)] * len(atlas[0]) for _ in atlas]
        (preview / "atlas_x4.png").write_bytes(png(scale(overlay(backdrop, atlas, 0, 0), 4)))
        tiled = [row * 3 for row in ground] * 2
        hero = frames["heroes/wanderer"]
        for index, key in enumerate(("heroes/wanderer", "enemies/ghoul", "enemies/roach")):
            tiled = overlay(tiled, frames[key], 100 + index * 24, 60)
        tiled = overlay(tiled, frames["xp/green"], 180, 66)
        del hero
        (preview / "ground_x3.png").write_bytes(png(scale(tiled, 3)))


# --- Android launcher icon and splash --------------------------------------------------

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def centered(size: int, sprite: Image, factor: int, background: Pixel = CLEAR) -> Image:
    big = scale(sprite, factor)
    offset = (size - len(big)) // 2
    return overlay([[background] * size for _ in range(size)], big, offset, offset)


def circle(image: Image) -> Image:
    size = len(image)
    radius = size / 2
    return [[pixel if (x + 0.5 - radius) ** 2 + (y + 0.5 - radius) ** 2 <= radius ** 2 else CLEAR
             for x, pixel in enumerate(row)] for y, row in enumerate(image)]


def build_android(frames: dict[str, Image]) -> None:
    """Launcher icons (adaptive + legacy) and the splash logo from the hero sprite."""
    if not ANDROID_RES.exists():
        return
    hero = frames["heroes/wanderer"]
    for name, density in DENSITIES.items():
        folder = ANDROID_RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        # Adaptive foreground is 108dp; the hero stays inside the 66dp safe zone.
        foreground = centered(round(108 * density), hero, round(4 * density))
        (folder / "ic_launcher_foreground.png").write_bytes(png(foreground))
        legacy = centered(round(48 * density), hero, round(2 * density), ICON_BACKGROUND)
        (folder / "ic_launcher.png").write_bytes(png(legacy))
        (folder / "ic_launcher_round.png").write_bytes(png(circle(legacy)))
    splash = ANDROID_RES / "drawable-xxhdpi"
    splash.mkdir(parents=True, exist_ok=True)
    (splash / "splash_logo.png").write_bytes(png(centered(192, hero, 12)))


# --- audio ---------------------------------------------------------------------------

def build_audio() -> None:
    (OUT / "sfx").mkdir(parents=True, exist_ok=True)
    for name, samples in audio.sound_effects().items():
        (OUT / "sfx" / f"{name}.wav").write_bytes(audio.wav(samples))
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise SystemExit("ffmpeg is required to encode music (libvorbis, libmp3lame)")
    (OUT / "music").mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, samples in audio.music_tracks().items():
            source = Path(tmp) / f"{name}.wav"
            source.write_bytes(audio.wav(samples))
            for suffix, codec in (("ogg", ["-c:a", "libvorbis", "-q:a", "3"]),
                                  ("mp3", ["-c:a", "libmp3lame", "-b:a", "96k"])):
                subprocess.run([
                    ffmpeg, "-loglevel", "error", "-y", "-i", str(source), *codec,
                    "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                    str(OUT / "music" / f"{name}.{suffix}"),
                ], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path, help="also write enlarged previews here")
    parser.add_argument("--images-only", action="store_true")
    args = parser.parse_args()
    build_images(args.preview)
    if not args.images_only:
        build_audio()


if __name__ == "__main__":
    main()
