# What Browsers Share

A one-page dashboard that shows what Google Chrome, Safari, DuckDuckGo and Brave send out during everyday browsing, and who ends up with it.

Open `index.html` in any browser. It has three parts:

1. **Scores.** Each browser is checked on 11 things and graded Good, Partial or Exposed. A switch at the top changes the view between computer, iPhone and Android, because some answers change by device. (For example, Chrome on iPhone blocks cross-site cookies, because Apple's engine does it for every iPhone browser.)
2. **Side by side.** Each row is a normal browsing moment: typing in the address bar, reading a page full of tracking code, clicking a link with `?fbclid=` on the end, and so on. Each cell says what happens, and "Show details" tells you how to change it, with sources.
3. **Test your browser.** The page reads what any website could read about you without asking (time zone, screen, graphics chip, fonts, canvas and audio fingerprints) and turns it into a fingerprint code. Open the page in each browser you use to compare.

## Opening it on each browser

- **Computer:** download `index.html` and open it in Chrome, Safari, DuckDuckGo and Brave one after another.
- **Phone:** the simplest way is to host the page with GitHub Pages (repo Settings → Pages → deploy from this branch, root folder) and open that link in each browser on your phone.

The tracker test ("Test tracker blocking") gives the fairest result from a web address. Some browsers turn off their tracker blocking for files opened straight from your device, and the claude.ai copy of the page can't make outside requests at all.

## Privacy of the page itself

The page makes no outside requests on its own. The fonts are embedded in the file. Only two buttons reach out, and only when you press them:

- "Test tracker blocking" contacts `google-analytics.com` and `connect.facebook.net` once, without cookies, to see if your browser blocks them.
- "Show my IP address" asks `api.ipify.org` for your public IP.

## Editing

The source is `src/page.html`. The grades and wording live in the `ROWS` list inside its script. After editing, rebuild:

```sh
python3 build.py
```

This embeds the fonts from `src/fonts/` and writes `index.html`.

## About the data

- Grades are for **default settings** as of **8 October 2026** (Safari 27, current Chrome, Brave and DuckDuckGo releases). Browsers change often, so check your own settings too.
- What each company says it does comes from its own help pages and privacy policies. Nobody outside can audit their servers. Where a point comes only from user reports, the details say so.
- Every row lists its sources, and the full list is at the bottom of the page.

Fonts: IBM Plex, under the SIL Open Font License (`src/fonts/OFL.txt`).
