// Solar System Live for the Mac.
//
// A small app that puts the Wallpaper page (web/index.html, inside the app) behind your desktop
// icons, on every screen and every Space, and ignores the mouse so clicking the desktop still
// clicks the desktop. Its settings are in a menu in the menu bar (there is no Dock icon).
// "Open Space Scope" opens the full app in a normal window.
//
// Everything that draws is the same web page as in the browser: this file only gives it a window
// and a menu.
import Cocoa
import WebKit
import ServiceManagement

// MARK: - What can be picked

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

// MARK: - What the person picked (kept between runs)

final class Settings {
    private let store = UserDefaults.standard

    var zoom: Double {
        get { store.object(forKey: "zoom") as? Double ?? 1 }
        set { store.set(newValue, forKey: "zoom") }
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
        rebuildMenu()
        LaunchCheck.log("menu built")
        buildWallpapers()
        LaunchCheck.log("wallpaper windows made: \(wallpapers.count)")
        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        LaunchCheck.runIfAsked { [weak self] in self?.wallpapers.first?.web }
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

    private func makeWebView(frame: NSRect) -> WKWebView {
        let config = WKWebViewConfiguration()
        LaunchCheck.log("web view: settings made")
        // The page loads its planet maps from files next to it.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        LaunchCheck.log("web view: file access allowed")
        let web = WKWebView(frame: frame, configuration: config)
        LaunchCheck.log("web view: made")
        web.autoresizingMask = [.width, .height]
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .black }
        return web
    }

    /// Opens one of the web pages. The settings are not in the address: once the page has loaded, `didFinish` below
    /// says them to it (the page takes them without a fuss while it is starting).
    private func load(_ web: WKWebView, page: String) {
        let url = webRoot.appendingPathComponent(page)
        LaunchCheck.log("loading \(url.path)")
        web.loadFileURL(url, allowingReadAccessTo: webRoot)
        LaunchCheck.log("load asked for")
    }

    private func buildWallpapers() {
        guard !paused, wallpapers.isEmpty else { return }
        let screens = settings.allScreens ? NSScreen.screens : Array(NSScreen.screens.prefix(1))
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
            let web = makeWebView(frame: NSRect(origin: .zero, size: screen.frame.size))
            web.navigationDelegate = self
            window.contentView?.addSubview(web)
            LaunchCheck.log("web view added to the window")
            load(web, page: "index.html")
            LaunchCheck.log("page asked for")
            window.orderFrontRegardless()
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
        let js = "(function(a){var w=window.solarWallpaper;if(w)w.set(\"\(key)\",a[0],{remember:false});})(\(json))"
        for entry in wallpapers { entry.web.evaluateJavaScript(js, completionHandler: nil) }
    }

    /// Once a wallpaper page has loaded, say all the settings again, in case the address lost them.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        LaunchCheck.log("a page finished loading")
        guard wallpapers.contains(where: { $0.web === webView }) else { return }
        var all: [String: Any] = ["zoom": settings.zoom, "speed": settings.speed, "ui": false]
        for choice in switchChoices {
            if let picked = settings.picked(choice.key) { all[choice.key] = picked }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: all, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "(function go(n,s){var w=window.solarWallpaper;if(!w){if(n<100)setTimeout(function(){go(n+1,s)},200);return;}"
            + "for(var k in s)w.set(k,s[k],{remember:false});})(0,\(json))"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// macOS can stop a page's process when it needs the memory. A wallpaper has to come back.
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        LaunchCheck.log("a page failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        LaunchCheck.log("a page couldn't start loading: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        LaunchCheck.log("a page's process stopped")
        if wallpapers.contains(where: { $0.web === webView }) {
            load(webView, page: "index.html")
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
        menu.addItem(item("Solar System Live", nil))
        menu.addItem(.separator())

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
        for choice in switchChoices {
            let it = item(choice.label, #selector(flip(_:)), on: settings.isOn(choice.key))
            it.representedObject = choice.key
            menu.addItem(it)
        }

        menu.addItem(.separator())
        menu.addItem(item("Show on every screen", #selector(toggleAllScreens), on: settings.allScreens))
        menu.addItem(item("Pause the wallpaper", #selector(togglePause), on: paused))
        if #available(macOS 13.0, *) {
            menu.addItem(item("Open at login", #selector(toggleLogin), on: launchesAtLogin))
        }
        menu.addItem(.separator())
        menu.addItem(item("Open Space Scope…", #selector(openScope)))
        menu.addItem(item("Credits", #selector(openCredits)))
        menu.addItem(.separator())
        menu.addItem(item("Quit Solar System Live", #selector(quit), key: "q"))
        statusItem.menu = menu
    }

    // MARK: What the menu does

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
                let web = makeWebView(frame: content.bounds)
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
