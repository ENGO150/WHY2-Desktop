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

# WHAT R8 CANNOT SEE. THE RELEASE BUILD SHRINKS THE KOTLIN HALF DOWN TO WHAT IS REACHED, AND WHAT REACHES
# OUR FIVE CLASSES IS android.rs THROUGH loadClass AND CallStaticMethod - A STRING AND NOT A REFERENCE,
# SO A CLASS NOTHING ELSE NAMES IS ONE R8 IS RIGHT TO BELIEVE IS DEAD. THE ACTIVITY AND THE SERVICE ARE
# NAMED IN THE MANIFEST AND SURVIVE ON THAT ALONE; AudioRoute, ImageStore AND Notifier ARE NAMED NOWHERE BUT HERE,
# AND WITHOUT THESE LINES A RELEASE APK IS ONE WHOSE SPEAKER BUTTON AND WHOSE SAVED PICTURE BOTH COME
# BACK AS "WHY2 could not reach Android." - AND NOT IN A DEBUG BUILD, WHERE NOTHING IS SHRUNK AT ALL.
# THE MEMBERS GO WITH THE CLASS: A STATIC METHOD CALLED BY NAME IS AS INVISIBLE AS THE CLASS WAS.
# scripts/android-patch.sh WRITES THIS BESIDE THE GENERATED PROJECT'S OWN RULES, WHICH build.gradle.kts
# TAKES IN AS `fileTree(".") { include("**/*.pro") }`, AND THE PACKAGE IS THE ONE THAT SCRIPT READ OFF
# THE GENERATED ACTIVITY

-keep class PACKAGE.MainActivity { *; }
-keep class PACKAGE.SessionService { *; }
-keep class PACKAGE.AudioRoute { *; }
-keep class PACKAGE.ImageStore { *; }
-keep class PACKAGE.Notifier { *; }

# AND THE COMPANION OBJECTS BEHIND THEM: @JvmStatic IS A STATIC METHOD ON THE CLASS THAT FORWARDS TO THE
# COMPANION'S OWN, SO THE FORWARDER KEPT ABOVE IS WORTH NOTHING WITHOUT WHAT IT CALLS
-keep class PACKAGE.**$Companion { *; }
