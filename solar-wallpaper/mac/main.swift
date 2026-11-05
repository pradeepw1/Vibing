// Solar System Live for the Mac.
//
// A small app that puts the solar system behind your desktop icons, on every screen and every Space,
// and ignores the mouse so clicking the desktop still clicks the desktop. Its settings are in a menu in
// the menu bar (there is no Dock icon). The picture is Space Scope (web/scope.html, inside the app) run as
// a wallpaper, which goes easy on the battery, or the lean Wallpaper page (web/index.html) if you prefer.
// "Open Space Scope" opens the full app, to fly about in, in a normal window.
//
// It also spares the battery: fewer frames a second when the Mac runs on its battery or is in Low Power
// Mode, and nothing drawn at all while the screen sleeps, the Mac is locked or the screen saver is on.
//
// Everything that draws is the same web page as in the browser: this file only gives it a window and a menu.
import Cocoa
import WebKit
import ServiceManagement
import IOKit.ps

// MARK: - What can be picked

enum Style: String {
    case scope // Space Scope as a wallpaper
    case lean // the lean Wallpaper page: just the planets
}

enum BatteryMode: String {
    case save // fewer frames a second
    case full // the same as when plugged in
    case pause // nothing drawn
}

let styleChoices: [(style: Style, label: String)] = [
    (.scope, "Space Scope (the full picture, easy on the battery)"),
    (.lean, "Lean Wallpaper (just the planets, lightest)"),
]

let batteryChoices: [(mode: BatteryMode, label: String)] = [
    (.save, "Save power (fewer frames a second)"),
    (.full, "Full speed"),
    (.pause, "Pause"),
]

// Space Scope's views (what the camera looks at).
let viewChoices: [(id: String, label: String)] = [
    ("middle", "Out to Jupiter"),
    ("system", "Whole solar system"),
    ("inner", "Inner planets"),
    ("sun", "The Sun"),
    ("mercury", "Mercury"),
    ("venus", "Venus"),
    ("earth", "Earth"),
    ("mars", "Mars"),
    ("jupiter", "Jupiter"),
    ("saturn", "Saturn"),
    ("uranus", "Uranus"),
    ("neptune", "Neptune"),
    ("pluto", "Pluto"),
]

// The lean Wallpaper's zoom.
let zoomChoices: [(zoom: Double, label: String)] = [
    (1, "The whole system"),
    (1.9, "Out to Saturn"),
    (4, "Out to Mars"),
    (10, "The Sun and Mercury"),
]
let zoomRange: ClosedRange<Double> = 1...10

let speedChoices: [(id: String, label: String)] = [
    ("live", "Live"),
    ("minute", "1 minute per second"),
    ("hour", "1 hour per second"),
    ("day", "1 day per second"),
    ("week", "1 week per second"),
    ("month", "1 month per second"),
    ("year", "1 year per second"),
]

// The page's names for these, and what to call them in the menu.
let switchChoices: [(key: String, label: String)] = [
    ("drift", "Camera goes round"),
    ("labels", "Names"),
    ("orbits", "Orbit lines"),
    ("belts", "Asteroids"),
    ("clock", "Date and time"),
    ("photos", "Real planet maps"),
]
let scopeSwitches: [(key: String, label: String)] = [
    ("strange", "Strange sightings (all made up)"),
]

// MARK: - Saving the battery

/// Frames a second the page should draw, or nil for none at all. The camera moves slowly, so fewer frames still look
/// smooth; every frame not drawn is power not spent.
func framesPerSecond(style: Style, onBattery: Bool, lowPower: Bool, mode: BatteryMode) -> Int? {
    if onBattery && mode == .pause { return nil }
    if lowPower { return style == .scope ? 12 : 10 } // the person asked the Mac to save power: whatever the mode says
    if onBattery && mode == .save { return style == .scope ? 20 : 15 }
    return style == .scope ? 30 : 20
}

struct PowerState: Equatable {
    var onBattery: Bool
    var lowPower: Bool
}

func readPower() -> PowerState {
    var onBattery = false
    if let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
       let type = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() {
        onBattery = (type as String) == "Battery Power"
    }
    var lowPower = false
    if #available(macOS 12.0, *) { lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled }
    return PowerState(onBattery: onBattery, lowPower: lowPower)
}

// MARK: - What the person picked (kept between runs)

final class Settings {
    private let store = UserDefaults.standard

    var style: Style {
        get { Style(rawValue: store.string(forKey: "style") ?? "") ?? .scope }
        set { store.set(newValue.rawValue, forKey: "style") }
    }

    var batteryMode: BatteryMode {
        get { BatteryMode(rawValue: store.string(forKey: "batteryMode") ?? "") ?? .save }
        set { store.set(newValue.rawValue, forKey: "batteryMode") }
    }

    var zoom: Double {
        get { store.object(forKey: "zoom") as? Double ?? 1 }
        set { store.set(newValue, forKey: "zoom") }
    }

    var view: String {
        get { store.string(forKey: "view") ?? "middle" }
        set { store.set(newValue, forKey: "view") }
    }

    var speed: String {
        get { store.string(forKey: "speed") ?? "live" }
        set { store.set(newValue, forKey: "speed") }
    }

    var allScreens: Bool {
        get { store.object(forKey: "allScreens") as? Bool ?? true }
        set { store.set(newValue, forKey: "allScreens") }
    }

    /// Where the camera was left in Space Scope ("x,y,z" from what it looks at), and, standing on a body, how
    /// ("height,turn,tilt"). Nil: the view's own framing.
    var camera: String? {
        get { store.string(forKey: "camera") }
        set { store.set(newValue, forKey: "camera") }
    }

    var look: String? {
        get { store.string(forKey: "look") }
        set { store.set(newValue, forKey: "look") }
    }

    /// Back to how the wallpaper started: the picture, the view and the camera, the speed, the zoom and the switches.
    /// (Not the app's own choices: the battery, every screen or not, opening at login.)
    func reset() {
        for key in ["style", "view", "camera", "look", "speed", "zoom"] { store.removeObject(forKey: key) }
        for choice in switchChoices + scopeSwitches { store.removeObject(forKey: "switch.\(choice.key)") }
    }

    /// A switch the person has flipped, or nil if they never did (then the page's own default stands).
    func picked(_ key: String) -> Bool? {
        store.object(forKey: "switch.\(key)") as? Bool
    }

    func pick(_ key: String, _ on: Bool) {
        store.set(on, forKey: "switch.\(key)")
    }

    /// What a switch is set to right now, as the menu shows it.
    func isOn(_ key: String) -> Bool {
        if let picked = picked(key) { return picked }
        if key == "strange" { return false } // a wallpaper doesn't have things drifting by unless asked
        // Someone who asked their Mac for less motion gets a camera that holds still, as in the browser.
        if key == "drift" { return !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
        return true
    }
}

// MARK: - The app

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private let settings = Settings()
    private var statusItem: NSStatusItem!
    private var wallpapers: [(window: NSWindow, web: WKWebView, screen: UInt32)] = []
    /// Screens where Space Scope's page kept stopping, so they show the lean picture instead; and where even that kept
    /// stopping, so they show nothing. (Picking a picture in the menu tries again.)
    private var fellBack = Set<UInt32>()
    private var gaveUp = Set<UInt32>()
    private var stops: [UInt32: [Date]] = [:]
    /// The screens as the wallpapers were made for them (which, where, how big), and a check of them waiting to run.
    /// Which build this is (build.sh writes it in: the commit, and when), so the menu and the log can say.
    private let buildName: String = {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "SSLBuild") as? String ?? "unknown build"
        return "\(version) (\(build))"
    }()
    private var screenLayout = ""
    private var screenCheck: DispatchWorkItem?
    /// What the Space Scope window shows, as it last said (the wallpaper takes it when the window closes).
    private var pendingSetUp: [String: Any]?
    private var scopeWindow: NSWindow?
    private var paused = false
    private var power = readPower()
    private var powerTimer: Timer?
    /// Why nothing is being drawn right now: "sleep", "locked", "screensaver", "session", "battery". Empty: drawing.
    private var quiet = Set<String>()

    /// Where the web page is: a folder called "web" inside the app.
    private lazy var webRoot: URL = {
        (Bundle.main.resourceURL ?? URL(fileURLWithPath: Bundle.main.bundlePath)).appendingPathComponent("web", isDirectory: true)
    }()

    // MARK: Start up

    func applicationDidFinishLaunching(_ notification: Notification) {
        LaunchCheck.log("started; screens: \(NSScreen.screens.count)")
        guard FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("index.html").path) else {
            tell("Solar System Live can't find its pictures", "The app is missing its \"web\" folder. Please download it again.")
            NSApp.terminate(nil)
            return
        }
        let version = buildName
        Journal.note("started: version \(version), \(ProcessInfo.processInfo.operatingSystemVersionString), "
            + "\(ProcessInfo.processInfo.physicalMemory / 1_073_741_824) GB of memory, picture: \(settings.style.rawValue)")
        noteScreens()
        // Two copies would each put a wallpaper on the desktop and fight over it. This one is the newer: the others go.
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .filter { $0 != NSRunningApplication.current }
        for other in others {
            Journal.note("another copy was running (process \(other.processIdentifier)): asked it to quit")
            other.terminate()
        }
        installMainMenu()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            if let image = NSImage(systemSymbolName: "globe.americas.fill", accessibilityDescription: "Solar System Live") {
                image.isTemplate = true
                button.image = image
            } else {
                button.title = "SSL"
            }
        }
        LaunchCheck.log("menu bar item made")
        applyPower(initial: true)
        rebuildMenu()
        LaunchCheck.log("menu built")
        buildWallpapers()
        LaunchCheck.log("wallpaper windows made: \(wallpapers.count)")
        watchTheMac()
        LaunchCheck.runIfAsked(LaunchCheck.Hooks(
            web: { [weak self] in self?.wallpapers.first?.web },
            menu: { [weak self] in self?.statusItem.menu },
            pickView: { [weak self] id in self?.setView(id) },
            useStyle: { [weak self] style in self?.setStyle(style) },
            pickZoom: { [weak self] zoom in self?.setZoom(zoom) },
            quiet: { [weak self] on in
                if on { self?.hush("test") } else { self?.unhush("test") }
            },
            style: { [weak self] in self?.settings.style.rawValue ?? "?" },
            window: { [weak self] in self?.wallpapers.first?.window },
            openScope: { [weak self] in self?.openScope() },
            scopeWeb: { [weak self] in self?.scopeWindow?.contentView?.subviews.first as? WKWebView },
            closeScope: { [weak self] in self?.scopeWindow?.close() },
            reset: { [weak self] in self?.resetWallpaper() }))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Quitting with the Space Scope window open still keeps what it shows, for the next start.
    func applicationWillTerminate(_ notification: Notification) {
        if let setUp = pendingSetUp { keepSetUp(setUp, show: false) }
    }

    /// A little main menu so that Cmd-Q and Cmd-W work in the Space Scope window.
    private func installMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Solar System Live", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.mainMenu = main
    }

    // MARK: The wallpaper windows

    /// A web view whose page finds `search` (the settings, written like a page address) when it starts.
    /// `setUp`: the Space Scope window, whose page says what it shows (see `keepSetUp`).
    private func makeWebView(frame: NSRect, search: String?, setUp: Bool = false) -> WKWebView {
        let config = WKWebViewConfiguration()
        LaunchCheck.log("web view: settings made")
        // The page loads its planet maps from files next to it.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        LaunchCheck.log("web view: file access allowed")
        if let search = search {
            // (A page opened from a file can't be given settings in its address, so they are set before it starts.)
            let quoted = search.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            config.userContentController.addUserScript(
                WKUserScript(source: "window.solarSearch = \"\(quoted)\";", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // Errors the page runs into, and its graphics being lost, go to the log (a few of them: not a flood).
        config.userContentController.add(self, name: "journal")
        if setUp { config.userContentController.add(self, name: "scene") }
        config.userContentController.addUserScript(WKUserScript(source: Self.reportProblems, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: frame, configuration: config)
        LaunchCheck.log("web view: made")
        web.autoresizingMask = [.width, .height]
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .black }
        if web.responds(to: NSSelectorFromString("_setDrawsBackground:")) {
            web.setValue(false, forKey: "drawsBackground") // (or it is white until the page first draws: black, like the window behind it)
        }
        return web
    }

    private static let reportProblems = """
        (function () {
          var sent = 0, said = {};
          function post(text) {
            text = String(text).slice(0, 300);
            if (sent >= 20 || said[text]) return;
            said[text] = true;
            sent++;
            try { window.webkit.messageHandlers.journal.postMessage(text); } catch (e) {}
          }
          addEventListener("error", function (e) { post("page error: " + e.message + " (" + String(e.filename || "").split("/").pop() + ":" + e.lineno + ")"); });
          addEventListener("unhandledrejection", function (e) { post("page error: " + (e.reason && e.reason.message || e.reason)); });
          addEventListener("webglcontextlost", function () { post("page: its graphics were lost"); }, true);
          addEventListener("webglcontextrestored", function () { post("page: its graphics came back"); }, true);
          // Hidden and shown again (another window over the desktop, Mission Control, the screen asleep): every time, up
          // to a couple of hundred, so the log shows what happens when an app opens.
          var turns = 0;
          document.addEventListener("visibilitychange", function () {
            if (++turns > 200) return;
            try { window.webkit.messageHandlers.journal.postMessage("page: " + (document.hidden ? "hidden" : "shown")); } catch (e) {}
          });
        })();
        """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "scene" {
            // What the Space Scope window shows now: kept until the window closes, then shown on the desktop.
            if let text = message.body as? String, let data = text.data(using: .utf8),
               let setUp = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                pendingSetUp = setUp
            }
            return
        }
        let text = "\(message.body)"
        if text.contains("graphics were lost"), let web = message.webView {
            trouble(web, "its graphics were lost", reload: false)
            return
        }
        let which = wallpapers.first(where: { $0.web === message.webView }).map { "screen \($0.screen)" } ?? "the Space Scope window"
        Journal.note("\(which): \(text)")
        if text.hasPrefix("page: finished loading"), let web = wallpapers.first(where: { $0.web === message.webView })?.web {
            minding(covers: true, web)
        }
    }

    private func screenID(_ screen: NSScreen) -> UInt32 {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    }

    private func noteScreens() {
        for (index, screen) in NSScreen.screens.enumerated() {
            Journal.note("screen \(screenID(screen))\(index == 0 ? " (the one with the menu bar)" : ""): \(screen.localizedName), "
                + "\(Int(screen.frame.width)) x \(Int(screen.frame.height)) points, \(screen.backingScaleFactor)x sharp")
        }
    }

    /// The picture a screen shows: the one picked, unless Space Scope kept stopping there.
    private func style(for screen: UInt32) -> Style {
        fellBack.contains(screen) ? .lean : settings.style
    }

    /// The frame rate for a picture right now, while it is drawn at all.
    private func frames(for style: Style) -> Int {
        framesPerSecond(style: style, onBattery: power.onBattery, lowPower: power.lowPower, mode: settings.batteryMode)
            ?? framesPerSecond(style: style, onBattery: false, lowPower: false, mode: .full) ?? 20
    }

    /// The settings as a page address would say them.
    /// `window`: for the Space Scope window, which opens on what the wallpaper shows but is the full app (no wallpaper
    /// savings, its own frame rate).
    private func search(for style: Style, window: Bool = false) -> String {
        var items = window ? ["speed=\(settings.speed)"] : ["wallpaper=1", "speed=\(settings.speed)", "fps=\(frames(for: style))"]
        for choice in switchChoices + (style == .scope ? scopeSwitches : []) {
            if let picked = settings.picked(choice.key) { items.append("\(choice.key)=\(picked ? 1 : 0)") }
        }
        if style == .scope {
            items.append("view=\(settings.view)")
            if let camera = settings.camera { items.append("cam=\(camera)") }
            if let look = settings.look { items.append("look=\(look)") }
        } else {
            items.append("zoom=\(number(settings.zoom))")
        }
        return "?" + items.joined(separator: "&")
    }

    private func page(for style: Style) -> String { style == .scope ? "scope.html" : "index.html" }

    private func load(_ web: WKWebView, page: String) {
        let url = webRoot.appendingPathComponent(page)
        LaunchCheck.log("loading \(url.path)")
        web.loadFileURL(url, allowingReadAccessTo: webRoot)
        LaunchCheck.log("load asked for")
    }

    /// Loads a wallpaper's page, on show as far as the page can tell even if windows cover it, until it has finished.
    ///
    /// macOS hides a covered page, and a hidden page puts nothing on the screen: it can load, but its picture only gets
    /// there once it is uncovered, so the desktop would stay black for a second just when someone looks at it. A page that
    /// has drawn once keeps that picture for when it is shown again, so it only needs to be allowed to draw once.
    /// (If this macOS has no such setting, the page still loads while hidden, by itself: see `nextWait`.)
    private func loadWallpaper(_ web: WKWebView, page: String) {
        minding(covers: false, web)
        load(web, page: page)
        // (A page that never says it finished must not go on drawing under other windows for ever.)
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self, weak web] in
            if let web = web { self?.minding(covers: true, web) }
        }
    }

    /// Whether macOS hides this page when other windows cover it.
    private func minding(covers: Bool, _ web: WKWebView) {
        let key = "windowOcclusionDetectionEnabled"
        guard web.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")),
              web.responds(to: NSSelectorFromString("_windowOcclusionDetectionEnabled")),
              web.value(forKey: key) as? Bool != covers else { return }
        web.setValue(covers, forKey: key)
        // (Setting it doesn't make the page look again at whether it is covered. This does.)
        web.isHidden = true
        web.isHidden = false
    }

    /// A borderless window just above the desktop picture but below the desktop icons, with the page in it.
    private func makeWallpaper(on screen: NSScreen, style: Style) -> (window: NSWindow, web: WKWebView, screen: UInt32) {
        LaunchCheck.log("making a window for a screen")
        let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        LaunchCheck.log("window made")
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isOpaque = true
        window.backgroundColor = .black
        window.hasShadow = false
        // Not the way an app's window opens. That animation is run by the screen's refreshes, so with the screen asleep or
        // the Mac locked it stops on its first frame and stays there: a wallpaper a little smaller than the screen.
        window.animationBehavior = .none
        window.ignoresMouseEvents = true // clicks go through to the desktop
        window.isReleasedWhenClosed = false
        window.setFrame(screen.frame, display: false)
        let web = makeWebView(frame: NSRect(origin: .zero, size: screen.frame.size), search: search(for: style))
        web.navigationDelegate = self
        window.contentView?.addSubview(web)
        LaunchCheck.log("web view added to the window")
        loadWallpaper(web, page: page(for: style))
        LaunchCheck.log("page asked for")
        if quiet.isEmpty { window.orderFrontRegardless() }
        LaunchCheck.log("window shown")
        return (window, web, screenID(screen))
    }

    private func buildWallpapers() {
        screenLayout = layoutOfScreens()
        guard !paused, wallpapers.isEmpty else { return }
        let screens = settings.allScreens ? NSScreen.screens : Array(NSScreen.screens.prefix(1))
        for screen in screens where !gaveUp.contains(screenID(screen)) {
            let id = screenID(screen)
            wallpapers.append(makeWallpaper(on: screen, style: style(for: id)))
            Journal.note("screen \(id): showing \(style(for: id).rawValue)")
        }
    }

    private func dropWallpaper(_ entry: (window: NSWindow, web: WKWebView, screen: UInt32)) {
        entry.web.stopLoading()
        entry.web.navigationDelegate = nil
        entry.web.removeFromSuperview()
        entry.window.orderOut(nil)
    }

    private func removeWallpapers() {
        for entry in wallpapers { dropWallpaper(entry) }
        wallpapers.removeAll()
    }

    private func layoutOfScreens() -> String {
        NSScreen.screens.map { screen in
            let f = screen.frame
            return "\(screenID(screen)):\(Int(f.minX)),\(Int(f.minY)),\(Int(f.width))x\(Int(f.height))@\(screen.backingScaleFactor)"
        }.joined(separator: " ")
    }

    /// macOS says the screens changed for small things too, such as the Dock or the menu bar showing and hiding (that
    /// changes the room left for windows), and it can say it several times in a row. Making the wallpapers again each time
    /// reloaded the picture every few seconds. So: wait until it has gone quiet for a second, then only act on a real
    /// change. The same screens at a new size or place just get their windows moved; only a screen added or taken away
    /// makes the wallpapers again.
    @objc private func screensChanged() {
        screenCheck?.cancel()
        let check = DispatchWorkItem { [weak self] in self?.checkScreens() }
        screenCheck = check
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: check)
    }

    private func checkScreens() {
        let layout = layoutOfScreens()
        guard layout != screenLayout else {
            Journal.note("the screens said they changed, but nothing about them did: left as they are")
            return
        }
        screenLayout = layout
        noteScreens()
        let screens = settings.allScreens ? NSScreen.screens : Array(NSScreen.screens.prefix(1))
        let wanted = Set(screens.map { screenID($0) }).subtracting(gaveUp)
        if !wallpapers.isEmpty && Set(wallpapers.map { $0.screen }) == wanted {
            for entry in wallpapers {
                if let screen = screens.first(where: { screenID($0) == entry.screen }) { entry.window.setFrame(screen.frame, display: true) }
            }
            Journal.note("the screens moved or changed size: windows moved, nothing reloaded")
        } else {
            Journal.note("a screen was added or taken away: the wallpapers are made again")
            removeWallpapers()
            buildWallpapers()
        }
    }

    // MARK: Telling the page about a change

    /// Sets one of the page's settings now (without the page saving it: this app remembers it).
    private func send(_ key: String, _ value: Any, to pages: [WKWebView]? = nil) {
        guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "(function(a){var w=window.solarSystem||window.solarWallpaper;if(w)w.set(\"\(key)\",a[0],{remember:false});})(\(json))"
        for web in pages ?? wallpapers.map({ $0.web }) { web.evaluateJavaScript(js, completionHandler: nil) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let which = wallpapers.first(where: { $0.web === webView }).map { "screen \($0.screen)" } ?? "the Space Scope window"
        Journal.note("\(which): the page loaded")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Journal.note("a page failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Journal.note("a page couldn't start loading: \(error.localizedDescription)")
    }

    /// macOS can stop a page's process when it needs the memory. A wallpaper has to come back.
    /// macOS can stop a page's process (when it needs the memory, or the page crashed). A wallpaper has to come back, but
    /// not over and over: if it stops three times in ten minutes on a screen, that screen gets the lean picture, which is
    /// lighter; if that keeps stopping too, the screen is left alone.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        trouble(webView, "the page stopped", reload: true)
    }

    /// Something went wrong with a screen's picture: its page stopped (`reload`: so load it again), or its graphics were
    /// lost (the picture goes black, and the page gets them back by itself). Three times in ten minutes on a screen and
    /// that screen gets the lean picture; if that has trouble three times too, the screen is left alone.
    private func trouble(_ webView: WKWebView, _ what: String, reload: Bool) {
        guard let index = wallpapers.firstIndex(where: { $0.web === webView }) else {
            Journal.note("the Space Scope window: \(what)")
            return
        }
        let id = wallpapers[index].screen
        let now = Date()
        let recent = (stops[id] ?? []).filter { now.timeIntervalSince($0) < 600 } + [now]
        stops[id] = recent
        Journal.note("screen \(id): \(what) (\(recent.count) time\(recent.count == 1 ? "" : "s") in 10 minutes), showing \(style(for: id).rawValue)")
        guard recent.count >= 3 else {
            if reload { loadWallpaper(webView, page: page(for: style(for: id))) }
            return
        }
        stops[id] = []
        dropWallpaper(wallpapers[index])
        if style(for: id) == .scope, let screen = NSScreen.screens.first(where: { screenID($0) == id }) {
            fellBack.insert(id)
            Journal.note("screen \(id): Space Scope keeps stopping on a screen: showing the lean picture there")
            wallpapers[index] = makeWallpaper(on: screen, style: .lean)
        } else {
            gaveUp.insert(id)
            Journal.note("screen \(id): the picture keeps stopping: leaving this screen alone")
            wallpapers.remove(at: index)
        }
        rebuildMenu()
    }

    // MARK: Drawing less, or not at all

    /// Nothing is drawn while a window isn't on screen: its page is hidden, and a hidden page stops its own work.
    private func hush(_ reason: String) {
        quiet.insert(reason)
        for entry in wallpapers { entry.window.orderOut(nil) }
        Journal.note("hushed for \(reason): \(quiet.sorted())")
    }

    private func unhush(_ reason: String) {
        quiet.remove(reason)
        if quiet.isEmpty { for entry in wallpapers { entry.window.orderFrontRegardless() } }
        Journal.note("woken from \(reason): \(quiet.sorted())")
    }

    /// Looks at the power again (on the battery? Low Power Mode?) and sets the frame rate, or stops drawing, to fit.
    private func applyPower(initial: Bool = false, force: Bool = false) {
        let now = readPower()
        if !initial && !force && now == power { return }
        power = now
        let frames = framesPerSecond(style: settings.style, onBattery: power.onBattery, lowPower: power.lowPower, mode: settings.batteryMode)
        Journal.note("power: battery \(power.onBattery), low power \(power.lowPower): \(frames.map { "\($0) frames a second" } ?? "paused")")
        if initial {
            // (The pages are not made yet: their address says the frame rate. Paused: the windows stay hidden.)
            if frames == nil { quiet.insert("battery") }
            return
        }
        if frames != nil {
            unhush("battery")
            for entry in wallpapers { send("fps", self.frames(for: style(for: entry.screen)), to: [entry.web]) } // (a screen may show the other picture)
        } else {
            hush("battery")
        }
        rebuildMenu()
    }

    private func powerNote() -> String {
        if power.lowPower { return "Low Power Mode is on" }
        return power.onBattery ? "Running on the battery" : "Plugged in"
    }

    /// What to listen for so that nothing is drawn when nobody can see it, and the power state is noticed.
    private func watchTheMac() {
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(screensSlept), name: NSWorkspace.screensDidSleepNotification, object: nil)
        workspace.addObserver(self, selector: #selector(screensWoke), name: NSWorkspace.screensDidWakeNotification, object: nil)
        workspace.addObserver(self, selector: #selector(sessionLeft), name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        workspace.addObserver(self, selector: #selector(sessionBack), name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        let distributed = DistributedNotificationCenter.default()
        distributed.addObserver(self, selector: #selector(locked), name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
        distributed.addObserver(self, selector: #selector(unlocked), name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
        distributed.addObserver(self, selector: #selector(screenSaverOn), name: NSNotification.Name("com.apple.screensaver.didstart"), object: nil)
        distributed.addObserver(self, selector: #selector(screenSaverOff), name: NSNotification.Name("com.apple.screensaver.didstop"), object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        if #available(macOS 12.0, *) {
            NotificationCenter.default.addObserver(
                self, selector: #selector(powerChanged), name: NSNotification.Name.NSProcessInfoPowerStateDidChange, object: nil)
        }
        // Plugging in or unplugging doesn't tell us, so look now and then (a slow, loose timer costs next to nothing).
        let timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.applyPower() }
        timer.tolerance = 15
        powerTimer = timer
    }

    @objc private func screensSlept() { hush("sleep") }
    @objc private func screensWoke() { unhush("sleep") }
    @objc private func sessionLeft() { hush("session") }
    @objc private func sessionBack() { unhush("session") }
    @objc private func locked() { hush("locked") }
    @objc private func unlocked() { unhush("locked") }
    @objc private func screenSaverOn() { hush("screensaver") }
    @objc private func screenSaverOff() { unhush("screensaver") }
    /// macOS sends this one on a background thread, and windows, menus and web pages may only be touched on the main one.
    @objc private func powerChanged() {
        DispatchQueue.main.async { [weak self] in
            Journal.note("the Low Power Mode setting changed")
            self?.applyPower()
        }
    }

    // MARK: The menu

    private func item(_ title: String, _ action: Selector?, key: String = "", on: Bool = false) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
        it.target = self
        it.state = on ? .on : .off
        return it
    }

    private func number(_ value: Double) -> String { String(format: "%g", value) }

    private var launchesAtLogin: Bool {
        if #available(macOS 13.0, *) { return SMAppService.mainApp.status == .enabled }
        return false
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(item("Solar System Live \(buildName)", nil))
        if !fellBack.isEmpty || !gaveUp.isEmpty {
            menu.addItem(item("Space Scope kept stopping on a screen, so it shows the lean picture there", nil))
        }
        menu.addItem(.separator())

        let styleMenu = NSMenu()
        for choice in styleChoices {
            let it = item(choice.label, #selector(pickStyle(_:)), on: settings.style == choice.style)
            it.representedObject = choice.style.rawValue
            styleMenu.addItem(it)
        }
        let styleItem = NSMenuItem(title: "Picture", action: nil, keyEquivalent: "")
        styleItem.submenu = styleMenu
        menu.addItem(styleItem)

        if settings.style == .scope {
            let viewMenu = NSMenu()
            for choice in viewChoices {
                let it = item(choice.label, #selector(pickView(_:)), on: settings.view == choice.id)
                it.representedObject = choice.id
                viewMenu.addItem(it)
            }
            let current = viewChoices.first(where: { $0.id == settings.view })?.label ?? settings.view
            let viewItem = NSMenuItem(title: "Look at (now \(current))", action: nil, keyEquivalent: "")
            viewItem.submenu = viewMenu
            menu.addItem(viewItem)
        } else {
            let zoomMenu = NSMenu()
            for choice in zoomChoices {
                let it = item("\(number(choice.zoom))×   \(choice.label)", #selector(pickZoom(_:)), on: abs(settings.zoom - choice.zoom) < 0.05)
                it.representedObject = choice.zoom
                zoomMenu.addItem(it)
            }
            zoomMenu.addItem(.separator())
            zoomMenu.addItem(item("Zoom in", #selector(zoomIn), key: "+"))
            zoomMenu.addItem(item("Zoom out", #selector(zoomOut), key: "-"))
            let zoomItem = NSMenuItem(title: "Zoom (now \(number(settings.zoom))×)", action: nil, keyEquivalent: "")
            zoomItem.submenu = zoomMenu
            menu.addItem(zoomItem)
        }

        let speedMenu = NSMenu()
        for choice in speedChoices {
            let it = item(choice.label, #selector(pickSpeed(_:)), on: settings.speed == choice.id)
            it.representedObject = choice.id
            speedMenu.addItem(it)
        }
        let speedItem = NSMenuItem(title: "Time speed", action: nil, keyEquivalent: "")
        speedItem.submenu = speedMenu
        menu.addItem(speedItem)

        menu.addItem(.separator())
        for choice in switchChoices + (settings.style == .scope ? scopeSwitches : []) {
            let it = item(choice.label, #selector(flip(_:)), on: settings.isOn(choice.key))
            it.representedObject = choice.key
            menu.addItem(it)
        }

        menu.addItem(.separator())
        let batteryMenu = NSMenu()
        batteryMenu.addItem(item(powerNote(), nil))
        batteryMenu.addItem(.separator())
        for choice in batteryChoices {
            let it = item(choice.label, #selector(pickBattery(_:)), on: settings.batteryMode == choice.mode)
            it.representedObject = choice.mode.rawValue
            batteryMenu.addItem(it)
        }
        let batteryItem = NSMenuItem(title: "When on the battery", action: nil, keyEquivalent: "")
        batteryItem.submenu = batteryMenu
        menu.addItem(batteryItem)
        menu.addItem(item("Show on every screen", #selector(toggleAllScreens), on: settings.allScreens))
        menu.addItem(item("Pause the wallpaper", #selector(togglePause), on: paused))
        if #available(macOS 13.0, *) {
            menu.addItem(item("Open at login", #selector(toggleLogin), on: launchesAtLogin))
        }
        menu.addItem(.separator())
        menu.addItem(item("Set up the wallpaper in Space Scope…", #selector(openScope)))
        menu.addItem(item("Reset the wallpaper…", #selector(askToReset)))
        menu.addItem(item("Credits", #selector(openCredits)))
        menu.addItem(item("Show the log (for when something goes wrong)", #selector(openLog)))
        menu.addItem(item("Copy the log (to paste when asking for help)", #selector(copyLog)))
        menu.addItem(.separator())
        menu.addItem(item("Quit Solar System Live", #selector(quit), key: "q"))
        statusItem.menu = menu
    }

    // MARK: What the menu does

    private func setStyle(_ style: Style) {
        settings.style = style
        fellBack.removeAll()
        gaveUp.removeAll()
        stops.removeAll()
        Journal.note("picture: \(style.rawValue)")
        removeWallpapers()
        buildWallpapers()
        rebuildMenu()
    }

    @objc private func pickStyle(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String, let style = Style(rawValue: raw) { setStyle(style) }
    }

    /// Whatever the Space Scope window was left showing becomes the wallpaper: the view, where the camera was, the speed
    /// and the switches. (Space Scope is the picture from then on.)
    private func keepSetUp(_ setUp: [String: Any], show: Bool = true) {
        pendingSetUp = nil
        if let view = setUp["view"] as? String { settings.view = view }
        if let speed = setUp["speed"] as? String { settings.speed = speed }
        for choice in switchChoices + scopeSwitches {
            if let on = setUp[choice.key] as? Bool { settings.pick(choice.key, on) }
        }
        let numbers = { (key: String) in (setUp[key] as? [NSNumber])?.map { "\($0.doubleValue)" }.joined(separator: ",") }
        settings.camera = numbers("cam")
        settings.look = numbers("look")
        settings.style = .scope
        Journal.note("the wallpaper now shows what Space Scope was left showing: \(settings.view)")
        if show { startAgain() }
    }

    /// The wallpapers made again from the settings (every screen tried again, with Space Scope where it was picked).
    private func startAgain() {
        fellBack.removeAll()
        gaveUp.removeAll()
        stops.removeAll()
        removeWallpapers()
        buildWallpapers()
        rebuildMenu()
    }

    private func resetWallpaper() {
        settings.reset()
        Journal.note("the wallpaper was reset")
        startAgain()
    }

    @objc private func askToReset() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Reset the wallpaper?"
        alert.informativeText = "It goes back to how it started: Space Scope, out to Jupiter, live time, the camera going round. "
            + "What you set up in Space Scope is forgotten."
        alert.addButton(withTitle: "Reset")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn { resetWallpaper() }
    }

    private func setView(_ id: String) {
        settings.view = id
        settings.camera = nil // (a view picked from the menu has its own framing)
        settings.look = nil
        send("view", id)
        rebuildMenu()
    }

    @objc private func pickView(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { setView(id) }
    }

    private func setZoom(_ zoom: Double) {
        let clean = min(zoomRange.upperBound, max(zoomRange.lowerBound, (zoom * 100).rounded() / 100))
        settings.zoom = clean
        send("zoom", clean)
        rebuildMenu()
    }

    @objc private func pickZoom(_ sender: NSMenuItem) {
        if let zoom = sender.representedObject as? Double { setZoom(zoom) }
    }

    @objc private func zoomIn() { setZoom(settings.zoom * 1.25) }

    @objc private func zoomOut() { setZoom(settings.zoom / 1.25) }

    @objc private func pickSpeed(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        settings.speed = id
        send("speed", id)
        rebuildMenu()
    }

    @objc private func flip(_ sender: NSMenuItem) {
        guard let key = sender.representedObject as? String else { return }
        let on = !settings.isOn(key)
        settings.pick(key, on)
        send(key, on)
        rebuildMenu()
    }

    @objc private func pickBattery(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let mode = BatteryMode(rawValue: raw) else { return }
        settings.batteryMode = mode
        applyPower(force: true)
    }

    @objc private func toggleAllScreens() {
        settings.allScreens.toggle()
        removeWallpapers()
        buildWallpapers()
        rebuildMenu()
    }

    /// Paused means the pages are gone altogether, so nothing is drawn and the memory is given back.
    @objc private func togglePause() {
        paused.toggle()
        if paused { removeWallpapers() } else { buildWallpapers() }
        rebuildMenu()
    }

    @objc private func toggleLogin() {
        guard #available(macOS 13.0, *) else { return }
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            tell("Couldn't change the login setting", error.localizedDescription)
        }
        rebuildMenu()
    }

    @objc private func openScope() {
        if scopeWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered, defer: false)
            window.title = "Space Scope: what you leave it showing becomes your wallpaper"
            window.isReleasedWhenClosed = false
            window.delegate = self
            window.center()
            if let content = window.contentView {
                // It opens on what the wallpaper shows, and whatever it is left showing becomes the wallpaper.
                let web = makeWebView(frame: content.bounds, search: search(for: .scope, window: true), setUp: true)
                content.addSubview(web)
                load(web, page: "scope.html")
            }
            scopeWindow = window
        }
        scopeWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Closing Space Scope throws its page away, so it stops using the graphics chip.
    func windowWillClose(_ notification: Notification) {
        guard (notification.object as? NSWindow) === scopeWindow else { return }
        for case let web as WKWebView in scopeWindow?.contentView?.subviews ?? [] {
            web.configuration.userContentController.removeScriptMessageHandler(forName: "scene") // (nothing more from it)
        }
        if let setUp = pendingSetUp { keepSetUp(setUp) }
        DispatchQueue.main.async { [weak self] in
            self?.scopeWindow?.contentView?.subviews.forEach { $0.removeFromSuperview() }
            self?.scopeWindow = nil
        }
    }

    @objc private func openCredits() {
        NSWorkspace.shared.open(webRoot.appendingPathComponent("CREDITS.txt"))
    }

    @objc private func openLog() {
        Journal.note("log opened from the menu")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NSWorkspace.shared.open(Journal.url) } // (once that line is written)
    }

    /// The last hundred lines of the log, on the clipboard.
    @objc private func copyLog() {
        Journal.note("log copied from the menu")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            let text = (try? String(contentsOf: Journal.url, encoding: .utf8)) ?? "(the log is empty)"
            let lines = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(100).joined(separator: "\n")
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString("Solar System Live \(self?.buildName ?? "")\n" + lines, forType: .string)
            self?.tell("The log is copied", "Paste it (Cmd-V) wherever you're asking for help.")
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    private func tell(_ message: String, _ detail: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = detail
        alert.runModal()
    }
}

// MARK: - Go

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
application.setActivationPolicy(.accessory) // no Dock icon: it lives in the menu bar
application.run()
