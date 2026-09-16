import shutil
from pathlib import Path
from typing import List


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
