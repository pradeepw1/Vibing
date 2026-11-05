// For the build check only. When the SSL_SNAPSHOT environment variable is set (to a file name), a
// little after start-up this saves what the first wallpaper window shows to that file, and writes the
// page's state and a small text picture of it to the log. Nothing here runs for a person using the app.
import Cocoa
import WebKit

enum LaunchCheck {
    static let on: Bool = !(ProcessInfo.processInfo.environment["SSL_SNAPSHOT"] ?? "").isEmpty

    /// One line of progress, only while the check is on.
    static func log(_ text: String) {
        if on { say("launch check: \(text)") }
    }

    /// `menu`: the menu bar menu. `pickFour`: does what choosing "4x" in it does.
    static func runIfAsked(wallpaper: @escaping () -> WKWebView?, menu: @escaping () -> NSMenu?, pickFour: @escaping () -> Void) {
        guard let path = ProcessInfo.processInfo.environment["SSL_SNAPSHOT"], !path.isEmpty else { return }
        // If the page never answers (its process didn't start, say), at least say so.
        DispatchQueue.main.asyncAfter(deadline: .now() + 22) { say("launch check: 22 seconds in") }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
            say("launch check: 15 seconds in")
            guard let web = wallpaper() else {
                say("launch check: there is no wallpaper window")
                return
            }
            let js = "(function(){var w=window.solarWallpaper,c=document.querySelector('canvas'),n=document.querySelector('#zoom-note');"
                + "return JSON.stringify({page:!!w,zoom:w&&w.settings.zoom,speed:w&&w.settings.speed,settingsButton:w&&w.settings.ui,"
                + "visibility:document.visibilityState,canvas:c?[c.width,c.height]:null,zoomNote:n&&n.textContent});})()"
            web.evaluateJavaScript(js) { result, error in
                say("launch check: page state: \(result.map { "\($0)" } ?? "none") \(error?.localizedDescription ?? "")")
            }
            say("launch check: menu: " + (menu()?.items.map { $0.isSeparatorItem ? "-" : $0.title }.joined(separator: " | ") ?? "none"))
            pickFour()
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                web.evaluateJavaScript("document.querySelector('#zoom-note').textContent") { result, _ in
                    say("launch check: after picking 4x in the menu the page says: \(result.map { "\($0)" } ?? "none")")
                }
            }
            web.takeSnapshot(with: nil) { image, error in
                guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else {
                    say("launch check: no snapshot: \(error?.localizedDescription ?? "unknown")")
                    return
                }
                if let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: path)) }
                say("launch check: snapshot \(rep.pixelsWide)x\(rep.pixelsHigh)\n" + picture(of: rep))
            }
        }
    }

    static func say(_ text: String) {
        FileHandle.standardError.write((text + "\n").data(using: .utf8) ?? Data())
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
