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

# LIBOPUS FOR THE ANDROID TARGETS. audiopus_sys BUILDS ITS OWN COPY WITH AUTOTOOLS AND PASSES NO --host,
# SO ITS configure WOULD RUN THE BUILD MACHINE'S OWN TESTS AGAINST A CROSS COMPILER AND STOP - BUT IT ASKS
# pkg-config FIRST AND RETURNS THE MOMENT THAT ANSWERS. SO THE LIBRARY IS BUILT HERE, ONCE PER ABI, AND
# android-env.sh POINTS THE PER-TARGET PKG_CONFIG_PATH AT WHAT THIS LEAVES BEHIND.
# THIS IS BUILD TOOLING AND NOT A SOURCE OF TRUTH: DELETE gen/opus AND IT IS ALL MADE AGAIN.

set -euo pipefail

# A RELEASE TARBALL RATHER THAN THE COPY VENDORED IN audiopus_sys: THAT ONE SHIPS configure.ac AND WOULD
# WANT autoconf/automake/libtool ON EVERY MACHINE THAT BUILDS THIS, WHILE A RELEASE CARRIES ITS OWN
# configure. THE HASH IS PINNED SO EVERY OTHER MACHINE BUILDS THE SAME BYTES
OPUS_VERSION="${OPUS_VERSION:-1.5.2}"
OPUS_SHA256="${OPUS_SHA256:-65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1}"
OPUS_URL="https://downloads.xiph.org/releases/opus/opus-${OPUS_VERSION}.tar.gz"

# AAudio, WHICH IS THE ONLY AUDIO BACKEND cpal HAS ON ANDROID, ARRIVED IN 26 - THE SAME FLOOR
# tauri.conf.json ASKS FOR
API="${ANDROID_API_LEVEL:-26}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ROOT="$ROOT/src-tauri/gen/opus"
WORK="$OUT_ROOT/build"

NDK="${NDK_HOME:-${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}}"

if [ -z "$NDK" ] || [ ! -d "$NDK" ]; then
    echo "opus-android: set NDK_HOME to the NDK you build the app with" >&2
    exit 1
fi

TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
[ -d "$TOOLCHAIN" ] || TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/darwin-x86_64"

if [ ! -d "$TOOLCHAIN" ]; then
    echo "opus-android: no llvm toolchain under $NDK" >&2
    exit 1
fi

# THE FOUR RUST TARGETS, OR WHICHEVER OF THEM WAS ASKED FOR
if [ "$#" -gt 0 ]; then
    TARGETS=("$@")
else
    TARGETS=(aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android)
fi

# THE CLANG WRAPPER THAT BUILDS FOR A TARGET, WHICH IS ALSO THE TRIPLE ITS configure WANTS TO BE TOLD.
# armv7 IS THE ONE WHERE RUST'S SPELLING AND THE NDK'S ARE NOT THE SAME WORD
clang_prefix()
{
    case "$1" in
        aarch64-linux-android)   echo "aarch64-linux-android" ;;
        armv7-linux-androideabi) echo "armv7a-linux-androideabi" ;;
        i686-linux-android)      echo "i686-linux-android" ;;
        x86_64-linux-android)    echo "x86_64-linux-android" ;;
        *) echo "opus-android: unknown target $1" >&2; exit 1 ;;
    esac
}

mkdir -p "$WORK"

TARBALL="$WORK/opus-${OPUS_VERSION}.tar.gz"

if [ ! -f "$TARBALL" ]; then
    echo "opus-android: fetching opus ${OPUS_VERSION}"
    curl -fsSL "$OPUS_URL" -o "$TARBALL.part"
    mv "$TARBALL.part" "$TARBALL"
fi

echo "${OPUS_SHA256}  ${TARBALL}" | sha256sum -c - >/dev/null

SOURCE="$WORK/opus-${OPUS_VERSION}"

if [ ! -d "$SOURCE" ]; then
    tar -xzf "$TARBALL" -C "$WORK"
fi

for TARGET in "${TARGETS[@]}"; do
    PREFIX="$OUT_ROOT/$TARGET"

    # ALREADY BUILT IS ALREADY DONE - THIS RUNS IN FRONT OF EVERY ANDROID BUILD
    if [ -f "$PREFIX/lib/libopus.a" ] && [ -f "$PREFIX/lib/pkgconfig/opus.pc" ]; then
        echo "opus-android: $TARGET is built"
        continue
    fi

    echo "opus-android: building $TARGET"

    CLANG="$TOOLCHAIN/bin/$(clang_prefix "$TARGET")$API-clang"

    if [ ! -x "$CLANG" ]; then
        echo "opus-android: $NDK has no compiler for $TARGET at API $API" >&2
        exit 1
    fi

    BUILD_DIR="$WORK/$TARGET"
    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR"

    (
        cd "$BUILD_DIR"

        CC="$CLANG" \
        AR="$TOOLCHAIN/bin/llvm-ar" \
        RANLIB="$TOOLCHAIN/bin/llvm-ranlib" \
        STRIP="$TOOLCHAIN/bin/llvm-strip" \
        NM="$TOOLCHAIN/bin/llvm-nm" \
        "$SOURCE/configure" \
            --host="$(clang_prefix "$TARGET")" \
            --prefix="$PREFIX" \
            --enable-static \
            --disable-shared \
            --disable-doc \
            --disable-extra-programs \
            --with-pic \
            >/dev/null

        make -j"$(nproc)" >/dev/null
        make install >/dev/null
    )

    # THE OBJECTS ARE OF NO USE ONCE THE LIBRARY IS INSTALLED, AND THEY ARE THE BULK OF WHAT CI WOULD
    # OTHERWISE CARRY BETWEEN RUNS
    rm -rf "$BUILD_DIR"
done

echo "opus-android: libopus is in $OUT_ROOT"
