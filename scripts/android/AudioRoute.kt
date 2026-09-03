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

// WHERE THE CALL COMES OUT. A DESKTOP HAS ONE PAIR OF SPEAKERS AND A PHONE HAS TWO - THE LOUD ONE ON THE
// BACK AND THE QUIET ONE THAT IS HELD TO AN EAR - AND WHICH OF THEM A CALL IS PLAYING THROUGH IS THE ONE
// THING EVERY PHONE CALL SCREEN HAS A BUTTON FOR.
// ANDROID IS ASKED FOR IT IN TWO WAYS, BECAUSE WHICH ONE WORKS DEPENDS ON THE VERSION: FROM 12 THERE IS
// A COMMUNICATION DEVICE TO NAME, AND BELOW THAT THERE IS THE SPEAKERPHONE FLAG, WHICH ONLY MEANS
// ANYTHING WHILE THE AUDIO MODE SAYS THERE IS A CALL - WHICH IS WHY THE MODE IS SET EITHER WAY.
// AND BECAUSE NEITHER OF THEM MOVES A STREAM THAT IS PLAYING AS MEDIA - WHICH IS WHAT cpal OPENS, HAVING
// NO WAY TO ASK FOR ANYTHING ELSE - route() HANDS BACK THE ID OF THE DEVICE IT PICKED, AND android.rs
// POINTS THE VOICE CLIENT'S OUTPUT STRAIGHT AT IT. THE TWO TOGETHER ARE WHAT ACTUALLY MOVES THE SOUND.
// scripts/android-patch.sh PUTS THIS FILE BESIDE THE GENERATED ACTIVITY AFTER EVERY `tauri android init`
// - gen/android IS NOT TRACKED, SO THIS IS WHERE IT ACTUALLY LIVES, AND THE PACKAGE LINE IS WRITTEN BY
// THAT SCRIPT FROM THE GENERATED ACTIVITY'S OWN

package PACKAGE

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

class AudioRoute {
  companion object {
    // NO DEVICE: EITHER NOTHING MATCHED OR ANDROID WOULD NOT HAVE IT, AND EITHER WAY THE ANSWER IS THE
    // ONE AN UNCONFIGURED OUTPUT ALREADY GIVES - WHATEVER THE SYSTEM PICKS
    private const val NONE = -1

    // THE EARPIECE IS THE LAST RESORT OF THE QUIET HALF AND NOT THE WHOLE OF IT: A HEADSET IN THE SOCKET
    // OR ON AN EAR IS ALREADY PRIVATE, AND MOVING THE CALL OFF IT AND ONTO THE PHONE'S OWN EARPIECE IS
    // NOT WHAT ANYBODY MEANS BY TURNING THE SPEAKERPHONE OFF. HIGHEST PREFERENCE FIRST
    private val QUIET = listOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_HEARING_AID,
      AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
    )

    private val LOUD = listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)

    // THE CALL IS ROUTED, AND THE ID OF WHAT IT WAS ROUTED TO COMES BACK - THAT SECOND HALF IS WHAT THE
    // PLAYBACK STREAM ITSELF IS REOPENED ON, SINCE ASKING THE SYSTEM POLITELY MOVES A VOICE CALL AND NOT
    // A MEDIA STREAM
    @JvmStatic
    @Suppress("DEPRECATION") // THE SPEAKERPHONE FLAG, WHICH IS THE ONLY WAY THERE IS BELOW 12
    fun route(context: Context, speaker: Boolean): Int =
      try {
        val audio = context.getSystemService(AudioManager::class.java)

        // A CALL IS A CALL AND NOT MUSIC, WHICH IS WHAT MAKES THE VOLUME KEYS MOVE THE CALL'S OWN VOLUME
        // AND THE SPEAKERPHONE FLAG BELOW MEAN ANYTHING AT ALL
        audio.mode = AudioManager.MODE_IN_COMMUNICATION

        val wanted = if (speaker) LOUD else QUIET

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          // FROM 12 THE DEVICE IS NAMED RATHER THAN DESCRIBED, AND ONLY THE ONES ANDROID OFFERS FOR A
          // CALL CAN BE NAMED - A LIST THAT ALREADY LEAVES OUT WHATEVER IS NOT PLUGGED IN
          val devices = audio.availableCommunicationDevices

          val device = wanted.firstNotNullOfOrNull { type -> devices.firstOrNull { it.type == type } }

          if (device == null) {
            audio.clearCommunicationDevice()

            NONE
          } else if (audio.setCommunicationDevice(device)) device.id else NONE
        } else {
          audio.isSpeakerphoneOn = speaker

          // THE FLAG ABOVE SAYS WHICH WAY TO GO AND NOT WHERE TO, SO THE DEVICE IS LOOKED FOR SEPARATELY
          // - IT IS THE PLAYBACK STREAM'S OWN ANSWER, WHICH ANDROID'S ROUTING KNOWS NOTHING ABOUT
          val devices = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)

          wanted.firstNotNullOfOrNull { type -> devices.firstOrNull { it.type == type } }?.id ?: NONE
        }
      } catch (error: Throwable) {
        NONE
      }

    // AND OUT OF IT AGAIN, WHICH IS THE END OF THE CALL: THE MODE IS THE WHOLE PHONE'S AND NOT OURS, SO A
    // SESSION THAT LEFT IT IN COMMUNICATION WOULD TAKE EVERY OTHER APP'S SOUND WITH IT
    @JvmStatic
    @Suppress("DEPRECATION")
    fun clear(context: Context): Boolean =
      try {
        val audio = context.getSystemService(AudioManager::class.java)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          audio.clearCommunicationDevice()
        } else {
          audio.isSpeakerphoneOn = false
        }

        audio.mode = AudioManager.MODE_NORMAL

        true
      } catch (error: Throwable) {
        false
      }
  }
}
