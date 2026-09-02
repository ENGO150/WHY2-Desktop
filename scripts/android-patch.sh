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

# THE TWO THINGS THE GENERATED ANDROID PROJECT DOES NOT KNOW ABOUT THE CALL: THAT THE APP RECORDS AUDIO,
# AND THAT THE ACTIVITY HAS THREE STATICS android.rs REACHES THROUGH JNI. gen/android IS NOT TRACKED - IT
# IS MADE ON EVERY MACHINE AND IN CI - SO THIS RUNS AFTER EVERY init, AND AGAIN IN FRONT OF EVERY BUILD.
# IT IS WRITTEN TO BE RUN TWICE: THE PERMISSION IS INSERTED ONLY WHERE IT IS MISSING, AND THE ACTIVITY IS
# OVERWRITTEN WITH THE COPY IN scripts/android/ EITHER WAY.
# A MISSING ANCHOR IS AN ERROR AND NOT A SHRUG: TAURI CHANGING ITS TEMPLATE SHOULD STOP THE BUILD RATHER
# THAN QUIETLY SHIP AN APK WHOSE MICROPHONE NEVER OPENS

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/src-tauri/gen/android"

# NOTHING TO PATCH BEFORE THERE IS A PROJECT, WHICH IS THE NORMAL STATE OF A FRESH CLONE
if [ ! -d "$PROJECT" ]; then
    exit 0
fi

MANIFEST="$PROJECT/app/src/main/AndroidManifest.xml"

if [ ! -f "$MANIFEST" ]; then
    echo "android-patch: no manifest at $MANIFEST" >&2
    exit 1
fi

if ! grep -q "android.permission.RECORD_AUDIO" "$MANIFEST"; then
    ANCHOR='<uses-permission android:name="android.permission.INTERNET" />'

    if ! grep -qF "$ANCHOR" "$MANIFEST"; then
        echo "android-patch: the manifest template changed - no INTERNET permission to write beside" >&2
        exit 1
    fi

    # THE CALL RECORDS, AND IT ALSO ASKS THE SYSTEM TO ROUTE ITSELF THROUGH THE EARPIECE OR A HEADSET
    python3 - "$MANIFEST" "$ANCHOR" <<'PATCH'
import sys

path, anchor = sys.argv[1], sys.argv[2]

with open(path, encoding="utf-8") as manifest:
    text = manifest.read()

added = (
    anchor
    + '\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />'
    + '\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />'
)

with open(path, "w", encoding="utf-8") as manifest:
    manifest.write(text.replace(anchor, added, 1))
PATCH

    echo "android-patch: the manifest asks for the microphone"
fi

ACTIVITY="$(find "$PROJECT/app/src/main/java" -name MainActivity.kt -print -quit)"

if [ -z "$ACTIVITY" ]; then
    echo "android-patch: no MainActivity.kt under $PROJECT" >&2
    exit 1
fi

# THE PACKAGE IS WHATEVER TAURI DERIVED FROM THE IDENTIFIER, READ OFF THE FILE BEING REPLACED RATHER THAN
# WORKED OUT AGAIN HERE - THE GENERATED FILE IS THE ONE THING THAT CANNOT BE WRONG ABOUT IT
PACKAGE="$(sed -n 's/^package \(.*\)$/\1/p' "$ACTIVITY" | head -1)"

if [ -z "$PACKAGE" ]; then
    echo "android-patch: $ACTIVITY has no package line" >&2
    exit 1
fi

sed "s/^package PACKAGE$/package $PACKAGE/" "$ROOT/scripts/android/MainActivity.kt" > "$ACTIVITY"

echo "android-patch: the activity can ask for the microphone"
