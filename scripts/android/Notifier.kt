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

// A LINE NOBODY IS LOOKING AT, SAID WHERE THEY WILL SEE IT. THIS IS THE OTHER HALF OF A SESSION SURVIVING
// THE HOME BUTTON: A SOCKET HELD OPEN BEHIND A PHONE'S BACK IS WORTH NOTHING IF WHAT ARRIVES ON IT IS
// ONLY EVER FOUND BY OPENING THE APP AGAIN.
// IT IS ITS OWN CHANNEL AND NOT THE SESSION'S: THAT ONE IS A STATUS LINE THAT MUST NEVER MAKE A SOUND IN
// THE MIDDLE OF THE CONVERSATION IT IS ABOUT, AND THIS ONE IS NEWS - AND TWO CHANNELS ARE ALSO TWO THINGS
// ANDROID'S OWN SETTINGS LET SOMEBODY TURN OFF SEPARATELY, WHICH IS THE POINT OF HAVING THEM.
// THE KEY IS WHERE THE LINE LANDED - ONE CONVERSATION, ONE NOTIFICATION - SO SOMEBODY WRITING FIVE TIMES
// REPLACES THEIR OWN LINE RATHER THAN STACKING FIVE OF THEM IN THE SHADE.
// scripts/android-patch.sh WRITES THIS BESIDE THE GENERATED ACTIVITY AFTER EVERY `tauri android init`,
// AND THE PACKAGE LINE IS THAT SCRIPT'S - gen/android IS NOT TRACKED, SO THIS IS WHERE IT LIVES

package PACKAGE

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

class Notifier {
  companion object {
    private const val CHANNEL = "why2.messages"

    @JvmStatic
    fun post(context: Context, key: String, title: String, text: String): Boolean =
      try {
        val manager = context.getSystemService(NotificationManager::class.java)

        // HIGH, BECAUSE THIS IS THE ONE THING HERE THAT IS ACTUALLY NEWS - A MESSAGE THAT ARRIVES
        // SILENTLY IN THE SHADE IS A MESSAGE FOUND TOMORROW
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
          manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH)
          )
        }

        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)

        // THE SAME INTENT THE LAUNCHER WOULD FIRE: THE APP IS ALREADY RUNNING BEHIND THIS, SO WHAT IT
        // ACTUALLY DOES IS BRING THE ACTIVITY BACK - WHICH IS EVERYTHING A CHAT NOTIFICATION IS FOR
        val back = if (open == null) null else PendingIntent.getActivity(
          context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = Notification.Builder(context, CHANNEL)
          .setContentTitle(title)
          .setContentText(text)
          .setStyle(Notification.BigTextStyle().bigText(text))
          .setSmallIcon(android.R.drawable.stat_notify_chat)
          .setContentIntent(back)
          .setAutoCancel(true)
          .build()

        // ONE PER CONVERSATION. A HASH IS ENOUGH FOR THAT: TWO KEYS THAT COLLIDE ARE TWO CONVERSATIONS
        // SHARING A LINE IN THE SHADE, WHICH IS A WORSE NOTIFICATION AND NOT A BROKEN ONE
        manager.notify(key.hashCode(), notification)

        true
      } catch (error: Throwable) {
        // POST_NOTIFICATIONS REFUSED (13+) IS THE ORDINARY WAY THIS DOES NOTHING, AND IT COSTS THE LINE
        // IN THE SHADE AND NOTHING ELSE - THE SESSION AND THE MESSAGE ARE BOTH FINE
        false
      }
  }
}
