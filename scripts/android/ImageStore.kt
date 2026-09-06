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

// WHERE A PICTURE GOES ON A PHONE. A DESKTOP ASKS WITH A FILE DIALOG AND A PHONE HAS NO SUCH THING - THE
// ONE ANSWER EVERY ANDROID USER ALREADY KNOWS IS THE GALLERY, WHICH IS MediaStore AND NOT A PATH.
// FROM 10 THAT INSERT IS THE APP'S OWN ROW IN THE MEDIA DATABASE AND COSTS NO PERMISSION AT ALL, WHICH
// IS THE WHOLE REASON THIS IS WORTH DOING PROPERLY; BELOW 10 THE SHARED Pictures DIRECTORY IS GUARDED BY
// WRITE_EXTERNAL_STORAGE, SO THE PICTURE GOES TO THE APP'S OWN EXTERNAL Pictures DIRECTORY INSTEAD AND IS
// HANDED TO THE MEDIA SCANNER - IT IS A REAL FILE IN A REAL PLACE THAT THE SAVED LINE NAMES, RATHER THAN
// A PERMISSION DIALOG IN FRONT OF A FEATURE NOBODY ASKED TO BE ASKED ABOUT.
// scripts/android-patch.sh PUTS THIS FILE BESIDE THE GENERATED ACTIVITY AFTER EVERY `tauri android init`
// - gen/android IS NOT TRACKED, SO THIS IS WHERE IT ACTUALLY LIVES, AND THE PACKAGE LINE IS WRITTEN BY
// THAT SCRIPT FROM THE GENERATED ACTIVITY'S OWN

package PACKAGE

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

class ImageStore {
  companion object {
    // THE PICTURES ARE THE APP'S OWN AND ARE KEPT TOGETHER, THE WAY EVERY OTHER PROGRAM THAT SAVES ONE
    // KEEPS THEM - A GALLERY WITH ONE ALBUM PER SENDER IS NOT WHAT ANYBODY ASKED FOR
    private const val ALBUM = "WHY2"

    // EMPTY IS "ANDROID WOULD NOT TAKE IT", WHICH IS THE ONLY WAY THIS FAILS THAT IS NOT A BUG IN THE
    // CALLER - android.rs SAYS SO IN THE PANE AND THERE IS NOTHING ELSE TO DO ABOUT IT
    private const val NOWHERE = ""

    @JvmStatic
    fun save(context: Context, filename: String, mime: String, bytes: ByteArray): String =
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) gallery(context, filename, mime, bytes)
        else beside(context, filename, mime, bytes)
      } catch (error: Exception) {
        NOWHERE
      }

    // THE MEDIA DATABASE'S OWN ANSWER. THE ROW IS INSERTED PENDING SO NOTHING READS A HALF-WRITTEN
    // PICTURE, AND THE NAME IS READ BACK OFF IT RATHER THAN ASSUMED: MediaStore RENAMES A COLLISION
    // ITSELF, AND WHAT IS SAID OUT LOUD HAD BETTER BE WHAT IS ACTUALLY THERE
    private fun gallery(context: Context, filename: String, mime: String, bytes: ByteArray): String {
      // THE BRANCH IS IN save(), AND THIS SAYS SO AGAIN WHERE THE 10-AND-UP CALLS ACTUALLY ARE: LINT
      // FOLLOWS A VERSION CHECK INSIDE THE METHOD THAT MAKES THE CALL AND NOT ONE A CALLER MADE
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return NOWHERE

      val resolver = context.contentResolver

      val values = ContentValues()

      values.put(MediaStore.Images.Media.DISPLAY_NAME, filename)
      values.put(MediaStore.Images.Media.MIME_TYPE, mime)
      values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM)
      values.put(MediaStore.Images.Media.IS_PENDING, 1)

      val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return NOWHERE

      try {
        resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return NOWHERE
      } catch (error: Exception) {
        resolver.delete(uri, null, null)

        return NOWHERE
      }

      values.clear()
      values.put(MediaStore.Images.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)

      var name = filename

      resolver.query(uri, arrayOf(MediaStore.Images.Media.DISPLAY_NAME), null, null, null)?.use { row ->
        if (row.moveToFirst()) name = row.getString(0)
      }

      return Environment.DIRECTORY_PICTURES + "/" + ALBUM + "/" + name
    }

    // AND BELOW 10, WHERE THE SHARED DIRECTORY WOULD HAVE TO BE ASKED FOR: THE APP'S OWN EXTERNAL
    // Pictures DIRECTORY, WHICH NEEDS NOTHING AND IS A PLACE A FILE MANAGER CAN REACH. THE SCANNER IS
    // WHAT GIVES THE GALLERY A CHANCE OF SHOWING IT
    private fun beside(context: Context, filename: String, mime: String, bytes: ByteArray): String {
      val directory = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: return NOWHERE

      if (!directory.exists() && !directory.mkdirs()) return NOWHERE

      // THE NAME IS THE SENDER'S AND TWO PEOPLE SEND photo.jpg, SO A SECOND ONE IS NUMBERED RATHER THAN
      // WRITTEN OVER THE FIRST - MediaStore DOES THE SAME THING ON ITS OWN SIDE
      val stop = filename.lastIndexOf('.')
      val stem = if (stop > 0) filename.substring(0, stop) else filename
      val extension = if (stop > 0) filename.substring(stop) else ""

      var file = File(directory, filename)
      var next = 1

      while (file.exists() && next < 1000) {
        file = File(directory, "$stem ($next)$extension")
        next += 1
      }

      file.writeBytes(bytes)

      MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mime), null)

      return file.absolutePath
    }
  }
}
