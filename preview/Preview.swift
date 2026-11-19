import AppKit

private struct Target: Decodable, Equatable, Sendable {
    let app: String
    let key: String
}

private struct Message: Decodable, Sendable {
    let kind: String
    let turn: String
    let selected: String?
    let apps: [Target]?
    let image: String?
}

private struct Action: Encodable {
    let kind: String
    let turn: String
    let selected: String?
}

@MainActor
private final class Preview: NSObject, NSWindowDelegate {
    private let panel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 304, height: 302),
        styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
        backing: .buffered, defer: false
    )
    private let imageView = NSImageView()
    private let selector = NSPopUpButton()
    private var turn: String?
    private var targets: [Target] = []
    private var hasPosition = false

    override init() {
        super.init()
        let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
        panel.title = chinese ? "DSH 预览伙伴" : "DSH Preview Companion"
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.contentMinSize = NSSize(width: 224, height: 164)
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.setAccessibilityLabel(chinese ? "当前应用窗口" : "Active app window")

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 304, height: 302))
        imageView.frame = NSRect(x: 6, y: 6, width: 292, height: 254)
        imageView.autoresizingMask = [.width, .height]
        content.addSubview(imageView)

        selector.frame = NSRect(x: 8, y: 269, width: 179, height: 26)
        selector.autoresizingMask = [.width, .minYMargin]
        selector.target = self
        selector.action = #selector(selectApp)
        selector.setAccessibilityLabel(chinese ? "切换应用预览" : "Switch app preview")
        content.addSubview(selector)

        let dock = NSButton(title: chinese ? "收回 DSH" : "Return to DSH", target: self, action: #selector(dockPreview))
        dock.frame = NSRect(x: 194, y: 269, width: 104, height: 26)
        dock.autoresizingMask = [.minXMargin, .minYMargin]
        dock.bezelStyle = .rounded
        content.addSubview(dock)
        panel.contentView = content
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        dockPreview()
        return false
    }

    @objc private func selectApp() {
        guard let key = selector.selectedItem?.representedObject as? String else { return }
        send("select", selected: key)
    }

    @objc private func dockPreview() {
        send("dock")
        hide()
    }

    func receive(_ message: Message, image: NSImage?) {
        if message.kind == "end" {
            if turn == message.turn { hide() }
            return
        }
        guard message.kind == "frame", let image else { return }
        turn = message.turn
        imageView.image = image
        if targets != message.apps ?? [] {
            targets = message.apps ?? []
            selector.removeAllItems()
            for target in targets {
                selector.menu?.addItem(withTitle: target.app, action: nil, keyEquivalent: "")
                    .representedObject = target.key
            }
        }
        if let index = targets.firstIndex(where: { $0.key == message.selected }) {
            selector.selectItem(at: index)
        }
        if !hasPosition, let screen = NSScreen.main ?? NSScreen.screens.first {
            let area = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: area.maxX - panel.frame.width - 24, y: area.maxY - panel.frame.height - 68))
            hasPosition = true
        }
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    private func send(_ kind: String, selected: String? = nil) {
        guard let turn, let bytes = try? JSONEncoder().encode(Action(kind: kind, turn: turn, selected: selected)) else { return }
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
    }

    private func hide() {
        panel.orderOut(nil)
        imageView.image = nil
        turn = nil
    }
}

@main
private enum Application {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let preview = Preview()
        DispatchQueue.global(qos: .userInitiated).async {
            let decoder = JSONDecoder()
            while let line = readLine() {
                guard let message = try? decoder.decode(Message.self, from: Data(line.utf8)) else { continue }
                let data = message.image.flatMap { Data(base64Encoded: $0) }
                DispatchQueue.main.async {
                    preview.receive(message, image: data.flatMap { NSImage(data: $0) })
                }
            }
            DispatchQueue.main.async { app.terminate(nil) }
        }
        app.run()
    }
}
