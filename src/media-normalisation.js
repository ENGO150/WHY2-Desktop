/* WHY2 media playback. Uses the same RMS target and smoothing as the native voice player. */

const target = 0.2;
const silence = 0.001 ** 2;

class MediaNormalisation extends AudioWorkletProcessor
{
    static get parameterDescriptors()
    {
        return [
            { name: "volume", defaultValue: 1, minValue: 0, maxValue: 2, automationRate: "k-rate" },
            { name: "normalise", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
        ];
    }

    power = target ** 2;
    smoothing = 1 - Math.exp(-1 / (0.3 * sampleRate));

    process([input], [output], { volume, normalise })
    {
        if (!input.length) return true;

        const enabled = normalise[0] === 1;
        if (!enabled) this.power = target ** 2;

        for (let frame = 0; frame < output[0].length; frame++)
        {
            let gain = volume[0];
            if (enabled)
            {
                let power = 0;
                for (const channel of input) power += channel[frame] ** 2;
                power /= input.length;
                if (Number.isFinite(power) && power > silence) this.power += this.smoothing * (power - this.power);
                gain *= Math.min(4, Math.max(0.1, target / Math.sqrt(this.power)));
            }

            for (let channel = 0; channel < output.length; channel++)
            {
                const sample = input[channel % input.length][frame];
                output[channel][frame] = Number.isFinite(sample) ? Math.tanh(sample * gain) : 0;
            }
        }

        return true;
    }
}

registerProcessor("why2-media-normalisation", MediaNormalisation);
