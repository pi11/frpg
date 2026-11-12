"""Original 8-bit SFX and chiptune music (CC0, made for this project).

Everything is synthesized from code: pulse/triangle/noise oscillators, pitch
slides and envelopes in the spirit of jsfxr, plus a tiny tracker for music.
"""

from __future__ import annotations

import math
import random
import struct
from collections.abc import Callable

RATE = 22050
Wave = Callable[[float], float]  # phase in cycles -> sample


def pulse(duty: float) -> Wave:
    return lambda phase: 1.0 if phase % 1.0 < duty else -1.0


def triangle(phase: float) -> float:
    p = phase % 1.0
    return 4 * p - 1 if p < 0.5 else 3 - 4 * p


def sine(phase: float) -> float:
    return math.sin(2 * math.pi * phase)


class Noise:
    """Sample-and-hold noise whose 'pitch' is the hold rate."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)
        self.value = 0.0
        self.cycle = -1

    def __call__(self, phase: float) -> float:
        cycle = int(phase * 2)
        if cycle != self.cycle:
            self.cycle = cycle
            self.value = self.rng.uniform(-1, 1)
        return self.value


def tone(
    wave: Wave, start_hz: float, end_hz: float, seconds: float, *,
    volume: float = 0.5, attack: float = 0.004, curve: float = 2.0,
    vibrato_hz: float = 0.0, vibrato_depth: float = 0.0,
) -> list[float]:
    """One voice with an exponential pitch slide and attack/decay envelope."""
    count = int(seconds * RATE)
    out: list[float] = []
    phase = 0.0
    for index in range(count):
        t = index / count
        hz = start_hz * (end_hz / start_hz) ** t
        if vibrato_depth:
            hz *= 1 + vibrato_depth * math.sin(2 * math.pi * vibrato_hz * index / RATE)
        phase += hz / RATE
        env = min(1.0, index / max(1, attack * RATE)) * (1 - t) ** curve
        out.append(wave(phase) * env * volume)
    return out


def mix(*tracks: list[float], offsets: tuple[float, ...] = ()) -> list[float]:
    starts = [int(offset * RATE) for offset in offsets] + [0] * (len(tracks) - len(offsets))
    out = [0.0] * max(start + len(track) for start, track in zip(starts, tracks, strict=True))
    for start, track in zip(starts, tracks, strict=True):
        for index, value in enumerate(track):
            out[start + index] += value
    return out


def lowpass(samples: list[float], cutoff_hz: float) -> list[float]:
    alpha = 1 - math.exp(-2 * math.pi * cutoff_hz / RATE)
    out, state = [], 0.0
    for value in samples:
        state += alpha * (value - state)
        out.append(state)
    return out


def arpeggio(wave: Wave, notes: list[float], step: float, volume: float) -> list[float]:
    return mix(*[tone(wave, hz, hz, step * 1.6, volume=volume, curve=1.5) for hz in notes],
               offsets=tuple(index * step for index in range(len(notes))))


def sound_effects() -> dict[str, list[float]]:
    return {
        "shot_pistol": mix(
            tone(pulse(0.5), 900, 180, 0.09, volume=0.35),
            tone(Noise(1), 9000, 3000, 0.04, volume=0.3),
        ),
        "shot_scatter": lowpass(mix(
            tone(Noise(2), 6000, 900, 0.2, volume=0.6, curve=1.6),
            tone(pulse(0.5), 320, 70, 0.14, volume=0.3),
        ), 4500),
        "enemy_hit": tone(pulse(0.25), 420, 240, 0.05, volume=0.22),
        "enemy_death": lowpass(mix(
            tone(Noise(3), 3000, 400, 0.22, volume=0.4),
            tone(pulse(0.5), 300, 55, 0.2, volume=0.25),
        ), 3500),
        "hero_hurt": tone(pulse(0.25), 240, 110, 0.2, volume=0.4,
                          vibrato_hz=30, vibrato_depth=0.08),
        "hero_death": mix(
            arpeggio(pulse(0.5), [440, 330, 262, 196, 131], 0.12, 0.3),
            tone(Noise(4), 1500, 200, 0.7, volume=0.2, curve=1.2),
        ),
        "xp_pickup": tone(pulse(0.125), 1200, 1900, 0.06, volume=0.18),
        "level_up": arpeggio(pulse(0.25), [523, 659, 784, 1047, 1319], 0.07, 0.25),
        "ui_click": tone(pulse(0.5), 1000, 900, 0.03, volume=0.2),
        "ui_buy": mix(tone(pulse(0.25), 988, 988, 0.08, volume=0.25),
                      tone(pulse(0.25), 1319, 1319, 0.2, volume=0.25), offsets=(0, 0.07)),
        "ui_error": tone(pulse(0.5), 150, 140, 0.18, volume=0.3, curve=0.5),
        "run_start": lowpass(mix(
            tone(Noise(5), 400, 4000, 0.6, volume=0.3, curve=0.8, attack=0.25),
            tone(triangle, 55, 82, 0.7, volume=0.5, curve=1.0, attack=0.1),
        ), 3000),
        "reward": arpeggio(triangle, [523, 659, 784, 1047, 784, 1047], 0.08, 0.45),
        "laser": mix(tone(pulse(0.125), 2400, 600, 0.16, volume=0.3),
                     tone(sine, 1800, 300, 0.16, volume=0.2)),
        "drone": tone(pulse(0.25), 180, 360, 0.25, volume=0.18, curve=0.8,
                      vibrato_hz=40, vibrato_depth=0.1),
        "aura": tone(triangle, 110, 100, 0.2, volume=0.2, curve=0.6),
        "firebomb": lowpass(mix(
            tone(Noise(6), 800, 4000, 0.18, volume=0.25, curve=0.5, attack=0.1),
            tone(Noise(7), 2500, 600, 0.35, volume=0.3, curve=1.4),
        ), 3500),
        "enemy_shot": tone(pulse(0.5), 520, 260, 0.08, volume=0.18),
        "explosion": lowpass(mix(
            tone(Noise(8), 2500, 120, 0.6, volume=0.5, curve=1.6),
            tone(sine, 90, 30, 0.5, volume=0.4, curve=1.2),
        ), 2500),
        "warning": mix(*[tone(pulse(0.5), 660 if i % 2 == 0 else 520, 660 if i % 2 == 0 else 520,
                              0.14, volume=0.22, curve=0.3) for i in range(4)],
                       offsets=tuple(i * 0.15 for i in range(4))),
        "crate_break": lowpass(mix(
            tone(Noise(9), 1800, 500, 0.16, volume=0.45, curve=1.8),
            tone(pulse(0.5), 160, 90, 0.08, volume=0.2),
        ), 3000),
        "cap": mix(tone(pulse(0.25), 1568, 1568, 0.04, volume=0.15),
                   tone(pulse(0.25), 2093, 2093, 0.08, volume=0.15), offsets=(0, 0.035)),
        "heal": arpeggio(sine, [392, 523, 659, 784], 0.06, 0.35),
        "powerup": tone(pulse(0.25), 300, 1500, 0.3, volume=0.25, curve=0.6,
                        vibrato_hz=18, vibrato_depth=0.05),
        "chest": mix(
            tone(Noise(10), 400, 300, 0.12, volume=0.25),
            arpeggio(pulse(0.25), [523, 659, 784, 1047, 1319, 1568], 0.06, 0.22),
            offsets=(0, 0.1),
        ),
    }


# --- music ---------------------------------------------------------------------------

NOTE_INDEX = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7,
              "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(note: str) -> float:
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((NOTE_INDEX[name] + 12 * (octave + 1) - 69) / 12)


def sequence(
    pattern: str, step_seconds: float, wave: Wave, volume: float, total: int,
    *, curve: float = 1.2, gate: float = 0.9,
) -> list[float]:
    """Pattern tokens 'A4:2' (note for 2 steps) or '-:2' (rest), repeated to `total` samples."""
    out = [0.0] * total
    cursor = 0.0
    tokens = pattern.split()
    while int(cursor * RATE) < total:
        for token in tokens:
            note, steps = token.split(":")
            length = int(steps) * step_seconds
            if note != "-":
                voice = tone(wave, hz(note), hz(note), length * gate,
                             volume=volume, curve=curve, attack=0.003)
                start = int(cursor * RATE)
                for index, value in enumerate(voice):
                    if start + index < total:
                        out[start + index] += value
            cursor += length
            if int(cursor * RATE) >= total:
                break
    return out


def drums(pattern: str, step_seconds: float, total: int, seed: int) -> list[float]:
    """'k' kick, 's' snare, 'h' hat, '.' rest; one character per step, repeated."""
    hits = {
        "k": tone(sine, 150, 40, 0.16, volume=0.7, curve=1.5),
        "s": lowpass(tone(Noise(seed), 7000, 2500, 0.14, volume=0.35, curve=1.8), 6000),
        "h": tone(Noise(seed + 1), 11000, 11000, 0.035, volume=0.12, curve=2.0),
    }
    out = [0.0] * total
    step = 0
    while int(step * step_seconds * RATE) < total:
        hit = hits.get(pattern[step % len(pattern)])
        if hit:
            start = int(step * step_seconds * RATE)
            for index, value in enumerate(hit):
                if start + index < total:
                    out[start + index] += value
        step += 1
    return out


def master(tracks: list[list[float]], cutoff: float) -> list[float]:
    total = [sum(values) for values in zip(*tracks, strict=True)]
    filtered = lowpass(total, cutoff)
    peak = max(abs(value) for value in filtered) or 1.0
    return [value * 0.85 / peak for value in filtered]


def shelter_theme() -> list[float]:
    """Calm terminal hum: Am7 - Dm7 - G7 - Cmaj7 arpeggios, 84 BPM, 8 bars."""
    step = 60 / 84 / 4  # sixteenth note
    total = int(step * 16 * 8 * RATE)
    arps = " ".join([
        "A3:2 C4:2 E4:2 G4:2 " * 2, "D3:2 F3:2 A3:2 C4:2 " * 2,
        "G3:2 B3:2 D4:2 F4:2 " * 2, "C4:2 E4:2 G4:2 B4:2 " * 2,
    ] * 2)
    bass = "A2:8 A2:8 D2:8 D2:8 G2:8 G2:8 C3:8 E2:8 " * 2
    lead = ("-:32 -:32 -:32 -:32 "
            "E5:6 D5:2 C5:8 -:16 F5:6 E5:2 D5:4 C5:4 -:16 "
            "D5:6 B4:2 G4:8 -:16 E5:4 D5:4 B4:8 C5:8 -:8")
    return master([
        sequence(arps, step, pulse(0.125), 0.10, total, curve=2.0),
        sequence(bass, step, triangle, 0.32, total, curve=0.6),
        sequence(lead, step, pulse(0.25), 0.09, total, curve=0.9),
        drums("....h.......h...", step, total, 11),
    ], cutoff=5000)


def wasteland_theme() -> list[float]:
    """Driving run music in E minor, 132 BPM, 16 bars."""
    step = 60 / 132 / 4
    total = int(step * 16 * 16 * RATE)
    bass = " ".join(
        [f"{root}:2 {root}:2 {octave}:2 {root}:2 " * 2 for root, octave in (
            ("E2", "E3"), ("E2", "E3"), ("C2", "C3"), ("D2", "D3"),
        )] * 4
    )
    lead = (
        "E4:4 G4:4 B4:6 A4:2 G4:4 F#4:4 E4:8 "
        "C5:4 B4:4 G4:4 E4:4 D4:4 F#4:4 A4:8 "
        "E4:4 G4:4 B4:6 D5:2 E5:6 D5:2 B4:8 "
        "C5:4 B4:4 A4:4 G4:4 F#4:6 D4:2 E4:8 "
        "-:32 -:32 "
        "B4:2 B4:2 A4:2 G4:2 A4:4 B4:4 G4:8 E4:8 "
        "C5:2 C5:2 B4:2 A4:2 B4:4 A4:4 F#4:8 D4:8"
    )
    pads = " ".join(["E4:16 ", "E4:16 ", "C4:16 ", "D4:16 "] * 4)
    return master([
        sequence(bass, step, pulse(0.5), 0.14, total, curve=1.4, gate=0.8),
        sequence(lead, step, pulse(0.25), 0.10, total, curve=0.7),
        sequence(pads, step, triangle, 0.10, total, curve=0.3),
        drums("k.h.s.h.k.k.s.hh", step, total, 21),
    ], cutoff=5500)


def boss_theme() -> list[float]:
    """Tense boss loop in D minor with a chromatic bass, 148 BPM, 8 bars."""
    step = 60 / 148 / 4
    total = int(step * 16 * 8 * RATE)
    bass = " ".join(["D2:2 D2:2 D3:2 D2:2 C#2:2 C#2:2 C#3:2 C#2:2 "
                     "C2:2 C2:2 C3:2 C2:2 A#1:2 A#1:2 A2:2 A1:2"] * 4)
    lead = ("D5:4 F5:4 A5:6 G#5:2 G5:4 F5:4 E5:8 "
            "D5:4 F5:4 A5:4 D6:4 C#6:8 A5:8 "
            "A#5:4 A5:4 G5:4 F5:4 E5:4 F5:4 G5:8 "
            "A5:6 G5:2 F5:4 E5:4 D5:16")
    return master([
        sequence(bass, step, pulse(0.5), 0.15, total, curve=1.2, gate=0.85),
        sequence(lead, step, pulse(0.25), 0.10, total, curve=0.6),
        drums("k.hsk.hsk.hsk.ss", step, total, 31),
    ], cutoff=5800)


def music_tracks() -> dict[str, list[float]]:
    return {"shelter": shelter_theme(), "wasteland": wasteland_theme(), "boss": boss_theme()}


def wav(samples: list[float]) -> bytes:
    data = b"".join(struct.pack("<h", max(-32767, min(32767, round(v * 32767))))
                    for v in samples)
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE", b"fmt ", 16,
                         1, 1, RATE, RATE * 2, 2, 16, b"data", len(data))
    return header + data
