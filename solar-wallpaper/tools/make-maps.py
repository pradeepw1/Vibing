#!/usr/bin/env python3
"""Makes the real planet and moon maps in dist/maps/ from NASA, USGS and other source maps.

    python3 tools/make-maps.py fetch [--src DIR] [--only moon,mars]
    python3 tools/make-maps.py build [--src DIR] [--out DIR] [--only moon,mars] [--preview DIR]

You need Python 3.9 or newer, Pillow (with WebP) and numpy: `pip install pillow numpy`.
`fetch` downloads the originals (about 3.5 GB, a few minutes on a fast line) and
shrinks each to at most 8192 pixels wide, kept in --src (default tools/maps-src/,
which git ignores). `build` turns those into the files the page loads.

What `build` writes, for every map, in two sizes ("lite" and "sharp"):

    dist/maps/<name>.<size>.js     window.__maps["<name>.<size>"] = "data:image/webp;base64,..."

Browsers won't read image files next to a page opened from disk (file://), but they
do run <script src> files and read data: addresses, so that is how the maps travel.

Along the way it does the clean-up the originals need:
  - paints the grey maps with a believable colour (Europa, Callisto, Pluto, ...)
  - fills the parts nobody ever photographed with blurred neighbours and a little grain
  - makes the left and right edges meet, and the poles come to a clean point
  - cuts every map down to the size it needs, and packs Earth's night lights and
    water into one picture, the way the page's shader wants them
"""
import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None  # the originals are huge on purpose

ROOT = Path(__file__).resolve().parent.parent
MAX_SRC = 8192  # sources are shrunk to this width (or less) once, in fetch

# --------------------------------------------------------------------------------
# Where everything comes from. The first address that works is used.
# Licences, in short: NASA and USGS maps are public domain (credit the source);
# Solar System Scope maps are CC BY 4.0 (credit them and say they were changed);
# Natural Earth is public domain.

USGS = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/"
SSS = "https://www.solarsystemscope.com/textures/download/"
# The same Solar System Scope files in a public GitHub repository, for when their own site can't be reached.
SSS_MIRROR = "https://media.githubusercontent.com/media/computationalcore/worldline-kinematics/main/apps/web/public/textures/"
NE_VECTOR = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NASA3D = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/"


def sss(name):
    return [SSS + name, SSS_MIRROR + name]


def usgs(name):
    return [USGS + name]


SOURCES = {
    # name: (file name once downloaded, [addresses], who made it, licence)
    "earth_day": ("earth_day.jpg", [
        "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg",
        "https://raw.githubusercontent.com/AlnisS/pasaules-skati/HEAD/data/world.topo.bathy.200412.3x5400x2700.jpg",
    ], "NASA Earth Observatory, Blue Marble Next Generation (December 2004, with sea floor)", "NASA, no copyright"),
    "earth_night": ("earth_night.jpg", sss("8k_earth_nightmap.jpg"), "Solar System Scope, from NASA night-time pictures", "CC BY 4.0"),
    "earth_clouds": ("earth_clouds.jpg", sss("8k_earth_clouds.jpg"), "Solar System Scope, from NASA satellite pictures", "CC BY 4.0"),
    "land": ("land.geojson", [NE_VECTOR + "ne_10m_land.geojson"], "Natural Earth, land (1:10m)", "public domain"),
    "lakes": ("lakes.geojson", [NE_VECTOR + "ne_10m_lakes.geojson"], "Natural Earth, lakes (1:10m)", "public domain"),
    "moon": ("moon.jpg", sss("8k_moon.jpg"), "Solar System Scope, from NASA LRO and JAXA Kaguya data", "CC BY 4.0"),
    "mars": ("mars.tif", usgs("Mars_Viking_ClrMosaic_global_925m.tif"), "USGS Astrogeology, Viking colour mosaic", "public domain"),
    "jupiter": ("jupiter.jpg", sss("8k_jupiter.jpg"), "Solar System Scope, from NASA Cassini pictures", "CC BY 4.0"),
    "saturn": ("saturn.jpg", sss("8k_saturn.jpg"), "Solar System Scope, from Cassini pictures", "CC BY 4.0"),
    "saturn_rings": ("saturn_rings.png", sss("8k_saturn_ring_alpha.png"), "Solar System Scope", "CC BY 4.0"),
    "venus": ("venus.jpg", [SSS + "4k_venus_atmosphere.jpg", "https://media.githubusercontent.com/media/bryancgarry/JHU.605.667-FinalProject/HEAD/textures/4k_venus_atmosphere.jpg"], "Solar System Scope (Venus's cloud tops)", "CC BY 4.0"),
    "mercury": ("mercury.tif", usgs("Mercury_MESSENGER_MDIS_Basemap_MD3Color_Mosaic_Global_665m.tif"), "USGS Astrogeology, from MESSENGER pictures (NASA/JHUAPL/CIW)", "public domain"),
    "uranus": ("uranus.jpg", sss("2k_uranus.jpg"), "Solar System Scope", "CC BY 4.0"),
    "neptune": ("neptune.jpg", sss("2k_neptune.jpg"), "Solar System Scope", "CC BY 4.0"),
    "pluto": ("pluto.tif", usgs("Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif"), "USGS Astrogeology, from New Horizons pictures (NASA/JHUAPL/SwRI)", "public domain"),
    "charon": ("charon.tif", usgs("Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif"), "USGS Astrogeology, from New Horizons pictures (NASA/JHUAPL/SwRI)", "public domain"),
    "io": ("io.tif", usgs("Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif"), "USGS Astrogeology, from Galileo and Voyager pictures", "public domain"),
    "europa": ("europa.tif", usgs("Europa_Voyager_GalileoSSI_global_mosaic_500m.tif"), "USGS Astrogeology, from Galileo and Voyager pictures", "public domain"),
    "ganymede": ("ganymede.tif", usgs("Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif"), "USGS Astrogeology, from Galileo and Voyager pictures", "public domain"),
    "callisto": ("callisto.tif", usgs("Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif"), "USGS Astrogeology, from Galileo and Voyager pictures", "public domain"),
    "titan": ("titan.tif", usgs("Titan_ISS_P19658_Mosaic_Global_4km.tif"), "USGS Astrogeology, from Cassini pictures", "public domain"),
    "triton": ("triton.tif", usgs("Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif"), "USGS Astrogeology, Paul Schenk (Lunar and Planetary Institute), from Voyager 2 pictures", "public domain"),
    "phobos": ("phobos.tif", usgs("Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif"), "USGS Astrogeology, from Viking pictures (DLR control)", "public domain"),
    "deimos": ("deimos.jpg", ["https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/hires/deimos.jpg"], "Celestia project, from Philip Stooke's maps in NASA's Planetary Data System", "CC0"),
    "rhea": ("rhea.tif", usgs("Rhea_Cassini_Voyager_mosaic_global_417m.tif"), "USGS Astrogeology, from Cassini and Voyager pictures", "public domain"),
    "iapetus": ("iapetus.tif", usgs("Iapetus_Cassini_Voyager_mosaic_global_783m.tif"), "USGS Astrogeology, from Cassini and Voyager pictures", "public domain"),
}
for _m in ["Miranda", "Ariel", "Umbriel", "Titania", "Oberon"]:
    SOURCES[_m.lower()] = (f"{_m.lower()}.jpg", [f"{NASA3D}Uranus%20-%20{_m}/Uranus%20-%20{_m}.jpg"], "NASA 3D Resources, from Voyager 2 pictures", "NASA, no copyright")


# --------------------------------------------------------------------------------
# Fetch

def download(urls, dest, label):
    last = None
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "solar-wallpaper-maps/1"})
            with urllib.request.urlopen(req, timeout=60) as r, open(str(dest) + ".part", "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                t0 = time.time()
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    got += len(chunk)
                    if total and sys.stdout.isatty():
                        print(f"\r  {label}: {got / 1e6:.0f} of {total / 1e6:.0f} MB", end="", flush=True)
            os.replace(str(dest) + ".part", dest)
            print(f"\r  {label}: {got / 1e6:.1f} MB in {time.time() - t0:.0f} s from {url.split('/')[2]}" + " " * 10)
            return
        except Exception as e:  # try the next address
            last = e
            print(f"  {label}: {url.split('/')[2]} failed ({e})")
    raise SystemExit(f"Could not download {label}: {last}")


def shrink(path, out):
    """Reads a big map (any mode) and saves it as an 8-bit PNG at most MAX_SRC wide."""
    im = Image.open(path)
    w, h = im.size
    if im.mode.startswith("I;16") or im.mode in ("I", "F"):
        a = np.asarray(im).astype("float32")
        lo, hi = np.percentile(a, [0.5, 99.5])
        im = Image.fromarray((((a - lo) / (hi - lo)).clip(0, 1) * 255).astype("uint8"), "L")
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    if w > MAX_SRC:
        im = im.resize((MAX_SRC, MAX_SRC * h // w), Image.LANCZOS, reducing_gap=2.0)
    im.save(out, compress_level=1)
    print(f"  {path.name}: {w}x{h} {Image.open(path).mode} -> {im.size[0]}x{im.size[1]}")


def source_path(src, name):
    """Where the ready-to-use copy of a source lives (a PNG made by fetch, or the file as downloaded)."""
    file = SOURCES[name][0]
    png = src / (Path(file).stem + ".png")
    return png if png.exists() else src / file


def fetch(src, only):
    src.mkdir(parents=True, exist_ok=True)
    raw = src / "_raw"
    raw.mkdir(exist_ok=True)
    for name, (file, urls, _credit, _licence) in SOURCES.items():
        if only and name not in only:
            continue
        done = src / file if not file.endswith(".tif") else src / (Path(file).stem + ".png")
        if done.exists():
            continue
        if file.endswith(".tif"):
            tmp = raw / file
            if not tmp.exists():
                download(urls, tmp, name)
            shrink(tmp, done)
            tmp.unlink()  # the original is huge and not needed again
        else:
            download(urls, done, name)




# --------------------------------------------------------------------------------
# Image helpers. A map is a float32 array, height x width x 3, 0..1. Longitude
# runs left to right (-180 to 180, 0 in the middle) and north is at the top.

def read(src, name, mode="RGB"):
    return Image.open(source_path(src, name)).convert(mode)


def to_arr(im):
    return np.asarray(im, dtype="float32") / 255.0


def to_img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype("uint8"), "RGB" if a.ndim == 3 else "L")


def resize(im, width, height=None):
    """Resizes a map image, wrapping round the 180 degree seam so the two edges still meet."""
    height = height or width // 2
    w, h = im.size
    if (w, h) == (width, height):
        return im
    pad = max(8, int(np.ceil(8 * w / width)))
    wide = Image.new(im.mode, (w + 2 * pad, h))
    wide.paste(im.crop((w - pad, 0, w, h)), (0, 0))
    wide.paste(im, (pad, 0))
    wide.paste(im.crop((0, 0, pad, h)), (pad + w, 0))
    pad2 = int(round(pad * width / w))
    wide = wide.resize((width + 2 * pad2, height), Image.LANCZOS, reducing_gap=2.0)
    return wide.crop((pad2, 0, pad2 + width, height))


def resize_f(a, width, height):
    """Resizes a float array (any number of channels) smoothly."""
    a = a if a.ndim == 3 else a[..., None]
    chans = [np.asarray(Image.fromarray(np.ascontiguousarray(a[..., c]), "F").resize((width, height), Image.BICUBIC)) for c in range(a.shape[2])]
    return np.stack(chans, axis=2)


def luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def box(a, r, axis, wrap):
    """Average over a window of 2r+1 along one axis (wrapping round, or repeating the edge)."""
    n = a.shape[axis]
    r = min(r, n // 2 - 1) if wrap else r
    idx = lambda s: tuple(s if i == axis else slice(None) for i in range(a.ndim))
    if wrap:
        head, tail = a[idx(slice(n - r, n))], a[idx(slice(0, r))]
    else:
        head = np.repeat(a[idx(slice(0, 1))], r, axis=axis)
        tail = np.repeat(a[idx(slice(n - 1, n))], r, axis=axis)
    p = np.concatenate([head, a, tail], axis=axis)
    z = np.cumsum(p, axis=axis, dtype=np.float32)
    z = np.concatenate([np.zeros_like(np.take(z, [0], axis=axis)), z], axis=axis)
    out = z[idx(slice(2 * r + 1, 2 * r + 1 + n))] - z[idx(slice(0, n))]
    return out / (2 * r + 1)


def blur(a, sigma, wrap=True):
    """Gaussian-like blur (three box passes), wrapping across the seam."""
    if sigma < 0.6:
        return a
    r = max(1, int(round((np.sqrt(4 * sigma * sigma + 1) - 1) / 2)))
    out = a
    for _ in range(3):
        out = box(out, r, 1, wrap)
        out = box(out, r, 0, False)
    return out


def dilate(mask, r):
    m = mask.astype("float32")
    return box(box(m, r, 1, True), r, 0, False) > 0.5 / (2 * r + 1) ** 2


def erode(mask, r):
    m = mask.astype("float32")
    return box(box(m, r, 1, True), r, 0, False) > 1 - 0.5 / (2 * r + 1) ** 2


def roll_lon(a, turns):
    """Moves longitudes round the map by a fraction of a turn (0.5 puts 180 degrees in the middle)."""
    return np.roll(a, int(round(turns * a.shape[1])), axis=1)


def fix_seam(a):
    """If the left and right edges don't match, spreads the difference over a band so they do."""
    h, w = a.shape[:2]
    edge = np.abs(a[:, 0] - a[:, -1]).mean()
    usual = (np.abs(a[:, w // 2] - a[:, w // 2 + 1]).mean() + np.abs(a[:, w // 4] - a[:, w // 4 + 1]).mean()) / 2
    if edge < 2.0 * usual + 0.004:
        return a
    d = blur((a[:, 0] - a[:, -1])[:, None, :], 5, wrap=False)[:, 0] / 2  # per row, smoothed
    band = max(24, w // 40)
    ramp = (1 - smoothstep(0, band, np.arange(band, dtype="float32")))[None, :, None]
    out = a.copy()
    out[:, :band] -= d[:, None, :] * ramp
    out[:, w - band:] += d[:, None, :] * ramp[:, ::-1]
    print("    seam: edges differed by %.3f, joined" % edge)
    return np.clip(out, 0, 1)


def fix_poles(a, from_lat=78.0):
    """Blends the rows near each pole towards their average, so each pole is a clean point and not a pinch."""
    h = a.shape[0]
    lat = np.abs(90 - (np.arange(h) + 0.5) / h * 180)
    wgt = (smoothstep(from_lat, 90.0, lat) ** 1.3)[:, None, None]
    return a * (1 - wgt) + a.mean(axis=1, keepdims=True) * wgt


def noise(shape, scale, rng):
    """Soft random grain with average size `scale` pixels, centred on 0 with spread about 1."""
    n = rng.standard_normal(shape[:2]).astype("float32")
    n = blur(n[..., None], scale / 2.0)[..., 0]
    return n / (n.std() + 1e-6)


def dither(a, rng, amount=0.7):
    """A little noise before the map is squeezed to 8 bits and compressed: stops bands in smooth gradients."""
    return a + (rng.random(a.shape[:2], dtype="float32") + rng.random(a.shape[:2], dtype="float32") - 1)[..., None] * (amount / 255)


# --------------------------------------------------------------------------------
# Gaps: parts nobody ever photographed show up as pure black.

def find_gaps(a, thresh=2.5 / 255, grow=1 / 300):
    """Pure black in big blocks. `grow` (a share of the width) widens it to take in the ragged, darkened edge."""
    w = a.shape[1]
    dark = a.max(axis=2) <= thresh
    r = max(1, w // 800)
    dark = dilate(erode(dark, r), r)  # drop lone dark specks that are real
    return dilate(dark, max(2, int(w * grow)))


def fill_gaps(a, bad, rng, borrow=True, gain=0.9):
    """Fills the pixels where `bad` is true with a smooth blend of what's around them.

    With `borrow`, fine detail (craters, ridges) is copied in from elsewhere on
    the map (turned upside down and moved round), so the patch isn't smooth.
    """
    h, w = bad.shape
    if not bad.any():
        return a
    sw = min(w, 512)
    sh = sw // 2
    a_s = resize_f(a, sw, sh)
    bad_s = resize_f(bad.astype("float32"), sw, sh)[..., 0] > 0.25
    good = (~bad_s).astype("float32")[..., None]
    num = a_s * good
    acc = np.zeros_like(a_s)
    done = np.zeros((sh, sw, 1), "float32")
    sigma = 1.5
    while done[bad_s].min(initial=1.0) < 0.999 and sigma < sw:
        d = blur(good, sigma)
        e = blur(num, sigma) / np.maximum(d, 1e-4)
        wk = np.clip(d / 0.35, 0, 1) * (1 - done)
        acc += wk * e
        done += wk
        sigma *= 1.7
    acc += (1 - done) * (num.sum((0, 1)) / max(good.sum(), 1))
    fill = resize_f(acc, w, h)
    if borrow:
        turn = 0.31
        src = np.flipud(roll_lon(a, turn))
        ok = ~np.flipud(roll_lon(bad, turn))
        okf = ok[..., None].astype("float32")
        s = max(2.0, w / 250)
        base = blur(src * okf, s) / np.maximum(blur(okf, s), 1e-3)
        ratio = np.clip(src / np.maximum(base, 0.02), 0.6, 1.6)
        ratio = np.where(ok[..., None], ratio, 1.0)
        # Where the borrowed patch is also missing, fall back on a little grain.
        grain = 1 + 0.025 * (noise(a.shape, 3.0, rng) * 0.6 + noise(a.shape, 8.0, rng) * 0.4)[..., None]
        fill = fill * (1 + gain * (ratio - 1)) * np.where(ok[..., None], 1.0, grain)
    else:
        fill = fill * (1 + 0.02 * (noise(a.shape, 4.0, rng) * 0.5 + noise(a.shape, 14.0, rng) * 0.5)[..., None])
    soft = blur(bad.astype("float32")[..., None], max(2.0, w / 450))
    wgt = np.clip((soft - 0.15) / 0.7, 0, 1)
    return a * (1 - wgt) + fill * wgt


# --------------------------------------------------------------------------------
# Colour. Several of the best maps are grey, and Mercury's is exaggerated.

def ramp(v, stops):
    """Colours values (0..1) along a list of (position, hex colour) stops."""
    pos = np.array([p for p, _ in stops], dtype="float32")
    cols = np.array([[int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)] for _, c in stops], dtype="float32")
    return np.stack([np.interp(v, pos, cols[:, k]) for k in range(3)], axis=-1).astype("float32")


def tint(grey, stops, lo=1.0, hi=99.0, gamma=1.0, mean=None):
    """Paints a grey map: how bright a pixel is picks its colour from `stops`.

    `lo` and `hi` are the percentiles of brightness that map to the two ends
    of the ramp. `mean` rescales the result so its average brightness is that.
    """
    l0, l1 = np.percentile(grey, [lo, hi])
    out = ramp(np.clip((grey - l0) / (l1 - l0), 0, 1) ** gamma, stops)
    if mean is not None:
        out *= mean / luma(out).mean()
    return np.clip(out, 0, 1)


def saturate(a, k):
    l = luma(a)[..., None]
    return np.clip(l + (a - l) * k, 0, 1)


def scale_mean(a, mean):
    return np.clip(a * (mean / luma(a).mean()), 0, 1)


# --------------------------------------------------------------------------------
# One recipe for each map. Each gets the width it should be made at and returns
# a float array of that width. `rng` makes the grain the same on every run.

def load(src, name, width, mode="RGB"):
    im = read(src, name, mode)
    width = min(width, im.size[0])
    arr = to_arr(resize(im, width))
    return arr if mode == "RGB" else arr[..., None].repeat(3, axis=2)


def plain(name, **opts):
    """A map used as it is, with the seam and poles tidied."""
    def make(src, width, rng):
        a = fix_seam(load(src, name, width))
        a = fix_poles(a, opts.get("pole", 78.0))
        if "saturation" in opts:
            a = saturate(a, opts["saturation"])
        if "mean" in opts:
            a = scale_mean(a, opts["mean"])
        return a
    return make


def grey_moon(name, stops, roll=0.0, mean=None, lo=1.0, hi=99.0, gamma=1.0, fill=True, borrow=True, blur_px=0.0, contrast=None, grow=1 / 300):
    """A grey map made into a coloured one, with the unmapped parts filled."""
    def make(src, width, rng):
        a = load(src, name, width)
        if roll:
            a = roll_lon(a, roll)
        bad = find_gaps(a, grow=grow) if fill else np.zeros(a.shape[:2], bool)
        a = fill_gaps(a, bad, rng, borrow=borrow)
        g = luma(a)
        if blur_px:
            g = blur(g[..., None], blur_px)[..., 0]
        if contrast is not None:  # flatten (or boost) the contrast around the middle grey
            g = g.mean() + (g - g.mean()) * contrast
        out = tint(g, stops, lo=lo, hi=hi, gamma=gamma, mean=mean)
        return fix_poles(fix_seam(out))
    return make


def colour_moon(name, roll=0.0, borrow=True, mean=None, saturation=None, fill=True):
    def make(src, width, rng):
        a = load(src, name, width)
        if roll:
            a = roll_lon(a, roll)
        bad = find_gaps(a) if fill else np.zeros(a.shape[:2], bool)
        a = fill_gaps(a, bad, rng, borrow=borrow)
        if saturation is not None:
            a = saturate(a, saturation)
        if mean is not None:
            a = scale_mean(a, mean)
        return fix_poles(fix_seam(a))
    return make


def mercury(src, width, rng):
    a = load(src, "mercury", width)
    bad = find_gaps(a)
    a = fill_gaps(a, bad, rng, borrow=False)
    # The colours in this map are stretched to show different rock; the real planet is a brownish grey.
    l = luma(a)[..., None]
    a = np.clip(l + (a - l) * 0.45, 0, 1) * np.array([1.08, 1.0, 0.88], "float32")
    a = scale_mean(a, 0.27) ** 0.92
    return fix_poles(fix_seam(a))


def titan(src, width, rng):
    """Titan from space is an orange ball of haze; the surface in this map (seen in infrared) only just shows through."""
    a = load(src, "titan", width)
    g = luma(a)
    g = blur(g[..., None], max(1.5, width / 700))[..., 0]  # joins between the pictures, and the haze, soften it
    g = g.mean() + (g - g.mean()) * 0.38
    out = tint(g, [(0.0, "#a8651f"), (0.5, "#cf8c3c"), (1.0, "#e6b265")], lo=2, hi=98, mean=0.46)
    return fix_poles(fix_seam(out))


def triton(src, width, rng):
    """The colours in the original map are stretched to show different ices; the real Triton is a pale pinkish cream."""
    a = load(src, "triton", width)
    bad = find_gaps(a, grow=1 / 120)
    a = fill_gaps(a, bad, rng, borrow=False)
    l = luma(a)
    cream = tint(l, [(0.0, "#5e514c"), (0.5, "#b4a49a"), (1.0, "#f1e6dc")], lo=1, hi=99.5)
    out = np.clip(cream + (a - l[..., None]) * 0.3, 0, 1)
    return fix_poles(fix_seam(scale_mean(out, 0.55)))


def earth_day(src, width, rng):
    return fix_poles(fix_seam(load(src, "earth_day", width)), 80.0)


def earth_lights_and_water(src, width, rng):
    """Red = city lights, green = water (none over sea ice), blue unused. Read as plain numbers, not colours."""
    h = width // 2
    night = to_arr(resize(read(src, "earth_night"), width))
    lights = np.maximum(night[..., 0], night[..., 1])
    floor = np.percentile(lights, 60) + 0.01
    lights = np.clip((lights - floor) / (0.55 - floor), 0, 1) ** 0.8
    lights = np.clip(lights * 1.5, 0, 1)
    water = water_mask(src, width)
    day = luma(to_arr(resize(read(src, "earth_day"), width)))
    ice = smoothstep(0.55, 0.78, day)  # sea ice and bright glare don't shine like water
    out = np.zeros((h, width, 3), "float32")
    out[..., 0] = lights
    out[..., 1] = water * (1 - ice)
    return out


def water_mask(src, width):
    """1 where there is sea or lake, from Natural Earth's land and lake outlines."""
    h = width // 2
    k = 4  # drawn four times bigger, then shrunk, so the coasts are smooth
    W, H = width * k, h * k
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    to_px = lambda ring: [((lon + 180) / 360 * W, (90 - lat) / 180 * H) for lon, lat in ring]

    def draw(file, outer, inner):
        data = json.loads((src / file).read_text())
        for f in data["features"]:
            g = f["geometry"]
            polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            for poly in polys:
                d.polygon(to_px(poly[0]), fill=outer)
                for hole in poly[1:]:
                    d.polygon(to_px(hole), fill=inner)

    draw("land.geojson", 255, 0)
    draw("lakes.geojson", 0, 255)
    land = to_arr(im.resize((width, h), Image.BOX))
    return 1 - land


def earth_clouds(src, width, rng):
    a = to_arr(resize(read(src, "earth_clouds", "L"), width))
    a = fix_poles(fix_seam(a[..., None].repeat(3, axis=2)), 82.0)
    return a


# What each layer needs. Order is the order they're built in.
# (sizes are widths: lite, sharp. A body's sharp map is skipped if it would be no bigger than its lite one.)
GREY = {
    "europa": [(0.0, "#6b4a38"), (0.3, "#a08b74"), (0.65, "#d8cdbb"), (1.0, "#f5f1e8")],
    "callisto": [(0.0, "#241e1a"), (0.35, "#4d443c"), (0.7, "#80766a"), (1.0, "#e9e5dd")],
    "pluto": [(0.0, "#3b2a22"), (0.25, "#6d5546"), (0.5, "#a28d78"), (0.8, "#d8cdb9"), (1.0, "#f4efe6")],
    "charon": [(0.0, "#4b342c"), (0.3, "#847b74"), (0.65, "#b0aaa3"), (1.0, "#e1ded9")],
    "phobos": [(0.0, "#2c2520"), (0.5, "#6b5e53"), (1.0, "#9f9285")],
    "deimos": [(0.0, "#352d27"), (0.5, "#74675b"), (1.0, "#a79a8c")],
    "rhea": [(0.0, "#67635d"), (0.5, "#a9a59f"), (1.0, "#e7e4df")],
    "iapetus": [(0.0, "#2c221b"), (0.3, "#54463a"), (0.55, "#9a9082"), (1.0, "#efebe3")],
    "miranda": [(0.0, "#66625e"), (0.5, "#a9a5a0"), (1.0, "#e0ddd8")],
    "ariel": [(0.0, "#6a6662"), (0.5, "#b0aca7"), (1.0, "#e6e3de")],
    "umbriel": [(0.0, "#3c3a38"), (0.5, "#6c6965"), (1.0, "#9a9792")],
    "titania": [(0.0, "#5a5653"), (0.5, "#9b958d"), (1.0, "#d6d0c8")],
    "oberon": [(0.0, "#4a3f39"), (0.5, "#8a7e74"), (1.0, "#cbc2b8")],
}

LAYERS = {
    # layer: (lite width, sharp width, recipe, encoding)
    "earth": (2048, 4096, earth_day, "webp"),
    "earth-extra": (2048, 2048, earth_lights_and_water, "jpeg444"),
    "clouds": (2048, 4096, earth_clouds, "webp-grey"),
    "moon": (2048, 4096, plain("moon", pole=82.0), "webp"),
    "mars": (2048, 4096, plain("mars", pole=80.0), "webp"),
    "jupiter": (2048, 4096, plain("jupiter", pole=80.0, saturation=0.9), "webp"),
    "saturn": (2048, 4096, plain("saturn", pole=80.0), "webp"),
    "venus": (1024, 2048, plain("venus", saturation=0.8), "webp"),
    "mercury": (1024, 2048, mercury, "webp"),
    "uranus": (1024, 2048, plain("uranus", pole=70.0), "webp"),
    "neptune": (1024, 2048, plain("neptune", pole=70.0), "webp"),
    "pluto": (1024, 2048, grey_moon("pluto", GREY["pluto"], roll=0.5, mean=0.43), "webp"),
    "charon": (1024, 2048, grey_moon("charon", GREY["charon"], roll=0.5, mean=0.36), "webp"),
    "io": (1024, 2048, colour_moon("io"), "webp"),
    "europa": (1024, 2048, grey_moon("europa", GREY["europa"], mean=0.62), "webp"),
    "ganymede": (1024, 2048, colour_moon("ganymede"), "webp"),
    "callisto": (1024, 2048, grey_moon("callisto", GREY["callisto"], mean=0.26, lo=0.5, hi=99.8), "webp"),
    "titan": (1024, 2048, titan, "webp"),
    "triton": (1024, 2048, triton, "webp"),
    "phobos": (1024, 2048, grey_moon("phobos", GREY["phobos"], mean=0.26), "webp"),
    "deimos": (1024, 2048, grey_moon("deimos", GREY["deimos"], mean=0.33, lo=0.5, hi=99.8), "webp"),
    "rhea": (1024, 2048, grey_moon("rhea", GREY["rhea"], mean=0.60), "webp"),
    "iapetus": (1024, 2048, grey_moon("iapetus", GREY["iapetus"], mean=0.40), "webp"),
    "miranda": (1024, 2048, grey_moon("miranda", GREY["miranda"], mean=0.52, grow=1 / 60), "webp"),
    "ariel": (1024, 2048, grey_moon("ariel", GREY["ariel"], mean=0.54, grow=1 / 60), "webp"),
    "umbriel": (1024, 2048, grey_moon("umbriel", GREY["umbriel"], mean=0.30, grow=1 / 60), "webp"),
    "titania": (1024, 2048, grey_moon("titania", GREY["titania"], mean=0.46, grow=1 / 60), "webp"),
    "oberon": (1024, 2048, grey_moon("oberon", GREY["oberon"], mean=0.40, grow=1 / 60), "webp"),
}

# Which source(s) each layer credits (for the file header).
CREDIT = {"earth": ["earth_day"], "earth-extra": ["earth_night", "land", "lakes", "earth_day"], "clouds": ["earth_clouds"]}

QUALITY = {"earth": 84, "clouds": 78, "moon": 80, "mercury": 78}


# --------------------------------------------------------------------------------
# Writing the files

def encode(a, kind, quality):
    """Compresses a map and returns (mime type, bytes)."""
    buf = io.BytesIO()
    if kind == "jpeg444":
        to_img(a).save(buf, "JPEG", quality=quality or 90, subsampling=0, optimize=True)
        return "image/jpeg", buf.getvalue()
    if kind == "webp-grey":
        to_img(a[..., 0]).save(buf, "WEBP", quality=quality or 80, method=6)
        return "image/webp", buf.getvalue()
    to_img(a).save(buf, "WEBP", quality=quality or 82, method=6)
    return "image/webp", buf.getvalue()


def write_js(path, key, mime, data, credit):
    b64 = base64.b64encode(data).decode("ascii")
    path.write_text(f"/* {credit} */\n(window.__maps = window.__maps || {{}})[{json.dumps(key)}] = \"data:{mime};base64,{b64}\";\n")


def credit_of(layer, names):
    parts = []
    for n in names:
        _file, _urls, who, licence = SOURCES[n]
        parts.append(f"{who} ({licence})")
    return f"{layer}: " + "; ".join(parts)


def build_rings(src, out):
    """Saturn's rings as one row of pixels, from the C ring's inner edge to the A ring's outer edge, as the page draws them."""
    im = Image.open(source_path(src, "saturn_rings")).convert("RGBA")
    a = np.asarray(im, dtype="float32") / 255
    row = a.mean(axis=0)  # the picture is the same all the way down: use the average
    alpha = row[:, 3]
    rgb = row[:, :3]
    w = len(alpha)
    # The original runs from the D ring to the F ring, in a straight line of distance from Saturn.
    # Matching its sharp edges to where they really are (the B ring starts at 92,000 km, the Cassini
    # Division is 117,580 to 122,170 km, the Encke Gap is at 133,589 km and the A ring ends at 136,775 km)
    # fits to within a pixel or two: 0.300 of the width at 92,000 km, 1.421e-5 of the width per km.
    saturn_r = 60268.0  # km: the page measures rings in these
    lo = 0.300 + (1.239 * saturn_r - 92000) * 1.421e-5
    hi = 0.300 + (2.270 * saturn_r - 92000) * 1.421e-5
    print(f"    rings: using {lo:.3f}..{hi:.3f} of the picture")
    width = 4096
    x = np.linspace(lo * w, hi * w, width + 1)
    idx = np.arange(w)
    out_rgba = np.zeros((width, 4), "float32")
    csum_a = np.concatenate([[0], np.cumsum(alpha)])
    csum_c = np.concatenate([np.zeros((1, 3)), np.cumsum(rgb * alpha[:, None], axis=0)])
    for i in range(width):
        s, e = int(x[i]), max(int(x[i + 1]), int(x[i]) + 1)
        aa = (csum_a[e] - csum_a[s]) / (e - s)
        out_rgba[i, 3] = aa
        out_rgba[i, :3] = (csum_c[e] - csum_c[s]) / max(csum_a[e] - csum_a[s], 1e-6)  # colour of the ring itself, not mixed with the see-through
    # The original's colours are dark (made for use with its own lighting); bring the B ring up to a bright cream like the real one.
    b = (np.arange(width) / width > 0.31) & (np.arange(width) / width < 0.62)
    gain = 0.80 / luma(out_rgba[b][:, :3][None]).mean()
    out_rgba[:, :3] = np.clip(out_rgba[:, :3] * gain, 0, 1)
    img = Image.fromarray((out_rgba * 255 + 0.5).astype("uint8").reshape(1, width, 4), "RGBA")
    buf = io.BytesIO()
    img.save(buf, "WEBP", lossless=True, method=6)
    write_js(out / "saturn-rings.lite.js", "saturn-rings.lite", "image/webp", buf.getvalue(), credit_of("saturn-rings", ["saturn_rings"]))
    print(f"{'saturn-rings':12s} lite {width}px {len(buf.getvalue()) / 1e3:.0f} KB", flush=True)
    return {"width": width, "bytes": len(buf.getvalue())}


def build(src, out, only, preview):
    out.mkdir(parents=True, exist_ok=True)
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for layer, (lite_w, sharp_w, recipe, kind) in LAYERS.items():
        if only and layer not in only:
            continue
        t0 = time.time()
        rng = np.random.default_rng(sum(layer.encode()) * 7919)
        names = CREDIT.get(layer, [layer])
        a = recipe(src, sharp_w, rng)  # made at the sharp width (or the source's width, if less)
        width = a.shape[1]
        sizes = {}
        for tier, w in (("lite", min(lite_w, width)), ("sharp", width)):
            if tier == "sharp" and width <= sizes["lite"][0]:
                continue
            m = a
            if w != width:
                m = np.stack([to_arr(resize(Image.fromarray((np.clip(a[..., c], 0, 1) * 255 + 0.5).astype("uint8"), "L"), w)) for c in range(3)], axis=2)
            m = dither(m, rng)
            mime, data = encode(m, kind, QUALITY.get(layer))
            write_js(out / f"{layer}.{tier}.js", f"{layer}.{tier}", mime, data, credit_of(layer, names))
            sizes[tier] = (w, len(data))
            if preview:
                to_img(m).save(preview / f"{layer}.{tier}.png")
        if "sharp" not in sizes:  # no bigger version: remove one left from an earlier run
            (out / f"{layer}.sharp.js").unlink(missing_ok=True)
        manifest[layer] = {t: {"width": s[0], "bytes": s[1]} for t, s in sizes.items()}
        print(f"{layer:12s} " + "  ".join(f"{t} {s[0]}px {s[1] / 1e3:.0f} KB" for t, s in sizes.items()) + f"   ({time.time() - t0:.0f} s)", flush=True)
    if not only or "saturn-rings" in only:
        manifest["saturn-rings"] = {"lite": build_rings(src, out)}
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    lite = sum(v["lite"]["bytes"] for v in manifest.values() if "lite" in v)
    sharp = sum(v.get("sharp", v["lite"])["bytes"] for v in manifest.values())
    print(f"Total before base64: lite {lite / 1e6:.1f} MB, sharp {sharp / 1e6:.1f} MB (all loaded in the sharp size)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["fetch", "build"])
    ap.add_argument("--src", default=str(ROOT / "tools" / "maps-src"), help="where the downloaded originals are kept")
    ap.add_argument("--out", default=str(ROOT / "dist" / "maps"), help="where build writes the map files")
    ap.add_argument("--only", default="", help="comma-separated names, to do just those")
    ap.add_argument("--preview", default="", help="build: also save each finished map here as a PNG, to look at")
    args = ap.parse_args()
    only = {s for s in args.only.split(",") if s}
    if args.command == "fetch":
        fetch(Path(args.src), only)
    else:
        build(Path(args.src), Path(args.out), only, Path(args.preview) if args.preview else None)


if __name__ == "__main__":
    main()
