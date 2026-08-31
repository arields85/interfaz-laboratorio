import struct
import unittest

from prisma_runtime import voice_dsp as dsp


CONFIG = {"effectEnabled": True, "preset": "robotic_medium_light", "effectIntensity": 100, "robotic": {"modulationHz": 30, "baseGain": 0.78, "modulationDepth": 0.22, "quantizationSteps": 260, "metallicHz": 410, "metallicMix": 0.04, "echo1DelayMs": 40, "echo1Gain": 0.22, "echo2DelayMs": 95, "echo2Gain": 0.10, "normalizationTarget": 29500, "normalizationMaxGain": 1.6}}


class VoiceDspTests(unittest.TestCase):
    def test_clean_snapshot_preserves_pcm_and_carries_odd_bytes(self) -> None:
        clean = dict(CONFIG, effectEnabled=False)
        processor = dsp.PrismaStreamingDSP(clean)
        pcm = struct.pack("<hh", 1000, -1000)
        self.assertEqual(processor.process(pcm[:3]), pcm[:2])
        self.assertEqual(processor.process(pcm[3:]), pcm[2:])

    def test_stream_and_full_file_use_the_same_algorithm(self) -> None:
        pcm = struct.pack("<" + "h" * 2400, *([1000, -700] * 1200))
        streamed = dsp.PrismaStreamingDSP(CONFIG).process(pcm)
        full = dsp.apply_prisma_dsp_full_pcm(pcm, CONFIG)
        self.assertEqual(len(streamed), len(full))
        self.assertNotEqual(streamed, pcm)
        self.assertNotEqual(full, pcm)

    def test_full_file_boundary_is_1800_samples(self) -> None:
        self.assertEqual(dsp.FULL_PCM_BLOCK_SAMPLES, 1800)
        pcm = struct.pack("<" + "h" * 1801, *([500] * 1801))
        self.assertEqual(len(dsp.apply_prisma_dsp_full_pcm(pcm, CONFIG)), len(pcm))


if __name__ == "__main__":
    unittest.main()
