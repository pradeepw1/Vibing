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

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private let settings = Settings()
    private var statusItem: NSStatusItem!
    private var wallpapers: [(window: NSWindow, web: WKWebView)] = []
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
            window: { [weak self] in self?.wallpapers.first?.window }))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

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
    private func makeWebView(frame: NSRect, search: String?) -> WKWebView {
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
        let web = WKWebView(frame: frame, configuration: config)
        LaunchCheck.log("web view: made")
        web.autoresizingMask = [.width, .height]
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .black }
        return web
    }

    private var currentFrames: Int {
        framesPerSecond(style: settings.style, onBattery: power.onBattery, lowPower: power.lowPower, mode: settings.batteryMode)
            ?? framesPerSecond(style: settings.style, onBattery: false, lowPower: false, mode: .full) ?? 20
    }

    /// The settings as a page address would say them.
    private func search(for style: Style) -> String {
        var items = ["wallpaper=1", "speed=\(settings.speed)", "fps=\(currentFrames)"]
        for choice in switchChoices + (style == .scope ? scopeSwitches : []) {
            if let picked = settings.picked(choice.key) { items.append("\(choice.key)=\(picked ? 1 : 0)") }
        }
        items.append(style == .scope ? "view=\(settings.view)" : "zoom=\(number(settings.zoom))")
        return "?" + items.joined(separator: "&")
    }

    private func page(for style: Style) -> String { style == .scope ? "scope.html" : "index.html" }

    private func load(_ web: WKWebView, page: String) {
        let url = webRoot.appendingPathComponent(page)
        LaunchCheck.log("loading \(url.path)")
        web.loadFileURL(url, allowingReadAccessTo: webRoot)
        LaunchCheck.log("load asked for")
    }

    private func buildWallpapers() {
        guard !paused, wallpapers.isEmpty else { return }
        let screens = settings.allScreens ? NSScreen.screens : Array(NSScreen.screens.prefix(1))
        let style = settings.style
        for screen in screens {
            // Borderless, and just above the desktop picture but below the desktop icons.
            LaunchCheck.log("making a window for a screen")
            let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            LaunchCheck.log("window made")
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            window.isOpaque = true
            window.backgroundColor = .black
            window.hasShadow = false
            window.ignoresMouseEvents = true // clicks go through to the desktop
            window.isReleasedWhenClosed = false
            window.setFrame(screen.frame, display: false)
            let web = makeWebView(frame: NSRect(origin: .zero, size: screen.frame.size), search: search(for: style))
            web.navigationDelegate = self
            window.contentView?.addSubview(web)
            LaunchCheck.log("web view added to the window")
            load(web, page: page(for: style))
            LaunchCheck.log("page asked for")
            if quiet.isEmpty { window.orderFrontRegardless() }
            LaunchCheck.log("window shown")
            wallpapers.append((window, web))
        }
    }

    private func removeWallpapers() {
        for entry in wallpapers {
            entry.web.stopLoading()
            entry.web.navigationDelegate = nil
            entry.web.removeFromSuperview()
            entry.window.orderOut(nil)
        }
        wallpapers.removeAll()
    }

    @objc private func screensChanged() {
        removeWallpapers()
        buildWallpapers()
    }

    // MARK: Telling the page about a change

    /// Sets one of the page's settings now (without the page saving it: this app remembers it).
    private func send(_ key: String, _ value: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "(function(a){var w=window.solarSystem||window.solarWallpaper;if(w)w.set(\"\(key)\",a[0],{remember:false});})(\(json))"
        for entry in wallpapers { entry.web.evaluateJavaScript(js, completionHandler: nil) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        LaunchCheck.log("a page finished loading")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        LaunchCheck.log("a page failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        LaunchCheck.log("a page couldn't start loading: \(error.localizedDescription)")
    }

    /// macOS can stop a page's process when it needs the memory. A wallpaper has to come back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        LaunchCheck.log("a page's process stopped")
        if wallpapers.contains(where: { $0.web === webView }) {
            load(webView, page: page(for: settings.style))
        }
    }

    // MARK: Drawing less, or not at all

    /// Nothing is drawn while a window isn't on screen: its page is hidden, and a hidden page stops its own work.
    private func hush(_ reason: String) {
        quiet.insert(reason)
        for entry in wallpapers { entry.window.orderOut(nil) }
        LaunchCheck.log("hushed for \(reason): \(quiet.sorted())")
    }

    private func unhush(_ reason: String) {
        quiet.remove(reason)
        if quiet.isEmpty { for entry in wallpapers { entry.window.orderFrontRegardless() } }
        LaunchCheck.log("woken from \(reason): \(quiet.sorted())")
    }

    /// Looks at the power again (on the battery? Low Power Mode?) and sets the frame rate, or stops drawing, to fit.
    private func applyPower(initial: Bool = false, force: Bool = false) {
        let now = readPower()
        if !initial && !force && now == power { return }
        power = now
        let frames = framesPerSecond(style: settings.style, onBattery: power.onBattery, lowPower: power.lowPower, mode: settings.batteryMode)
        LaunchCheck.log("power: battery \(power.onBattery), low power \(power.lowPower): \(frames.map { "\($0) frames a second" } ?? "paused")")
        if initial {
            // (The pages are not made yet: their address says the frame rate. Paused: the windows stay hidden.)
            if frames == nil { quiet.insert("battery") }
            return
        }
        if let frames = frames {
            unhush("battery")
            send("fps", frames)
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
    @objc private func powerChanged() { applyPower() }

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
        menu.addItem(item("Solar System Live", nil))
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
        menu.addItem(item("Open Space Scope in a window…", #selector(openScope)))
        menu.addItem(item("Credits", #selector(openCredits)))
        menu.addItem(.separator())
        menu.addItem(item("Quit Solar System Live", #selector(quit), key: "q"))
        statusItem.menu = menu
    }

    // MARK: What the menu does

    private func setStyle(_ style: Style) {
        settings.style = style
        removeWallpapers()
        buildWallpapers()
        rebuildMenu()
    }

    @objc private func pickStyle(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String, let style = Style(rawValue: raw) { setStyle(style) }
    }

    private func setView(_ id: String) {
        settings.view = id
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
            window.title = "Space Scope"
            window.isReleasedWhenClosed = false
            window.delegate = self
            window.center()
            if let content = window.contentView {
                let web = makeWebView(frame: content.bounds, search: nil) // (no settings: the full app, as in a browser)
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
        DispatchQueue.main.async { [weak self] in
            self?.scopeWindow?.contentView?.subviews.forEach { $0.removeFromSuperview() }
            self?.scopeWindow = nil
        }
    }

    @objc private func openCredits() {
        NSWorkspace.shared.open(webRoot.appendingPathComponent("CREDITS.txt"))
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
