import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from terminal_app.audio.youtube import TerminalYoutubeAudioPlayer, download_youtube_audio
from terminal_app.domain.content import normalize_grammar_notes, normalize_reading_tests, normalize_records, normalize_youtube_subtitles
from terminal_app.domain.models import YoutubeSubtitle


class FakeRunner:
    def __init__(self):
        self.commands = []
        self.process = FakeProcess()

    def which(self, command):
        return f'/fake/{command}'

    def run(self, command, **_kwargs):
        self.commands.append(command)
        if len(self.commands) == 1:
            return SimpleNamespace(returncode=1, stderr='HTTP Error 403: Forbidden')
        output = Path(command[command.index('--output') + 1].replace('%(ext)s', 'mp3'))
        output.write_bytes(b'audio')
        return SimpleNamespace(returncode=0, stderr='')

    def popen(self, command, **_kwargs):
        self.commands.append(command)
        return self.process


class FakeProcess:
    def __init__(self):
        self.running = True
        self.signals = []
        self.terminated = False

    def poll(self):
        return None if self.running else 0

    def send_signal(self, value):
        self.signals.append(value)

    def terminate(self):
        self.terminated = True
        self.running = False

    def wait(self, timeout):
        return 0

    def kill(self):
        self.running = False


class TerminalDomainAudioTests(unittest.TestCase):
    def test_domain_modules_do_not_import_ui_network_audio_or_cache(self):
        domain_dir = Path(__file__).parents[1] / 'terminal_app' / 'domain'
        source = '\n'.join(path.read_text(encoding='utf-8') for path in domain_dir.glob('*.py'))
        for forbidden in ('import curses', 'import subprocess', 'urllib', 'terminal_app.audio', 'terminal_app.sync'):
            self.assertNotIn(forbidden, source)

    def test_content_normalizers_are_deterministic_without_io(self):
        records = [{
            'id': 'word', 'date': '2026-09-16', 'order': 2,
            'item': {'ko': '단어', 'meanings': [{'zh': '單字', 'examples': [{'ko': '단어예요.', 'zh': '是單字。'}]}]},
        }]
        cards, questions = normalize_records(records, {'starred': ['word']})
        self.assertEqual((cards[0].ko, cards[0].is_starred), ('단어', True))
        self.assertEqual([question.kind for question in questions], ['term', 'example'])
        self.assertEqual(normalize_grammar_notes([{'id': 'n', 'title': '標題'}])[0].category, 'grammar')
        self.assertEqual(normalize_youtube_subtitles([{'id': 's', 'title': '字幕', 'mode': 'srt'}])[0].mode, 'srt')

    def test_reading_tests_normalize_valid_questions_and_ignore_incomplete_records(self):
        tests = normalize_reading_tests([
            {
                'id': 'reading',
                'passage': {'ko': '한국어 글', 'zh': '韓文文章'},
                'question': {'ko': '고르십시오.', 'zh': '請選擇。'},
                'options': [
                    {'id': '1', 'ko': '첫째', 'zh': '第一'},
                    {'id': '2', 'ko': '둘째', 'zh': '第二'},
                ],
                'answer': '2',
                'learned': True,
            },
            {'id': 'invalid', 'passage': {'ko': '缺少其餘欄位'}},
        ])
        self.assertEqual(len(tests), 1)
        self.assertEqual(tests[0].answer, '2')
        self.assertTrue(tests[0].learned)

    def test_youtube_downloader_uses_fallback_after_403(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = FakeRunner()
            subtitle = YoutubeSubtitle('id', 'title', 'https://youtu.be/test', 'srt', [], '', '')
            path, message = download_youtube_audio(subtitle, Path(directory), runner)
            self.assertTrue(path.exists())
            self.assertEqual(len(runner.commands), 2)
            self.assertIn('備援策略 2', message)

    def test_audio_player_seek_pause_resume_and_cleanup_use_adapter(self):
        runner = FakeRunner()
        times = iter([10.0, 12.5, 13.0, 20.0])
        player = TerminalYoutubeAudioPlayer(Path('/tmp/audio.mp3'), runner=runner, clock=lambda: next(times))
        self.assertTrue(player.play_from(30))
        self.assertAlmostEqual(player.position(), 32.5)
        self.assertTrue(player.pause())
        self.assertTrue(player.resume())
        player.stop()
        self.assertTrue(runner.process.terminated)


if __name__ == '__main__':
    unittest.main()
