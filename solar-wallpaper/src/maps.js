// Real maps of the planets and moons (NASA, USGS and others), loaded once the
// first picture is up. The painted surfaces (surfaces.js) stand in until a map
// arrives, and stay for any body whose map is missing or won't load.
//
// Each map is a small script in maps/ that sets window.__maps["name.size"] to
// a data: address. Scripts and data: addresses are the one way that works from
// a page opened from disk, where a plain image file next to the page can't be
// used. Two sizes: "lite" for everything, and "sharp" for the body you're
// looking at closely or standing on, freed again when you leave.
//
// Loading must never make the animation stutter. A script is fetched and its
// image decoded off the page's thread, and at most one map goes to the
// graphics chip per frame, and not while frames are running very late.
import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import { getAnisotropy } from "./system.js";

/* global MAP_MANIFEST */
// What was built into maps/ (written by tools/make-maps.py): { name: { lite: { width, bytes }, sharp: {...} } }.
const LISTED = typeof MAP_MANIFEST === "object" && MAP_MANIFEST ? MAP_MANIFEST : {};

const LOADS_AT_ONCE = 2;
const KEEP_SHARP_FOR = 4000; // ms a sharp map stays after you look away, so zooming in and out doesn't reload it
const MIN_GAP = 400; // ms: even when frames are late, a waiting map is handed over at least this often

// Earth's picture and its lights-and-water map are one thing, so the lights
// never show on the wrong picture. Every other unit is a body, by its id.
const UNITS = { earth: ["earth", "earth-extra"] };
const layersOf = (id) => UNITS[id] ?? [id];
// Units that belong to a body but aren't its skin: Earth's clouds and Saturn's ring strip.
const OWNER = { clouds: "earth", "saturn-rings": "saturn" };
const isData = (layer) => layer === "earth-extra" || layer === "clouds"; // plain numbers, not colours

/** Which sizes exist for a unit, and fit on this graphics chip (`limit` is the widest picture it takes). */
function sizesOf(id, limit) {
  const layers = layersOf(id);
  if (!layers.every((l) => LISTED[l]?.lite && LISTED[l].lite.width <= limit)) return [];
  return LISTED[layers[0]].sharp?.width <= limit ? ["lite", "sharp"] : ["lite"];
}

/** Turns the data: address a map script made into a Blob, without decoding it on the page's thread. */
async function blobOf(uri) {
  try {
    return await (await fetch(uri)).blob();
  } catch {
    // Some wallpaper hosts won't fetch data: addresses. Do it by hand.
    const [head, b64] = uri.split(",");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: head.slice(5, head.indexOf(";")) });
  }
}

/** Decodes a Blob. `flipped` says the rows are already the right way up for the graphics chip. */
async function decode(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const image = await createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
      return { image, flipped: true };
    } catch {
      // fall back to an ordinary image
    }
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { image, flipped: false };
}

/** Loads maps/<key>.js and returns the image it holds as a Blob, or null if it's missing or broken. */
function loadScript(key) {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    const done = (ok) => {
      script.remove();
      const uri = window.__maps?.[key];
      if (window.__maps) delete window.__maps[key]; // the text is big; the Blob is all that's kept
      resolve(ok && typeof uri === "string" ? blobOf(uri).catch(() => null) : null);
    };
    script.onload = () => done(true);
    script.onerror = () => done(false);
    script.async = true;
    script.src = `maps/${key}.js`;
    document.head.appendChild(script);
  });
}

function makeTexture(image, flipped, layer, blob) {
  const t = new Texture(image);
  t.colorSpace = isData(layer) ? NoColorSpace : SRGBColorSpace;
  t.flipY = !flipped;
  t.wrapS = layer === "saturn-rings" ? ClampToEdgeWrapping : RepeatWrapping; // longitude goes all the way round; a ring strip has two ends
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = layer === "saturn-rings" ? 1 : getAnisotropy(); // a one-pixel-high strip gives a false "slanted" signal that makes it shimmer
  t.userData = { layer, blob, width: image.width, height: image.height }; // the blob is small; it rebuilds the texture if the graphics context is lost
  t.needsUpdate = true;
  return t;
}

/**
 * Loads the maps and gives them to `system` (system.applyPhoto) as they
 * arrive. Call start() after the first picture, then update() every frame.
 *
 *   onSettled()    every map has either arrived or failed
 *   onMissing(id)  a map failed: the painted surface is all there will be
 */
export function createMaps({ renderer, system, enabled, onSettled, onMissing }) {
  const units = new Map(); // id -> { id, sizes, lite, sharp, wantedAt }
  const ids = ["earth", "clouds", ...[...system.bodies.keys()].filter((k) => k !== "sun" && k !== "earth"), "saturn-rings"];
  for (const id of ids) {
    const sizes = sizesOf(id, renderer.capabilities.maxTextureSize);
    if (sizes.length) units.set(id, { id, sizes, lite: { state: "idle", look: null }, sharp: { state: "idle", look: null }, wantedAt: -Infinity });
  }
  let on = Boolean(enabled) && units.size > 0;
  let started = false;
  let settled = false;
  let preferred = []; // body ids that come first
  let sharpWanted = new Set();
  let loading = 0;
  let ready = []; // decoded, waiting for the graphics chip: { unit, tier, parts }
  let lastUpload = -Infinity;
  let generation = 0; // changes when real maps are switched off, so loads under way can tell

  /** Bigger on screen first, and whatever you're looking at before everything. */
  function priority(unit, camera) {
    const body = system.bodies.get(OWNER[unit.id] ?? unit.id);
    if (preferred.includes(body.id)) return -Infinity;
    return -(body.radius * body.group.scale.x) / Math.max(camera.position.distanceTo(body.group.position), 1e-6);
  }

  /** What to load next: a sharp map for what you're looking at, else the lite map of whatever is biggest on screen. */
  function nextJob(camera) {
    for (const unit of units.values()) {
      if (unit.sizes.includes("sharp") && sharpWanted.has(unit.id) && unit.lite.state === "shown" && unit.sharp.state === "idle") return { unit, tier: "sharp" };
    }
    let best = null;
    let bestScore = Infinity;
    for (const unit of units.values()) {
      const score = unit.lite.state === "idle" ? priority(unit, camera) : Infinity;
      if (score < bestScore) [best, bestScore] = [{ unit, tier: "lite" }, score];
    }
    return best;
  }

  async function run({ unit, tier }) {
    const slot = unit[tier];
    const gen = generation;
    slot.state = "loading";
    loading++;
    try {
      const layers = layersOf(unit.id).filter((l) => LISTED[l]?.[tier]);
      const parts = [];
      for (const layer of layers) {
        const blob = await loadScript(`${layer}.${tier}`);
        if (!blob) throw new Error(`no map ${layer}.${tier}`);
        const { image, flipped } = await decode(blob);
        parts.push({ layer, blob, image, flipped });
      }
      if (gen !== generation) return void parts.forEach((p) => p.image.close?.()); // switched off meanwhile
      slot.state = "decoded";
      ready.push({ unit, tier, parts });
    } catch {
      if (gen !== generation) return;
      slot.state = "failed";
      if (tier === "lite") onMissing?.(unit.id);
    } finally {
      loading--;
    }
  }

  /** Disposes textures, apart from any in `keep`. */
  function free(textures, keep = []) {
    for (const t of textures) {
      if (keep.includes(t)) continue;
      t.dispose();
      t.image?.close?.();
    }
  }

  /** Hands one decoded map to the graphics chip and starts it fading in. */
  function upload({ unit, tier, parts }) {
    const slot = unit[tier];
    if (tier === "sharp" && !sharpWanted.has(unit.id) && performance.now() - unit.wantedAt > KEEP_SHARP_FOR) {
      parts.forEach((p) => p.image.close?.()); // looked away while it loaded
      slot.state = "idle";
      return;
    }
    const textures = parts.map((p) => {
      const t = makeTexture(p.image, p.flipped, p.layer, p.blob);
      renderer.initTexture(t); // uploads now, not whenever it's first drawn
      if (p.flipped) p.image.close?.(); // the graphics chip has it: no second copy on the page
      return t;
    });
    // A sharp look keeps whatever only comes in one size (Earth's lights and water).
    const carried = tier === "sharp" ? unit.lite.look.textures.filter((t) => !textures.some((n) => n.userData.layer === t.userData.layer)) : [];
    slot.look = { textures: [...textures, ...carried] };
    slot.state = "shown";
    system.applyPhoto(unit.id, slot.look.textures);
  }

  /** Lets go of a body's sharp map and goes back to its lite one. */
  function release(unit) {
    const { sharp, lite } = unit;
    unit.sharp = { state: "idle", look: null };
    system.applyPhoto(unit.id, lite.look.textures);
    const own = sharp.look.textures.filter((t) => !lite.look.textures.includes(t));
    system.whenUnused(unit.id, own, () => free(own));
  }

  function checkSettled() {
    if (settled || !started) return;
    if ([...units.values()].some((u) => ["idle", "loading", "decoded"].includes(u.lite.state))) return;
    settled = true;
    onSettled?.();
  }

  // The graphics chip can lose everything (a driver reset, switching cards).
  // The compressed maps are kept, so rebuild the textures from them.
  renderer.domElement.addEventListener("webglcontextrestored", async () => {
    for (const unit of units.values()) {
      for (const tier of ["lite", "sharp"]) {
        for (const t of unit[tier].look?.textures ?? []) {
          if (!t.userData.blob) continue;
          const { image, flipped } = await decode(t.userData.blob);
          t.image = image;
          t.flipY = !flipped;
          t.needsUpdate = true;
        }
      }
    }
  });

  return {
    get available() {
      return units.size > 0;
    },
    get enabled() {
      return on;
    },
    /** Does this body have a real map that is, or is going to be, on show? */
    covers(id) {
      const unit = units.get(id);
      return on && Boolean(unit) && unit.lite.state !== "failed";
    },

    /** Starts the loading (call after the first picture). */
    start() {
      started = true;
      if (!on) onSettled?.();
    },

    /** Real maps on or off. Off frees them all and shows the painted surfaces again. */
    setEnabled(value) {
      value = Boolean(value) && units.size > 0;
      if (value === on) return;
      on = value;
      system.setPhotosEnabled(on);
      if (on) {
        settled = false;
        return;
      }
      generation++;
      for (const p of ready.splice(0)) p.parts.forEach((part) => part.image.close?.());
      for (const unit of units.values()) {
        for (const tier of ["lite", "sharp"]) {
          const textures = unit[tier].look?.textures;
          if (textures) system.whenUnused(unit.id, textures, () => free(textures));
          unit[tier] = { state: "idle", look: null };
        }
      }
    },

    /** Body ids that come first (what you're looking at, and the planet its moon goes round). */
    prefer(bodyIds) {
      preferred = bodyIds;
    },

    /** The bodies you're looking at closely or standing on get their sharp map, and lose it again once you look away. */
    sharpen(bodyIds, now) {
      const wanted = new Set(bodyIds);
      if (wanted.has("earth")) wanted.add("clouds");
      for (const id of wanted) {
        const unit = units.get(id);
        if (unit) unit.wantedAt = now;
      }
      sharpWanted = wanted;
    },

    /** Every frame. `frameMs`: how long since the last frame. `gapMs`: how long a frame is meant to take. */
    update(camera, now, frameMs, gapMs) {
      if (!started || !on) return;
      const late = frameMs > Math.max(gapMs * 3, 120);
      for (const unit of units.values()) {
        if (unit.sharp.state === "shown" && !sharpWanted.has(unit.id) && now - unit.wantedAt > KEEP_SHARP_FOR) release(unit);
      }
      // One map to the graphics chip per frame, and not on a late frame unless it has been a while.
      if (ready.length && (!late || now - lastUpload > MIN_GAP)) {
        ready.sort((a, b) => (a.tier === b.tier ? priority(a.unit, camera) - priority(b.unit, camera) : a.tier === "sharp" ? -1 : 1));
        upload(ready.shift());
        lastUpload = now;
      }
      // Loading takes next to nothing from the page (the work is done elsewhere), so it carries on even when frames are late.
      while (loading < LOADS_AT_ONCE && ready.length + loading < LOADS_AT_ONCE + 1) {
        const job = nextJob(camera);
        if (!job) break;
        run(job);
      }
      checkSettled();
    },

    /** Where each map has got to, for checking it from the browser console: { moon: "lite shown, sharp idle", ... }. */
    state() {
      return Object.fromEntries([...units.values()].map((u) => [u.id, `lite ${u.lite.state}, sharp ${u.sharp.state}`]));
    },

    /** Graphics memory the real maps use now, in MB (rough: four bytes a pixel, a third more for the smaller copies). */
    memoryMB() {
      const seen = new Set();
      let bytes = 0;
      for (const unit of units.values()) {
        for (const tier of ["lite", "sharp"]) {
          for (const t of unit[tier].look?.textures ?? []) {
            if (seen.has(t)) continue;
            seen.add(t);
            bytes += t.userData.width * t.userData.height * 4 * 1.33;
          }
        }
      }
      return bytes / 1048576;
    },
  };
}
