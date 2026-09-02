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
// android.rs CALLS THE THREE STATICS BELOW THROUGH JNI, AND scripts/android-patch.sh PUTS THIS FILE IN
// PLACE OF THE GENERATED ONE AFTER EVERY `tauri android init` - gen/android IS NOT TRACKED, SO THIS IS
// WHERE THE FILE ACTUALLY LIVES. THE PACKAGE LINE IS WRITTEN BY THAT SCRIPT FROM THE GENERATED FILE'S OWN

package PACKAGE

import android.Manifest
import android.content.pm.PackageManager
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

    // false IS NO ACTIVITY TO ASK FROM, WHICH IS THE ONE ANSWER THE CALL CANNOT WAIT ON
    @JvmStatic
    fun requestMicrophone(): Boolean {
      val activity = current ?: return false

      denied = false

      activity.runOnUiThread {
        activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MICROPHONE)
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

    if (requestCode == MICROPHONE) {
      denied = grantResults.isEmpty() || grantResults[0] != PackageManager.PERMISSION_GRANTED
    }
  }
}
