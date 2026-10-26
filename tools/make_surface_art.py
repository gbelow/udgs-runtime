"""Draws the tileable textures the surfaces are laid with, into public/surfaces.

Each is one TILE-pixel square that repeats seamlessly, so the board only ever
decodes a small bitmap. Run it again after changing a colour below.
"""
from pathlib import Path

import numpy as np
from PIL import Image

TILE = 256
OUT = Path(__file__).resolve().parent.parent / 'public' / 'surfaces'
rng = np.random.default_rng(11)


def smooth(t):
    return t * t * (3 - 2 * t)


def noise(cells, octaves=1):
    """Tileable value noise in 0..1: a cells x cells lattice, wrapped, blended smoothly."""
    total = np.zeros((TILE, TILE))
    amplitude, norm = 1.0, 0.0
    for octave in range(octaves):
        n = cells * 2 ** octave
        lattice = rng.random((n, n))
        pos = np.arange(TILE) * n / TILE
        i0 = pos.astype(int) % n
        i1 = (i0 + 1) % n
        f = smooth(pos - np.floor(pos))
        top = lattice[i0][:, i0] * (1 - f)[None, :] + lattice[i0][:, i1] * f[None, :]
        bottom = lattice[i1][:, i0] * (1 - f)[None, :] + lattice[i1][:, i1] * f[None, :]
        total += (top * (1 - f)[:, None] + bottom * f[:, None]) * amplitude
        norm += amplitude
        amplitude *= 0.5
    return total / norm


def blend(low, high, t):
    low, high = np.array(low, dtype=float), np.array(high, dtype=float)
    return low + (high - low) * t[..., None]


def save(name, rgb):
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    image.save(OUT / f'{name}.webp', quality=82, method=6)


def meadow():
    patches = noise(4, 3)
    base = blend((92, 104, 64), (118, 126, 80), patches)
    blades = noise(64, 2)
    base = base * (0.93 + 0.14 * blades)[..., None]
    dry = smooth(np.clip((noise(8, 3) - 0.5) / 0.3, 0, 1)) * 0.3
    return base * (1 - dry)[..., None] + np.array((150, 138, 92)) * dry[..., None]


def earth():
    base = blend((104, 80, 56), (138, 108, 76), noise(5, 3))
    grit = noise(96, 1)
    base = base * (0.9 + 0.2 * grit)[..., None]
    pebbles = noise(48, 1) > 0.9
    return np.where(pebbles[..., None], base * 0.7 + np.array((150, 140, 128)) * 0.3, base)


def flagstone():
    courses, per_row = 8, 4
    height, width = TILE // courses, TILE // per_row
    y, x = np.mgrid[0:TILE, 0:TILE]
    row = y // height
    shifted = (x + (row % 2) * (width // 2)) % TILE
    column = shifted // width
    tone = rng.random((courses, per_row))[row, column]
    stone = blend((122, 120, 114), (158, 154, 144), tone * 0.8 + 0.2 * noise(8, 2))
    stone = stone * (0.94 + 0.12 * noise(48, 1))[..., None]
    joint = ((y % height) < 2) | ((shifted % width) < 2)
    return np.where(joint[..., None], stone * 0.55, stone)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    save('meadow', meadow())
    save('earth', earth())
    save('flagstone', flagstone())
