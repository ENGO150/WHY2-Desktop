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

# WHAT EVERY ANDROID COMMAND IS RUN INSIDE. IT MAKES SURE libopus IS BUILT FOR THE ABIS AND THEN POINTS
# audiopus_sys AT IT - PER TARGET, BECAUSE ONE `tauri android build` COMPILES ALL FOUR IN ONE PROCESS AND
# A SINGLE PKG_CONFIG_PATH WOULD HAND THE SAME ARM LIBRARY TO THE x86 ONE.
# NOTHING HERE TOUCHES A DESKTOP BUILD: THE VARIABLES ARE TARGET-QUALIFIED, AND THIS SCRIPT ONLY EVER
# WRAPS THE android:* SCRIPTS IN package.json

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# THE FOUR RUST TARGETS THE APK CARRIES. OPUS_TARGETS CUTS IT DOWN WHEN ONLY ONE ABI IS BEING BUILT
# (`npm run android:build -- --target x86_64` ON AN EMULATOR), SINCE EACH ONE IS A FULL C BUILD
TARGETS="${OPUS_TARGETS:-aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android}"

# shellcheck disable=SC2086
bash "$ROOT/scripts/opus-android.sh" $TARGETS

# AND THAT THE GENERATED PROJECT STILL ASKS FOR THE MICROPHONE - IT IS REGENERATED OFTEN AND BY HAND, AND
# A DEV BUILD OFF AN UNPATCHED ONE WOULD LOOK LIKE THE CALL ITSELF IS BROKEN. IT IS A NO-OP WITHOUT ONE
bash "$ROOT/scripts/android-patch.sh"

OPUS_ROOT="$ROOT/src-tauri/gen/opus"

ENVIRONMENT=()

for TARGET in $TARGETS; do
    # pkg-config READS <VAR>_<TARGET> BEFORE THE PLAIN ONE, WITH THE TRIPLE'S DASHES AS UNDERSCORES
    ENVIRONMENT+=("PKG_CONFIG_PATH_${TARGET//-/_}=$OPUS_ROOT/$TARGET/lib/pkgconfig")
done

# THE BUILD SCRIPT RUNS ON THIS MACHINE AND WOULD OTHERWISE REFUSE TO ANSWER FOR ANOTHER ONE
ENVIRONMENT+=(PKG_CONFIG_ALLOW_CROSS=1)

# AND WOULD LINK THE PHONE AGAINST A libopus.so THAT IS NOT THERE: audiopus_sys DECIDES STATIC-OR-NOT FROM
# THE MACHINE IT IS COMPILED ON, WHICH IS THIS ONE
ENVIRONMENT+=(LIBOPUS_STATIC=1)

exec env "${ENVIRONMENT[@]}" "$@"
