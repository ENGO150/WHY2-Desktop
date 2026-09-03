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
// KEEPING THE SESSION ALIVE BEHIND THE HOME BUTTON IS THE OTHER HALF OF THAT, AND IT IS
// SessionService.kt. THE BACK GESTURE IS THE THIRD THING THE PLATFORM WILL NOT LET RUST HAVE.
// android.rs CALLS THE THREE STATICS BELOW THROUGH JNI, AND scripts/android-patch.sh PUTS THIS FILE IN
// PLACE OF THE GENERATED ONE AFTER EVERY `tauri android init` - gen/android IS NOT TRACKED, SO THIS IS
// WHERE THE FILE ACTUALLY LIVES. THE PACKAGE LINE IS WRITTEN BY THAT SCRIPT FROM THE GENERATED FILE'S OWN

package PACKAGE

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
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
    // SERVICE (SessionService), AND FROM 13 ONWARDS SHOWING ITS NOTIFICATION IS A PERMISSION OF ITS OWN -
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

  // THE BACK GESTURE, WHICH IS THE ONE NAVIGATION CONTROL THE PHONE ALREADY HAS AND WHICH EVERYBODY
  // EXPECTS TO CLOSE WHAT IS IN FRONT RATHER THAN THE PROGRAM. TauriActivity TURNS WryActivity'S OWN
  // HANDLING OFF, SO WITHOUT THIS THE PRESS GOES STRAIGHT TO THE DEFAULT ONE AND FINISHES THE ACTIVITY
  // WITH A DRAWER STILL OVER THE CHAT.
  // THE PAGE IS ASKED RATHER THAN THE WEBVIEW'S HISTORY: WHAT IS IN FRONT IS REACT STATE AND NOT A
  // NAVIGATION, AND A HISTORY ENTRY PARKED FOR IT IS A GUESS ABOUT WHAT canGoBack() COUNTS. THE ANSWER
  // COMES BACK ON THE UI THREAD A MOMENT LATER, WHICH IS WHY LEAVING IS DONE IN THE CALLBACK AND NOT
  // AFTER IT
  private var web: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    web = webView

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val view = web

        if (view == null) {
          leave()
          return
        }

        view.evaluateJavascript("(window.__why2Back && window.__why2Back()) ? 1 : 0") { answer ->
          if (answer != "1") leave()
        }
      }

      // THE ONLY WAY OUT IS THE HANDLING THIS CALLBACK IS STANDING IN FRONT OF, SO IT STANDS ASIDE FOR
      // ONE PRESS RATHER THAN CALLING finish() AND TAKING THE ACTIVITY'S OWN SAY OUT OF IT
      private fun leave() {
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
      }
    })
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    current = this
    super.onCreate(savedInstanceState)
  }

  override fun onDestroy() {
    if (current === this) current = null
    web = null
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
