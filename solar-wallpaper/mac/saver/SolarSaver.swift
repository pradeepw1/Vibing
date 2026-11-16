// The screen saver: Space Scope on its tour (flying off to a planet, a galaxy, a black hole or another star's planets
// every so often, with a note on each), from the same web pages as the app, carried inside the .saver bundle.
// build.sh makes "Solar System Live.saver" from this file and puts it in ~/Library/Screen Savers on install; it is
// picked in System Settings, under Screen Saver.
import ScreenSaver
import WebKit

@objc(SolarSaverView)
final class SolarSaverView: ScreenSaverView {
    private var web: WKWebView?

    private var webRoot: URL? {
        Bundle(for: SolarSaverView.self).resourceURL?.appendingPathComponent("web", isDirectory: true)
    }

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        setUp()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUp()
    }

    private func setUp() {
        animationTimeInterval = 1 // (the page draws itself: this only paces animateOneFrame, which does nothing)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        // Newer macOS keeps a screen saver's view (and its page, drawing away) after the screen saver stops: let it go.
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(willStop), name: NSNotification.Name("com.apple.screensaver.willstop"), object: nil)
        show()
    }

    /// The page. The little preview in System Settings gets the lean picture; the real thing gets Space Scope's tour.
    private func show() {
        guard web == nil, let root = webRoot else { return }
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs") // (it loads its planet maps from files)
        // Nothing kept between runs: settings saved in Space Scope's own window (sound, say) stay out of the screen saver.
        config.websiteDataStore = .nonPersistent()
        let search = isPreview
            ? "?wallpaper=1&ui=0&fps=20"
            : "?ui=0&tour=1&strange=1&labels=1&clock=1&sound=0&view=middle&speed=live&fps=30"
        config.userContentController.addUserScript(
            WKUserScript(source: "window.solarSearch = \"\(search)\";", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: bounds, configuration: config)
        view.autoresizingMask = [.width, .height]
        if view.responds(to: NSSelectorFromString("_setDrawsBackground:")) { view.setValue(false, forKey: "drawsBackground") }
        addSubview(view)
        view.loadFileURL(root.appendingPathComponent(isPreview ? "index.html" : "scope.html"), allowingReadAccessTo: root)
        web = view
    }

    private func hide() {
        web?.stopLoading()
        web?.removeFromSuperview()
        web = nil
    }

    @objc private func willStop() {
        hide()
    }

    override func startAnimation() {
        super.startAnimation()
        show()
    }

    override func stopAnimation() {
        super.stopAnimation()
        hide()
    }

    override func animateOneFrame() {}

    override var hasConfigureSheet: Bool { false }
}
