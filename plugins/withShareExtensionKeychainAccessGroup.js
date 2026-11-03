const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withEntitlementsPlist, IOSConfig } = require('expo/config-plugins');

/**
 * `expo-share-extension`'s own config plugin (`withShareExtensionEntitlements`)
 * writes the Share Extension target's `.entitlements` file with only the shared
 * App Group capability. For the extension to read the main app's stored Wallabag
 * credentials/tokens (see `src/lib/auth/sharedAuth.ts`), both targets also need a
 * matching Keychain Sharing access group — Apple's documented pattern of reusing
 * an App Group identifier as a Keychain access group
 * (https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps).
 *
 * This plugin must be listed BEFORE `"expo-share-extension"` in `app.json`'s
 * `plugins` array — confirmed empirically via `npx expo prebuild`. Expo's config
 * plugins of the same mod type (here, `withEntitlementsPlist`) compose like an
 * onion: each newly-registered mod wraps around the previously-registered one and
 * runs *before* delegating to it, so mods actually execute in REVERSE registration
 * order within a category, not array order. Listing this plugin before
 * "expo-share-extension" means its mod is registered first, gets wrapped by
 * theirs, and therefore actually *executes second* — after their
 * `withShareExtensionEntitlements` mod has already written the extension's
 * `.entitlements` file this plugin patches. (An earlier version of this plugin
 * used `withDangerousMod` placed after "expo-share-extension" in the array, which
 * reliably ran too early — the file didn't exist yet — regardless of array
 * position relative to a different mod category; switching to the same mod type
 * as the plugin being patched, and reasoning about the real onion-composition
 * order instead of array order, is what fixed it.) The main app's half of this
 * (`com.apple.security.application-groups` + `keychain-access-groups`) is set
 * directly via `ios.entitlements` in `app.json`, which Expo's own prebuild
 * pipeline merges into the main target's entitlements automatically — no plugin
 * needed for that side.
 */
const withShareExtensionKeychainAccessGroup = (config) => {
  return withEntitlementsPlist(config, (config) => {
    const appGroup =
      config.ios?.infoPlist?.AppGroup ||
      config.ios?.infoPlist?.AppGroupIdentifier ||
      `group.${config.ios?.bundleIdentifier}`;

    const targetName = `${IOSConfig.XcodeUtils.sanitizedName(config.name)}ShareExtension`;
    const entitlementsPath = path.join(
      config.modRequest.platformProjectRoot,
      targetName,
      `${targetName}.entitlements`
    );

    if (!fs.existsSync(entitlementsPath)) {
      console.warn(
        `[withShareExtensionKeychainAccessGroup] ${entitlementsPath} does not exist yet — ` +
          'make sure this plugin is listed AFTER "expo-share-extension" in app.json\'s plugins array.'
      );
      return config;
    }

    const existing = plist.parse(fs.readFileSync(entitlementsPath, 'utf8'));
    const updated = {
      ...existing,
      'keychain-access-groups': [appGroup],
    };
    fs.writeFileSync(entitlementsPath, plist.build(updated));

    return config;
  });
};

module.exports = withShareExtensionKeychainAccessGroup;
