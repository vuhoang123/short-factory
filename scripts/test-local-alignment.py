"""Small dependency-free regression checks for bounded DTW timing normalization."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("local_tts", Path(__file__).with_name("local-tts-server.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class AlignmentTests(unittest.TestCase):
    def test_keeps_good_model_anchors(self):
        words = [{"text": "Xin", "startMs": 100, "endMs": 300}, {"text": "chào", "startMs": 320, "endMs": 600}]
        self.assertEqual(bridge.normalize_word_timings(words, 700), (words, 0))

    def test_repairs_zero_width_cell_within_local_model_anchors(self):
        words = [{"text": "các", "startMs": 100, "endMs": 100}, {"text": "con", "startMs": 100, "endMs": 400}]
        result, count = bridge.normalize_word_timings(words, 500)
        self.assertEqual(count, 2)
        self.assertEqual([(word["startMs"], word["endMs"]) for word in result], [(100, 120), (120, 400)])
        self.assertEqual(words[0]["endMs"], 100)

    def test_repairs_final_cell_without_exceeding_audio(self):
        words = [{"text": "xin", "startMs": 0, "endMs": 500}, {"text": "chào", "startMs": 500, "endMs": 500}]
        result, _ = bridge.normalize_word_timings(words, 500)
        self.assertEqual(result[-1]["endMs"], 500)
        self.assertEqual(result[-1]["startMs"], 480)
        self.assertEqual(result[0]["endMs"], 480)

    def test_refuses_large_uncertain_region_or_inadequate_audio(self):
        words = [{"text": str(index), "startMs": 0, "endMs": 0} for index in range(5)]
        with self.assertRaises(ValueError):
            bridge.normalize_word_timings(words, 1000)
        with self.assertRaises(ValueError):
            bridge.normalize_word_timings(words[:1], 5)


if __name__ == "__main__":
    unittest.main()
