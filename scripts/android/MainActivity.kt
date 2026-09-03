// This is part of WHY2
// Copyright (C) 2026 Václav Šmejkal

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// THE GENERATED ACTIVITY, PLUS THE ONE THING THAT CANNOT BE DONE FROM RUST: ASKING FOR A PERMISSION.
// KEEPING THE CALL ALIVE BEHIND THE HOME BUTTON IS THE OTHER HALF OF THAT, AND IT IS CallService.kt.
// android.rs CALLS THE THREE STATICS BELOW THROUGH JNI, AND scripts/android-patch.sh PUTS THIS FILE IN
// PLACE OF THE GENERATED ONE AFTER EVERY `tauri android init` - gen/android IS NOT TRACKED, SO THIS IS
// WHERE THE FILE ACTUALLY LIVES. THE PACKAGE LINE IS WRITTEN BY THAT SCRIPT FROM THE GENERATED FILE'S OWN

package PACKAGE

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    // THE ACTIVITY ON SCREEN, WHICH IS WHAT requestPermissions IS A METHOD OF. THERE IS ONLY EVER ONE
    private var current: MainActivity? = null

    // ANDROID ANSWERS FOR THE USER ONCE THEY HAVE REFUSED TWICE, AND IT ANSWERS AT ONCE - SO THE REFUSAL
    // IS REMEMBERED, OR THE CALL WOULD SIT THERE WAITING OUT A DIALOG THAT WAS NEVER DRAWN
    private var denied = false

    private const val MICROPHONE = 0x574859 // "WHY"

    @JvmStatic
    fun microphoneGranted(): Boolean =
      current?.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    @JvmStatic
    fun microphoneDenied(): Boolean = denied

    // false IS NO ACTIVITY TO ASK FROM, WHICH IS THE ONE ANSWER THE CALL CANNOT WAIT ON.
    // THE NOTIFICATION IS ASKED FOR IN THE SAME BREATH: A CALL THAT OUTLIVES THE WINDOW IS A FOREGROUND
    // SERVICE (CallService), AND FROM 13 ONWARDS SHOWING ITS NOTIFICATION IS A PERMISSION OF ITS OWN -
    // BUT ONLY THE NOTIFICATION, SO A REFUSAL COSTS THE LINE IN THE SHADE AND NOT THE CALL
    @JvmStatic
    fun requestMicrophone(): Boolean {
      val activity = current ?: return false

      denied = false

      val wanted = mutableListOf(Manifest.permission.RECORD_AUDIO)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        wanted.add(Manifest.permission.POST_NOTIFICATIONS)
      }

      activity.runOnUiThread {
        activity.requestPermissions(wanted.toTypedArray(), MICROPHONE)
      }

      return true
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    current = this
    super.onCreate(savedInstanceState)
  }

  override fun onDestroy() {
    if (current === this) current = null
    super.onDestroy()
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)

    // THE MICROPHONE IS LOOKED UP BY NAME AND NOT BY POSITION, SINCE IT IS NOT THE ONLY THING ASKED FOR
    // ANY MORE - AND IT IS THE ONLY ONE OF THEM A REFUSAL OF WHICH ENDS THE CALL
    if (requestCode == MICROPHONE) {
      val index = permissions.indexOf(Manifest.permission.RECORD_AUDIO)

      denied = index < 0 || index >= grantResults.size ||
        grantResults[index] != PackageManager.PERMISSION_GRANTED
    }
  }
}
