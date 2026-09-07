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

// THE ONE THING THAT KEEPS A SESSION ALIVE BEHIND THE HOME BUTTON. AN APP THAT IS NOT ON SCREEN IS A
// PROCESS ANDROID IS FREE TO FREEZE AND THEN KILL - WHICH IS WHAT USED TO END THE SOCKET - AND FROM 9
// ONWARDS IT IS ALSO ONE THE MICROPHONE IS SIMPLY CUT OFF FROM. A FOREGROUND SERVICE IS THE ONLY ANSWER
// TO EITHER, AND THE NOTIFICATION IS THE PRICE OF IT RATHER THAN A FEATURE.
// IT RUNS FOR AS LONG AS THERE IS A SESSION AND SAYS WHICH OF THE TWO THINGS IT IS HOLDING: specialUse
// FOR THE SOCKET, AND microphone BESIDE IT WHILE THERE IS A CALL. specialUse AND NOT dataSync BECAUSE 15
// STOPS A dataSync SERVICE AFTER SIX HOURS IN A DAY, AND A CHAT CONNECTION THAT DIES AT LUNCHTIME IS
// WORSE THAN ONE THAT NEVER CLAIMED TO SURVIVE - THE ONE COST IS THAT PUBLISHING THIS ON PLAY WOULD PUT
// THE SUBTYPE BELOW IN FRONT OF A REVIEWER.
// android.rs STARTS AND STOPS IT THROUGH THE TWO STATICS BELOW, AND scripts/android-patch.sh PUTS THIS
// FILE AND THE <service> ELEMENT IN PLACE AFTER EVERY `tauri android init` - gen/android IS NOT TRACKED,
// SO THIS IS WHERE THE FILE ACTUALLY LIVES. THE PACKAGE LINE IS WRITTEN BY THAT SCRIPT FROM THE
// GENERATED ACTIVITY'S OWN

package PACKAGE

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class SessionService : Service() {
  companion object {
    private const val CHANNEL = "why2.session"
    private const val NOTIFICATION = 0x574859 // "WHY"
    private const val CALL = "call"
    private const val SERVER = "server"

    // WHAT A SWIPE ON THE NOTIFICATION FIRES, SEE keeper BELOW. IT IS THE PACKAGE'S OWN AND IS SENT
    // NOWHERE ELSE - THIS PROCESS PUTS IT UP AND THIS PROCESS RECEIVES IT
    private const val KEEP = "why2.session.KEEP"

    // THE CONTEXT IS HANDED IN RATHER THAN HELD: THE ONE android.rs HAS IS THE APPLICATION, WHICH IS THE
    // ONLY CONTEXT THAT IS STANDING WHETHER OR NOT THERE IS AN ACTIVITY LEFT TO ASK
    @JvmStatic
    fun start(context: Context, call: Boolean, server: String): Boolean =
      try {
        context.startForegroundService(
          Intent(context, SessionService::class.java).putExtra(CALL, call).putExtra(SERVER, server)
        )

        true
      } catch (error: Throwable) {
        false
      }

    @JvmStatic
    fun stop(context: Context): Boolean =
      try {
        context.stopService(Intent(context, SessionService::class.java))

        true
      } catch (error: Throwable) {
        false
      }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // WHAT THE NOTIFICATION LAST SAID, SO THE LINE THAT COMES BACK AFTER A SWIPE IS THE SAME ONE THAT WENT
  private var call = false
  private var server = ""

  // FROM 14 AN ONGOING FOREGROUND-SERVICE NOTIFICATION CAN BE SWIPED AWAY - setOngoing IS ONLY HONOURED
  // BELOW THAT - AND WHAT IT TAKES WITH IT IS THE ONE VISIBLE SIGN THAT THE SESSION IS STILL UP. THE
  // SERVICE ITSELF IS UNTOUCHED BY THE SWIPE, SO THE ANSWER IS SIMPLY TO SAY IT AGAIN: THE DISMISSAL
  // FIRES THIS, AND THIS POSTS THE LINE BACK UNDER THE SAME ID. IT IS A BROADCAST TO OURSELVES AND NOT A
  // SERVICE START, WHICH FROM THE BACKGROUND - WHICH IS EXACTLY WHERE A SWIPE COMES FROM - IS REFUSED
  private val keeper = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      try {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification(call, server))
      } catch (error: Throwable) {
      }
    }
  }

  override fun onCreate() {
    super.onCreate()

    val filter = IntentFilter(KEEP)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(keeper, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(keeper, filter)
    }
  }

  // STARTED AGAIN RATHER THAN REPLACED WHEN THE CALL COMES AND GOES: THE SAME NOTIFICATION ID AND A NEW
  // TYPE IS HOW A RUNNING FOREGROUND SERVICE CHANGES WHAT IT IS FOR
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val call = intent?.getBooleanExtra(CALL, false) ?: false

    // AND WHICH SERVER IT IS A SESSION ON, WHICH IS THE WHOLE OF WHAT THIS NOTIFICATION HAS TO SAY THAT
    // THE ICON BESIDE IT DOES NOT. IT ARRIVES EMPTY UNTIL THE SERVER HAS SAID WHAT IT IS CALLED, SO THE
    // LINE IS WRITTEN BOTH WAYS RATHER THAN LEFT SAYING `Connected to `
    val server = intent?.getStringExtra(SERVER).orEmpty()

    this.call = call
    this.server = server

    // FROM 14 THE TYPE HAS TO BE NAMED IN THE CALL AS WELL AS IN THE MANIFEST, AND microphone IS ONE THE
    // SYSTEM CAN REFUSE - THE SOCKET IS WORTH HOLDING EVEN WHERE THE CALL IS NOT, SO A REFUSAL FALLS BACK
    // TO THE HALF THAT IS ALWAYS ALLOWED RATHER THAN TAKING THE WHOLE SERVICE DOWN WITH IT.
    // BELOW 14 THE TWO-ARGUMENT CALL TAKES WHATEVER THE MANIFEST DECLARED, WHICH IS THE SAME ANSWER
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val held = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE

      try {
        startForeground(
          NOTIFICATION, notification(call, server),
          if (call) held or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else held
        )
      } catch (error: Throwable) {
        startForeground(NOTIFICATION, notification(false, server), held)
      }
    } else {
      startForeground(NOTIFICATION, notification(call, server))
    }

    // A SESSION IS SOMETHING SOMEBODY OPENED, AND A SERVICE ANDROID BROUGHT BACK BY ITSELF WOULD HAVE NO
    // SOCKET UNDER IT - NOTHING TO KEEP ALIVE AND A NOTIFICATION SAYING OTHERWISE
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    try {
      unregisterReceiver(keeper)
    } catch (error: Throwable) {
    }

    stopForeground(STOP_FOREGROUND_REMOVE)

    super.onDestroy()
  }

  private fun notification(call: Boolean, server: String): Notification {
    val manager = getSystemService(NotificationManager::class.java)

    // LOW, BECAUSE THIS IS A STATUS LINE AND NOT NEWS: IT MUST NOT MAKE A SOUND IN THE MIDDLE OF THE
    // CONVERSATION IT IS ABOUT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Session", NotificationManager.IMPORTANCE_LOW)
      )
    }

    val open = packageManager.getLaunchIntentForPackage(packageName)

    val back = if (open == null) null else PendingIntent.getActivity(
      this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    // AND WHAT A SWIPE ON IT DOES, WHICH IS TO PUT IT BACK
    val kept = PendingIntent.getBroadcast(
      this, 0, Intent(KEEP).setPackage(packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    return Notification.Builder(this, CHANNEL)
      .setContentTitle(applicationInfo.loadLabel(packageManager))
      .setContentText(
        when {
          call && server.isEmpty() -> "In a voice call"
          call -> "In a voice call on $server"
          server.isEmpty() -> "Connected"
          else -> "Connected to $server"
        }
      )
      .setSmallIcon(if (call) android.R.drawable.ic_btn_speak_now else android.R.drawable.stat_notify_chat)
      .setContentIntent(back)
      .setDeleteIntent(kept)
      .setOngoing(true)
      .build()
  }
}
