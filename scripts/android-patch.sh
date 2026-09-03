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

# WHAT THE GENERATED ANDROID PROJECT DOES NOT KNOW ABOUT THE CALL: THAT THE APP RECORDS AUDIO, THAT IT
# KEEPS RECORDING BEHIND THE HOME BUTTON THROUGH A FOREGROUND SERVICE, AND THAT THE TWO KOTLIN CLASSES
# android.rs REACHES THROUGH JNI EXIST AT ALL. gen/android IS NOT TRACKED - IT IS MADE ON EVERY MACHINE
# AND IN CI - SO THIS RUNS AFTER EVERY init, AND AGAIN IN FRONT OF EVERY BUILD.
# IT IS WRITTEN TO BE RUN TWICE: EVERY MANIFEST LINE IS INSERTED ONLY WHERE IT IS MISSING, AND THE TWO
# CLASSES ARE OVERWRITTEN WITH THE COPIES IN scripts/android/ EITHER WAY.
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

# THE CALL RECORDS, IT ASKS THE SYSTEM TO ROUTE ITSELF THROUGH THE EARPIECE OR A HEADSET, AND IT KEEPS
# DOING BOTH WHILE THE WINDOW IS AWAY - WHICH IS A FOREGROUND SERVICE, ITS TYPED PERMISSION (14+), AND
# THE NOTIFICATION THAT PAYS FOR IT (13+). THE SERVICE ELEMENT GOES WITH THEM, TYPE AND ALL: FROM 10
# ONWARDS AN UNTYPED microphone SERVICE IS ONE THE MICROPHONE IS CUT OFF FROM ANYWAY
python3 - "$MANIFEST" <<'PATCH'
import sys

path = sys.argv[1]

with open(path, encoding="utf-8") as manifest:
    text = manifest.read()

PERMISSION = '<uses-permission android:name="android.permission.INTERNET" />'

if PERMISSION not in text:
    sys.exit("android-patch: the manifest template changed - no INTERNET permission to write beside")

for name in (
    "RECORD_AUDIO",
    "MODIFY_AUDIO_SETTINGS",
    "FOREGROUND_SERVICE",
    "FOREGROUND_SERVICE_MICROPHONE",
    "POST_NOTIFICATIONS",
):
    line = '<uses-permission android:name="android.permission.%s" />' % name

    if line not in text:
        text = text.replace(PERMISSION, PERMISSION + "\n    " + line, 1)

    # THE NEXT ONE GOES AFTER THIS ONE, SO A SECOND RUN FINDS THE LIST IN THE ORDER IT IS WRITTEN HERE
    PERMISSION = line

APPLICATION = "    </application>"

if APPLICATION not in text:
    sys.exit("android-patch: the manifest template changed - no application element to write inside")

if "CallService" not in text:
    service = (
        '        <service\n'
        '            android:name=".CallService"\n'
        '            android:exported="false"\n'
        '            android:foregroundServiceType="microphone" />\n\n'
    )

    text = text.replace(APPLICATION, service + APPLICATION, 1)

with open(path, "w", encoding="utf-8") as manifest:
    manifest.write(text)
PATCH

echo "android-patch: the manifest asks for the microphone and can hold the call"

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

# THE SERVICE IS A SIBLING OF THE ACTIVITY AND NOT A GENERATED FILE AT ALL, SO IT IS SIMPLY WRITTEN BESIDE
# IT - THE PACKAGE IS THE ONE THE ACTIVITY DECLARED, WHICH IS ALSO THE DIRECTORY IT SITS IN
sed "s/^package PACKAGE$/package $PACKAGE/" "$ROOT/scripts/android/CallService.kt" > "$(dirname "$ACTIVITY")/CallService.kt"

echo "android-patch: the activity can ask for the microphone, and the service can hold the call"
