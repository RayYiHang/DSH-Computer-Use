#!/bin/sh
set -eu
cd "$(dirname "$0")"
bundle='bin/DSH Computer Use Preview.app'
mkdir -p "$bundle/Contents/MacOS"
cp Info.plist "$bundle/Contents/Info.plist"
/usr/bin/swiftc -parse-as-library -O -target arm64-apple-macos14.4 Preview.swift -o "$bundle/Contents/MacOS/DSHComputerUsePreview"
/usr/bin/codesign --force --sign - "$bundle"
