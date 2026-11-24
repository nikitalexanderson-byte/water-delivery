"""Verify the Android manifest packaged in the APK distributed from the website."""

import argparse
import subprocess
import xml.etree.ElementTree as ET


ANDROID = "{http://schemas.android.com/apk/res/android}"
PACKAGE = "ru.farvater.driver"
PERMISSIONS = {
    "android.permission.INTERNET",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.REQUEST_INSTALL_PACKAGES",
    f"{PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
}


def verify(apkanalyzer, apk, version_code):
    manifest = ET.fromstring(subprocess.check_output([apkanalyzer, "manifest", "print", apk]))
    if manifest.get("package") != PACKAGE or manifest.get(ANDROID + "versionCode") != version_code:
        raise ValueError("Unexpected package ID or version code")
    sdk = manifest.find("uses-sdk")
    if sdk is None or int(sdk.get(ANDROID + "targetSdkVersion", "0")) < 36:
        raise ValueError("The direct APK must target Android API 36 or higher")

    permissions = {node.get(ANDROID + "name") for node in manifest if node.tag.startswith("uses-permission")}
    if permissions != PERMISSIONS:
        raise ValueError(f"Unexpected permission changes: {', '.join(sorted(permissions ^ PERMISSIONS))}")
    app = manifest.find("application")
    if app is None or any(app.get(ANDROID + attr) != "false" for attr in ("usesCleartextTraffic", "allowBackup")):
        raise ValueError("The direct APK must disable cleartext traffic and application backup")
    if app.get(ANDROID + "debuggable") == "true" or app.get(ANDROID + "testOnly") == "true":
        raise ValueError("The direct APK must be a non-debuggable release")

    exported = {
        (node.tag, node.get(ANDROID + "name"), node.get(ANDROID + "permission"))
        for node in app if node.get(ANDROID + "exported") == "true"
    }
    if exported != {
        ("activity", f"{PACKAGE}.MainActivity", None),
        ("receiver", "androidx.profileinstaller.ProfileInstallReceiver", "android.permission.DUMP"),
    }:
        raise ValueError(f"Unexpected exported Android components: {exported}")
    launcher = next(node for node in app.findall("activity") if node.get(ANDROID + "name") == f"{PACKAGE}.MainActivity")
    filters = [[(node.tag, node.get(ANDROID + "name")) for node in entry] for entry in launcher.findall("intent-filter")]
    if len(filters) != 1 or set(filters[0]) != {
        ("action", "android.intent.action.MAIN"), ("category", "android.intent.category.LAUNCHER")
    }:
        raise ValueError("The launcher must not advertise additional entry points")

    provider = next((node for node in app.findall("provider") if node.get(ANDROID + "authorities") == f"{PACKAGE}.update"), None)
    if provider is None or provider.get(ANDROID + "exported") != "false" or provider.get(ANDROID + "grantUriPermissions") != "true":
        raise ValueError("The APK installer must use a private FileProvider with per-file access")
    print(f"Verified direct WaySlate APK manifest: {PACKAGE}, version code {version_code}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apkanalyzer", required=True)
    parser.add_argument("--apk", required=True)
    parser.add_argument("--version-code", required=True)
    args = parser.parse_args()
    verify(args.apkanalyzer, args.apk, args.version_code)
