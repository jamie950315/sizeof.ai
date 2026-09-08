from pathlib import Path
import tempfile
import unittest

from .status import record_status, read_status


class StatusTests(unittest.TestCase):
    def test_failure_and_recovery_do_not_store_exception_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'models.sqlite')
            self.assertIsNone(read_status(path, 'replica'))
            record_status(path, 'replica', OSError('secret-token'))
            status = read_status(path, 'replica')
            self.assertFalse(status['ok'])
            self.assertEqual(status['errorType'], 'OSError')
            self.assertNotIn('secret-token', (Path(directory) / 'replica-status.json').read_text())
            record_status(path, 'replica')
            self.assertTrue(read_status(path, 'replica')['ok'])
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_invalid_status_is_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'models.sqlite')
            for contents in ('broken', '[]', '{"ok":"yes"}'):
                (Path(directory) / 'replica-status.json').write_text(contents)
                self.assertFalse(read_status(path, 'replica')['ok'])
