import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class ConfigTests(unittest.TestCase):
    def test_api_keys_are_trimmed_from_environment(self):
        config_module = importlib.import_module("src.config")

        with patch.dict(
            os.environ,
            {
                "OPEN_AI_API_KEY": " openai-key \n",
                "GEMINI_API_KEY": " gemini-key\n",
            },
            clear=False,
        ):
            config_module = importlib.reload(config_module)

            self.assertEqual(config_module.OPENAI_KEY, "openai-key")
            self.assertEqual(config_module.GEMINI_KEY, "gemini-key")
            self.assertEqual(config_module.config.OPENAI_API_KEY, "openai-key")
            self.assertEqual(config_module.config.GEMINI_API_KEY, "gemini-key")

        importlib.reload(config_module)

    def test_worker_poller_threads_is_clamped_to_at_least_one(self):
        config_module = importlib.import_module("src.config")

        with patch.dict(os.environ, {"WORKER_POLLER_THREADS": "0"}, clear=False):
            config_module = importlib.reload(config_module)

            self.assertEqual(config_module.config.POLLER_THREADS, 1)
            self.assertGreaterEqual(config_module.config.DB_POOL_MAXCONN, 5)

        importlib.reload(config_module)


if __name__ == "__main__":
    unittest.main()
