// The sky facts in the menu: the Moon's phase, the next eclipses and what else is coming up. They come from
// web/facts.js (built from src/facts.js) run in JavaScriptCore: the same astronomy as the pages, with no page needed.
import Foundation
import JavaScriptCore

struct SkyEvent {
    let title: String
    let when: Date
}

struct SkyFacts {
    let moonName: String
    let moonSymbol: String // the name of macOS's own symbol for the phase
    let lit: Double // 0...1
    let nextFull: Date
    let eclipses: [SkyEvent]
    let coming: [SkyEvent]
    let at: Date
}

final class Facts {
    private let context: JSContext?
    private var kept: SkyFacts?

    init(script: URL) {
        let context = JSContext()
        context?.exceptionHandler = { _, error in Journal.note("sky facts: \(error?.toString() ?? "an error")") }
        if let source = try? String(contentsOf: script, encoding: .utf8) {
            context?.evaluateScript(source)
        } else {
            Journal.note("sky facts: can't read \(script.lastPathComponent)")
        }
        self.context = context
    }

    /// The facts now (worked out again when the ones kept are ten minutes old), or nil if they can't be had.
    func read(at date: Date = Date()) -> SkyFacts? {
        if let kept = kept, abs(kept.at.timeIntervalSince(date)) < 600 { return kept }
        guard let call = context?.objectForKeyedSubscript("solarFacts")?.objectForKeyedSubscript("skyFacts"),
              let json = call.call(withArguments: [date.timeIntervalSince1970 * 1000])?.toString(),
              let data = json.data(using: .utf8),
              let all = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let moon = all["moon"] as? [String: Any] else { return kept }
        func time(_ value: Any?) -> Date? { (value as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue / 1000) } }
        func events(_ value: Any?) -> [SkyEvent] {
            (value as? [[String: Any]] ?? []).compactMap { e in
                guard let title = e["title"] as? String, let when = time(e["when"]) else { return nil }
                return SkyEvent(title: title, when: when)
            }
        }
        kept = SkyFacts(
            moonName: moon["name"] as? String ?? "The Moon",
            moonSymbol: moon["symbol"] as? String ?? "",
            lit: (moon["lit"] as? NSNumber)?.doubleValue ?? 0,
            nextFull: time(moon["nextFull"]) ?? date,
            eclipses: events(all["eclipses"]),
            coming: events(all["coming"]),
            at: date)
        return kept
    }
}

/// A day as people say it here ("Tue 24 Nov"), with the year when it isn't this one.
func dayText(_ date: Date, now: Date = Date()) -> String {
    let calendar = Calendar.current
    let format = DateFormatter()
    format.setLocalizedDateFormatFromTemplate(
        calendar.component(.year, from: date) == calendar.component(.year, from: now) ? "EEE d MMM" : "EEE d MMM yyyy")
    return format.string(from: date)
}

/// How far off a day is: "today", "tomorrow", "in 12 days".
func soonText(_ date: Date, now: Date = Date()) -> String {
    let calendar = Calendar.current
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
    switch days {
    case ..<1: return "today"
    case 1: return "tomorrow"
    default: return "in \(days) days"
    }
}
