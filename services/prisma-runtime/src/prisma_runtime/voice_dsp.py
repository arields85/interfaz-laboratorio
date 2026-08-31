"""Pure Prisma PCM DSP shared by streaming and full-file processing."""

import math
import sys
from array import array


SAMPLE_RATE = 24000
SAMPLE_WIDTH = 2
FULL_PCM_BLOCK_SAMPLES = 1800


def _clamp(value):
    return max(-32768, min(32767, int(round(value))))


class PrismaStreamingDSP:
    def __init__(self, config):
        self.config = config
        r = config["robotic"]
        self.active = bool(config["effectEnabled"] and config["preset"] == "robotic_medium_light" and config["effectIntensity"] > 0)
        self.mix = max(0.0, min(1.0, float(config["effectIntensity"]) / 100))
        self.base_gain, self.depth = float(r["baseGain"]), float(r["modulationDepth"])
        self.mhz, self.thz = float(r["modulationHz"]), float(r["metallicHz"])
        self.qstep = 65534.0 / max(1, int(r["quantizationSteps"]) - 1)
        self.metallic_mix = float(r["metallicMix"])
        self.e1, self.g1 = round(float(r["echo1DelayMs"]) * SAMPLE_RATE / 1000), float(r["echo1Gain"])
        self.e2, self.g2 = round(float(r["echo2DelayMs"]) * SAMPLE_RATE / 1000), float(r["echo2Gain"])
        self.target, self.max_gain = float(r["normalizationTarget"]), float(r["normalizationMaxGain"])
        self.phase = self.tphase = 0.0
        self.ps = 2 * math.pi * self.mhz / SAMPLE_RATE
        self.tps = 2 * math.pi * self.thz / SAMPLE_RATE
        self.delay = [0.0] * (max(self.e1, self.e2, 1) + 1)
        self.pos = 0
        self.gain = 1.0
        self.carry = b""

    def process(self, pcm):
        data = self.carry + bytes(pcm)
        size = len(data) // 2 * 2
        raw, self.carry = data[:size], data[size:]
        if not raw or not self.active:
            return raw
        samples = array("h")
        samples.frombytes(raw)
        if sys.byteorder != "little":
            samples.byteswap()
        wet = []
        for dry in map(float, samples):
            q = round(max(-32767, min(32767, dry * (self.base_gain + self.depth * math.sin(self.phase)))) / self.qstep) * self.qstep
            core = q * (1 - self.metallic_mix) + q * math.sin(self.tphase) * self.metallic_mix
            wet.append(core + self.delay[(self.pos - self.e1) % len(self.delay)] * self.g1 + self.delay[(self.pos - self.e2) % len(self.delay)] * self.g2)
            self.delay[self.pos] = core
            self.pos = (self.pos + 1) % len(self.delay)
            self.phase = (self.phase + self.ps) % (2 * math.pi)
            self.tphase = (self.tphase + self.tps) % (2 * math.pi)
        peak = max(map(abs, wet), default=0)
        target = min(self.max_gain, self.target / peak) if peak >= 64 else 1
        self.gain += (target - self.gain) * (0.35 if target < self.gain else 0.10)
        output = array("h")
        for dry, value in zip(samples, wet):
            output.append(_clamp(dry * (1 - self.mix) + value * self.gain * self.mix))
        if sys.byteorder != "little":
            output.byteswap()
        return output.tobytes()


def apply_prisma_dsp_full_pcm(pcm, config):
    dsp = PrismaStreamingDSP(config)
    size = FULL_PCM_BLOCK_SAMPLES * SAMPLE_WIDTH
    return b"".join(dsp.process(pcm[start:start + size]) for start in range(0, len(pcm), size))
