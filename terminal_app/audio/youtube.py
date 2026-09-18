import hashlib
import os
import re
import shutil
import signal
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, List, Optional, Tuple

from terminal_app.domain.models import YoutubeSubtitle


class CommandRunner:
    def which(self, command: str) -> Optional[str]:
        return shutil.which(command)

    def run(self, command: List[str], **kwargs):
        return subprocess.run(command, **kwargs)

    def popen(self, command: List[str], **kwargs):
        return subprocess.Popen(command, **kwargs)


def youtube_audio_cache_path(subtitle: YoutubeSubtitle, cache_dir: Path) -> Path:
    url_hash = hashlib.sha256(subtitle.youtube_url.encode("utf-8")).hexdigest()[:16]
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", subtitle.id).strip("-.") or "subtitle"
    return cache_dir / "youtube-audio" / f"{safe_id}-{url_hash}.mp3"


def youtube_audio_download_profiles() -> List[List[str]]:
    return [
        [],
        ["--format", "bestaudio[ext=m4a]/bestaudio/best"],
    ]


def youtube_auth_options() -> Tuple[List[str], Optional[str]]:
    browser = os.getenv("TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER", "").strip()
    cookie_file = os.getenv("TERMINAL_YOUTUBE_COOKIES_FILE", "").strip()
    if browser and cookie_file:
        return [], "請只設定 TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER 或 TERMINAL_YOUTUBE_COOKIES_FILE 其中一種。"
    if browser:
        return ["--cookies-from-browser", browser], None
    if cookie_file:
        path = Path(cookie_file).expanduser()
        if not path.is_file():
            return [], "找不到 TERMINAL_YOUTUBE_COOKIES_FILE 指定的 cookie 檔案。"
        return ["--cookies", str(path)], None
    return [], None


def youtube_login_required(error: str) -> bool:
    return "sign in to confirm you" in error.lower() or "login_required" in error.lower()


def download_youtube_audio(
    subtitle: YoutubeSubtitle,
    cache_dir: Path,
    runner: Optional[CommandRunner] = None,
) -> Tuple[Optional[Path], str]:
    runner = runner or CommandRunner()
    if not subtitle.youtube_url:
        return None, "這篇字幕沒有 YouTube 連結。"
    audio_path = youtube_audio_cache_path(subtitle, cache_dir)
    if audio_path.exists() and audio_path.stat().st_size > 0:
        return audio_path, "已載入快取的 YouTube 原音。"
    yt_dlp = runner.which("yt-dlp")
    if not yt_dlp:
        return None, "缺少 yt-dlp，請執行 python3 -m pip install -r requirements-terminal.txt。"
    if not runner.which("ffmpeg"):
        return None, "缺少 ffmpeg，無法將 YouTube 音訊轉成 MP3。"
    js_runtime = "deno" if runner.which("deno") else "node" if runner.which("node") else None
    if not js_runtime:
        return None, "缺少 Deno 或 Node.js，yt-dlp 無法解析 YouTube 音訊格式。請先安裝其中一種。"
    auth_options, auth_error = youtube_auth_options()
    if auth_error:
        return None, auth_error

    audio_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_dir = audio_path.parent / f".{audio_path.stem}-{uuid.uuid4().hex}"
    temporary_dir.mkdir(parents=True, exist_ok=True)
    try:
        errors: List[str] = []
        for attempt_index, profile in enumerate(youtube_audio_download_profiles(), start=1):
            attempt_dir = temporary_dir / f"attempt-{attempt_index}"
            attempt_dir.mkdir(parents=True, exist_ok=True)
            result = runner.run([
                yt_dlp, "--ignore-config", "--no-playlist", "--no-progress", "--retries", "3", "--fragment-retries", "3",
                "--js-runtimes", js_runtime, "--remote-components", "ejs:github",
                "--extract-audio", "--audio-format", "mp3", "--audio-quality", "5",
                "--output", str(attempt_dir / "audio.%(ext)s"), *auth_options, *profile, subtitle.youtube_url,
            ], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=300)
            generated = attempt_dir / "audio.mp3"
            if result.returncode == 0 and generated.exists() and generated.stat().st_size > 0:
                os.replace(generated, audio_path)
                strategy = "" if attempt_index == 1 else f"（使用備援策略 {attempt_index}）"
                return audio_path, f"YouTube 原音已下載並快取{strategy}。"
            lines = [line.strip() for line in (result.stderr or "").splitlines() if line.strip()]
            errors.append(lines[-1] if lines else f"策略 {attempt_index} 未產生音訊檔案")
            if youtube_login_required(result.stderr or ""):
                if auth_options:
                    return None, "YouTube 仍要求登入；請確認指定瀏覽器已登入 YouTube，或更新 cookie 檔案後重試。"
                return None, (
                    "YouTube 要求登入驗證。請在 .env 設定 "
                    "TERMINAL_YOUTUBE_COOKIES_FROM_BROWSER=chrome（或 firefox），"
                    "也可設定 TERMINAL_YOUTUBE_COOKIES_FILE 指向 Netscape 格式 cookie 檔；"
                    "重新啟動 Terminal 後再試。"
                )
        detail = errors[-1] if errors else "yt-dlp 未產生音訊檔案"
        return None, f"YouTube 音訊下載失敗：{detail}。請更新 yt-dlp；若仍顯示格式不可用，請確認 YouTube cookie 仍有效。"
    except subprocess.TimeoutExpired:
        return None, "YouTube 音訊下載逾時，請稍後再試。"
    except OSError as exc:
        return None, f"YouTube 音訊下載失敗：{exc}"
    finally:
        shutil.rmtree(temporary_dir, ignore_errors=True)


class TerminalYoutubeAudioPlayer:
    def __init__(self, audio_path: Path, runner: Optional[CommandRunner] = None, clock=time.monotonic) -> None:
        self.audio_path = audio_path
        self.runner = runner or CommandRunner()
        self.clock = clock
        self.process: Optional[Any] = None
        self.base_position = 0.0
        self.started_at: Optional[float] = None
        self.paused = True

    @staticmethod
    def available() -> bool:
        runner = CommandRunner()
        return bool(runner.which("ffplay") or runner.which("cvlc"))

    def _command(self, position: float) -> Optional[List[str]]:
        if self.runner.which("ffplay"):
            return ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", "-ss", f"{position:.3f}", str(self.audio_path)]
        if self.runner.which("cvlc"):
            return ["cvlc", "--intf", "dummy", "--no-video", "--play-and-exit", "--quiet", f"--start-time={position:.3f}", str(self.audio_path)]
        return None

    def position(self) -> float:
        if self.started_at is None or self.paused:
            return self.base_position
        current = self.base_position + max(0.0, self.clock() - self.started_at)
        if self.process and self.process.poll() is not None:
            self.base_position, self.started_at, self.process, self.paused = current, None, None, True
        return current

    def play_from(self, position: float) -> bool:
        self.stop()
        self.base_position = max(0.0, float(position))
        command = self._command(self.base_position)
        if not command:
            return False
        try:
            self.process = self.runner.popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            self.process = None
            return False
        self.started_at, self.paused = self.clock(), False
        return True

    def pause(self) -> bool:
        if not self.process or self.process.poll() is not None or self.paused:
            return False
        self.base_position = self.position()
        try:
            self.process.send_signal(signal.SIGSTOP)
        except OSError:
            return False
        self.started_at, self.paused = None, True
        return True

    def resume(self) -> bool:
        if self.process and self.process.poll() is None and self.paused:
            try:
                self.process.send_signal(signal.SIGCONT)
            except OSError:
                return False
            self.started_at, self.paused = self.clock(), False
            return True
        return self.play_from(self.base_position)

    def toggle(self) -> bool:
        return self.resume() if self.paused else self.pause()

    def stop(self) -> None:
        process = self.process
        if not process:
            return
        if process.poll() is None:
            try:
                if self.paused:
                    process.send_signal(signal.SIGCONT)
                process.terminate()
                process.wait(timeout=1)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                except OSError:
                    pass
        self.process, self.started_at, self.paused = None, None, True
