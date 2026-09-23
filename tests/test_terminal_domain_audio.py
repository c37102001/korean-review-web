import curses
import os
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from terminal_app.audio.tts import InterruptibleSpeechRunner
from terminal_app.audio.youtube import TerminalYoutubeAudioPlayer, download_youtube_audio
from terminal_app.domain.content import normalize_grammar_notes, normalize_reading_tests, normalize_records, normalize_youtube_subtitles
from terminal_app.domain.models import YoutubeSubtitle
from terminal_app.runtime import is_auto_audio_enabled, set_auto_audio_enabled
from terminal_app.ui.curses_helpers import auto_audio_control_label, read_terminal_key


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


class LoginRequiredRunner(FakeRunner):
    def run(self, command, **_kwargs):
        self.commands.append(command)
        return SimpleNamespace(returncode=1, stderr="ERROR: [youtube] Sign in to confirm you’re not a bot. Use --cookies-from-browser")


class MissingJavascriptRunner(FakeRunner):
    def which(self, command):
        return None if command in ('deno', 'node') else super().which(command)


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


class FakeTerminalScreen:
    def __init__(self, key):
        self.key = key
        self.lines = []

    def getch(self):
        return self.key

    def getmaxyx(self):
        return (24, 100)

    def addstr(self, y, x, text, attr):
        self.lines.append((y, x, text, attr))

    def refresh(self):
        return None


class BlockingSpeechProcess(FakeProcess):
    def __init__(self):
        super().__init__()
        self.wait_started = threading.Event()

    def wait(self, timeout):
        self.wait_started.set()
        if self.running:
            raise subprocess.TimeoutExpired('speech', timeout)
        return 0


class HiddenTerminalScreen:
    def __init__(self, keys):
        self.keys = iter(keys)
        self.erase_count = 0
        self.timeout_values = []

    def get_wch(self):
        return next(self.keys)

    def timeout(self, value):
        self.timeout_values.append(value)

    def attrset(self, _value):
        return None

    def bkgdset(self, *_args):
        return None

    def erase(self):
        self.erase_count += 1

    def refresh(self):
        return None


class TerminalDomainAudioTests(unittest.TestCase):
    def tearDown(self):
        set_auto_audio_enabled(True)

    def test_dot_key_toggles_the_shared_audio_state_used_by_every_screen(self):
        set_auto_audio_enabled(True)
        screen = FakeTerminalScreen(ord('.'))
        with patch('terminal_app.ui.curses_helpers.time.sleep'):
            read_terminal_key(screen)

        self.assertFalse(is_auto_audio_enabled())
        self.assertIn('自動語音:關', auto_audio_control_label())
        self.assertTrue(any('自動播放語音：關閉' in line[2] for line in screen.lines))

    def test_any_terminal_key_stops_active_speech_before_it_is_handled(self):
        screen = FakeTerminalScreen(ord('6'))
        with patch('terminal_app.ui.curses_helpers.stop_korean_speech') as stop:
            key = read_terminal_key(screen)

        self.assertEqual(key, ord('6'))
        stop.assert_called_once_with()

    def test_interruptible_speech_runs_in_background_and_terminates_immediately(self):
        process = BlockingSpeechProcess()
        runner = InterruptibleSpeechRunner()

        with patch('terminal_app.audio.tts.subprocess.Popen', return_value=process):
            started_at = time.monotonic()
            runner.start(lambda generation: runner.run_process(['player'], generation, 20))
            self.assertLess(time.monotonic() - started_at, 0.25)
            self.assertTrue(process.wait_started.wait(timeout=1))
            runner.stop()

        self.assertTrue(process.terminated)
        deadline = time.monotonic() + 1
        while runner.is_playing() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(runner.is_playing())

    def test_three_hides_everything_and_swallows_keys_until_three_is_pressed_again(self):
        screen = HiddenTerminalScreen(['3', '6', 'x', '3'])
        key = read_terminal_key(screen, wide=True)

        self.assertEqual(key, curses.KEY_RESIZE)
        self.assertEqual(screen.erase_count, 3)
        self.assertEqual(screen.timeout_values, [-1])

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
            with patch.dict(os.environ, {
                'TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER': '', 'TERMINAL_YOUTUBE_COOKIES_FILE': '',
            }):
                path, message = download_youtube_audio(subtitle, Path(directory), runner)
            self.assertTrue(path.exists())
            self.assertEqual(len(runner.commands), 2)
            self.assertIn('備援策略 2', message)
            for command in runner.commands:
                self.assertEqual(command[command.index('--js-runtimes') + 1], 'deno')
                self.assertEqual(command[command.index('--remote-components') + 1], 'ejs:github')
                self.assertIn('--ignore-config', command)

    def test_youtube_downloader_requires_a_javascript_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MissingJavascriptRunner()
            subtitle = YoutubeSubtitle('id', 'title', 'https://youtu.be/test', 'srt', [], '', '')
            path, message = download_youtube_audio(subtitle, Path(directory), runner)
            self.assertIsNone(path)
            self.assertIn('Deno 或 Node.js', message)
            self.assertEqual(runner.commands, [])

    def test_youtube_login_error_stops_retries_and_explains_cookie_setup(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = LoginRequiredRunner()
            subtitle = YoutubeSubtitle('id', 'title', 'https://youtu.be/test', 'srt', [], '', '')
            with patch.dict(os.environ, {
                'TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER': '', 'TERMINAL_YOUTUBE_COOKIES_FILE': '',
            }):
                path, message = download_youtube_audio(subtitle, Path(directory), runner)
            self.assertIsNone(path)
            self.assertEqual(len(runner.commands), 1)
            self.assertIn('TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER=chrome', message)

    def test_youtube_browser_auth_is_passed_to_downloader(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = FakeRunner()
            subtitle = YoutubeSubtitle('id', 'title', 'https://youtu.be/test', 'srt', [], '', '')
            with patch.dict(os.environ, {
                'TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER': 'chrome', 'TERMINAL_YOUTUBE_COOKIES_FILE': '',
            }):
                path, _ = download_youtube_audio(subtitle, Path(directory), runner)
            self.assertTrue(path.exists())
            self.assertTrue(all(command[command.index('--cookies-from-browser') + 1] == 'chrome' for command in runner.commands))

    def test_youtube_cookie_file_is_used_without_exporting_it(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie_file = Path(directory) / 'cookies.txt'
            cookie_file.write_text('# Netscape HTTP Cookie File\n', encoding='utf-8')
            runner = FakeRunner()
            subtitle = YoutubeSubtitle('id', 'title', 'https://youtu.be/test', 'srt', [], '', '')
            with patch.dict(os.environ, {
                'TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER': '', 'TERMINAL_YOUTUBE_COOKIES_FILE': str(cookie_file),
            }):
                path, _ = download_youtube_audio(subtitle, Path(directory), runner)
            self.assertTrue(path.exists())
            self.assertTrue(all(command[command.index('--cookies') + 1] == str(cookie_file) for command in runner.commands))

    def test_youtube_conflicting_cookie_sources_fail_before_download(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = FakeRunner()
            subtitle = YoutubeSubtitle('id', 'title', 'https://youtu.be/test', 'srt', [], '', '')
            with patch.dict(os.environ, {
                'TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER': 'chrome', 'TERMINAL_YOUTUBE_COOKIES_FILE': 'cookies.txt',
            }):
                path, message = download_youtube_audio(subtitle, Path(directory), runner)
            self.assertIsNone(path)
            self.assertIn('其中一種', message)
            self.assertEqual(runner.commands, [])

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
