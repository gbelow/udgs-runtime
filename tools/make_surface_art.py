"""Converts the source textures of the surfaces into the small bitmaps the board repeats.

Reads every .jpg, .jpeg and .png in the source folder (public/surfaces by default)
and writes <name>.webp beside it: a TILE-pixel square without alpha, the name
lower-cased with spaces made underscores. Sources are left where they are; move
them out of public/ once converted, since everything in public/ is served.

    python tools/make_surface_art.py [source_folder]
"""
import sys
from pathlib import Path

from PIL import Image

TILE = 256
DEFAULT = Path(__file__).resolve().parent.parent / 'public' / 'surfaces'
SOURCE_SUFFIXES = {'.jpg', '.jpeg', '.png'}


def convert(source: Path, out: Path) -> Path:
    name = source.stem.strip().lower().replace(' ', '_')
    target = out / f'{name}.webp'
    image = Image.open(source).convert('RGB').resize((TILE, TILE), Image.LANCZOS)
    image.save(target, quality=82, method=6)
    return target


if __name__ == '__main__':
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    sources = sorted(p for p in folder.iterdir() if p.suffix.lower() in SOURCE_SUFFIXES)
    for source in sources:
        print(f'{source.name} -> {convert(source, DEFAULT).name}')
    print(f'{len(sources)} converted')
