import json
import os
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path

from . import douyin

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
DOWNLOAD_DIR = ROOT / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

YTDLP = str(TOOLS / "yt-dlp.exe") if os.name == "nt" else "yt-dlp"
FFMPEG_LOCATION = str(TOOLS)

FILE_TTL_SECONDS = 3600
MAX_CONCURRENT = 3
PARSE_TIMEOUT = 90

_semaphore = threading.Semaphore(MAX_CONCURRENT)
tasks = {}
stats = {"date": "", "downloads": 0}
_quota = {}
FREE_DAILY_LIMIT = int(os.environ.get("FREE_DAILY_LIMIT", "5"))

_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def _child_env():
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _run(args, timeout=None):
    return subprocess.run(
        [YTDLP, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env=_child_env(),
        creationflags=_CREATE_NO_WINDOW,
    )


def validate_url(url):
    from urllib.parse import urlparse

    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.netloc:
        raise ValueError("链接看起来不太对，粘贴完整的视频链接试试")
    return url.strip()


def _friendly_error(stderr):
    lines = [l.strip() for l in (stderr or "").splitlines() if l.strip()]
    err = next((l for l in lines if l.startswith("ERROR")), lines[-1] if lines else "")
    err = re.sub(r"^ERROR:\s*", "", err)
    if "Unsupported URL" in err:
        return "这个链接暂时不支持，换个平台或链接试试"
    if "Video unavailable" in err or "not available" in err:
        return "视频不存在或已被删除"
    if "login" in err.lower() or "cookies" in err.lower() or "account" in err.lower():
        return "这个视频需要登录才能获取，暂时下不了"
    if "timed out" in err.lower() or "Network" in err:
        return "网络开小差了，稍后再试一次"
    if "max-filesize" in err or "larger than" in err:
        return "这个视频文件太大啦，超出了当前能下载的大小"
    return "解析失败了，换个链接试试"


def _build_choices(formats):
    heights = sorted(
        {f.get("height") for f in formats if f.get("height") and f.get("vcodec") not in (None, "none")},
        reverse=True,
    )
    choices = []
    for h in heights:
        if h < 240:
            continue
        size = 0
        for f in formats:
            if f.get("height") == h and f.get("vcodec") not in (None, "none"):
                size = max(size, f.get("filesize") or f.get("filesize_approx") or 0)
        choices.append({"id": str(h), "label": f"{h}P", "height": h, "approx_size": size or None})
    choices.append({"id": "audio", "label": "仅音频 MP3", "height": 0, "approx_size": None})
    return choices


def parse(url):
    url = validate_url(url)
    if douyin.is_douyin(url):
        return douyin.parse(url)
    args = ["-J", "--flat-playlist", "--no-warnings"]
    cookie_file = TOOLS / "douyin_cookies.txt"
    if "douyin.com" in url and cookie_file.exists():
        args += ["--cookies", str(cookie_file)]
    try:
        proc = _run([*args, "--", url], timeout=PARSE_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise ValueError("解析超时了，稍后再试一次")
    if proc.returncode != 0:
        raise ValueError(_friendly_error(proc.stderr))
    info = json.loads(proc.stdout)

    if info.get("_type") == "playlist":
        entries = []
        for e in (info.get("entries") or [])[:50]:
            entries.append({
                "title": e.get("title") or e.get("id"),
                "url": e.get("url") or e.get("webpage_url") or e.get("id"),
                "duration": e.get("duration"),
            })
        if not entries:
            raise ValueError("这个合集是空的，或者需要登录才能看到内容")
        total = len(info.get("entries") or [])
        return {"type": "playlist", "title": info.get("title"), "entries": entries,
                "total": total, "truncated": total > 50}

    return {
        "type": "video",
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader"),
        "webpage_url": info.get("webpage_url") or url,
        "choices": _build_choices(info.get("formats") or []),
        "subtitles": sorted((info.get("subtitles") or {}).keys()),
    }


def _selector(choice_id):
    if choice_id == "audio":
        return "ba/b"
    if choice_id == "best":
        return "bv*+ba/b"
    if not re.fullmatch(r"\d{3,4}", choice_id):
        raise ValueError("清晰度选项不对")
    h = int(choice_id)
    return f"bv*[height<={h}]+ba/b[height<={h}]/b"


def check_quota(ip):
    today = time.strftime("%Y-%m-%d")
    rec = _quota.get(ip)
    if not rec or rec["date"] != today:
        rec = {"date": today, "count": 0}
        _quota[ip] = rec
    return max(0, FREE_DAILY_LIMIT - rec["count"])


def _use_quota(ip):
    today = time.strftime("%Y-%m-%d")
    rec = _quota.setdefault(ip, {"date": today, "count": 0})
    if rec["date"] != today:
        rec.update(date=today, count=0)
    rec["count"] += 1
    if stats["date"] != today:
        stats.update(date=today, downloads=0)
    stats["downloads"] += 1


def start_download(url, choice_id, title, ip, subtitle_lang=None):
    url = validate_url(url)
    selector = _selector(choice_id)
    if check_quota(ip) <= 0:
        raise PermissionError("今天的免费次数用完啦，明天再来，或开通会员畅享下载")

    task_id = uuid.uuid4().hex[:12]
    task = {
        "id": task_id,
        "status": "queued",
        "percent": 0,
        "speed": None,
        "title": title or "video",
        "filepath": None,
        "error": None,
        "created": time.time(),
    }
    tasks[task_id] = task
    _use_quota(ip)

    if douyin.is_douyin(url):
        if choice_id not in ("best", "audio"):
            choice_id = "best"
        threading.Thread(
            target=douyin.download_into,
            args=(task, url, choice_id, DOWNLOAD_DIR, _semaphore),
            daemon=True,
        ).start()
        return task_id

    args = [
        "-f", selector,
        "-S", "vcodec:h264",
        "--ffmpeg-location", FFMPEG_LOCATION,
        "--no-playlist",
        "--windows-filenames",
        "--trim-filenames", "80",
        "--newline",
        "--no-warnings",
        "--no-quiet",
        "--no-simulate",
        "--max-filesize", os.environ.get("MAX_FILESIZE", "500M"),
        "--print", "after_move:filepath",
        "--progress-template",
        "download:@PROG@%(progress.downloaded_bytes)s,%(progress.total_bytes)s,%(progress.total_bytes_estimate)s,%(progress.speed)s",
        "-o", str(DOWNLOAD_DIR / f"{task_id}.%(ext)s"),
    ]
    if choice_id == "audio":
        args += ["-x", "--audio-format", "mp3"]
    else:
        args += ["--merge-output-format", "mp4"]
    cookie_file = TOOLS / "douyin_cookies.txt"
    if "douyin.com" in url and cookie_file.exists():
        args += ["--cookies", str(cookie_file)]
    if subtitle_lang and re.fullmatch(r"[\w-]{1,20}", subtitle_lang):
        args += ["--write-subs", "--sub-langs", subtitle_lang]
    args += ["--", url]

    threading.Thread(target=_run_task, args=(task, args), daemon=True).start()
    return task_id


def _run_task(task, args):
    with _semaphore:
        task["status"] = "downloading"
        try:
            proc = subprocess.Popen(
                [YTDLP, *args],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=_child_env(),
                creationflags=_CREATE_NO_WINDOW,
            )
        except OSError:
            task.update(status="error", error="下载引擎没准备好，联系站长看看")
            return

        filepath = None
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("@PROG@"):
                parts = line[6:].split(",")
                try:
                    done = float(parts[0])
                    total = float(parts[1]) if parts[1] not in ("NA", "") else float(parts[2])
                    if total > 0:
                        task["percent"] = min(99, round(done / total * 100))
                    if parts[3] not in ("NA", ""):
                        task["speed"] = float(parts[3])
                except (ValueError, IndexError):
                    pass
            elif line.startswith(str(DOWNLOAD_DIR)):
                filepath = line
        proc.wait()
        stderr = proc.stderr.read()

        if proc.returncode != 0:
            task.update(status="error", error=_friendly_error(stderr))
            return
        if not filepath or not Path(filepath).exists():
            matches = sorted(DOWNLOAD_DIR.glob(f"{task['id']}.*"), key=lambda p: p.stat().st_mtime)
            matches = [p for p in matches if not p.name.endswith((".part", ".ytdl"))]
            if not matches:
                task.update(status="error", error="下载完成了但文件没找到，再试一次")
                return
            filepath = str(matches[-1])
        task.update(status="done", percent=100, filepath=filepath)


def cleanup_loop():
    while True:
        now = time.time()
        for tid in list(tasks):
            t = tasks.get(tid)
            if t and now - t["created"] > FILE_TTL_SECONDS:
                fp = t.get("filepath")
                if fp:
                    try:
                        Path(fp).unlink(missing_ok=True)
                    except OSError:
                        pass
                tasks.pop(tid, None)
        for p in DOWNLOAD_DIR.iterdir():
            try:
                if now - p.stat().st_mtime > FILE_TTL_SECONDS:
                    p.unlink(missing_ok=True)
            except OSError:
                pass
        time.sleep(300)