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
    }

    static let on: Bool = !(ProcessInfo.processInfo.environment["SSL_SNAPSHOT"] ?? "").isEmpty

    /// One line of progress, only while the check is on.
    static func log(_ text: String) {
        if on { say("launch check: \(text)") }
    }

    static func say(_ text: String) {
        FileHandle.standardError.write((text + "\n").data(using: .utf8) ?? Data())
    }

    private static func at(_ seconds: Double, _ block: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: block)
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

        // 15 seconds in: the Space Scope picture, as the app starts.
        at(15) {
            say("launch check: 15 seconds in")
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
        }
        at(19) {
            ask(hooks, "window.solarSystem && window.solarSystem.settings.view", "after picking the Inner planets view the page says:")
            hooks.useStyle(.lean)
        }
        // 15 seconds after switching to the lean picture.
        at(34) {
            say("launch check: style now: \(hooks.style())")
            ask(hooks, stateJS, "page state (lean):")
            hooks.pickZoom(4)
        }
        at(38) {
            ask(hooks, "document.querySelector('#zoom-note').textContent", "after picking 4x in the menu the page says:")
            hooks.quiet(true)
        }
        at(40) {
            ask(hooks, "document.visibilityState", "visibility while hushed:")
            hooks.quiet(false)
        }
        at(42) {
            ask(hooks, "document.visibilityState", "visibility after waking:")
        }
        at(44) { say("launch check: finished") }
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
