# Browser watcher

See, live, which companies your browsers talk to while you browse.

The watcher is a small program that runs on your Mac. Your browsers send their traffic through it on the way out, and it shows every server they contact on a live page. It sees **who** gets contacted and **how much** data goes each way. It never sees **what's inside**: secure (https) traffic passes through still encrypted.

Nothing leaves your Mac and nothing is saved, unless you press "Save as spreadsheet".

## What you need

- A Mac with Python 3. Open Terminal and type `python3 --version`. If your Mac offers to install "command line developer tools", say yes; that installs Python.
- This project folder on your Mac (download it from GitHub, or `git clone` it).

## Start it

1. Open **Terminal** and go to the project folder, for example:
   ```sh
   cd ~/Downloads/Vibing
   ```
2. Start the watcher:
   ```sh
   python3 watch/watch.py --setup
   ```
   `--setup` switches your Mac's proxy setting on for you, and back off when you stop the watcher. If macOS doesn't allow that, the watcher tells you and you can do it by hand (below).
3. Open **http://localhost:8899** in any browser. That's the live view.
4. Browse as usual. Quit and reopen Chrome and Brave once, so they pick up the new setting.
5. To stop, click the Terminal window and press **Ctrl+C**.

### Setting the proxy by hand

If you don't use `--setup`:

1. Open **System Settings → Network → Wi-Fi → Details… → Proxies**.
2. Turn on **Automatic proxy configuration** and enter `http://127.0.0.1:8899/proxy.pac`.
3. Press **OK**.

When you're done, turn **Automatic proxy configuration** off again. If you forget, browsing should keep working, because the setup file tells browsers to connect directly when the watcher isn't running. If pages ever stop loading, turn the setting off, or run `python3 watch/watch.py --off`.

## Using it

- **All / Chrome / Safari / DuckDuckGo / Brave / Other apps**: pick whose traffic to show. The watcher works out which app made each connection by itself.
- **Safari and DuckDuckGo** use the same Apple networking engine, so the watcher can't tell them apart. Use one at a time and tell the page which one it is.
- **Who's getting your data**: one line per company or website, with what kind it is:
  - **Tracker**: an ad or analytics company (about 140 are recognised, plus servers whose names show they swap ad IDs, like `sync.` or `match.`).
  - **Browser maker**: the company that makes the browser you're looking at, e.g. Google for Chrome. Searches on google.com from Chrome count here too, because the watcher can't see what was sent.
  - **Content delivery**: networks that serve files for websites.
  - **Website**: everything else.
- **Compare browsers**: totals for each browser side by side. The **2-minute quiet test** shows what a browser sends home when you leave it alone on a blank tab.
- **Save as spreadsheet**: download everything as a CSV file you can open in Numbers or Excel.

## Your iPhone

1. Start the watcher with `python3 watch/watch.py --phone`. Terminal shows an address like `http://192.168.1.20:8899/proxy.pac`.
2. If your Mac asks whether Python may accept incoming network connections, choose **Allow**.
3. On the iPhone (same Wi-Fi): **Settings → Wi-Fi →** tap **ⓘ** next to your network **→ Configure Proxy → Automatic**, paste the address, and tap **Save**.
4. Phone traffic shows up under **Phone**. Set **Configure Proxy** back to **Off** when you're done.

With `--phone`, only devices on your own home network can use the watcher.

## If something looks wrong

- **Nothing shows up.** Check the proxy address is exactly right, then quit and reopen the browser.
- **Safari shows nothing.** iCloud Private Relay may be sending Safari's traffic around the watcher. Turn it off while you test (System Settings → your name → iCloud → Private Relay).
- **Lots of "Other apps".** Mail, App Store and other apps follow the same setting. Pick a browser at the top to hide them.
- **"Couldn't start on port 8899".** The watcher is probably already running in another Terminal window. Or start it on another port: `python3 watch/watch.py --port 8900` (then use port 8900 everywhere above).

## Options

```
python3 watch/watch.py [--setup] [--off] [--phone] [--port N] [--upstream http://host:port]
```

- `--setup`: switch the Mac's proxy setting on now and off again when the watcher stops.
- `--off`: switch the Mac's proxy setting back the way it was, then quit.
- `--phone`: let phones on the same Wi-Fi use the watcher.
- `--port N`: listen on another port (default 8899).
- `--upstream URL`: send traffic on through another proxy, for networks that need one.
