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
| Sizes and distances | **Squashed** so everything fits on one screen. Directions are never changed, only distances, so line-ups and phases stay true |
| Planet surfaces | Painted in code. Big features are in the right places (coastlines, the Moon's dark seas, Mars's ice caps, Jupiter's belts, Pluto's heart). Small detail is made up |

The clock in the corner is your local time. Speed it up to watch the inner planets lap the outer ones, Moon phases come and go, and Saturn's rings tilt.

## The sky from a planet

![The sky from Earth, the Moon, Io and Saturn](docs/views-from.jpg)

Click any planet or moon (or its name) to see the sky from there. You hover just above the ground with the horizon at the bottom of the screen. On a planet the Sun sits low over the horizon; on a moon you face the planet it goes round, rising over the edge (Earth from the Moon, Jupiter from Io). Drag to look around, scroll (or pinch) to go higher or lower, and press <kbd>Esc</kbd> or **Back** to return. Click another body in the sky to hop over to it.

Everything in that sky is in the direction it really is from where you stand, with its real phase. From Earth in late October 2026 you'll see Venus as a dark sliver next to the Sun, because it's passing between us and the Sun. Speed time up and Mars loops backwards across the sky around its opposition.

Discs are drawn bigger than real so you can see them (the Sun and the Moon are both about 5½ degrees across, not half a degree). Small ones grow the most and ones that are already big hardly at all (Jupiter from Io is its real size, 19 degrees across), and a bigger real disc always stays bigger, so the Sun and the Moon still match from Earth. Wherever two discs come close, the gap between them is stretched just enough that they only touch when the real ones do, as seen from somewhere on that planet or moon. So eclipses, transits and the Moon passing over a planet happen on their real dates and only then: the Moon covers the Sun from Earth on 2 August 2027, and the tests check that it doesn't at any other new moon that year, and that from Earth no two discs touch when they shouldn't at any time in 2026. From Jupiter's moons, where Jupiter fills a big part of the sky, it's right almost all of the time.

Jupiter's moons are shown where they were when their light left (about 40 minutes earlier from Earth), so they cross Jupiter at the times listed in sky almanacs.

The nearest galaxies are out there too, in the same places from every planet because they're so far away. Andromeda and Triangulum are in the northern autumn sky; the two Magellanic Clouds sit near the south pole of the sky, so they show up behind the planets when you look down on the solar system.

## Use it as your wallpaper

The files you need are all in `dist/`: `index.html`, `solar.js` and `LivelyProperties.json`. Copy that folder anywhere.

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
| `view` | Look at: `system`, `middle`, `inner`, `sun`, or a planet (`mercury` ... `pluto`). Look from: `from-earth`, `from-mars` ... any planet or moon, like `from-moon` or `from-io` | `middle` |
| `reverse` | `1` to run time backwards | `0` |
| `date` | any date, like `2033-05-01` or `1969-07-20T20:17Z`. Start there instead of now | now |
| `labels`, `orbits`, `belts`, `clock`, `drift` | `0` or `1` | all `1` |
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
```

`dist/solar.js` is committed, so the wallpaper works without building. Rebuild after you change anything in `src/`.

| File | What it does |
|---|---|
| `src/ephemeris.js` | Where everything is and which way it faces, and how sizes and distances are squashed (`SCALE`) |
| `src/bodies.js` | Sizes, periods and colours of the Sun, planets and moons |
| `src/system.js` | Builds the planets, moons, rings and orbit lines, and moves them every frame |
| `src/surfaces.js` | Paints each planet's surface. `src/land.js` holds the coastlines |
| `src/paint-worker.js`, `src/painter.js` | Do that painting in the background, so the animation never stutters |
| `src/shaders.js` | Lighting, night-side city lights, ring shadows, the Sun's surface, orbit trails, asteroids |
| `src/belts.js`, `src/sky.js` | Asteroids and the Kuiper belt; stars and the Milky Way |
| `src/galaxies.js` | The nearest galaxies: where they are, how big, and how they're painted |
| `src/pov.js`, `src/povcam.js` | The sky as seen from a planet or moon, and the camera that hovers over its ground |
| `src/main.js`, `src/ui.js`, `src/settings.js` | The clock, camera, settings panel and wallpaper-app hooks |
| `tools/make-land.mjs` | Rebuilds `src/land.js` from Natural Earth map data |
| `tools/build.mjs` | Builds `dist/solar.js`, and writes `dist/LivelyProperties.json` from the same lists the page uses |

Credits: [three.js](https://threejs.org) (MIT) draws it. [astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT) works out the positions. Coastlines come from [Natural Earth](https://www.naturalearthdata.com) (public domain) via [world-atlas](https://github.com/topojson/world-atlas).

## Next

- Real bright stars and constellations, from a star catalogue
- The Moon's shadow on Earth during a solar eclipse, and Jupiter's moons' shadows on Jupiter
- Real starting positions for the smaller moons (from JPL's mean orbital elements)
- Comets, and spacecraft like Voyager and JWST
- Real photo textures as an option
- An Android live wallpaper version
