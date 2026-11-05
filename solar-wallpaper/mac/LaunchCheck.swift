// For the build check only. When the SSL_SNAPSHOT environment variable is set (to a file name), the app walks
// through its own features a little after start-up and writes what it finds to the log: the page's state, a small
// text picture of the first wallpaper window, what choosing things in the menu does, and what happens to the page
// while the wallpaper is hushed. Nothing here runs for a person using the app.
import Cocoa
import WebKit

enum LaunchCheck {
    /// What the app lets the check do, the way the menu does.
    struct Hooks {
        let web: () -> WKWebView?
        let menu: () -> NSMenu?
        let pickView: (String) -> Void
        let useStyle: (Style) -> Void
        let pickZoom: (Double) -> Void
        let quiet: (Bool) -> Void
        let style: () -> String
        let window: () -> NSWindow?
        let openScope: () -> Void
        let scopeWeb: () -> WKWebView?
        let closeScope: () -> Void
        let reset: () -> Void
    }

    private static var cover: NSWindow? // (an ordinary window laid over the whole desktop, for one of the checks)

    static let on: Bool = !(ProcessInfo.processInfo.environment["SSL_SNAPSHOT"] ?? "").isEmpty

    /// One line of progress, only while the check is on.
    static func log(_ text: String) {
        if on { say("launch check: \(text)") }
    }

    private static let started = Date()

    /// A line for the log, with how many seconds after start-up it was written (so a late step shows).
    static func say(_ text: String) {
        let line = text + String(format: "   [%.1f s]", Date().timeIntervalSince(started))
        FileHandle.standardError.write((line + "\n").data(using: .utf8) ?? Data())
    }

    /// What the page says about itself (Space Scope and the lean Wallpaper both set one of these two).
    private static let stateJS = "(function(){var w=window.solarSystem||window.solarWallpaper,c=document.querySelector('canvas'),n=document.querySelector('#zoom-note');"
        + "return JSON.stringify({page:!!w,which:window.solarSystem?'scope':'lean',saver:w&&w.settings.saver,fps:w&&w.settings.fps,view:w&&w.settings.view,"
        + "zoom:w&&w.settings.zoom,speed:w&&w.settings.speed,strange:w&&w.settings.strange,settingsButton:w&&w.settings.ui,"
        + "visibility:document.visibilityState,canvas:c?[c.width,c.height]:null,zoomNote:n&&n.textContent});})()"

    private static func ask(_ hooks: Hooks, _ js: String, _ label: String) {
        guard let web = hooks.web() else {
            say("launch check: \(label) there is no wallpaper window")
            return
        }
        web.evaluateJavaScript(js) { result, error in
            say("launch check: \(label) \(result.map { "\($0)" } ?? "none") \(error?.localizedDescription ?? "")")
        }
    }

    static func runIfAsked(_ hooks: Hooks) {
        guard let path = ProcessInfo.processInfo.environment["SSL_SNAPSHOT"], !path.isEmpty else { return }

        // The frame-rate rules, for every case.
        for style in [Style.scope, Style.lean] {
            let cases: [(String, Bool, Bool, BatteryMode)] = [
                ("plugged in", false, false, .save),
                ("battery, save power", true, false, .save),
                ("battery, full speed", true, false, .full),
                ("battery, pause", true, false, .pause),
                ("low power mode", false, true, .save),
            ]
            for (name, battery, low, mode) in cases {
                let frames = framesPerSecond(style: style, onBattery: battery, lowPower: low, mode: mode)
                say("launch check: frame rate \(style.rawValue), \(name): \(frames.map { "\($0)" } ?? "paused")")
            }
        }

        var hushedAt = 0.0
        var wokeAt = 0.0
        var coveredAt = 0.0
        var uncoveredAt = 0.0
        let now = { Date().timeIntervalSince1970 * 1000 }
        let workspace = NSWorkspace.shared.notificationCenter
        let distributed = DistributedNotificationCenter.default()
        let post = { (name: String) in
            distributed.postNotificationName(NSNotification.Name(name), object: nil, userInfo: nil, deliverImmediately: true)
        }
        let windowState = { () -> String in
            guard let visible = hooks.window()?.occlusionState.contains(.visible) else { return "missing" }
            return visible ? "still visible" : "not visible"
        }
        var steps: [(Double, () -> Void)] = []

        // The Space Scope picture, as the app starts.
        steps.append((15, {
            ask(hooks, stateJS, "page state (scope):")
            say("launch check: menu: " + (hooks.menu()?.items.map { $0.isSeparatorItem ? "-" : $0.title }.joined(separator: " | ") ?? "none"))
            hooks.web()?.takeSnapshot(with: nil) { image, error in
                guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else {
                    say("launch check: no snapshot: \(error?.localizedDescription ?? "unknown")")
                    return
                }
                if let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: path)) }
                say("launch check: snapshot \(rep.pixelsWide)x\(rep.pixelsHigh)\n" + picture(of: rep))
            }
            hooks.pickView("inner")
        }))
        steps.append((4, {
            ask(hooks, "window.solarSystem && window.solarSystem.settings.view", "after picking the Inner planets view the page says:")
            hooks.useStyle(.lean)
        }))
        // The lean picture, once it has loaded.
        steps.append((15, {
            say("launch check: style now: \(hooks.style())")
            ask(hooks, stateJS, "page state (lean):")
            hooks.pickZoom(4)
        }))
        // While hushed the window is off the screen and the page should draw nothing. A page that is off the screen doesn't
        // answer the app until it is shown again, so the page writes down its own draws, and its hide and show events, for
        // the app to read after.
        steps.append((4, {
            ask(hooks, "document.querySelector('#zoom-note').textContent", "after picking 4x in the menu the page says:")
            ask(hooks, "(function(){var w=window.solarSystem||window.solarWallpaper;window.__seen=[];window.__draws=[];"
                + "document.addEventListener('visibilitychange',function(){window.__seen.push([Date.now(),document.visibilityState]);});"
                + "var r=w.renderer,d=r.render.bind(r);r.render=function(){window.__draws.push(Date.now());return d.apply(null,arguments);};return 'recording';})()",
                "recording:")
        }))
        steps.append((1, {
            hushedAt = now()
            hooks.quiet(true)
            say("launch check: hushed the windows")
        }))
        steps.append((3, {
            wokeAt = now()
            hooks.quiet(false)
            say("launch check: woke the windows, \(Int(wokeAt - hushedAt)) ms after hushing them")
        }))
        steps.append((3, {
            let js = "(function(a,b){var n=0,t=window.__draws||[];for(var i=0;i<t.length;i++)if(t[i]>a+500&&t[i]<b)n++;"
                + "return JSON.stringify({seen:(window.__seen||[]).map(function(e){return e[1];}),drawsWhileHushed:n,drawsInAll:t.length,"
                + "msHushed:Math.round(b-a),visibility:document.visibilityState});})(\(hushedAt),\(wokeAt))"
            ask(hooks, js, "while hushed, the page saw and drew:")
        }))
        // The Mac's own signals: the app hushes for each and wakes when it ends.
        steps.append((1, { workspace.post(name: NSWorkspace.screensDidSleepNotification, object: nil) }))
        steps.append((1, { workspace.post(name: NSWorkspace.screensDidWakeNotification, object: nil) }))
        steps.append((1, { post("com.apple.screenIsLocked") }))
        steps.append((1, { post("com.apple.screenIsUnlocked") }))
        steps.append((1, { post("com.apple.screensaver.didstart") }))
        steps.append((1, { post("com.apple.screensaver.didstop") }))
        // Another window over the whole desktop: does the page stop drawing underneath?
        steps.append((1, {
            guard let screen = NSScreen.screens.first else { return }
            let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            window.level = .normal
            window.backgroundColor = .gray
            window.isOpaque = true
            window.isReleasedWhenClosed = false
            window.setFrame(screen.frame, display: true)
            window.orderFrontRegardless()
            cover = window
            coveredAt = now()
            say("launch check: laid a window over the desktop")
        }))
        steps.append((4, {
            say("launch check: covered, the wallpaper window is \(windowState())")
            uncoveredAt = now()
            cover?.orderOut(nil)
            cover = nil
            say("launch check: took the window away, \(Int(uncoveredAt - coveredAt)) ms after laying it")
        }))
        steps.append((3, {
            // (Also: was the page told it was hidden while covered, and does it draw again afterwards?)
            let js = "(function(a,b){var n=0,m=0,t=window.__draws||[];for(var i=0;i<t.length;i++){if(t[i]>a+700&&t[i]<b)n++;if(t[i]>b)m++;}"
                + "var seen=(window.__seen||[]).filter(function(e){return e[0]>a-200&&e[0]<b+1500;}).map(function(e){return e[1];});"
                + "return JSON.stringify({drawsWhileCovered:n,seenWhileCovered:seen,msCovered:Math.round(b-a),drawsAfter:m});})(\(coveredAt),\(uncoveredAt))"
            ask(hooks, js, "while another window covered the desktop, the page drew:")
        }))
        // The Low Power Mode signal arrives on a background thread: the app has to take it on the main one (it used to touch
        // its windows straight from the signal, which can crash a Mac app).
        steps.append((1, {
            if #available(macOS 12.0, *) {
                DispatchQueue.global().async {
                    NotificationCenter.default.post(name: NSNotification.Name.NSProcessInfoPowerStateDidChange, object: nil)
                }
            }
        }))
        // Space Scope's page stopping over and over (as if it crashed): after the third time in ten minutes, the screen gets
        // the lean picture instead of reloading for ever.
        let stopPage = { (which: String) in
            guard let web = hooks.web(), let pid = (web.value(forKey: "_webProcessIdentifier") as? NSNumber)?.int32Value, pid > 0 else {
                say("launch check: \(which) time: no page process to stop")
                return
            }
            kill(pid, SIGKILL)
            say("launch check: \(which) time: stopped the page's process")
        }
        steps.append((2, { hooks.useStyle(.scope) }))
        steps.append((15, { stopPage("first") }))
        steps.append((8, { stopPage("second") }))
        steps.append((8, { stopPage("third") }))
        steps.append((15, { ask(hooks, stateJS, "page state (after the picture kept stopping):") }))
        // macOS saying the screens changed when nothing about them did (as when the Dock or the menu bar shows and hides):
        // the wallpapers must not be made again or reloaded, however many times it says so.
        steps.append((1, {
            for _ in 0..<5 { NotificationCenter.default.post(name: NSApplication.didChangeScreenParametersNotification, object: nil) }
            say("launch check: told the app five times that the screens changed")
        }))
        steps.append((4, { say("launch check: four seconds after") }))
        // Set up in the Space Scope window (Saturn, the camera put somewhere, standing still), close it: the wallpaper shows
        // just that. Then Reset: back to how it started.
        let wallpaperNow = "(function(){var s=window.solarSystem;if(!s)return 'not Space Scope';return JSON.stringify({view:s.settings.view,"
            + "drift:s.settings.drift,cam:s.settings.cam||null,camNow:s.camera.position.clone().sub(s.controls.target).toArray()"
            + ".map(function(n){return Math.round(n*10)/10;})});})()"
        steps.append((1, { hooks.openScope() }))
        steps.append((15, {
            hooks.scopeWeb()?.evaluateJavaScript("window.solarSystem.set('drift',false);window.solarSystem.set('view','saturn');'ok'", completionHandler: nil)
            say("launch check: in the Space Scope window: camera still, looking at Saturn")
        }))
        steps.append((6, {
            hooks.scopeWeb()?.evaluateJavaScript("var s=window.solarSystem;s.camera.position.copy(s.controls.target).add({x:6,y:3,z:8});'ok'", completionHandler: nil)
            say("launch check: in the Space Scope window: camera put at 6, 3, 8 from Saturn")
        }))
        steps.append((3, {
            hooks.closeScope()
            say("launch check: closed the Space Scope window")
        }))
        steps.append((15, { ask(hooks, wallpaperNow, "after setting up Saturn in the Space Scope window, the wallpaper shows:") }))
        steps.append((1, { hooks.reset() }))
        steps.append((15, { ask(hooks, wallpaperNow, "after Reset, the wallpaper shows:") }))
        steps.append((3, { say("launch check: finished") }))
        run(steps)
    }

    /// Runs the steps one after another, each its wait after the one before really ran. (On a busy machine a step can
    /// come late; the next one must not then come straight after it.)
    private static func run(_ steps: [(Double, () -> Void)]) {
        guard let next = steps.first else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + next.0) {
            next.1()
            run(Array(steps.dropFirst()))
        }
    }

    /// The picture as 96 by 28 characters: the brightest spot in each cell, so a star or a planet still shows.
    private static func picture(of rep: NSBitmapImageRep) -> String {
        let columns = 96, rows = 28
        let ramp = Array(" .:-=+*#%@")
        var lines: [String] = []
        var lit = 0
        for row in 0..<rows {
            var line = ""
            for column in 0..<columns {
                let x0 = column * rep.pixelsWide / columns, x1 = max((column + 1) * rep.pixelsWide / columns, x0 + 1)
                let y0 = row * rep.pixelsHigh / rows, y1 = max((row + 1) * rep.pixelsHigh / rows, y0 + 1)
                var best = 0.0
                for y in stride(from: y0, to: y1, by: max(1, (y1 - y0) / 4)) {
                    for x in stride(from: x0, to: x1, by: max(1, (x1 - x0) / 4)) {
                        if let color = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) {
                            best = max(best, Double(color.brightnessComponent))
                        }
                    }
                }
                if best > 0.15 { lit += 1 }
                line.append(ramp[min(ramp.count - 1, Int(best * Double(ramp.count)))])
            }
            lines.append(line)
        }
        return lines.joined(separator: "\n") + "\nlaunch check: \(lit) of \(columns * rows) cells are lit"
    }
}
