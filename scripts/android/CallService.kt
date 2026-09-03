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

// THE ONE THING THAT KEEPS A CALL ALIVE BEHIND THE HOME BUTTON. AN APP THAT IS NOT ON SCREEN IS A
// PROCESS ANDROID IS FREE TO FREEZE AND THEN KILL, AND FROM 9 ONWARDS IT IS ALSO ONE THE MICROPHONE IS
// SIMPLY CUT OFF FROM - A FOREGROUND SERVICE IS THE ONLY ANSWER TO EITHER, AND THE NOTIFICATION IS THE
// PRICE OF IT RATHER THAN A FEATURE. android.rs STARTS AND STOPS IT THROUGH THE TWO STATICS BELOW, AND
// scripts/android-patch.sh PUTS THIS FILE AND THE <service> LINE IN PLACE AFTER EVERY `tauri android
// init` - gen/android IS NOT TRACKED, SO THIS IS WHERE THE FILE ACTUALLY LIVES. THE PACKAGE LINE IS
// WRITTEN BY THAT SCRIPT FROM THE GENERATED ACTIVITY'S OWN

package PACKAGE

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class CallService : Service() {
  companion object {
    private const val CHANNEL = "why2.call"
    private const val NOTIFICATION = 0x574859 // "WHY"

    // THE CONTEXT IS HANDED IN RATHER THAN HELD: THE ONE android.rs HAS IS THE APPLICATION, WHICH IS THE
    // ONLY CONTEXT THAT IS STANDING WHETHER OR NOT THERE IS AN ACTIVITY LEFT TO ASK
    @JvmStatic
    fun start(context: Context): Boolean =
      try {
        context.startForegroundService(Intent(context, CallService::class.java))

        true
      } catch (error: Throwable) {
        false
      }

    @JvmStatic
    fun stop(context: Context): Boolean =
      try {
        context.stopService(Intent(context, CallService::class.java))

        true
      } catch (error: Throwable) {
        false
      }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // FROM 10 ONWARDS THE TYPE IS WHAT DECIDES WHETHER THE MICROPHONE KEEPS WORKING, AND FROM 14 IT HAS
    // TO BE NAMED IN THE CALL AS WELL AS IN THE MANIFEST
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION, notification())
    }

    // A CALL BELONGS TO A SESSION, AND A SERVICE ANDROID BROUGHT BACK BY ITSELF WOULD HAVE NO SOCKET
    // UNDER IT - NOTHING TO KEEP ALIVE AND A NOTIFICATION SAYING OTHERWISE
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)

    super.onDestroy()
  }

  private fun notification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)

    // LOW, BECAUSE THIS IS A STATUS LINE AND NOT NEWS: IT MUST NOT MAKE A SOUND IN THE MIDDLE OF THE
    // CALL IT IS ABOUT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Voice call", NotificationManager.IMPORTANCE_LOW)
      )
    }

    val open = packageManager.getLaunchIntentForPackage(packageName)

    val back = if (open == null) null else PendingIntent.getActivity(
      this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    return Notification.Builder(this, CHANNEL)
      .setContentTitle(applicationInfo.loadLabel(packageManager))
      .setContentText("In a voice call")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentIntent(back)
      .setOngoing(true)
      .build()
  }
}
