#!/usr/bin/env python3
"""Browser watcher: see, live, which companies your browsers talk to.

Run it, point your Mac's proxy setting at it, then open http://localhost:8899.

    python3 watch/watch.py            # start watching
    python3 watch/watch.py --setup    # also switch the Mac's proxy setting on (and off again on exit)
    python3 watch/watch.py --off      # switch the Mac's proxy setting back off
    python3 watch/watch.py --phone    # also let an iPhone on the same Wi-Fi use it

What it sees: the name of every server a browser connects to, which app made
the connection, and how many bytes go each way. What it never sees: the
contents. Secure (https) traffic passes through still encrypted, untouched.

Standard library only. No data leaves your computer; nothing is saved unless
you press "Save as file" on the live page.
"""

import argparse
import asyncio
import base64
import collections
import ipaddress
import json
import os
import pathlib
import re
import resource
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
PAGE = HERE / "live.html"
FONT_DIR = HERE.parent / "src" / "fonts"
BACKUP = pathlib.Path.home() / ".browser-watch-proxy-backup.json"
DEFAULT_PORT = 8899

# ---------------------------------------------------------------------------
# Who owns a server name
# ---------------------------------------------------------------------------

# (domain, company, kind). kind: "tracker" for ad and analytics services,
# "cdn" for content delivery networks, "" for everything else. The longest
# matching domain wins, so a specific host can override its parent domain.
DOMAINS = [
    # Google
    ("google.com", "Google", ""), ("googleapis.com", "Google", ""), ("gstatic.com", "Google", ""),
    ("gvt1.com", "Google", ""), ("gvt2.com", "Google", ""), ("gvt3.com", "Google", ""),
    ("googleusercontent.com", "Google", ""), ("googlevideo.com", "Google", ""), ("youtube.com", "Google", ""),
    ("ytimg.com", "Google", ""), ("ggpht.com", "Google", ""), ("youtube-nocookie.com", "Google", ""),
    ("withgoogle.com", "Google", ""), ("google", "Google", ""), ("goo.gl", "Google", ""),
    ("doubleclick.net", "Google", "tracker"), ("google-analytics.com", "Google", "tracker"),
    ("googletagmanager.com", "Google", "tracker"), ("googlesyndication.com", "Google", "tracker"),
    ("googleadservices.com", "Google", "tracker"), ("googletagservices.com", "Google", "tracker"),
    ("adservice.google.com", "Google", "tracker"), ("app-measurement.com", "Google", "tracker"),
    ("2mdn.net", "Google", "tracker"), ("admob.com", "Google", "tracker"),
    ("pagead2.googlesyndication.com", "Google", "tracker"),
    # Apple
    ("apple.com", "Apple", ""), ("icloud.com", "Apple", ""), ("icloud-content.com", "Apple", ""),
    ("apple-cloudkit.com", "Apple", ""), ("mzstatic.com", "Apple", ""), ("cdn-apple.com", "Apple", ""),
    ("aaplimg.com", "Apple", ""), ("apple-dns.net", "Apple", ""), ("apple.news", "Apple", ""),
    ("safebrowsing.apple", "Apple", ""), ("apple", "Apple", ""),
    # DuckDuckGo
    ("duckduckgo.com", "DuckDuckGo", ""), ("duck.com", "DuckDuckGo", ""), ("duck.ai", "DuckDuckGo", ""),
    ("duckduckgo.co", "DuckDuckGo", ""),
    # Brave
    ("brave.com", "Brave", ""), ("brave.app", "Brave", ""), ("brave.software", "Brave", ""),
    ("bravesoftware.com", "Brave", ""), ("search.brave.com", "Brave", ""),
    # Meta
    ("facebook.com", "Meta", ""), ("facebook.net", "Meta", "tracker"), ("fbcdn.net", "Meta", ""),
    ("instagram.com", "Meta", ""), ("cdninstagram.com", "Meta", ""), ("whatsapp.com", "Meta", ""),
    ("whatsapp.net", "Meta", ""), ("fbsbx.com", "Meta", ""),
    # Microsoft
    ("microsoft.com", "Microsoft", ""), ("bing.com", "Microsoft", ""), ("bat.bing.com", "Microsoft", "tracker"),
    ("clarity.ms", "Microsoft", "tracker"), ("msn.com", "Microsoft", ""), ("live.com", "Microsoft", ""),
    ("adnxs.com", "Microsoft (Xandr)", "tracker"), ("linkedin.com", "LinkedIn", ""),
    ("ads.linkedin.com", "LinkedIn", "tracker"), ("px.ads.linkedin.com", "LinkedIn", "tracker"),
    ("licdn.com", "LinkedIn", ""), ("snap.licdn.com", "LinkedIn", "tracker"),
    # Amazon
    ("amazon.com", "Amazon", ""), ("media-amazon.com", "Amazon", ""), ("ssl-images-amazon.com", "Amazon", ""),
    ("amazon-adsystem.com", "Amazon", "tracker"), ("cloudfront.net", "Amazon CloudFront", "cdn"),
    ("amazonaws.com", "Amazon Web Services", "cdn"),
    # Other ad and analytics companies
    ("scorecardresearch.com", "Comscore", "tracker"), ("criteo.com", "Criteo", "tracker"),
    ("criteo.net", "Criteo", "tracker"), ("taboola.com", "Taboola", "tracker"), ("outbrain.com", "Outbrain", "tracker"),
    ("hotjar.com", "Hotjar", "tracker"), ("hotjar.io", "Hotjar", "tracker"), ("segment.io", "Segment", "tracker"),
    ("segment.com", "Segment", "tracker"), ("mixpanel.com", "Mixpanel", "tracker"), ("amplitude.com", "Amplitude", "tracker"),
    ("nr-data.net", "New Relic", "tracker"), ("quantserve.com", "Quantcast", "tracker"),
    ("quantcount.com", "Quantcast", "tracker"), ("rubiconproject.com", "Magnite", "tracker"),
    ("pubmatic.com", "PubMatic", "tracker"), ("openx.net", "OpenX", "tracker"), ("casalemedia.com", "Index Exchange", "tracker"),
    ("indexww.com", "Index Exchange", "tracker"), ("adsrvr.org", "The Trade Desk", "tracker"),
    ("demdex.net", "Adobe", "tracker"), ("omtrdc.net", "Adobe", "tracker"), ("everesttech.net", "Adobe", "tracker"),
    ("adobedtm.com", "Adobe", "tracker"), ("analytics.tiktok.com", "TikTok", "tracker"),
    ("ads-twitter.com", "X (Twitter)", "tracker"), ("analytics.twitter.com", "X (Twitter)", "tracker"),
    ("ct.pinterest.com", "Pinterest", "tracker"), ("sc-static.net", "Snap", "tracker"), ("tr.snapchat.com", "Snap", "tracker"),
    ("alb.reddit.com", "Reddit", "tracker"), ("pixel-config.reddit.com", "Reddit", "tracker"),
    ("analytics.yahoo.com", "Yahoo", "tracker"), ("chartbeat.com", "Chartbeat", "tracker"), ("chartbeat.net", "Chartbeat", "tracker"),
    ("parsely.com", "Parse.ly", "tracker"), ("parse.ly", "Parse.ly", "tracker"), ("moatads.com", "Oracle", "tracker"),
    ("bluekai.com", "Oracle", "tracker"), ("krxd.net", "Salesforce", "tracker"), ("exelator.com", "Nielsen", "tracker"),
    ("imrworldwide.com", "Nielsen", "tracker"), ("crwdcntrl.net", "Lotame", "tracker"), ("rlcdn.com", "LiveRamp", "tracker"),
    ("liadm.com", "LiveIntent", "tracker"), ("id5-sync.com", "ID5", "tracker"), ("33across.com", "33Across", "tracker"),
    ("sharethrough.com", "Sharethrough", "tracker"), ("teads.tv", "Teads", "tracker"), ("smartadserver.com", "Equativ", "tracker"),
    ("adform.net", "Adform", "tracker"), ("media.net", "Media.net", "tracker"), ("doubleverify.com", "DoubleVerify", "tracker"),
    ("adsafeprotected.com", "Integral Ad Science", "tracker"), ("optimizely.com", "Optimizely", "tracker"),
    ("branch.io", "Branch", "tracker"), ("appsflyer.com", "AppsFlyer", "tracker"), ("adjust.com", "Adjust", "tracker"),
    ("sentry.io", "Sentry", "tracker"), ("bidswitch.net", "BidSwitch", "tracker"), ("3lift.com", "TripleLift", "tracker"),
    ("yieldmo.com", "Yieldmo", "tracker"), ("gumgum.com", "GumGum", "tracker"), ("tapad.com", "Tapad", "tracker"),
    ("agkn.com", "Neustar", "tracker"), ("mathtag.com", "MediaMath", "tracker"), ("contextweb.com", "PulsePoint", "tracker"),
    ("lijit.com", "Sovrn", "tracker"), ("sovrn.com", "Sovrn", "tracker"), ("adroll.com", "AdRoll", "tracker"),
    ("hs-analytics.net", "HubSpot", "tracker"), ("hs-scripts.com", "HubSpot", "tracker"), ("mktoresp.com", "Adobe Marketo", "tracker"),
    ("pardot.com", "Salesforce", "tracker"), ("mc.yandex.ru", "Yandex", "tracker"), ("mc.yandex.com", "Yandex", "tracker"),
    ("kochava.com", "Kochava", "tracker"), ("onesignal.com", "OneSignal", "tracker"), ("braze.com", "Braze", "tracker"),
    ("cloudflareinsights.com", "Cloudflare", "tracker"), ("quantummetric.com", "Quantum Metric", "tracker"),
    ("fullstory.com", "FullStory", "tracker"), ("heapanalytics.com", "Heap", "tracker"), ("mouseflow.com", "Mouseflow", "tracker"),
    ("crazyegg.com", "Crazy Egg", "tracker"), ("newrelic.com", "New Relic", "tracker"), ("bounceexchange.com", "Wunderkind", "tracker"),
    ("zemanta.com", "Outbrain", "tracker"), ("adition.com", "Adition", "tracker"), ("yieldlab.net", "Yieldlab", "tracker"),
    ("adtrafficquality.google", "Google", "tracker"), ("permutive.app", "Permutive", "tracker"),
    ("permutive.com", "Permutive", "tracker"), ("prmutv.co", "Permutive", "tracker"), ("cxense.com", "Piano", "tracker"),
    ("piano.io", "Piano", "tracker"), ("tinypass.com", "Piano", "tracker"), ("bidr.io", "Beeswax", "tracker"),
    ("mparticle.com", "mParticle", "tracker"), ("creativecdn.com", "RTB House", "tracker"),
    ("durationmedia.net", "Duration Media", "tracker"), ("eu-1-id5-sync.com", "ID5", "tracker"),
    ("blismedia.com", "Blis", "tracker"), ("360yield.com", "Improve Digital", "tracker"),
    ("dotmetrics.net", "Ipsos", "tracker"), ("dv.tech", "DoubleVerify", "tracker"),
    ("brandmetrics.com", "Brandmetrics", "tracker"), ("im-apps.net", "Intimate Merger", "tracker"),
    ("ipredictive.com", "Viant", "tracker"), ("seedtag.com", "Seedtag", "tracker"), ("adx.opera.com", "Opera Ads", "tracker"),
    ("webcontentassessor.com", "Confiant", "tracker"), ("confiant-integrations.net", "Confiant", "tracker"),
    ("intentiq.com", "Intent IQ", "tracker"), ("openxcdn.net", "OpenX", "tracker"), ("mgaru.dev", "myGaru", "tracker"),
    ("mygaru.com", "myGaru", "tracker"), ("fastclick.net", "Epsilon", "tracker"), ("dotomi.com", "Epsilon", "tracker"),
    ("the-ozone-project.com", "Ozone", "tracker"), ("kargo.com", "Kargo", "tracker"), ("presage.io", "Ogury", "tracker"),
    ("ogury.io", "Ogury", "tracker"), ("1rx.io", "Unruly", "tracker"), ("turn.com", "Amobee", "tracker"),
    ("stackadapt.com", "StackAdapt", "tracker"), ("deepintent.com", "DeepIntent", "tracker"), ("loopme.me", "LoopMe", "tracker"),
    ("onetag-sys.com", "OneTag", "tracker"), ("rfihub.com", "Zeta Global", "tracker"), ("pmbmonetize.live", "PMB Monetize", "tracker"),
    ("sitescout.com", "Basis", "tracker"), ("pippio.com", "LiveRamp", "tracker"), ("trustedstack.com", "TrustedStack", "tracker"),
    ("speedcurve.com", "SpeedCurve", "tracker"), ("edigitalsurvey.com", "Ipsos", "tracker"), ("cognitivlabs.com", "Cognitiv", "tracker"),
    ("sonobi.com", "Sonobi", "tracker"), ("eyeota.net", "Dun & Bradstreet", "tracker"), ("addthis.com", "Oracle", "tracker"),
    ("sharethis.com", "ShareThis", "tracker"), ("tiqcdn.com", "Tealium", "tracker"), ("tealiumiq.com", "Tealium", "tracker"),
    ("ensighten.com", "Ensighten", "tracker"), ("go-mpulse.net", "Akamai mPulse", "tracker"), ("revcontent.com", "Revcontent", "tracker"),
    ("mgid.com", "MGID", "tracker"), ("nativo.com", "Nativo", "tracker"), ("spotxchange.com", "Magnite", "tracker"),
    ("spotx.tv", "Magnite", "tracker"), ("springserve.com", "SpringServe", "tracker"), ("freewheel.tv", "FreeWheel", "tracker"),
    ("innovid.com", "Innovid", "tracker"), ("lkqd.net", "Nexstar Digital", "tracker"), ("aniview.com", "Aniview", "tracker"),
    ("connatix.com", "Connatix", "tracker"), ("jwpltx.com", "JW Player", "tracker"), ("advertising.com", "Yahoo", "tracker"),
    ("ads.yahoo.com", "Yahoo", "tracker"), ("yahoo.com", "Yahoo", ""), ("adsymptotic.com", "Adsymptotic", "tracker"),
    ("smartclip.net", "Smartclip", "tracker"), ("richaudience.com", "Rich Audience", "tracker"), ("adkernel.com", "AdKernel", "tracker"),
    ("emxdgt.com", "Big Village", "tracker"), ("e-planning.net", "e-planning", "tracker"),
    ("adhigh.net", "AdHigh", "tracker"), ("zeotap.com", "Zeotap", "tracker"), ("semasio.net", "Semasio", "tracker"),
    ("weborama.fr", "Weborama", "tracker"), ("weborama.com", "Weborama", "tracker"), ("nexx360.io", "Nexx360", "tracker"),
    ("sportradarserving.com", "Sportradar", "tracker"), ("usbrowserspeed.com", "Intent IQ", "tracker"),
    ("ad-delivery.net", "Ad delivery", "tracker"), ("adlightning.com", "Ad Lightning", "tracker"),
    ("adentifi.com", "Adentifi", "tracker"), ("admanmedia.com", "Adman Media", "tracker"),
    ("chocolateplatform.com", "Chocolate Platform", "tracker"), ("simpli.fi", "Simpli.fi", "tracker"),
    ("tribalfusion.com", "Exponential", "tracker"), ("ymmobi.com", "Yeahmobi", "tracker"),
    ("privacy-mgmt.com", "Sourcepoint (cookie banners)", ""), ("sourcepoint.com", "Sourcepoint (cookie banners)", ""),
    ("didomi.io", "Didomi (cookie banners)", ""), ("usercentrics.eu", "Usercentrics (cookie banners)", ""),
    # Consent banners
    ("cookielaw.org", "OneTrust (cookie banners)", ""), ("onetrust.com", "OneTrust (cookie banners)", ""),
    ("cookiebot.com", "Cookiebot (cookie banners)", ""), ("consensu.org", "Cookie banner services", ""),
    # Content delivery
    ("cloudflare.com", "Cloudflare", "cdn"), ("cloudflare.net", "Cloudflare", "cdn"), ("akamaized.net", "Akamai", "cdn"),
    ("akamaihd.net", "Akamai", "cdn"), ("akamai.net", "Akamai", "cdn"), ("edgekey.net", "Akamai", "cdn"),
    ("edgesuite.net", "Akamai", "cdn"), ("fastly.net", "Fastly", "cdn"), ("fastly.com", "Fastly", "cdn"),
    ("jsdelivr.net", "jsDelivr", "cdn"), ("unpkg.com", "unpkg", "cdn"), ("azureedge.net", "Microsoft Azure", "cdn"),
    ("b-cdn.net", "Bunny CDN", "cdn"), ("imgix.net", "imgix", "cdn"),
]
DOMAIN_TABLE = sorted(DOMAINS, key=lambda d: -len(d[0]))
GOOGLE_CC = re.compile(r"(^|\.)google\.(co\.)?[a-z]{2,3}(\.[a-z]{2})?$")

# Two-part public suffixes, so "bbc.co.uk" groups as one site.
MULTI_SUFFIX = {
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "edu.au", "gov.au",
    "co.in", "net.in", "org.in", "gov.in", "ac.in", "co.jp", "ne.jp", "or.jp", "ac.jp", "com.br", "net.br",
    "com.cn", "net.cn", "org.cn", "com.mx", "co.nz", "org.nz", "co.za", "com.sg", "com.tr", "co.kr", "or.kr",
    "com.tw", "com.hk", "com.ar", "co.id", "com.my", "com.ph", "com.vn", "com.ua", "com.pk", "com.ng",
    "com.eg", "com.sa", "co.il", "co.th", "com.co", "com.pe", "com.pl", "co.at", "com.es",
}


def is_ip(host):
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False


def site_of(host):
    """The registrable domain: www.bbc.co.uk -> bbc.co.uk."""
    host = host.lower().rstrip(".")
    if is_ip(host):
        return host
    labels = host.split(".")
    if len(labels) >= 3 and ".".join(labels[-2:]) in MULTI_SUFFIX:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


SYNC_HOST = re.compile(r"^(sync|csync|usersync|user-sync|cookie-sync|ms-cookie-sync|pixel-sync|idsync|match|cm)\d*\.")


def classify(host):
    host = host.lower().rstrip(".")
    for domain, company, kind in DOMAIN_TABLE:
        if host == domain or host.endswith("." + domain):
            return company, kind
    if GOOGLE_CC.search(host):
        return "Google", ""
    if SYNC_HOST.match(host) and host.count(".") >= 2:
        return "", "tracker"
    return "", ""


# ---------------------------------------------------------------------------
# Which app made a connection
# ---------------------------------------------------------------------------

def browser_of(app, webkit_as):
    """Map a process name to one of the browsers on the dashboard."""
    a = (app or "").lower()
    if not a:
        return "unknown"
    if "brave" in a:
        return "brave"
    if "chrome" in a or "chromium" in a:
        return "chrome"
    if "duckduckgo" in a:
        return "ddg"
    if "safari" in a:
        return "safari"
    if "webkit" in a:
        # Safari and DuckDuckGo share Apple's networking process, so the
        # person tells us which one they are using.
        return webkit_as
    return "other"


def nice_app(app):
    if not app:
        return ""
    if "webkit.networking" in app.lower():
        return "WebKit (Safari or DuckDuckGo)"
    return app


LSOF_NAME = re.compile(r"^\[?([0-9a-fA-F:.]+)\]?:(\d+)->\[?([0-9a-fA-F:.]+)\]?:(\d+)")


class AppFinder:
    """Asks lsof which process owns the client end of each connection."""

    def __init__(self, port):
        self.port = port
        self.lsof = shutil.which("lsof") or ("/usr/sbin/lsof" if os.path.exists("/usr/sbin/lsof") else None)
        self.pending = {}  # client port -> (conn, asked_at)
        self.seen = {}  # client port -> (command, pid, when) from recent scans
        self.wake = asyncio.Event()
        self.me = os.getpid()

    def ask(self, conn, client_port):
        if not self.lsof or not is_loopback(conn.client):
            WATCH.resolve(conn, None, None)
            return
        self.pending[client_port] = (conn, time.monotonic())
        self.wake.set()

    async def run(self):
        while True:
            await self.wake.wait()
            self.wake.clear()
            await asyncio.sleep(0.05)  # let a few connections pile up, then ask once
            scanned_at = time.monotonic()
            for cport, (cmd, pid) in (await self.scan()).items():
                self.seen[cport] = (cmd, pid, scanned_at)
            now = time.monotonic()
            for cport, (conn, asked) in list(self.pending.items()):
                hit = self.seen.get(cport)
                if hit and hit[2] >= asked - 0.5:
                    WATCH.resolve(conn, hit[0], hit[1])
                    del self.pending[cport]
                elif conn.state != "open" and asked < scanned_at:
                    # Gone before any scan caught it. If nothing was sent, nothing to report.
                    if conn.up or conn.down:
                        WATCH.resolve(conn, None, None)
                    else:
                        WATCH.drop(conn)
                    del self.pending[cport]
                elif now - asked > 5:
                    WATCH.resolve(conn, None, None)
                    del self.pending[cport]
            for cport in [p for p, v in self.seen.items() if now - v[2] > 30]:
                del self.seen[cport]
            if self.pending:
                self.wake.set()

    async def scan(self):
        try:
            proc = await asyncio.create_subprocess_exec(
                self.lsof, "-nP", "+c", "0", f"-iTCP:{self.port}", "-sTCP:ESTABLISHED", "-F", "pcn",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(proc.communicate(), 5)
        except (OSError, asyncio.TimeoutError):
            return {}
        found = {}
        pid, cmd = None, None
        for line in out.decode("utf-8", "replace").splitlines():
            if not line:
                continue
            tag, value = line[0], line[1:]
            if tag == "p":
                pid, cmd = int(value) if value.isdigit() else None, None
            elif tag == "c":
                cmd = value
            elif tag == "n" and pid != self.me:
                m = LSOF_NAME.match(value)
                if m and int(m.group(4)) == self.port and int(m.group(2)) != self.port:
                    found[int(m.group(2))] = (cmd, pid)
        return found


# ---------------------------------------------------------------------------
# What we keep
# ---------------------------------------------------------------------------

MAKERS = {"chrome": "Google", "safari": "Apple", "ddg": "DuckDuckGo", "brave": "Brave"}


class Conn:
    __slots__ = ("id", "start", "end", "client", "app", "browser", "host", "port", "site", "company",
                 "kind", "up", "down", "state", "agg", "quiet")

    def __init__(self, cid, client, host, port):
        self.id = cid
        self.start = time.time()
        self.end = None
        self.client = client
        self.app = None
        self.browser = None  # unknown until the app is found
        self.host = host
        self.port = port
        self.site = site_of(host)
        self.company, self.kind = classify(host)
        self.up = 0
        self.down = 0
        self.state = "open"
        self.agg = None
        self.quiet = None

    def public(self):
        return {
            "id": self.id, "start": round(self.start, 3), "end": self.end and round(self.end, 3),
            "app": nice_app(self.app), "browser": self.browser, "host": self.host, "port": self.port,
            "site": self.site, "company": self.company, "kind": self.kind,
            "up": self.up, "down": self.down, "state": self.state,
        }


class Agg:
    """Everything one browser sent to one site."""
    __slots__ = ("browser", "site", "company", "kind", "conns", "open", "up", "down", "first", "last", "hosts")

    def __init__(self, browser, conn):
        self.browser = browser
        self.site = conn.site
        self.company = conn.company
        self.kind = conn.kind
        self.conns = 0
        self.open = 0
        self.up = 0
        self.down = 0
        self.first = conn.start
        self.last = conn.start
        self.hosts = []

    def public(self):
        return {
            "browser": self.browser, "site": self.site, "company": self.company, "kind": self.kind,
            "conns": self.conns, "open": self.open, "up": self.up, "down": self.down,
            "first": round(self.first, 3), "last": round(self.last, 3), "hosts": self.hosts,
        }


class Watch:
    def __init__(self):
        self.next_id = 1
        self.recent = collections.deque(maxlen=400)
        self.open = {}
        self.aggs = {}
        self.dirty_conns = {}
        self.dirty_aggs = {}
        self.settings = {"webkitAs": "safari"}
        self.quiet = None  # the running quiet test
        self.quiet_results = {}
        self.started = time.time()
        self.total = 0
        self.listeners = set()
        self.finder = None

    def new_conn(self, client, host, port):
        conn = Conn(self.next_id, client, host, port)
        self.next_id += 1
        self.total += 1
        self.recent.append(conn)
        self.open[conn.id] = conn
        self.dirty_conns[conn.id] = conn
        return conn

    def drop(self, conn):
        """A connection that closed unused and couldn't be matched to an app."""
        if conn.browser is None:
            conn.browser = "dropped"
            self.dirty_conns.pop(conn.id, None)

    def resolve(self, conn, app, pid):
        if conn.browser is not None:
            return
        conn.app = app
        if not is_loopback(conn.client):
            conn.browser = "phone"
            conn.app = f"Phone or tablet ({conn.client})"
        else:
            conn.browser = browser_of(app, self.settings["webkitAs"])
        self.attach(conn, conn.up, conn.down)
        self.dirty_conns[conn.id] = conn
        q = self.quiet
        if q and conn.browser == q["browser"] and conn.start >= q["start"]:
            conn.quiet = q
            q["conns"].append(conn)

    def attach(self, conn, up, down):
        key = (conn.browser, conn.site)
        agg = self.aggs.get(key)
        if agg is None:
            agg = self.aggs[key] = Agg(conn.browser, conn)
        agg.conns += 1
        agg.up += up
        agg.down += down
        agg.last = max(agg.last, time.time())
        if conn.state == "open":
            agg.open += 1
        if conn.host not in agg.hosts and len(agg.hosts) < 12:
            agg.hosts.append(conn.host)
        conn.agg = agg
        self.dirty_aggs[key] = agg

    def add_bytes(self, conn, up=0, down=0):
        conn.up += up
        conn.down += down
        self.dirty_conns[conn.id] = conn
        agg = conn.agg
        if agg is not None:
            agg.up += up
            agg.down += down
            agg.last = time.time()
            self.dirty_aggs[(agg.browser, agg.site)] = agg

    def close(self, conn, state="closed"):
        if conn.state != "open":
            return
        conn.state = state
        conn.end = time.time()
        self.open.pop(conn.id, None)
        self.dirty_conns[conn.id] = conn
        agg = conn.agg
        if agg is not None:
            agg.open = max(0, agg.open - 1)
            agg.last = max(agg.last, conn.end)
            self.dirty_aggs[(agg.browser, agg.site)] = agg

    def clear(self):
        self.recent.clear()
        self.aggs.clear()
        self.dirty_conns.clear()
        self.dirty_aggs.clear()
        self.quiet_results.clear()
        self.quiet = None
        self.started = time.time()
        self.total = 0
        # Connections still open start counting again from zero.
        for conn in self.open.values():
            if conn.browser is not None:
                self.attach(conn, 0, 0)

    # Quiet test: what does a browser contact while you leave it alone?
    def start_quiet(self, browser, seconds):
        if browser in ("safari", "ddg"):
            self.settings["webkitAs"] = browser
        self.quiet = {"browser": browser, "start": time.time(), "seconds": seconds, "conns": []}

    def quiet_public(self, q, done):
        companies = {}
        for c in q["conns"]:
            name = c.company or c.site
            row = companies.setdefault(name, {"name": name, "kind": c.kind, "conns": 0, "up": 0, "down": 0, "hosts": []})
            row["conns"] += 1
            row["up"] += c.up
            row["down"] += c.down
            if c.host not in row["hosts"] and len(row["hosts"]) < 8:
                row["hosts"].append(c.host)
        return {
            "browser": q["browser"], "start": round(q["start"], 3), "seconds": q["seconds"], "done": done,
            "companies": sorted(companies.values(), key=lambda r: (-r["conns"], r["name"])),
        }

    def tick_quiet(self):
        q = self.quiet
        if q and time.time() >= q["start"] + q["seconds"]:
            self.quiet_results[q["browser"]] = self.quiet_public(q, True)
            self.quiet = None
            return True
        return False

    def snapshot(self):
        return {
            "started": round(self.started, 3), "total": self.total, "now": round(time.time(), 3),
            "settings": self.settings,
            "aggs": [a.public() for a in self.aggs.values()],
            "conns": [c.public() for c in self.recent if c.browser not in (None, "dropped")],
            "quiet": self.quiet and self.quiet_public(self.quiet, False),
            "quietResults": self.quiet_results,
            "appFinder": bool(WATCH.finder and WATCH.finder.lsof),
        }

    def take_changes(self):
        conns = [c.public() for c in self.dirty_conns.values() if c.browser not in (None, "dropped")]
        aggs = [a.public() for a in self.dirty_aggs.values()]
        self.dirty_conns = {k: c for k, c in self.dirty_conns.items() if c.browser is None}
        self.dirty_aggs = {}
        return conns, aggs


WATCH = Watch()


# ---------------------------------------------------------------------------
# Network helpers
# ---------------------------------------------------------------------------

def is_loopback(ip):
    try:
        return ipaddress.ip_address(ip.split("%")[0]).is_loopback
    except ValueError:
        return False


def is_private(ip):
    try:
        addr = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return False
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_private or addr.is_loopback or addr.is_link_local


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # no packet is sent; this just picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def parse_head(raw):
    text = raw.decode("latin-1")
    lines = text.split("\r\n")
    parts = lines[0].split(" ")
    if len(parts) != 3:
        raise ValueError("bad request line")
    headers = []
    for line in lines[1:]:
        if not line:
            continue
        name, sep, value = line.partition(":")
        if not sep:
            raise ValueError("bad header")
        headers.append((name.strip(), value.strip()))
    return parts[0].upper(), parts[1], parts[2], headers


def header(headers, name):
    name = name.lower()
    for k, v in headers:
        if k.lower() == name:
            return v
    return None


def split_hostport(value, default_port):
    value = value.strip()
    if value.startswith("["):
        end = value.find("]")
        host = value[1:end]
        rest = value[end + 1:]
        port = int(rest[1:]) if rest.startswith(":") else default_port
    elif value.count(":") == 1:
        host, _, p = value.partition(":")
        port = int(p)
    else:
        host, port = value, default_port
    if not host or not (0 < port < 65536):
        raise ValueError("bad host")
    return host.lower(), port


class Upstream:
    """An optional proxy to send everything through (some offices need one)."""

    def __init__(self, url):
        u = urllib.parse.urlsplit(url)
        if u.scheme != "http" or not u.hostname:
            raise SystemExit("--upstream must look like http://host:port")
        self.host = u.hostname
        self.port = u.port or 8080
        self.auth = None
        if u.username:
            token = f"{urllib.parse.unquote(u.username)}:{urllib.parse.unquote(u.password or '')}"
            self.auth = "Basic " + base64.b64encode(token.encode()).decode()


UPSTREAM = None


async def open_upstream(host, port):
    """Connect to host:port directly, or through the upstream proxy."""
    if UPSTREAM is None:
        return await asyncio.wait_for(asyncio.open_connection(host, port), 15)
    reader, writer = await asyncio.wait_for(asyncio.open_connection(UPSTREAM.host, UPSTREAM.port), 15)
    target = f"[{host}]:{port}" if ":" in host else f"{host}:{port}"
    lines = [f"CONNECT {target} HTTP/1.1", f"Host: {target}"]
    if UPSTREAM.auth:
        lines.append(f"Proxy-Authorization: {UPSTREAM.auth}")
    writer.write(("\r\n".join(lines) + "\r\n\r\n").encode())
    await writer.drain()
    head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 15)
    status = head.split(b" ", 2)
    if len(status) < 2 or status[1] != b"200":
        writer.close()
        raise ConnectionError("upstream proxy refused: " + head.split(b"\r\n", 1)[0].decode("latin-1"))
    return reader, writer


async def pump(src, dst, conn, direction):
    try:
        while True:
            data = await src.read(65536)
            if not data:
                break
            dst.write(data)
            if direction == "up":
                WATCH.add_bytes(conn, up=len(data))
            else:
                WATCH.add_bytes(conn, down=len(data))
            await dst.drain()
    except (ConnectionError, OSError, asyncio.IncompleteReadError):
        pass
    finally:
        try:
            if dst.can_write_eof():
                dst.write_eof()
        except (OSError, RuntimeError):
            pass


async def relay(reader, writer, up_reader, up_writer, conn):
    send = asyncio.ensure_future(pump(reader, up_writer, conn, "up"))
    recv = asyncio.ensure_future(pump(up_reader, writer, conn, "down"))
    done, pending = await asyncio.wait({send, recv}, return_when=asyncio.FIRST_COMPLETED)
    if pending:
        await asyncio.wait(pending, timeout=30)
    for task in pending:
        task.cancel()


def close_quietly(*writers):
    for w in writers:
        try:
            w.close()
        except (OSError, RuntimeError):
            pass


# ---------------------------------------------------------------------------
# Proxy
# ---------------------------------------------------------------------------

class Server:
    def __init__(self, port, phone):
        self.port = port
        self.phone = phone
        self.lan = lan_ip() if phone else None
        self.self_hosts = {"localhost", "127.0.0.1", "::1"}
        if self.lan:
            self.self_hosts.add(self.lan)

    def client_allowed(self, ip):
        return is_loopback(ip) or (self.phone and is_private(ip))

    def target_allowed(self, client_ip, host, port):
        if host in self.self_hosts and port == self.port:
            return False  # would loop back into the watcher
        if is_loopback(client_ip):
            return True
        # Don't let other devices reach services that only listen on this Mac.
        return host not in ("localhost",) and not (is_ip(host) and is_loopback(host.strip("[]")))

    async def handle(self, reader, writer):
        peer = writer.get_extra_info("peername") or ("?", 0)
        client_ip, client_port = peer[0], peer[1]
        if not self.client_allowed(client_ip):
            close_quietly(writer)
            return
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 30)
            method, target, version, headers = parse_head(raw)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError,
                ConnectionError, OSError, ValueError):
            close_quietly(writer)
            return
        try:
            if method == "CONNECT":
                await self.tunnel(reader, writer, client_ip, client_port, target)
            elif target.lower().startswith("http://"):
                url = urllib.parse.urlsplit(target)
                host, port = (url.hostname or "").lower(), url.port or 80
                if host in self.self_hosts and port == self.port:
                    path = (url.path or "/") + (f"?{url.query}" if url.query else "")
                    await self.local(reader, writer, method, path, headers, client_ip)
                else:
                    await self.forward(reader, writer, client_ip, client_port, method, url, version, headers)
            elif target.startswith("/"):
                await self.local(reader, writer, method, target, headers, client_ip)
            else:
                await respond(writer, 400, b"Bad request\n")
        except (ConnectionError, OSError):
            close_quietly(writer)

    async def tunnel(self, reader, writer, client_ip, client_port, target):
        try:
            host, port = split_hostport(target, 443)
        except ValueError:
            await respond(writer, 400, b"Bad request\n")
            return
        if not self.target_allowed(client_ip, host, port):
            await respond(writer, 403, b"Not allowed\n")
            return
        conn = WATCH.new_conn(client_ip, host, port)
        WATCH.finder.ask(conn, client_port)
        try:
            up_reader, up_writer = await open_upstream(host, port)
        except (OSError, asyncio.TimeoutError, ConnectionError, ValueError, asyncio.IncompleteReadError,
                asyncio.LimitOverrunError):
            WATCH.close(conn, "failed")
            await respond(writer, 502, b"Could not reach that server\n")
            return
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        try:
            await writer.drain()
            await relay(reader, writer, up_reader, up_writer, conn)
        finally:
            WATCH.close(conn)
            close_quietly(writer, up_writer)

    async def forward(self, reader, writer, client_ip, client_port, method, url, version, headers):
        """Plain http:// requests. Passed on with 'Connection: close'."""
        host, port = (url.hostname or "").lower(), url.port or 80
        if not host or not self.target_allowed(client_ip, host, port):
            await respond(writer, 403, b"Not allowed\n")
            return
        conn = WATCH.new_conn(client_ip, host, port)
        WATCH.finder.ask(conn, client_port)
        try:
            up_reader, up_writer = await open_upstream(host, port)
        except (OSError, asyncio.TimeoutError, ConnectionError, ValueError, asyncio.IncompleteReadError,
                asyncio.LimitOverrunError):
            WATCH.close(conn, "failed")
            await respond(writer, 502, b"Could not reach that server\n")
            return
        path = (url.path or "/") + (f"?{url.query}" if url.query else "")
        skip = {"proxy-connection", "proxy-authorization", "connection", "keep-alive"}
        lines = [f"{method} {path} {version}"]
        lines += [f"{k}: {v}" for k, v in headers if k.lower() not in skip]
        if header(headers, "host") is None:
            lines.append(f"Host: {url.netloc}")
        lines.append("Connection: close")
        head = ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")
        up_writer.write(head)
        WATCH.add_bytes(conn, up=len(head))
        try:
            await up_writer.drain()
            send = asyncio.ensure_future(pump(reader, up_writer, conn, "up"))
            await pump(up_reader, writer, conn, "down")
            send.cancel()
        finally:
            WATCH.close(conn)
            close_quietly(writer, up_writer)

    # -- the live page and its data ---------------------------------------

    async def local(self, reader, writer, method, path, headers, client_ip):
        host_header = (header(headers, "host") or "").lower()
        try:
            host_name, _ = split_hostport(host_header, self.port)
        except ValueError:
            host_name = ""
        if host_name not in self.self_hosts:
            # Blocks other websites from reading the log through a renamed address.
            await respond(writer, 403, b"Open this page at http://localhost:%d\n" % self.port)
            return
        route = path.split("?", 1)[0]
        if method == "GET" and route in ("/", "/index.html"):
            body = PAGE.read_bytes() if PAGE.exists() else b"live.html is missing next to watch.py\n"
            await respond(writer, 200, body, "text/html; charset=utf-8", page=True)
        elif method == "GET" and route == "/proxy.pac":
            await respond(writer, 200, pac(host_name, self.port).encode(), "application/x-ns-proxy-autoconfig")
        elif method == "GET" and route.startswith("/fonts/"):
            name = route[len("/fonts/"):]
            f = FONT_DIR / name
            if re.fullmatch(r"[a-z0-9-]+\.woff2", name) and f.exists():
                await respond(writer, 200, f.read_bytes(), "font/woff2", cache=True)
            else:
                await respond(writer, 404, b"Not found\n")
        elif method == "GET" and route == "/events":
            await self.events(writer)
        elif method == "GET" and route == "/api/state":
            await respond(writer, 200, json.dumps(WATCH.snapshot()).encode(), "application/json")
        elif method == "POST" and route.startswith("/api/"):
            await self.api(reader, writer, route, headers)
        else:
            await respond(writer, 404, b"Not found\n")

    async def api(self, reader, writer, route, headers):
        # A custom header means other sites can't send these without asking first.
        if header(headers, "x-watch") != "1":
            await respond(writer, 403, b"Missing header\n")
            return
        try:
            length = int(header(headers, "content-length") or 0)
            if length > 10000:
                raise ValueError
            body = json.loads((await reader.readexactly(length)).decode() or "{}") if length else {}
        except (ValueError, asyncio.IncompleteReadError):
            await respond(writer, 400, b"Bad request\n")
            return
        if route == "/api/settings":
            if body.get("webkitAs") in ("safari", "ddg"):
                WATCH.settings["webkitAs"] = body["webkitAs"]
            broadcast("settings", WATCH.settings)
        elif route == "/api/clear":
            WATCH.clear()
            broadcast("snapshot", WATCH.snapshot())
        elif route == "/api/quiet":
            browser = body.get("browser")
            if browser not in MAKERS:
                await respond(writer, 400, b"Unknown browser\n")
                return
            seconds = int(body.get("seconds") or 120)
            WATCH.start_quiet(browser, max(30, min(seconds, 600)))
            broadcast("quiet", WATCH.quiet_public(WATCH.quiet, False))
            broadcast("settings", WATCH.settings)
        elif route == "/api/quiet/stop":
            WATCH.quiet = None
            broadcast("quiet", None)
        else:
            await respond(writer, 404, b"Not found\n")
            return
        await respond(writer, 200, b'{"ok":true}', "application/json")

    async def events(self, writer):
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\n"
                     b"Connection: keep-alive\r\nX-Content-Type-Options: nosniff\r\n\r\nretry: 2000\n\n")
        writer.write(sse("snapshot", WATCH.snapshot()))
        queue = asyncio.Queue(maxsize=200)
        WATCH.listeners.add(queue)
        try:
            await writer.drain()
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), 15)
                except asyncio.TimeoutError:
                    msg = b": still here\n\n"
                writer.write(msg)
                await asyncio.wait_for(writer.drain(), 10)
        except (ConnectionError, OSError, asyncio.TimeoutError):
            pass
        finally:
            WATCH.listeners.discard(queue)
            close_quietly(writer)


def sse(event, data):
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode()


def broadcast(event, data):
    msg = sse(event, data)
    for q in list(WATCH.listeners):
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            # A page that can't keep up gets a fresh copy of everything instead.
            while not q.empty():
                q.get_nowait()
            q.put_nowait(sse("snapshot", WATCH.snapshot()))


async def ticker():
    while True:
        await asyncio.sleep(0.5)
        if WATCH.tick_quiet():
            broadcast("quietResults", WATCH.quiet_results)
            broadcast("quiet", None)
        conns, aggs = WATCH.take_changes()
        if WATCH.listeners and (conns or aggs):
            msg = {"conns": conns, "aggs": aggs, "total": WATCH.total, "now": round(time.time(), 3)}
            if WATCH.quiet:
                msg["quiet"] = WATCH.quiet_public(WATCH.quiet, False)
            broadcast("update", msg)


async def respond(writer, status, body, ctype="text/plain; charset=utf-8", page=False, cache=False):
    reason = {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 502: "Bad Gateway"}[status]
    lines = [
        f"HTTP/1.1 {status} {reason}", f"Content-Type: {ctype}", f"Content-Length: {len(body)}",
        "Connection: close", "X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer",
        "Cache-Control: " + ("max-age=86400" if cache else "no-store"),
    ]
    if page:
        lines.append("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; "
                     "style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; "
                     "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    writer.write(("\r\n".join(lines) + "\r\n\r\n").encode() + body)
    try:
        await writer.drain()
    finally:
        close_quietly(writer)


def pac(host, port):
    proxy = f"[{host}]" if ":" in host else host
    return f"""// Browser watcher: send web traffic through the watcher, or go direct if it isn't running.
function FindProxyForURL(url, host) {{
  if (isPlainHostName(host) || host == "localhost" || host == "{host}" ||
      shExpMatch(host, "127.*") || shExpMatch(host, "*.local") ||
      shExpMatch(host, "10.*") || shExpMatch(host, "192.168.*") || shExpMatch(host, "169.254.*") ||
      shExpMatch(host, "172.1[6-9].*") || shExpMatch(host, "172.2[0-9].*") || shExpMatch(host, "172.3[0-1].*") ||
      host == "::1" || host == "[::1]")
    return "DIRECT";
  return "PROXY {proxy}:{port}; DIRECT";
}}
"""


# ---------------------------------------------------------------------------
# Mac proxy setting (--setup / --off)
# ---------------------------------------------------------------------------

def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)


def mac_service():
    """The network service (usually "Wi-Fi") that carries the default route."""
    code, out = run(["route", "-n", "get", "default"])
    m = re.search(r"interface:\s*(\S+)", out)
    device = m.group(1) if m else None
    code, order = run(["networksetup", "-listnetworkserviceorder"])
    services = re.findall(r"^\(\d+\)\s+(.+)$\n^\(Hardware Port: .*?, Device: (\S*)\)", order, re.M)
    for name, dev in services:
        if device and dev == device:
            return name.strip()
    names = [n.strip() for n, _ in services]
    return "Wi-Fi" if "Wi-Fi" in names or not names else names[0]


def mac_setup(port):
    if sys.platform != "darwin":
        print("  --setup only works on a Mac. Set the proxy by hand (see below).")
        return None
    service = mac_service()
    url = f"http://127.0.0.1:{port}/proxy.pac"
    if not BACKUP.exists():
        code, out = run(["networksetup", "-getautoproxyurl", service])
        prev_url = re.search(r"URL:\s*(.*)", out)
        prev_on = re.search(r"Enabled:\s*(\w+)", out)
        BACKUP.write_text(json.dumps({
            "service": service,
            "url": prev_url.group(1).strip() if prev_url else "(null)",
            "enabled": bool(prev_on and prev_on.group(1).lower() == "yes"),
        }))
    code, out = run(["networksetup", "-setautoproxyurl", service, url])
    code2, out2 = run(["networksetup", "-setautoproxystate", service, "on"])
    if code or code2 or "rror" in out + out2:
        print(f"  macOS didn't allow the change ({(out or out2)[:120]}).")
        print("  Set it by hand instead (see below), or run with sudo.")
        BACKUP.unlink(missing_ok=True)
        return None
    print(f"  Turned on automatic proxy for \"{service}\". It goes back off when you stop the watcher.")
    return service


def mac_off():
    if sys.platform != "darwin":
        return
    if BACKUP.exists():
        try:
            saved = json.loads(BACKUP.read_text())
        except ValueError:
            saved = {}
        service = saved.get("service") or mac_service()
        if saved.get("enabled") and saved.get("url") not in (None, "", "(null)"):
            run(["networksetup", "-setautoproxyurl", service, saved["url"]])
        else:
            run(["networksetup", "-setautoproxystate", service, "off"])
        BACKUP.unlink(missing_ok=True)
        print(f"  Put the proxy setting for \"{service}\" back the way it was.")
    else:
        service = mac_service()
        code, out = run(["networksetup", "-getautoproxyurl", service])
        if "/proxy.pac" in out and ("127.0.0.1" in out or "localhost" in out):
            run(["networksetup", "-setautoproxystate", service, "off"])
            print(f"  Turned off the watcher's proxy setting for \"{service}\".")


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

def raise_file_limit():
    # Each browser tab can hold many connections; the Mac's default limit is low.
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        want = 8192 if hard == resource.RLIM_INFINITY else min(8192, hard)
        if soft < want:
            resource.setrlimit(resource.RLIMIT_NOFILE, (want, hard))
    except (ValueError, OSError):
        pass


def banner(port, server, did_setup):
    print()
    print("Browser watcher is running.")
    print()
    print(f"  Live view:  http://localhost:{port}")
    print()
    if not did_setup:
        print("  Point your Mac at the watcher (once):")
        print("    System Settings > Network > Wi-Fi > Details... > Proxies")
        print("    Turn on \"Automatic proxy configuration\" and enter:")
        print(f"      http://127.0.0.1:{port}/proxy.pac")
        print("    (or stop this and run it again with --setup to do it for you)")
        print()
    if server.phone:
        if server.lan:
            print("  On your iPhone (same Wi-Fi):")
            print("    Settings > Wi-Fi > (i) next to your network > Configure Proxy > Automatic")
            print(f"      URL: http://{server.lan}:{port}/proxy.pac")
            print("    If your Mac asks whether python3 may accept incoming connections, say Allow.")
        else:
            print("  Couldn't find this Mac's Wi-Fi address, so the phone option is off.")
        print()
    print("  Browse as usual. Press Ctrl+C here to stop.")
    print()


async def main_async(args):
    global UPSTREAM
    if args.upstream:
        UPSTREAM = Upstream(args.upstream)
    server = Server(args.port, args.phone)
    host = "0.0.0.0" if args.phone else "127.0.0.1"
    WATCH.finder = AppFinder(args.port)
    try:
        srv = await asyncio.start_server(server.handle, host, args.port, limit=65536, reuse_address=True)
    except OSError as e:
        raise SystemExit(f"Couldn't start on port {args.port} ({e.strerror}). Is the watcher already running? "
                         f"Try --port {args.port + 1}.")
    did_setup = mac_setup(args.port) is not None if args.setup else False
    banner(args.port, server, did_setup)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass
    tasks = [asyncio.ensure_future(WATCH.finder.run()), asyncio.ensure_future(ticker())]
    try:
        async with srv:
            await stop.wait()
    finally:
        for t in tasks:
            t.cancel()
        if did_setup:
            mac_off()
        print("Watcher stopped.")


def main():
    ap = argparse.ArgumentParser(description="See, live, which companies your browsers talk to.")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port to listen on (default {DEFAULT_PORT})")
    ap.add_argument("--setup", action="store_true", help="switch the Mac's proxy setting on now and off on exit")
    ap.add_argument("--off", action="store_true", help="switch the Mac's proxy setting back off and quit")
    ap.add_argument("--phone", action="store_true", help="let phones on the same Wi-Fi use the watcher")
    ap.add_argument("--upstream", metavar="URL", help="send traffic on through another proxy, e.g. http://host:3128")
    args = ap.parse_args()
    if args.off:
        mac_off()
        return
    raise_file_limit()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
