// A plain log of what the app did, for when something goes wrong: ~/Library/Logs/Solar System Live.log ("Show the log"
// in the menu opens it). It holds the screens' sizes, what loaded, what stopped, errors the page reported and power
// changes: nothing personal. Past 256 KB the older half is dropped.
import Foundation

enum Journal {
    static let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs", isDirectory: true)
        .appendingPathComponent("Solar System Live.log")
    private static let queue = DispatchQueue(label: "solar-system-live.journal") // (writing never holds up the app)
    private static let stamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone.current
        return formatter
    }()

    static func note(_ text: String) {
        LaunchCheck.log(text)
        let when = Date()
        queue.async {
            guard let data = "\(stamp.string(from: when))  \(text)\n".data(using: .utf8) else { return }
            let files = FileManager.default
            try? files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let size = ((try? files.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.intValue ?? 0
            if size > 256 * 1024, let old = try? Data(contentsOf: url) {
                try? old.suffix(128 * 1024).write(to: url) // keep the newer half
            }
            if let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(data)
                handle.closeFile()
            } else {
                try? data.write(to: url)
            }
        }
    }
}
