#!/usr/bin/env bash
# This is part of WHY2
# Copyright (C) 2026 Václav Šmejkal

# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

# EVERY ICON IN THE PROJECT, OUT OF THE ONE SVG THEY ARE ALL THE SAME PICTURE OF. THIS IS NOT A BUILD
# STEP - IT IS RUN BY HAND WHEN THE MARK CHANGES, AND WHAT IT WRITES IS COMMITTED - BECAUSE IT WANTS
# rsvg-convert AND PILLOW, WHICH NOTHING ELSE HERE DOES, AND BECAUSE tauri icon PUTS A TIMESTAMP IN THE
# .icns AND WOULD MAKE THE TREE DIRTY ON EVERY BUILD.
# THE TWO HALVES GO TO TWO PLACES: THE DESKTOP SET IS src-tauri/icons/, WHICH IS WHERE tauri.conf.json
# POINTS; THE LAUNCHER IS scripts/android/res/, WHICH scripts/android-patch.sh COPIES INTO gen/android
# AFTER EVERY init - `tauri android init` WRITES TAURI'S OWN TEMPLATE ICONS AND KNOWS NOTHING OF OURS

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/src-tauri/icons/why2.svg"

if [ ! -f "$SOURCE" ]; then
    echo "icons: no $SOURCE" >&2
    exit 1
fi

for tool in rsvg-convert python3; do
    if ! command -v "$tool" >/dev/null; then
        echo "icons: $tool is not installed" >&2
        exit 1
    fi
done

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# TAURI'S OWN GENERATOR FOR THE DESKTOP SET, INTO A SCRATCH DIRECTORY RATHER THAN IN PLACE: LEFT TO
# ITSELF IT ALSO WRITES AN iOS SET THIS PROJECT HAS NO TARGET FOR, AND REACHES INTO gen/android
(cd "$ROOT" && npx tauri icon "$SOURCE" -o "$SCRATCH" >/dev/null)

cp "$SCRATCH"/*.png "$SCRATCH"/icon.icns "$SCRATCH"/icon.ico "$ROOT/src-tauri/icons/"

echo "icons: the desktop set is in src-tauri/icons"

python3 - "$SOURCE" "$ROOT/scripts/android/res" <<'ICONS'
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

source, out = sys.argv[1], sys.argv[2]

# WHAT A LAUNCHER ASKS FOR: THE LEGACY ICON IS 48dp AND THE ADAPTIVE ONE'S LAYERS ARE 108dp, EACH AT THE
# FIVE DENSITIES ANDROID STILL SHIPS
DENSITIES = { "mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4 }

# HOW TALL THE MARK STANDS ON THE 108dp FOREGROUND. THE MASK KEEPS ROUGHLY THE MIDDLE 66dp OF IT AND
# EVERY LAUNCHER CUTS A DIFFERENT SHAPE, SO THE ONE THING THAT MUST NOT HAPPEN IS AN EAR GOING MISSING
MARK = 58

def render(svg, size):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as handle:
        handle.write(svg)
        path = handle.name

    try:
        picture = subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size), path],
            check=True, stdout=subprocess.PIPE,
        ).stdout
    finally:
        os.unlink(path)

    with tempfile.NamedTemporaryFile("wb", suffix=".png", delete=False) as handle:
        handle.write(picture)
        path = handle.name

    try:
        return Image.open(path).convert("RGBA").copy()
    finally:
        os.unlink(path)

def circle(image):
    # DRAWN BIG AND BROUGHT DOWN, SINCE AN ELLIPSE AT 48 PIXELS IS A STAIRCASE
    mask = Image.new("L", (image.width * 4, image.height * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, mask.width - 1, mask.height - 1), fill=255)
    mask = mask.resize(image.size, Image.LANCZOS)

    out = image.copy()
    out.putalpha(Image.composite(image.getchannel("A"), Image.new("L", image.size, 0), mask))

    return out

plate = open(source, encoding="utf-8").read()

# THE MARK ON ITS OWN IS THE NESTED <svg> INSIDE THE PLATE - ONE FILE STAYS THE SOURCE OF BOTH, SO THE
# FOREGROUND CANNOT DRIFT FROM THE ICON IT IS THE INSIDE OF. IT IS FOUND BY ITS x=, WHICH THE OUTER ONE
# HAS NOT GOT
inner = re.search(r'<svg x="[^"]*"[^>]*viewBox="([^"]+)"[^>]*>(.*?)</svg>', plate, re.S)

if inner is None:
    sys.exit("icons: %s has no nested <svg> to take the mark from" % source)

box, body = inner.group(1), inner.group(2)
offset = (108 - MARK) / 2

foreground = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">'
    '<svg x="%s" y="%s" width="%s" height="%s" viewBox="%s" preserveAspectRatio="xMidYMid meet">'
    % (offset, offset, MARK, MARK, box)
    + body
    + "</svg></svg>"
)

for density, scale in DENSITIES.items():
    folder = os.path.join(out, "mipmap-" + density)
    os.makedirs(folder, exist_ok=True)

    legacy = render(plate, round(48 * scale))
    legacy.save(os.path.join(folder, "ic_launcher.png"))
    circle(legacy).save(os.path.join(folder, "ic_launcher_round.png"))

    layer = render(foreground, round(108 * scale))
    layer.save(os.path.join(folder, "ic_launcher_foreground.png"))

    # 13 TINTS THIS ONE ITSELF, SO WHAT IT WANTS IS THE SHAPE AND NOT THE COLOUR - THE SAME LAYER
    layer.save(os.path.join(folder, "ic_launcher_monochrome.png"))

folder = os.path.join(out, "mipmap-anydpi-v26")
os.makedirs(folder, exist_ok=True)

adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
"""

for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    open(os.path.join(folder, name), "w", encoding="utf-8").write(adaptive)

folder = os.path.join(out, "values")
os.makedirs(folder, exist_ok=True)

# THE PLATE THE MARK SITS ON, WHICH IS THE WINDOW'S OWN DEEPEST SURFACE (--deep IN src/theme.css) - AN
# ADAPTIVE ICON DRAWS ITS BACKGROUND ITSELF, SO THE COLOUR HAS TO BE SAID HERE AS WELL AS IN THE SVG
open(os.path.join(folder, "ic_launcher_background.xml"), "w", encoding="utf-8").write(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<resources>\n"
    '    <color name="ic_launcher_background">#050405</color>\n'
    "</resources>\n"
)

print("icons: the launcher is in scripts/android/res")
ICONS
