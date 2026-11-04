const { withXcodeProject } = require('expo/config-plugins');

/**
 * `expo-share-extension`'s own config plugin creates the Share Extension's
 * native target with Xcode's bare-default `IPHONEOS_DEPLOYMENT_TARGET`
 * (15.1), not matching the rest of this project — the main `Bindle` target
 * and `Podfile` are both pinned to 16.4 (`ios/Podfile:25`), required by
 * `ExpoDomWebView`, a transitive dependency pulled in by Expo SDK 58's core
 * modules.
 *
 * Confirmed for real via `xcodebuild` (2026-11-04, while verifying the
 * pendingShareSaves fix): this mismatch is a hard `SwiftCompile` error —
 * "compiling for iOS 15.1, but module 'ExpoDomWebView' has a minimum
 * deployment target of iOS 16.4" — not a warning. Before this fix the
 * BindleShareExtension target had never actually compiled on this SDK/
 * toolchain combination; every prior "verified" pass only got as far as
 * `expo prebuild` (target/entitlements exist) or a Metro JS bundle (the JS
 * side resolves/compiles), neither of which invokes Swift compilation.
 *
 * Raises the extension target's deployment target to match so it actually
 * builds. Must run AFTER `expo-share-extension`'s own `withXcodeProject` mod
 * has created the `BindleShareExtension` target's build configurations —
 * which, per the same onion-composition rule documented in
 * `withShareExtensionKeychainAccessGroup.js`, means this plugin must be
 * listed BEFORE `"expo-share-extension"` in `app.json`'s `plugins` array
 * (mods of the same type run in reverse registration order: registering
 * first means executing second). Confirmed empirically — listed after
 * `"expo-share-extension"` instead, `pbxXCBuildConfigurationSection()` comes
 * back with zero `BindleShareExtension` entries because this mod ran before
 * the target existed yet.
 */
const EXTENSION_INFOPLIST_MARKER = 'BindleShareExtension/Info.plist';
const DEPLOYMENT_TARGET = '16.4';

const withShareExtensionDeploymentTarget = (config) => {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const buildConfigs = project.pbxXCBuildConfigurationSection();
    let patched = 0;

    for (const key of Object.keys(buildConfigs)) {
      const entry = buildConfigs[key];
      const settings = entry && entry.buildSettings;
      if (settings && settings.INFOPLIST_FILE === EXTENSION_INFOPLIST_MARKER) {
        settings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
        patched += 1;
      }
    }

    if (patched === 0) {
      console.warn(
        '[withShareExtensionDeploymentTarget] Found no BindleShareExtension build ' +
          'configurations to patch — make sure this plugin runs after "expo-share-extension" ' +
          'in app.json\'s plugins array.'
      );
    }

    return config;
  });
};

module.exports = withShareExtensionDeploymentTarget;
