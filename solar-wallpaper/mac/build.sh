#!/usr/bin/env bash
# Builds "Solar System Live.app" from the web pages in ../dist and the .swift files here, on a Mac.
#
#   ./build.sh                 build the app into mac/build/
#   ./build.sh install         build it, put it in /Applications (or ~/Applications) and open it
#   ./build.sh dmg zip         also make a disk image and a zip to hand to someone else
#
# It needs the Command Line Tools (a window offers them if you run `xcode-select --install`).
# By default it builds for this Mac's chip; ARCHS="arm64 x86_64" builds one app for both.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dist="$here/../dist"
out="$here/build"
name="Solar System Live"
app="$out/$name.app"
archs="${ARCHS:-$(uname -m)}"
target="11.0"

if [ "$(uname)" != "Darwin" ]; then
  echo "This builds a Mac app, so it has to run on a Mac." >&2
  exit 1
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc isn't here. Run:  xcode-select --install   then try again." >&2
  exit 1
fi
if [ ! -f "$dist/index.html" ]; then
  echo "Can't find $dist/index.html" >&2
  exit 1
fi

want_install=0; want_dmg=0; want_zip=0
for arg in "$@"; do
  case "$arg" in
    install) want_install=1 ;;
    dmg) want_dmg=1 ;;
    zip) want_zip=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

rm -rf "$out"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

echo "Compiling for: $archs"
bins=()
for arch in $archs; do
  swiftc -O -target "$arch-apple-macos$target" -o "$out/SolarSystemLive-$arch" "$here"/*.swift
  bins+=("$out/SolarSystemLive-$arch")
done
if [ "${#bins[@]}" -gt 1 ]; then
  lipo -create "${bins[@]}" -output "$app/Contents/MacOS/SolarSystemLive"
else
  cp "${bins[0]}" "$app/Contents/MacOS/SolarSystemLive"
fi
rm -f "${bins[@]}"

cp "$here/Info.plist" "$app/Contents/Info.plist"
cp -R "$dist" "$app/Contents/Resources/web"
rm -f "$app/Contents/Resources/web/LivelyProperties.json" # (only Lively reads it)

# The icon: every size a Mac asks for, made from one picture.
icons="$out/AppIcon.iconset"
mkdir -p "$icons"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$here/icon.png" --out "$icons/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$here/icon.png" --out "$icons/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$icons" -o "$app/Contents/Resources/AppIcon.icns"
rm -rf "$icons"

# Signed "ad hoc": there is no Apple developer account behind it, but a signature of some kind is
# what a Mac with an Apple chip needs before it will run an app.
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
echo "Built: $app"

if [ "$want_zip" = 1 ]; then
  ditto -c -k --keepParent "$app" "$out/SolarSystemLive.zip"
  echo "Zip:   $out/SolarSystemLive.zip"
fi

if [ "$want_dmg" = 1 ]; then
  stage="$out/dmg"
  mkdir -p "$stage"
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"
  hdiutil create -volname "$name" -srcfolder "$stage" -ov -format UDZO "$out/SolarSystemLive.dmg" >/dev/null
  rm -rf "$stage"
  echo "Disk image: $out/SolarSystemLive.dmg"
fi

if [ "$want_install" = 1 ]; then
  osascript -e "tell application \"$name\" to quit" >/dev/null 2>&1 || true
  sleep 1
  dest="/Applications"
  if [ ! -w "$dest" ]; then dest="$HOME/Applications"; mkdir -p "$dest"; fi
  rm -rf "$dest/$name.app"
  cp -R "$app" "$dest/"
  # Built on this Mac, so macOS has nothing to warn about; this just makes sure of it.
  xattr -dr com.apple.quarantine "$dest/$name.app" 2>/dev/null || true
  echo "Installed in $dest"
  open "$dest/$name.app"
fi
