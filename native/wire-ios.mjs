#!/usr/bin/env node
// Wires Hillpace's native files and settings into the Capacitor-generated Xcode project.
// Safe to run any number of times. Run it after `npx cap add ios` (or whenever ios/ is regenerated):
//
//   node native/wire-ios.mjs
//
// What it does (everything that can be done without Xcode):
//   - copies HealthBridgePlugin.swift, MainViewController.swift, PrivacyInfo.xcprivacy, App.entitlements into ios/App/App/
//   - adds the two Swift files to the App target's Sources, PrivacyInfo.xcprivacy to its Resources
//   - makes SceneDelegate.swift and Main.storyboard use MainViewController (which registers HealthBridge)
//   - merges native/Info.plist-additions.xml into Info.plist; portrait only; no iPad orientations; no scene storyboard
//   - build settings: iOS 17.0, iPhone only, CODE_SIGN_ENTITLEMENTS = App/App.entitlements
//   - copies the app icon and the light/dark launch images from assets/ into Assets.xcassets
// Signing (Team), capabilities on the App ID and the first device build still happen in Xcode: see IOS_BUILD.md.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = join(root, 'native');
const appDir = join(root, 'ios/App/App');
const pbxPath = join(root, 'ios/App/App.xcodeproj/project.pbxproj');

const require = createRequire(import.meta.url);
function load(name) {
  try { return require(name); } catch {
    // xcode and plist are dependencies of @capacitor/cli; resolve them from there if npm did not hoist them.
    return createRequire(require.resolve('@capacitor/cli/package.json'))(name);
  }
}
const xcode = load('xcode');
const plist = load('plist');

if (!existsSync(pbxPath)) {
  console.error('ios/App/App.xcodeproj not found. Run `npx cap add ios` first, then run this script again.');
  process.exit(1);
}

const done = [];
const warn = [];

/* 1. Copy native sources (native/ is the source of truth; ios/ copies are overwritten). */
for (const f of ['HealthBridgePlugin.swift', 'MainViewController.swift', 'PrivacyInfo.xcprivacy', 'App.entitlements']) {
  copyFileSync(join(nativeDir, f), join(appDir, f));
}
done.push('copied HealthBridgePlugin.swift, MainViewController.swift, PrivacyInfo.xcprivacy, App.entitlements');

/* 2. SceneDelegate: the Capacitor 8 template builds the window in code, so the root view controller is set here. */
const scenePath = join(appDir, 'SceneDelegate.swift');
if (existsSync(scenePath)) {
  let s = readFileSync(scenePath, 'utf8');
  if (s.includes('MainViewController()')) done.push('SceneDelegate already uses MainViewController');
  else if (s.includes('CAPBridgeViewController()')) {
    s = s.replace('CAPBridgeViewController()', 'MainViewController()');
    writeFileSync(scenePath, s);
    done.push('SceneDelegate: rootViewController = MainViewController()');
  } else warn.push('SceneDelegate.swift: could not find "CAPBridgeViewController()". Set window?.rootViewController = MainViewController() by hand.');
} else warn.push('No SceneDelegate.swift (older template): set the Main.storyboard class to MainViewController in Xcode.');

/* 3. Main.storyboard custom class (used if anything instantiates the storyboard). */
const sbPath = join(appDir, 'Base.lproj/Main.storyboard');
if (existsSync(sbPath)) {
  let s = readFileSync(sbPath, 'utf8');
  if (s.includes('customClass="MainViewController"')) done.push('Main.storyboard already uses MainViewController');
  else if (s.includes('customClass="CAPBridgeViewController" customModule="Capacitor"')) {
    s = s.replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="MainViewController" customModule="App" customModuleProvider="target"');
    writeFileSync(sbPath, s);
    done.push('Main.storyboard: custom class MainViewController (module App)');
  } else warn.push('Main.storyboard: unexpected content; set the view controller class to MainViewController in Xcode.');
}

/* 4. Info.plist */
const infoPath = join(appDir, 'Info.plist');
const info = plist.parse(readFileSync(infoPath, 'utf8'));
const additions = plist.parse(readFileSync(join(nativeDir, 'Info.plist-additions.xml'), 'utf8'));
Object.assign(info, additions);
delete info['UISupportedInterfaceOrientations~ipad'];
delete info.UIBackgroundModes;
const scenes = info.UIApplicationSceneManifest && info.UIApplicationSceneManifest.UISceneConfigurations;
if (scenes) for (const role of Object.values(scenes)) for (const cfg of role || []) delete cfg.UISceneStoryboardFile;
writeFileSync(infoPath, plist.build(info, { indent: '\t' }) + '\n');
done.push('Info.plist: Health purpose strings, ITSAppUsesNonExemptEncryption = NO, portrait only, no scene storyboard, no background modes');

/* 5. Xcode project */
const project = xcode.project(pbxPath);
project.parseSync();
const groups = project.hash.project.objects.PBXGroup;
const appGroup = Object.keys(groups).find((k) => k.endsWith('_comment') && groups[k] === 'App')?.replace(/_comment$/, '');
if (!appGroup) { console.error('Could not find the "App" group in project.pbxproj.'); process.exit(1); }
const target = project.getFirstTarget().uuid;

for (const f of ['HealthBridgePlugin.swift', 'MainViewController.swift']) {
  if (project.hasFile(f)) done.push(`${f} already in the App target`);
  else { project.addSourceFile(f, { target }, appGroup); done.push(`added ${f} to the App target (Sources)`); }
}
if (project.hasFile('PrivacyInfo.xcprivacy')) done.push('PrivacyInfo.xcprivacy already in the App target');
else { project.addResourceFile('PrivacyInfo.xcprivacy', { target, lastKnownFileType: 'text.xml' }, appGroup); done.push('added PrivacyInfo.xcprivacy to the App target (Resources)'); }
if (!project.hasFile('App.entitlements')) { project.addFile('App.entitlements', appGroup, { lastKnownFileType: 'text.plist.entitlements' }); done.push('added App.entitlements to the project'); }

const configs = project.hash.project.objects.XCBuildConfiguration;
for (const [key, cfg] of Object.entries(configs)) {
  if (key.endsWith('_comment') || !cfg.buildSettings) continue;
  const b = cfg.buildSettings;
  if ('IPHONEOS_DEPLOYMENT_TARGET' in b) b.IPHONEOS_DEPLOYMENT_TARGET = '17.0';
  if ('PRODUCT_BUNDLE_IDENTIFIER' in b) { // the App target's Debug/Release
    b.TARGETED_DEVICE_FAMILY = '1';
    b.CODE_SIGN_ENTITLEMENTS = 'App/App.entitlements';
    b.SUPPORTS_MACCATALYST = 'NO';
    b.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = 'NO';
    b.SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD = 'NO';
  }
}
// The xcode library writes `explicitFileType = undefined;` / `fileEncoding = undefined;` for new references. Strip them so
// Xcode infers the type from lastKnownFileType (an explicit "undefined" type could stop Swift files compiling).
writeFileSync(pbxPath, project.writeSync().replace(/ (explicitFileType|fileEncoding) = undefined;/g, ''));
done.push('build settings: IPHONEOS_DEPLOYMENT_TARGET 17.0, TARGETED_DEVICE_FAMILY 1 (iPhone), CODE_SIGN_ENTITLEMENTS App/App.entitlements, no Mac/Vision Pro "designed for iPhone"');

/* 6. App icon and launch images */
const xc = join(appDir, 'Assets.xcassets');
const icon = join(root, 'assets/icon-only.png');
if (existsSync(icon)) { copyFileSync(icon, join(xc, 'AppIcon.appiconset/AppIcon-512@2x.png')); done.push('app icon: assets/icon-only.png (1024, opaque)'); }
else warn.push('assets/icon-only.png missing: add a 1024x1024 opaque PNG to AppIcon in Xcode.');
const splash = join(root, 'assets/splash.png');
const splashDark = join(root, 'assets/splash-dark.png');
if (existsSync(splash)) {
  const images = [];
  for (const [scale, n] of [['1x', '-2'], ['2x', '-1'], ['3x', '']]) {
    copyFileSync(splash, join(xc, `Splash.imageset/splash-2732x2732${n}.png`));
    images.push({ idiom: 'universal', filename: `splash-2732x2732${n}.png`, scale });
    if (existsSync(splashDark)) {
      copyFileSync(splashDark, join(xc, `Splash.imageset/splash-2732x2732-dark${n}.png`));
      images.push({ idiom: 'universal', filename: `splash-2732x2732-dark${n}.png`, scale, appearances: [{ appearance: 'luminosity', value: 'dark' }] });
    }
  }
  writeFileSync(join(xc, 'Splash.imageset/Contents.json'), JSON.stringify({ images, info: { version: 1, author: 'xcode' } }, null, 2) + '\n');
  done.push('launch images: assets/splash.png (light) and assets/splash-dark.png (dark)');
}

console.log('Hillpace iOS wiring\n' + done.map((d) => '  ✓ ' + d).join('\n'));
if (warn.length) console.log('\nNeeds attention:\n' + warn.map((w) => '  ! ' + w).join('\n'));
console.log('\nNext, in Xcode (see IOS_BUILD.md): set your Team and bundle ID, confirm the HealthKit and Time Sensitive Notifications capabilities, then build to a device.');
