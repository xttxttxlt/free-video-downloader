"""Douyin-specific parser/downloader.

Adapted from rathodpratham-dev/douyin_video_downloader (MIT License).
Enhanced with a server-generated guest ttwid cookie so the share page
reliably returns SSR data without any user login or user cookies.
"""
import base64
import json
import os
import re
import subprocess
import time
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import requests

FFMPEG = str(Path(__file__).resolve().parent.parent / "tools" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg"))
_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
)
HEADERS = {"User-Agent": MOBILE_UA, "Accept-Language": "zh-CN,zh;q=0.9", "Referer": "https://www.douyin.com/"}

_ttwid_cache = {"value": None, "ts": 0}


def is_douyin(url):
    return any(h in url for h in ("douyin.com", "iesdouyin.com"))


def _guest_ttwid():
    if _ttwid_cache["value"] and time.time() - _ttwid_cache["ts"] < 6 * 3600:
        return _ttwid_cache["value"]
    body = {"region": "cn", "aid": 1768, "needFid": False, "service": "www.ixigua.com",
            "migrate_info": {"ticket": "", "source": "node"}, "cbUrlProtocol": "https", "union": True}
    r = requests.post("https://ttwid.bytedance.com/ttwid/union/register/", json=body, timeout=20)
    val = r.cookies.get("ttwid")
    if not val:
        raise ValueError("抖音服务暂时连不上，稍后再试")
    _ttwid_cache.update(value=val, ts=time.time())
    return val


def _session():
    s = requests.Session()
    s.headers.update(HEADERS)
    tt = _guest_ttwid()
    for d in (".douyin.com", ".iesdouyin.com", ".snssdk.com"):
        s.cookies.set("ttwid", tt, domain=d, path="/")
    return s


def extract_video_id(url):
    parsed = urlparse(url)
    q = parse_qs(parsed.query)
    for key in ("modal_id", "item_ids", "group_id", "aweme_id"):
        if q.get(key):
            m = re.search(r"(\d{8,24})", q[key][0])
            if m:
                return m.group(1)
    for pat in (r"/video/(\d{8,24})", r"/note/(\d{8,24})", r"/(\d{8,24})(?:/|$)"):
        m = re.search(pat, parsed.path)
        if m:
            return m.group(1)
    m = re.search(r"(?<!\d)(\d{8,24})(?!\d)", url)
    if m:
        return m.group(1)
    raise ValueError("没从这个链接里找到抖音视频，换完整的分享链接试试")


def _resolve_video_id(s, url):
    if "v.douyin.com" in url or "iesdouyin.com" not in url:
        try:
            r = s.get(url, timeout=(10, 30), allow_redirects=True)
            url = r.url or url
        except requests.RequestException:
            pass
    return extract_video_id(url)


def _router_data(html):
    m = re.search(r"window\._ROUTER_DATA\s*=\s*", html)
    if not m:
        return {}
    i = m.end()
    depth = 0
    in_str = False
    esc = False
    for c in range(i, len(html)):
        ch = html[c]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[i:c + 1])
                except ValueError:
                    return {}
    return {}


def _is_waf(html):
    return "Please wait..." in html and "wci=" in html and "cs=" in html


def _b64d(v):
    v = v.replace("-", "+").replace("_", "/")
    v += "=" * (-len(v) % 4)
    return base64.b64decode(v)


def _solve_waf(s, html, page_url):
    m = re.search(r'wci="([^"]+)"\s*,\s*cs="([^"]+)"', html)
    if not m:
        return False
    name, blob = m.groups()
    try:
        data = json.loads(_b64d(blob).decode("utf-8"))
        prefix = _b64d(data["v"]["a"])
        target = _b64d(data["v"]["c"]).hex()
    except (KeyError, ValueError, TypeError):
        return False
    for cand in range(1_000_001):
        if sha256(prefix + str(cand).encode()).hexdigest() == target:
            data["d"] = base64.b64encode(str(cand).encode()).decode()
            val = base64.b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
            s.cookies.set(name, val, domain=urlparse(page_url).hostname, path="/")
            return True
    return False


def _fetch_item(s, video_id):
    share_url = f"https://www.iesdouyin.com/share/video/{video_id}/"
    html = s.get(share_url, timeout=30).text
    if _is_waf(html) and _solve_waf(s, html, share_url):
        html = s.get(share_url, timeout=30).text
    data = _router_data(html)
    for node in (data.get("loaderData") or {}).values():
        if isinstance(node, dict):
            items = (node.get("videoInfoRes") or {}).get("item_list") or []
            if items and isinstance(items[0], dict):
                return items[0]
    raise ValueError("这个抖音视频暂时解析不了，可能已被删除或需要登录")


def parse(url):
    s = _session()
    video_id = _resolve_video_id(s, url)
    item = _fetch_item(s, video_id)
    video = item.get("video") or {}
    duration_ms = video.get("duration") or 0
    cover = ((video.get("origin_cover") or video.get("cover") or {}).get("url_list") or [None])[0]
    return {
        "type": "video",
        "engine": "douyin",
        "video_id": video_id,
        "title": item.get("desc") or f"抖音视频 {video_id}",
        "thumbnail": cover,
        "duration": duration_ms / 1000 if duration_ms else None,
        "uploader": (item.get("author") or {}).get("nickname"),
        "webpage_url": f"https://www.douyin.com/video/{video_id}",
        "choices": [
            {"id": "best", "label": "无水印 MP4", "height": video.get("height") or 0},
            {"id": "audio", "label": "仅音频 MP3", "height": 0},
        ],
        "subtitles": [],
    }


def _video_url(item):
    urls = ((item.get("video") or {}).get("play_addr") or {}).get("url_list") or []
    if not urls:
        raise ValueError("没找到视频播放地址")
    return urls[0].replace("playwm", "play")


def _stream_to(s, url, target, task, lo=0, hi=99):
    temp = target.with_suffix(target.suffix + ".part")
    with s.get(url, stream=True, timeout=(10, 120), allow_redirects=True) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        with temp.open("wb") as f:
            for chunk in r.iter_content(65536):
                if not chunk:
                    continue
                f.write(chunk)
                done += len(chunk)
                if total > 0:
                    task["percent"] = lo + round((hi - lo) * done / total)
    temp.replace(target)


def download_into(task, url, choice_id, download_dir, semaphore):
    with semaphore:
        task["status"] = "downloading"
        video_tmp = None
        try:
            s = _session()
            video_id = _resolve_video_id(s, url)
            item = _fetch_item(s, video_id)
            media_url = _video_url(item)
            if choice_id == "audio":
                video_tmp = Path(download_dir) / f"{task['id']}_src.mp4"
                _stream_to(s, media_url, video_tmp, task, 0, 90)
                task["percent"] = 95
                target = Path(download_dir) / f"{task['id']}.mp3"
                proc = subprocess.run(
                    [FFMPEG, "-y", "-i", str(video_tmp), "-vn", "-acodec", "libmp3lame", "-q:a", "2", str(target)],
                    capture_output=True, creationflags=_CREATE_NO_WINDOW,
                )
                if proc.returncode != 0 or not target.exists():
                    raise ValueError("音频转换失败，再试一次")
            else:
                target = Path(download_dir) / f"{task['id']}.mp4"
                _stream_to(s, media_url, target, task, 0, 99)
            task.update(status="done", percent=100, filepath=str(target))
        except ValueError as e:
            task.update(status="error", error=str(e))
        except requests.RequestException:
            task.update(status="error", error="抖音下载失败，稍后再试一次")
        except OSError:
            task.update(status="error", error="保存文件出了点问题，再试一次")
        finally:
            if video_tmp:
                video_tmp.unlink(missing_ok=True)