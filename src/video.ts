/*
This is part of WHY2
Copyright (C) 2026 Václav Šmejkal

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

//AN ACCESS UNIT IS A KEYFRAME WHEN IT CARRIES AN IDR SLICE, OR THE PARAMETER SETS THAT COME IN FRONT OF
//ONE. A DECODER CANNOT START ANYWHERE ELSE, AND ANNEX-B PUTS THE TYPE IN THE LOW FIVE BITS OF THE FIRST
//BYTE AFTER EVERY START CODE - WHICH IS THE WHOLE OF WHAT HAS TO BE UNDERSTOOD ABOUT H.264 HERE
export function isKeyFrame(bytes: Uint8Array): boolean
{
    for (let index = 0; index + 3 < bytes.length; index++)
    {
        if (bytes[index] !== 0 || bytes[index + 1] !== 0) continue;

        const start = bytes[index + 2] === 1
            ? index + 3
            : bytes[index + 2] === 0 && bytes[index + 3] === 1 ? index + 4 : -1;

        if (start < 0 || start >= bytes.length) continue;

        const kind = bytes[start] & 0x1f;

        if (kind === 5 || kind === 7) return true;
    }

    return false;
}

//HOW THIS WEBVIEW WOULD DECODE THE SHARE, IF IT CAN. THE LEVEL IN THE CODEC STRING ONLY HAS TO BE AT LEAST
//THE STREAM'S, AND THE STREAM'S DEPENDS ON THE MONITOR SOMEBODY ELSE IS SHARING, SO THE HIGHEST SUPPORTED
//ONE WINS - AND null MEANS THE PICTURE HAS TO ARRIVE ALREADY DECODED.
//SOFTWARE IS ASKED FOR FIRST. THE REST OF THIS PROJECT DECODES THE SAME STREAM WITH openh264 AND DRAWS IT
//CORRECTLY, SO A PICTURE THAT IS TORN ONLY HERE IS THE MACHINE'S VIDEO HARDWARE, NOT THE STREAM
export async function h264Config(): Promise<VideoDecoderConfig | null>
{
    if (typeof VideoDecoder === "undefined") return null;

    for (const hardwareAcceleration of ["prefer-software", "no-preference"] as const)
    {
        for (const codec of ["avc1.42E034", "avc1.42E028", "avc1.42E01E"])
        {
            const config: VideoDecoderConfig = { codec, optimizeForLatency: true, hardwareAcceleration };

            try
            {
                const { supported } = await VideoDecoder.isConfigSupported(config);

                if (supported) return config;
            }
            catch { /* THE NEXT ONE */ }
        }
    }

    return null;
}
