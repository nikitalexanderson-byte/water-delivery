"""Verify the final Google Play bundle using Google's bundletool and Python 3."""

import argparse
import json
import struct
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def verify_elf_alignment(name, data):
    # Android arm64-v8a and x86_64 use the little-endian ELF64 program header layout.
    if data[:6] != b"\x7fELF\x02\x01":
        raise ValueError(f"Invalid 64-bit library: {name}")
    table = struct.unpack_from("<Q", data, 32)[0]
    entry_size, count = struct.unpack_from("<HH", data, 54)
    for index in range(count):
        kind, _, offset, address, _, _, _, alignment = struct.unpack_from("<IIQQQQQQ", data, table + entry_size * index)
        if kind == 1 and (alignment < 16384 or (address - offset) % 16384):
            raise ValueError(f"ELF LOAD segment is not aligned for 16 KB pages: {name}")


def verify(bundletool, bundle, version):
    command = ["java", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-jar", bundletool]
    subprocess.run([*command, "validate", f"--bundle={bundle}"], check=True, stdout=subprocess.DEVNULL)
    manifest = subprocess.check_output([*command, "dump", "manifest", f"--bundle={bundle}"])
    root = ET.fromstring(manifest)
    android = "{http://schemas.android.com/apk/res/android}"
    if root.get("package") != "ru.farvater.driver" or root.get(android + "versionCode") != version:
        raise ValueError("Unexpected application ID or version code")
    sdk = root.find("uses-sdk")
    if sdk is None or int(sdk.get(android + "targetSdkVersion", "0")) < 36:
        raise ValueError("Unexpected target SDK")
    app = root.find("application")
    if app is None or app.get(android + "usesCleartextTraffic") != "false" or app.get(android + "debuggable") == "true":
        raise ValueError("Expected a non-debuggable bundle with cleartext disabled")
    if any(node.get(android + "name") == "android.permission.REQUEST_INSTALL_PACKAGES" for node in root):
        raise ValueError("Package installation permission found in the Play bundle")
    if any(node.get(android + "authorities") == "ru.farvater.driver.update" for node in app.findall("provider")):
        raise ValueError("APK update provider found in the Play bundle")
    with ZipFile(bundle) as archive:
        entries = archive.namelist()
        if "base/res/xml/update_paths.xml" in entries:
            raise ValueError("APK update file paths found in the Play bundle")
        libraries = [name for name in entries if name.endswith(".so") and
                     ("/lib/arm64-v8a/" in name or "/lib/x86_64/" in name)]
        if libraries:
            config = json.loads(subprocess.check_output([*command, "dump", "config", f"--bundle={bundle}"]))
            packaging = config["optimizations"]["uncompressNativeLibraries"]
            if packaging["enabled"] and packaging.get("alignment") != "PAGE_ALIGNMENT_16K":
                raise ValueError("Native libraries require 16 KB ZIP alignment")
            for name in libraries:
                verify_elf_alignment(name, archive.read(name))
        bytecode = [name for name in entries if "/dex/" in name and name.endswith(".dex")]
        if not bytecode:
            raise ValueError("Missing application bytecode")
        for name in bytecode:
            data = archive.read(name)
            if any(marker in data for marker in (
                b"/downloads/wayslate.apk", b"/downloads/farvater-driver.apk", b"Lru/farvater/driver/UpdateModel;",
            )):
                raise ValueError(f"Direct APK updater found in {name}")
    print(f"Verified Google Play bundle: ru.farvater.driver, version code {version}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundletool", required=True, help="Path to the official bundletool-all JAR")
    parser.add_argument("--bundle", required=True, help="Path to the AAB")
    parser.add_argument("--version-code", required=True)
    args = parser.parse_args()
    verify(args.bundletool, args.bundle, args.version_code)
