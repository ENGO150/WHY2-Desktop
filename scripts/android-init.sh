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

# `tauri android init` AND THE PATCH THAT FOLLOWS IT. IT IS ONE SCRIPT AND NOT TWO COMMANDS JOINED BY &&
# IN package.json BECAUSE npm PUTS THE USER'S OWN ARGUMENTS AT THE END OF WHATEVER THE SCRIPT IS - AND
# `npm run android:init -- --skip-targets-install` WOULD HAND THEM TO THE PATCH INSTEAD

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

npx tauri android init "$@"

bash "$ROOT/scripts/android-patch.sh"
