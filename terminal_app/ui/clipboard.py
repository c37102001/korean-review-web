import shutil
import subprocess


def copy_to_clipboard(text: str) -> bool:
    commands = (["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"], ["pbcopy"])
    for command in commands:
        if not shutil.which(command[0]):
            continue
        try:
            subprocess.run(command, input=text, text=True, check=True, timeout=3)
            return True
        except (OSError, subprocess.SubprocessError):
            continue
    return False
