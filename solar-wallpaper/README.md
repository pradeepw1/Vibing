# Solar System Live

A live wallpaper of the solar system. Every planet and moon sits where it really is right now, and moves the way it really does.

![The solar system on 14 October 2026](docs/overview.jpg)
![Earth with the Moon, Jupiter with its four big moons, Saturn with its rings](docs/close-ups.jpg)

It's one web page. It runs in any browser and works as a desktop wallpaper on Windows, macOS and Linux. It needs no internet connection and no server, so you can just open `dist/index.html`.

## What's real

| Thing | How real |
|---|---|
| Where the planets and Pluto are | Real, from [astronomy-engine](https://github.com/cosinekitty/astronomy) (within about 1 arcminute) |
| Earth's Moon | Real position, so the phase you see is tonight's phase. It wobbles (libration) like the real one |
| Jupiter's Io, Europa, Ganymede, Callisto | Real positions |
| Charon | Real: it always hangs over the same spot on Pluto, the same as in reality |
| Which way each planet faces and spins | Real (IAU rotation models). The day side of Earth matches the actual time of day |
| Tilt of each planet and of Saturn's rings | Real. Saturn's rings open and close over its 29-year orbit |
| Shadows | Saturn's rings cast a shadow on Saturn and Saturn shades its rings, at the real angle |
| Other moons (Phobos, Titan, Triton, Uranus's moons...) | Real size of orbit, real period, real direction (Triton goes backwards). Where they are along their orbit is made up |
| Eclipses | Moons go dark in their planet's shadow: Io every 42 hours, our Moon (turning red) during real lunar eclipses |
| Asteroid belt, Trojans, Kuiper belt | Made-up rocks on real-looking orbits. They follow Kepler's laws, leave the real Kirkwood gaps, and the Trojans stay 60° ahead of and behind Jupiter |
| Milky Way | Placed where the real one is in the sky. The stars themselves are made up |
| Nearest galaxies | The Large and Small Magellanic Clouds, the Sagittarius Dwarf, Andromeda (with its two small companions) and Triangulum, at their real places in the sky, real sizes and real tilt, each with its name and distance. Their look is painted in code |
| Black holes | Sagittarius A* (the middle of the Milky Way), Cygnus X-1 and M87*, at their real places and distances. **Drawn millions of times bigger than they are**, or you'd never see them. The bending of light around them follows the real rule for light past a black hole. The disc, its colours and the star crowds round them are made up |
| Sizes and distances | **Squashed** so everything fits on one screen. Directions are never changed, only distances, so line-ups and phases stay true |
| Planet surfaces | Real maps made from pictures taken by space probes (NASA and USGS, see Credits): Earth's land, sea floor and city lights, the Moon's craters, Mars, Jupiter's storms, Saturn and its rings' true gaps, Io's volcanoes, Pluto's heart, and so on, down to the small moons. The parts no probe ever photographed (half of Triton, the north of Uranus's moons) are filled in with a blend of what's around them, and some maps that were only taken in grey are tinted with the colour the body is described as having. Until a map has loaded, and wherever there is none, a surface painted in code stands in. The painted look can be turned back on in the menu |

The clock in the corner is your local time. Speed it up to watch the inner planets lap the outer ones, Moon phases come and go, and Saturn's rings tilt.

## The sky from a planet

![The sky from Earth, the Moon, Io and Saturn](docs/views-from.jpg)

Click any planet or moon (or its name) to see the sky from there. You hover just above the ground with the horizon at the bottom of the screen. On a planet the Sun sits low over the horizon; on a moon you face the planet it goes round, rising over the edge (Earth from the Moon, Jupiter from Io). Drag to look around, scroll (or pinch) to go higher or lower, and press <kbd>Esc</kbd> or **Back** to return. Click another body in the sky to hop over to it.

Everything in that sky is in the direction it really is from where you stand, with its real phase. From Earth in late October 2026 you'll see Venus as a dark sliver next to the Sun, because it's passing between us and the Sun. Speed time up and Mars loops backwards across the sky around its opposition.

Discs are drawn bigger than real so you can see them (the Sun and the Moon are both about 5½ degrees across, not half a degree). Small ones grow the most and ones that are already big hardly at all (Jupiter from Io is its real size, 19 degrees across), and a bigger real disc always stays bigger, so the Sun and the Moon still match from Earth. Wherever two discs come close, the gap between them is stretched just enough that they only touch when the real ones do, as seen from somewhere on that planet or moon. So eclipses, transits and the Moon passing over a planet happen on their real dates and only then: the Moon covers the Sun from Earth on 2 August 2027, and the tests check that it doesn't at any other new moon that year, and that from Earth no two discs touch when they shouldn't at any time in 2026. From Jupiter's moons, where Jupiter fills a big part of the sky, it's right almost all of the time.

Jupiter's moons are shown where they were when their light left (about 40 minutes earlier from Earth), so they cross Jupiter at the times listed in sky almanacs.

The nearest galaxies are out there too, in the same places from every planet because they're so far away. Andromeda and Triangulum are in the northern autumn sky; the two Magellanic Clouds sit near the south pole of the sky, so they show up behind the planets when you look down on the solar system.

## Out to the galaxies

Click a galaxy's name and you leave the solar system: the view turns towards it, then flies out across the gap (2.5 million light-years to Andromeda) and circles it, seen from its far side with the Milky Way in the distance behind it. Every galaxy is a 3D cloud of stars at its real distance and direction from the Sun, tilted the way it really is towards us: Andromeda's tightly wound arms and its ring of new stars, Triangulum's loose arms and the pink NGC 604, the Large Magellanic Cloud's off-centre bar and the Tarantula Nebula, the Small Magellanic Cloud stretched out almost straight towards us, and the Sagittarius Dwarf being pulled apart below the Milky Way. The Milky Way is there too, with its bar and four arms, and the Sun marked on the inner edge of the Orion spur.

### Black holes

Three real black holes are out there too. Click a name (or pick one from the menu) and you fly to a spot just above its disc of glowing gas.

- **Sagittarius A\*** sits in the middle of the Milky Way, 26,700 light-years away, with about 4 million suns' worth of mass.
- **Cygnus X-1** was the first black hole ever found (about 21 suns), 7,200 light-years away. A blue giant star circles next to it, and you can see the gas it pulls off.
- **M87\*** is the one in the first photograph of a black hole (2019), in the galaxy M87, 53.5 million light-years away.

Their places in the sky and their distances are real, and M87\*'s disc is tilted the way the real one is. Everything else is made up or stretched: a real black hole is only a speck, so each is drawn millions of times bigger, and the colours, streaks and clumps of the disc are invented. What's real is the bending of light: every pixel follows its own ray of light round the hole, so stars are stretched into arcs, the middle is black, and the back of the disc is seen bent over the top and underneath. The side of the disc that's turning towards you is brighter and bluer. It's the heaviest drawing in the app, so if your graphics chip can't keep up, the picture near a black hole is drawn a little softer.

Drag to look round, scroll to zoom. Out there, names show how far each galaxy is from where you are; click one to fly over to it, or click the Milky Way (or press Back or <kbd>Esc</kbd>) to fly home. The stars in these galaxies are made up; their sizes, tilts, bars, arms and positions come from published measurements.

## Use it as your wallpaper

The files you need are all in `dist/`: `index.html`, `solar.js`, `LivelyProperties.json` and the `maps` folder (the real planet maps, about 16 MB; without it you get painted planets). Copy that folder anywhere.

**Windows, with [Lively Wallpaper](https://www.rocksdanister.com/lively/) (free):** click *Add wallpaper*, pick `dist/index.html`. The settings (speed, view, names...) show up in Lively's customise panel.

**Windows, with Wallpaper Engine:** open the wallpaper editor, create a wallpaper from `dist/index.html`. Click the small button in the top right of the wallpaper to change settings. They're saved.

**macOS, with [Plash](https://sindresorhus.com/plash) (free):** add a website and point it at the `index.html` file.

**Linux:** KDE Plasma and some other desktops have "web page" wallpaper plugins. Point one at `index.html`.

**Phones:** not yet. That needs a native app (see Next).

For wallpaper use, add `?wallpaper` to the address (`index.html?wallpaper`). It hides the settings button and runs at 30 frames a second to save power.

## Settings

Click the button in the top right, or add them to the address, like `index.html?speed=day&view=earth`.

| Setting | Values | Default |
|---|---|---|
| `speed` | `live`, `minute`, `hour`, `day`, `week`, `month`, `year` (how much time passes each second) | `live` |
| `view` | Look at: `system`, `middle`, `inner`, `sun`, or a planet (`mercury` ... `pluto`). Look from: `from-earth`, `from-mars` ... any planet or moon, like `from-moon` or `from-io`. Fly to a galaxy: `galaxy-m31`, `galaxy-m33`, `galaxy-lmc`, `galaxy-smc`, `galaxy-sgr`. Fly to a black hole: `galaxy-sgra`, `galaxy-cygx1`, `galaxy-m87bh` | `middle` |
| `reverse` | `1` to run time backwards | `0` |
| `date` | any date, like `2033-05-01` or `1969-07-20T20:17Z`. Start there instead of now | now |
| `labels`, `orbits`, `belts`, `clock`, `drift` | `0` or `1` | all `1` |
| `photos` | `0` for painted planets only (the menu's **Real maps (NASA)** box). Good for a slow computer or a small download | `1` |
| `fps` | frames per second, 5 to 240 | 60 |
| `ui` | `0` hides the settings button | `1` |
| `wallpaper` | shorthand for `ui=0&fps=30` | |

Keys: <kbd>Space</kbd> pause, <kbd>←</kbd> <kbd>→</kbd> slower/faster, <kbd>R</kbd> backwards, <kbd>N</kbd> back to now, <kbd>L</kbd> names, <kbd>O</kbd> orbits, <kbd>H</kbd> hide everything, <kbd>F</kbd> full screen, <kbd>1</kbd>-<kbd>9</kbd> look at a planet, <kbd>Shift</kbd>+<kbd>1</kbd>-<kbd>9</kbd> look from it, <kbd>Enter</kbd> look from the planet you're looking at, <kbd>Esc</kbd> / <kbd>B</kbd> / <kbd>Backspace</kbd> back, <kbd>0</kbd> overview.

Drag to turn the view, scroll to zoom, click a planet or moon to see the sky from there.

A view you reach by clicking isn't saved, so a stray click on your desktop won't change the wallpaper after a restart. Pick it in the settings panel (or the address) to keep it. In Lively, the settings have a **Look at** list and a **Look from** list; set Look from to *Nothing* to go back to the Look at view.

Time can run from 1600 to 2400. Outside that, the models for the moons and Pluto get shaky, so it stops.

## Changing it

You need [Node.js](https://nodejs.org) 18 or newer.

```sh
cd solar-wallpaper
npm install
npm run build      # rebuilds dist/solar.js from src/
npm test           # checks positions against real events (equinox, Mars opposition, eclipses, full moon...)
npm run textures   # then open tools/textures.html to see every painted surface flat
npm run maps       # rebuilds dist/maps/ from the original NASA and USGS maps (see below)
```

`dist/solar.js` and `dist/maps/` are committed, so the wallpaper works without building. Rebuild `solar.js` after you change anything in `src/`.

### How the maps are made

The real maps in `dist/maps/` come from `tools/make-maps.py`. You only need to run it to change the maps.

1. You need Python 3.9 or newer, and `pip install pillow numpy` (Pillow with WebP, which the usual download has).
2. `python3 tools/make-maps.py fetch` downloads the original maps (about 3.5 GB: NASA, USGS and Solar System Scope; a few minutes on a fast line) into `tools/maps-src/`, which git ignores. It shrinks each one to at most 8192 pixels wide and throws the huge original away. Some hosts (NASA's own site, Solar System Scope's) can be blocked on some networks; the tool then tries a public copy of the same file on GitHub.
3. `python3 tools/make-maps.py build` (or `npm run maps`) turns those into the files the page loads. Add `--only moon,mars` to redo a few, and `--preview some/folder` to also save each finished map as a PNG to look at.

For each map it makes two sizes: **lite** (2048 pixels wide for Earth, the Moon, Mars, Jupiter and Saturn; 1024 for the rest; 3 MB in all) and **sharp** (4096 for Earth, its clouds, the Moon, Mars, Jupiter and Saturn; 2048 for most others; 9 MB in all). The page loads every lite map after its first picture, and a sharp one only for the body you are looking at closely or standing on, and lets it go again afterwards. Each is a small WebP picture, written as text inside a plain script (`dist/maps/moon.sharp.js` sets `window.__maps["moon.sharp"]` to a `data:` address), because a page opened straight from disk can't read picture files next to it, but it can run scripts and read `data:` addresses.

On the way it cleans up what the originals need:

- **Grey maps are tinted** (Europa, Callisto, Pluto, Charon, Phobos, Deimos, Rhea, Iapetus, Titan and Uranus's moons): the darker a spot is, the more brown or cream it gets, going by what the body is described as looking like. Mercury's and Triton's colours were stretched to show different rocks and ices, so they are turned down to a plain grey-brown and a pale cream. Mars and Jupiter are warmed a little.
- **Gaps are filled**: where no probe took a picture the original is pure black. Those parts are filled with a blur of what is around them, plus detail borrowed from elsewhere on the same map, so no black patch shows.
- **The edges meet**: the map's left and right edges are made to match at the 180 degree line (no thin line there), and the rows near each pole are blended so the poles are a clean point, not a pinch.
- **Earth's night lights and water** are packed into one picture (red is city lights, green is sea and lakes, from Natural Earth's outlines), the way the page's shader wants them. Saturn's rings are one row of pixels from the real ring picture.

The built files are in git, but the originals are not.

| File | What it does |
|---|---|
| `src/ephemeris.js` | Where everything is and which way it faces, and how sizes and distances are squashed (`SCALE`) |
| `src/bodies.js` | Sizes, periods and colours of the Sun, planets and moons |
| `src/system.js` | Builds the planets, moons, rings and orbit lines, and moves them every frame |
| `src/surfaces.js` | Paints each planet's surface in code (the stand-in until the real maps arrive, and the fallback). `src/land.js` holds the coastlines |
| `src/paint-worker.js`, `src/painter.js` | Do that painting in the background, so the animation never stutters |
| `src/maps.js` | Loads the real maps from `dist/maps/` after the first picture, nearest planet first, without stuttering, and frees the sharp ones when you look away |
| `dist/maps/` | The real maps, one script per map and size (`earth.lite.js`, `earth.sharp.js`...), and `manifest.json` listing them |
| `tools/make-maps.py` | Downloads the original maps and builds `dist/maps/` from them |
| `src/shaders.js` | Lighting, night-side city lights, ring shadows, the Sun's surface, orbit trails, asteroids |
| `src/belts.js`, `src/sky.js` | Asteroids and the Kuiper belt; stars and the Milky Way |
| `src/galaxies.js` | The nearest galaxies on the sky: where they are, how big, and how they're painted |
| `src/localgroup.js` | Out among the galaxies: each one (and the Milky Way) as a 3D cloud of stars, and the flights between them |
| `src/blackholes.js` | The black holes: where they are, how big they're drawn, how their discs are tilted. The light-bending itself is in `src/shaders.js` |
| `src/pov.js`, `src/povcam.js` | The sky as seen from a planet or moon, and the camera that hovers over its ground |
| `src/main.js`, `src/ui.js`, `src/settings.js` | The clock, camera, settings panel and wallpaper-app hooks |
| `tools/make-land.mjs` | Rebuilds `src/land.js` from Natural Earth map data |
| `tools/build.mjs` | Builds `dist/solar.js`, and writes `dist/LivelyProperties.json` from the same lists the page uses |

## Credits

[three.js](https://threejs.org) (MIT) draws it. [astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT) works out the positions. The painted stand-in for Earth's coastlines comes from [Natural Earth](https://www.naturalearthdata.com) (public domain) via [world-atlas](https://github.com/topojson/world-atlas).

**The real maps.** Every picture comes from a space mission, and the maps were joined, cleaned, resized and in some cases tinted or filled in for this project (see "How the maps are made"). NASA and USGS maps are public domain, and NASA should be thanked as their source; no NASA endorsement is meant or implied.

| Map | Made from | Licence |
|---|---|---|
| Earth (land and sea floor) | [NASA Earth Observatory](https://earthobservatory.nasa.gov/features/BlueMarble), Blue Marble Next Generation with topography and bathymetry, December 2004 | Public domain |
| Earth's city lights and clouds | Solar System Scope, from NASA pictures | CC BY 4.0 |
| Earth's water mask | [Natural Earth](https://www.naturalearthdata.com) land and lake outlines (1:10m) | Public domain |
| Moon, Venus (cloud tops), Jupiter, Saturn, Saturn's rings, Uranus, Neptune | Solar System Scope, from NASA mission pictures (Moon: LRO and Kaguya; Jupiter and Saturn: Cassini) | CC BY 4.0 |
| Mars | USGS Astrogeology Science Center, Viking colour mosaic (925 m) | Public domain |
| Mercury | USGS Astrogeology Science Center, from MESSENGER pictures (NASA, Johns Hopkins APL, Carnegie Institution) | Public domain |
| Pluto, Charon | USGS Astrogeology Science Center, from New Horizons pictures (NASA, Johns Hopkins APL, Southwest Research Institute). Tinted here | Public domain |
| Io, Europa, Ganymede, Callisto | USGS Astrogeology Science Center, from Galileo and Voyager pictures. Europa and Callisto tinted here | Public domain |
| Titan | USGS Astrogeology Science Center, from Cassini pictures (infrared, so the colour is invented to match how Titan looks from space) | Public domain |
| Triton | USGS Astrogeology Science Center, mosaic by Paul Schenk (Lunar and Planetary Institute), from Voyager 2 pictures. Colour turned down, unmapped north filled in | Public domain |
| Phobos | USGS Astrogeology Science Center, from Viking pictures (control by DLR). Tinted here | Public domain |
| Deimos | [Celestia project](https://github.com/CelestiaProject/CelestiaContent), from Philip Stooke's maps in NASA's Planetary Data System. Tinted here | CC0 |
| Rhea, Iapetus | USGS Astrogeology Science Center, from Cassini and Voyager pictures. Tinted here | Public domain |
| Miranda, Ariel, Umbriel, Titania, Oberon | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), from Voyager 2 pictures. Tinted here, unmapped north filled in | Public domain |

The Solar System Scope maps: *Textures by [Solar System Scope](https://www.solarsystemscope.com/textures/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), based on NASA imagery. Changed here: resized, joined at the edges, recoloured a little and packed into other files.*

## Next

- Real bright stars and constellations, from a star catalogue
- The Moon's shadow on Earth during a solar eclipse, and Jupiter's moons' shadows on Jupiter
- Real starting positions for the smaller moons (from JPL's mean orbital elements)
- Comets, and spacecraft like Voyager and JWST
- Bumps and shadows from real heights (the Moon's craters, Mars's volcanoes) so relief changes with the light
- An 8192-pixel size for the Moon, Earth and Mars when you zoom right in
- An Android live wallpaper version
