import shutil
import subprocess
import threading
from pathlib import Path
from typing import Callable, List, Optional


class InterruptibleSpeechRunner:
    """Run one speech job in the background and allow terminal input to cancel it."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._generation = 0
        self._process: Optional[subprocess.Popen] = None
        self._thread: Optional[threading.Thread] = None

    def start(self, job: Callable[[int], None]) -> None:
        self.stop()
        with self._lock:
            generation = self._generation
            thread = threading.Thread(
                target=self._run_job,
                args=(job, generation),
                name="terminal-korean-speech",
                daemon=True,
            )
            self._thread = thread
            thread.start()

    def stop(self) -> None:
        with self._lock:
            self._generation += 1
            process = self._process
            self._process = None
        self._terminate(process)

    def is_playing(self) -> bool:
        with self._lock:
            return bool(self._thread and self._thread.is_alive())

    def is_current(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation

    def run_process(self, command: List[str], generation: int, timeout: int) -> Optional[bool]:
        if not self.is_current(generation):
            return None
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            return False
        with self._lock:
            if generation != self._generation:
                self._terminate(process)
                return None
            self._process = process
        try:
            return process.wait(timeout=timeout) == 0
        except subprocess.TimeoutExpired:
            self._terminate(process)
            return False
        finally:
            with self._lock:
                if self._process is process:
                    self._process = None

    def _run_job(self, job: Callable[[int], None], generation: int) -> None:
        try:
            job(generation)
        except Exception:
            # Background audio failures must not corrupt the curses screen with a traceback.
            return
        finally:
            with self._lock:
                if self._thread is threading.current_thread():
                    self._thread = None

    @staticmethod
    def _terminate(process: Optional[subprocess.Popen]) -> None:
        if process is None or process.poll() is not None:
            return
        try:
            process.terminate()
            process.wait(timeout=0.25)
        except (OSError, subprocess.TimeoutExpired):
            try:
                process.kill()
            except OSError:
                pass


def korean_speech_commands(text: str) -> List[List[str]]:
    commands: List[List[str]] = []
    if shutil.which("spd-say"):
        commands.append(["spd-say", "--wait", "--language", "ko", "--rate", "-10", text])
    if shutil.which("espeak-ng"):
        commands.append(["espeak-ng", "-v", "ko", "-s", "145", text])
    elif shutil.which("espeak"):
        commands.append(["espeak", "-v", "ko", "-s", "145", text])
    return commands


def korean_audio_players(audio_path: Path) -> List[List[str]]:
    commands: List[List[str]] = []
    if shutil.which("cvlc"):
        commands.append(["cvlc", "--intf", "dummy", "--play-and-exit", "--no-video", "--quiet", str(audio_path)])
    if shutil.which("ffplay"):
        commands.append(["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", str(audio_path)])
    return commands
