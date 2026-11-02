// MainViewController.swift
// Walking Companion: the app's root view controller. It is Capacitor's bridge view controller plus two things:
//   1. registers the local HealthBridge plugin (HealthBridgePlugin.swift) before the web app loads;
//   2. paints the web view background in the app's own light/dark colours, so there is no white flash on launch in dark mode.
//
// SceneDelegate.swift creates this class (window?.rootViewController = MainViewController()), and Main.storyboard names it
// as its custom class. Both must point here, or Apple Health silently stops working (the JS side gets "not implemented").

import UIKit
import WebKit
import Capacitor

class MainViewController: CAPBridgeViewController {

    /// Light: --bg #EEF1EF. Dark: --bg #0A1012 (src/styles/tokens.css).
    private static let appBackground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 10 / 255, green: 16 / 255, blue: 18 / 255, alpha: 1)
            : UIColor(red: 238 / 255, green: 241 / 255, blue: 239 / 255, alpha: 1)
    }

    /// Called by Capacitor after the bridge and web view exist, before the page loads.
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(HealthBridgePlugin())

        if let webView = webView {
            webView.isOpaque = false
            webView.backgroundColor = Self.appBackground
            webView.scrollView.backgroundColor = Self.appBackground
            webView.underPageBackgroundColor = Self.appBackground
        }
    }
}
