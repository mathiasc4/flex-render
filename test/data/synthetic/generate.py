#!/usr/bin/env python3
"""Optional data generator for the pathology shader gallery.

The gallery (``test/demo/shader-gallery.html``) is fully functional with nothing
generated at all -- it synthesizes every tile in the browser. This script only
covers the two things a browser cannot do for itself:

``--slide``
    Fetch one freely-licensed H&E histology image from Wikimedia Commons and tile
    it into a DZI pyramid, so the gallery can show real tissue instead of
    procedurally generated tissue. Writes ``ATTRIBUTION.md`` next to it.

``--precision``
    Write the high-dynamic-range Ki-67 field as a real RGBA16F binary plus a JSON
    manifest. The gallery generates the same field at runtime; the file exists so
    tests can exercise the float16 path from disk, and so the browser's
    ``toHalf`` encoder can be checked against an independent implementation.

Everything lands in ``out/``, which is gitignored.

Requires: Pillow, numpy. Networking (``--slide`` only) uses the standard library.

Usage:
    python generate.py --slide
    python generate.py --precision
    python generate.py --all
    python generate.py --slide --slide-url https://example.org/some-he-image.jpg
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import urllib.parse
import urllib.request

try:
    import numpy as np
except ImportError:  # pragma: no cover - dependency hint
    sys.exit("numpy is required: pip install numpy")

try:
    from PIL import Image
except ImportError:  # pragma: no cover - dependency hint
    sys.exit("Pillow is required: pip install Pillow")


HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "out")

USER_AGENT = (
    "flex-renderer-gallery-data-generator/1.0 "
    "(https://github.com/RationAI/flex-renderer; repository demo tooling)"
)

# Licences we are willing to redistribute inside a demo folder.
ACCEPTED_LICENCE_PREFIXES = ("cc0", "cc by", "cc-by", "public domain", "pd")


# --------------------------------------------------------------------- utilities


def log(message: str) -> None:
    print(message, flush=True)


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def http_get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


# ----------------------------------------------------------- Wikimedia slide fetch


COMMONS_API = "https://commons.wikimedia.org/w/api.php"

SEARCH_TERMS = [
    "hematoxylin eosin histology micrograph",
    "H&E stain histopathology",
    "histopathology hematoxylin eosin",
]


def _licence_is_acceptable(short_name: str) -> bool:
    lowered = (short_name or "").strip().lower()
    return any(lowered.startswith(prefix) for prefix in ACCEPTED_LICENCE_PREFIXES)


def find_commons_slide(width: int) -> dict:
    """Search Commons for a freely-licensed H&E image.

    Searching rather than hardcoding a file name means the script does not rot
    when a specific file is renamed or deleted, and it keeps the licence check
    honest: whatever it picks, it reports.
    """
    for term in SEARCH_TERMS:
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f"filetype:bitmap {term}",
            "gsrnamespace": "6",
            "gsrlimit": "25",
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata",
            "iiurlwidth": str(width),
        }
        url = f"{COMMONS_API}?{urllib.parse.urlencode(params)}"
        log(f"searching Commons: {term}")

        payload = json.loads(http_get(url).decode("utf-8"))
        pages = (payload.get("query") or {}).get("pages") or {}

        for page in pages.values():
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            licence = (meta.get("LicenseShortName") or {}).get("value", "")

            if not _licence_is_acceptable(licence):
                continue
            if not info.get("thumburl"):
                continue
            # Anything smaller than this makes a pointless pyramid.
            if int(info.get("width") or 0) < 1500:
                continue

            def clean(field: str) -> str:
                raw = (meta.get(field) or {}).get("value", "")
                # extmetadata values are HTML fragments; keep the text only.
                text = raw.replace("&amp;", "&")
                out = []
                depth = 0
                for char in text:
                    if char == "<":
                        depth += 1
                    elif char == ">":
                        depth = max(0, depth - 1)
                    elif depth == 0:
                        out.append(char)
                return " ".join("".join(out).split())

            return {
                "title": page.get("title", "(untitled)"),
                "thumburl": info["thumburl"],
                "descriptionurl": info.get("descriptionurl", ""),
                "licence": licence,
                "artist": clean("Artist"),
                "credit": clean("Credit"),
                "usage_terms": clean("UsageTerms"),
                "width": info.get("thumbwidth") or info.get("width"),
                "height": info.get("thumbheight") or info.get("height"),
            }

    raise RuntimeError(
        "no freely-licensed H&E image found on Commons; "
        "pass --slide-url to use a specific image instead"
    )


def write_attribution(out_dir: str, record: dict) -> None:
    path = os.path.join(out_dir, "ATTRIBUTION.md")
    lines = [
        "# Slide attribution",
        "",
        "The H&E slide in this folder was not authored by this project. It was",
        "downloaded by `test/data/synthetic/generate.py --slide`.",
        "",
        f"- **File**: {record.get('title', '')}",
        f"- **Source page**: {record.get('descriptionurl') or record.get('source_url', '')}",
        f"- **Downloaded from**: {record.get('source_url', '')}",
        f"- **Licence**: {record.get('licence', 'see source page')}",
        f"- **Usage terms**: {record.get('usage_terms', '')}",
        f"- **Author / artist**: {record.get('artist', '')}",
        f"- **Credit**: {record.get('credit', '')}",
        "",
        "If you redistribute this pyramid, carry this attribution with it.",
        "",
    ]
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    log(f"wrote {path}")


# ------------------------------------------------------------------- DZI tiling


def write_dzi(
    image: Image.Image,
    out_dir: str,
    name: str,
    tile_size: int = 254,
    overlap: int = 1,
    quality: int = 82,
) -> str:
    """Write a Deep Zoom pyramid, matching the existing fixtures in test/data."""
    width, height = image.size
    max_level = max(1, math.ceil(math.log2(max(width, height))))

    files_dir = os.path.join(out_dir, f"{name}_files")
    if os.path.isdir(files_dir):
        shutil.rmtree(files_dir)
    ensure_dir(files_dir)

    total = 0
    for level in range(max_level + 1):
        scale = 2 ** (max_level - level)
        level_w = max(1, math.ceil(width / scale))
        level_h = max(1, math.ceil(height / scale))
        level_image = image.resize((level_w, level_h), Image.LANCZOS)

        level_dir = os.path.join(files_dir, str(level))
        ensure_dir(level_dir)

        columns = math.ceil(level_w / tile_size)
        rows = math.ceil(level_h / tile_size)

        for row in range(rows):
            for col in range(columns):
                # Overlap is added on every inner edge, which is what the DZI
                # spec means and what OpenSeadragon expects.
                left = max(0, col * tile_size - overlap)
                top = max(0, row * tile_size - overlap)
                right = min(level_w, (col + 1) * tile_size + overlap)
                bottom = min(level_h, (row + 1) * tile_size + overlap)

                tile = level_image.crop((left, top, right, bottom))
                tile.convert("RGB").save(
                    os.path.join(level_dir, f"{col}_{row}.jpg"),
                    "JPEG",
                    quality=quality,
                    optimize=True,
                )
                total += 1

    descriptor = os.path.join(out_dir, f"{name}.dzi")
    with open(descriptor, "w", encoding="utf-8") as handle:
        handle.write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"\n'
            f'       Format="jpg" Overlap="{overlap}" TileSize="{tile_size}">\n'
            f'    <Size Width="{width}" Height="{height}"/>\n'
            "</Image>\n"
        )

    log(f"wrote {descriptor} ({total} tiles, levels 0-{max_level})")
    return descriptor


def build_slide(out_dir: str, url: str | None, width: int, force: bool) -> None:
    descriptor = os.path.join(out_dir, "he_slide.dzi")
    if os.path.exists(descriptor) and not force:
        log(f"{descriptor} already exists; pass --force to rebuild")
        return

    if url:
        record = {"source_url": url, "title": os.path.basename(url), "licence": "(supplied by --slide-url)"}
        log(f"downloading {url}")
    else:
        record = find_commons_slide(width)
        record["source_url"] = record["thumburl"]
        log(f"selected {record['title']}  [{record['licence']}]")
        log(f"downloading {record['source_url']}")

    ensure_dir(out_dir)
    raw = http_get(record["source_url"])

    temp = os.path.join(out_dir, "_he_slide_source")
    with open(temp, "wb") as handle:
        handle.write(raw)

    with Image.open(temp) as image:
        image = image.convert("RGB")
        log(f"source image: {image.size[0]}x{image.size[1]}")
        write_dzi(image, out_dir, "he_slide")

    os.remove(temp)
    write_attribution(out_dir, record)


# ------------------------------------------------- the field, mirrored from JS
#
# These reproduce the noise in test/demo/synthetic-pathology-sources.js exactly:
# the same 32-bit integer hash, the same octave weights, the same lesion lobes.
# Exact agreement is not something the gallery depends on, but it makes the file
# fixture and the runtime field comparable, which is the point of having both.

MASK32 = 0xFFFFFFFF


def _imul(a, b):
    """JS Math.imul over numpy arrays: low 32 bits of a signed 32-bit product."""
    return ((np.asarray(a, dtype=np.int64) * np.int64(b)) & MASK32).astype(np.int64)


def _ushr(x, n):
    return (np.asarray(x, dtype=np.int64) & MASK32) >> n


def hash2(ix, iy, seed):
    h = _imul(ix, 374761393) ^ _imul(iy, 668265263) ^ _imul(np.full_like(np.asarray(ix, dtype=np.int64), seed), 2147483647)
    h = _imul(h ^ _ushr(h, 13), 1274126177)
    h = h ^ _ushr(h, 16)
    return (h & MASK32).astype(np.float64) / 4294967296.0


def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def value_noise(x, y, seed):
    ix = np.floor(x).astype(np.int64)
    iy = np.floor(y).astype(np.int64)
    fx = _smooth(x - ix)
    fy = _smooth(y - iy)

    a = hash2(ix, iy, seed)
    b = hash2(ix + 1, iy, seed)
    c = hash2(ix, iy + 1, seed)
    d = hash2(ix + 1, iy + 1, seed)

    top = a + (b - a) * fx
    bottom = c + (d - c) * fx
    return top + (bottom - top) * fy


def fbm(x, y, seed, octaves=4):
    total = np.zeros_like(np.asarray(x, dtype=np.float64))
    amp = 0.5
    norm = 0.0
    fx = np.asarray(x, dtype=np.float64)
    fy = np.asarray(y, dtype=np.float64)

    for i in range(octaves):
        total = total + amp * value_noise(fx, fy, seed + i * 101)
        norm += amp
        amp *= 0.5
        fx = fx * 2.03
        fy = fy * 1.97

    return total / norm


def smoothstep(edge0, edge1, v):
    return _smooth(np.clip((v - edge0) / (edge1 - edge0), 0.0, 1.0))


IMAGE_SIZE = 8192


def tissue_mask(x, y):
    nx = x / IMAGE_SIZE
    ny = y / IMAGE_SIZE
    dx = nx - 0.5
    dy = ny - 0.5
    r = np.sqrt(dx * dx + dy * dy)
    wobble = 0.10 * (fbm(nx * 3.1, ny * 3.1, 7717, 3) - 0.5)
    return smoothstep(0.50, 0.42, r + wobble)


def lesion_field(x, y):
    nx = x / IMAGE_SIZE
    ny = y / IMAGE_SIZE

    warp = fbm(nx * 2.6, ny * 2.6, 4211, 4) - 0.5
    wx = nx + 0.10 * warp
    wy = ny + 0.10 * (fbm(nx * 2.6 + 5.5, ny * 2.6 - 3.1, 4211, 4) - 0.5)

    d1 = np.hypot(wx - 0.36, wy - 0.41) / 0.21
    d2 = np.hypot(wx - 0.64, wy - 0.66) / 0.14
    d3 = np.hypot(wx - 0.72, wy - 0.28) / 0.075

    lobes = np.exp(-d1 * d1) + 0.85 * np.exp(-d2 * d2) + 0.6 * np.exp(-d3 * d3)
    texture = 0.80 + 0.40 * fbm(nx * 9, ny * 9, 9091, 3)

    return np.clip(lobes * texture, 0.0, 1.0) * tissue_mask(x, y)


def build_precision_fixture(out_dir: str, size: int, force: bool) -> None:
    binary_path = os.path.join(out_dir, "ki67_f16.bin")
    manifest_path = os.path.join(out_dir, "ki67_f16.json")

    if os.path.exists(binary_path) and not force:
        log(f"{binary_path} already exists; pass --force to rebuild")
        return

    ensure_dir(out_dir)
    log(f"generating {size}x{size} RGBA16F Ki-67 field")

    # Sample the full image extent, matching what the runtime source produces at
    # the pyramid level whose tile grid covers `size` pixels.
    step = IMAGE_SIZE / size
    coords = (np.arange(size, dtype=np.float64) * step)
    xs, ys = np.meshgrid(coords, coords, indexing="xy")

    lesion = lesion_field(xs, ys)
    noise = fbm(xs / 640.0, ys / 640.0, 2749, 3)

    score = -0.4 + 3.5 * lesion * (0.55 + 0.75 * noise)
    ratio = 2.4 * (lesion - 0.42) + 0.9 * (noise - 0.5)
    normalized = np.clip(score / 3.1, 0.0, 1.0)

    rgba = np.empty((size, size, 4), dtype=np.float16)
    rgba[..., 0] = score.astype(np.float16)
    rgba[..., 1] = ratio.astype(np.float16)
    rgba[..., 2] = normalized.astype(np.float16)
    rgba[..., 3] = np.float16(1.0)

    with open(binary_path, "wb") as handle:
        handle.write(rgba.tobytes())

    manifest = {
        "format": "RGBA16F",
        "width": size,
        "height": size,
        "channelCount": 4,
        "byteOrder": "little-endian",
        "layout": "interleaved RGBA, row-major, top-left origin",
        "binary": os.path.basename(binary_path),
        "channels": [
            {"index": 0, "name": "ki67-score", "min": float(score.min()), "max": float(score.max())},
            {"index": 1, "name": "log2-ratio", "min": float(ratio.min()), "max": float(ratio.max())},
            {"index": 2, "name": "ki67-normalized", "min": 0.0, "max": 1.0},
            {"index": 3, "name": "one", "min": 1.0, "max": 1.0},
        ],
        "notes": [
            "Channels 0 and 1 deliberately leave [0,1]; an RGBA8 colour target clamps them away.",
            "Feed as {width, height, channelCount, packs: [{format: 'RGBA16F', data: Uint16Array}]}.",
        ],
    }

    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    log(f"wrote {binary_path} ({os.path.getsize(binary_path)} bytes)")
    log(f"wrote {manifest_path}")
    log(
        "channel 0 range: "
        f"{score.min():.3f} .. {score.max():.3f}   "
        f"channel 1 range: {ratio.min():.3f} .. {ratio.max():.3f}"
    )


# ------------------------------------------------------------------------- main


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Optional data generator for the pathology shader gallery.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--slide", action="store_true", help="fetch and tile a real H&E slide")
    parser.add_argument("--precision", action="store_true", help="write the RGBA16F Ki-67 fixture")
    parser.add_argument("--all", action="store_true", help="do everything")
    parser.add_argument("--force", action="store_true", help="overwrite existing output")
    parser.add_argument("--out", default=DEFAULT_OUT, help=f"output directory (default: {DEFAULT_OUT})")
    parser.add_argument(
        "--slide-url",
        default=None,
        help="download this image instead of searching Commons; you own the licence check",
    )
    parser.add_argument(
        "--slide-width",
        type=int,
        default=4096,
        help="requested width of the downloaded slide (default: 4096)",
    )
    parser.add_argument(
        "--precision-size",
        type=int,
        default=512,
        help="side length of the RGBA16F fixture (default: 512)",
    )

    args = parser.parse_args(argv)

    do_slide = args.slide or args.all
    do_precision = args.precision or args.all

    if not (do_slide or do_precision):
        parser.print_help()
        log("\nNothing selected. The gallery works without any of this; see README.md.")
        return 0

    ensure_dir(args.out)

    if do_slide:
        build_slide(args.out, args.slide_url, args.slide_width, args.force)

    if do_precision:
        build_precision_fixture(args.out, args.precision_size, args.force)

    return 0


if __name__ == "__main__":
    sys.exit(main())
