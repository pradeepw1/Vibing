# Cuecode

Learn to code by doing it: cue cards, the same job side by side in eight languages, and docs in plain words. Describe something you want to build and it pulls together the tools for it.

It needs no internet, no account and no server. To open it on your Mac:

```sh
open index.html
```

## The four parts

| Part | What it does |
|---|---|
| **Describe** | Say what you want to build. It works out what kind of project that is and which parts it needs, then lists the tools and libraries for each language. |
| **Cards** | Cue cards with spaced repetition, so each card comes back just before you'd forget it. What does it print, fill the gap, fix the bug, write it, explain it. |
| **Compare** | One job in Python, Swift, Java, COBOL, JavaScript, TypeScript, HTML and CSS, side by side, plus JCL where it matters. Each topic has a "Mainframe sense" note. |
| **Docs** | Every term in one plain sentence, with something familiar to compare it to. Search handles things like `S0C7` or `closure`. |

## Can you trust the examples?

Every example that can run was run, with the real compiler, and the output shown is what it printed. Each snippet says which it was:

| Label | Meaning |
|---|---|
| **Ran ✓** | Compiled and ran here. The output matched exactly. |
| **Compiled ✓** | Passed the compiler, but it opens a window, so it wasn't run. |
| **Live** | HTML and CSS, running in your browser right now. |
| **Not run** | It can't run here, and hovering over the label says why. |

The "what does it print?" cards are checked the same way. The claim is tied to the exact code: edit a snippet and it loses its label until the checker passes it again.

What this doesn't cover:

- **Anything that needs a real mainframe.** JCL, CICS, BMS and Db2 examples were written with care but never run, so treat them as not proven.
- **GnuCOBOL isn't IBM's compiler.** The COBOL here runs in `-std=ibm` mode and is written in mainframe style, but a few things differ. The notes point these out, such as `LINE SEQUENTIAL` and sorting a table.
- **Two Swift examples** (`@Model` and `@State`) need full Xcode, which isn't on this Mac.
- **Written answers.** "Explain it" cards and the docs are plain text, so nothing can run them.

## The Describe box isn't AI

It matches your words against a built-in catalogue of common building blocks. That's why it works offline and costs nothing, and why it tells you which words it didn't recognise. Anything specific to your idea may need its own research.

## Trying code yourself

HTML, CSS and JavaScript have a **Try it** button. For the rest, press **Copy**, save the code and run it:

```sh
python3 main.py
swift main.swift
java Main.java
cobc -x main.cob && ./main
```

`cobc` is in `~/.local/gnucobol/bin`, because Homebrew won't install GnuCOBOL on macOS 27. It was built from gnu.org's source. To use it from any terminal:

```sh
echo 'export PATH="$HOME/.local/gnucobol/bin:$PATH"' >> ~/.zshrc
```

Try-it code runs in a locked-down frame. It can't reach your saved progress, this page or the network.

## Your progress

Progress is saved in your browser, so clearing browser data clears it. **Save a backup** on the Cards page makes a file you can restore from. A copy opened from a different address counts as a different place, with its own progress.

## Adding to it

Everything you read lives in plain text files in `content/`. A line starting with `%%` opens a block.

| To change | Edit |
|---|---|
| Side-by-side topics | `content/concepts/` |
| Cue cards | `content/cards/` |
| Docs | `content/docs/` |
| What the Describe box knows | `app/finder-data.js` |

Then run these. You only need Node for the build and tests. The checker also needs the languages installed.

```sh
npm install        # once, for TypeScript
npm run verify     # compile and run whatever changed
npm run build      # turn content/ into app/data.js
npm test           # check it all still holds together
```

`npm run verify -- --all` runs everything again. `npm run verify -- cobol` runs one language.
