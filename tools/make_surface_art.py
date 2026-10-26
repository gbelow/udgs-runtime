"""Converts the source textures of the surfaces into the small bitmaps the board repeats.

Also draws cloud.webp, the slow variation laid over every textured cell to hide
that a texture repeats. Reads every .jpg, .jpeg and .png in the source folder (public/surfaces by default)
and writes <name>.webp beside it: a TILE-pixel square without alpha, the name
lower-cased with spaces made underscores. Sources are left where they are; move
them out of public/ once converted, since everything in public/ is served.

    python tools/make_surface_art.py [source_folder]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

TILE = 256
CLOUD = 512
CLOUD_LOW = 150
DEFAULT = Path(__file__).resolve().parent.parent / 'public' / 'surfaces'
SOURCE_SUFFIXES = {'.jpg', '.jpeg', '.png'}


def convert(source: Path, out: Path) -> Path:
    name = source.stem.strip().lower().replace(' ', '_')
    target = out / f'{name}.webp'
    image = Image.open(source).convert('RGB').resize((TILE, TILE), Image.LANCZOS)
    image.save(target, quality=82, method=6)
    return target


def smooth(t):
    return t * t * (3 - 2 * t)


def cloud(path: Path) -> None:
    """Tileable greyscale value noise, white where it leaves a texture as it is."""
    rng = np.random.default_rng(7)
    total = np.zeros((CLOUD, CLOUD))
    amplitude, norm = 1.0, 0.0
    for octave in range(3):
        n = 3 * 2 ** octave
        lattice = rng.random((n, n))
        pos = np.arange(CLOUD) * n / CLOUD
        i0 = pos.astype(int) % n
        i1 = (i0 + 1) % n
        f = smooth(pos - np.floor(pos))
        top = lattice[i0][:, i0] * (1 - f)[None, :] + lattice[i0][:, i1] * f[None, :]
        bottom = lattice[i1][:, i0] * (1 - f)[None, :] + lattice[i1][:, i1] * f[None, :]
        total += (top * (1 - f)[:, None] + bottom * f[:, None]) * amplitude
        norm += amplitude
        amplitude *= 0.5
    total = total / norm
    total = (total - total.min()) / (total.max() - total.min())
    grey = CLOUD_LOW + (255 - CLOUD_LOW) * total
    Image.fromarray(grey.astype(np.uint8)).save(path, quality=85, method=6)


if __name__ == '__main__':
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    sources = sorted(p for p in folder.iterdir() if p.suffix.lower() in SOURCE_SUFFIXES)
    for source in sources:
        print(f'{source.name} -> {convert(source, DEFAULT).name}')
    cloud(DEFAULT / 'cloud.webp')
    print(f'{len(sources)} converted, cloud.webp drawn')
