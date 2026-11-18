"""AI 视频总结：字幕提取（B站 dm/view 免登录 + 其他平台 yt-dlp）+ DeepSeek 总结/问答"""

import json
import os
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

from . import downloader as dl
from . import douyin

ROOT = Path(__file__).resolve().parent.parent


def _load_env():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env()

DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
LLM_TIMEOUT = 120
CHAT_TIMEOUT = 60
MAX_SUBTITLE_CHARS = 150_000
MAX_CHAT_ROUNDS = 20
SUMMARY_TTL_SECONDS = 3600

summaries = {}
_semaphore = threading.Semaphore(2)

_UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
}

LANG_PRIORITY = ["zh-CN", "zh-Hans", "ai-zh", "zh", "zh-Hant", "zh-TW", "en-US", "en", "ja", "ko"]
FAKE_SUB_LANGS = {"danmaku", "live_chat"}


def _api_key():
    return os.environ.get("DEEPSEEK_API_KEY", "")


# ---------- 纯函数：字幕解析 ----------

def parse_bcc(data):
    cues = []
    for item in data.get("body") or []:
        text = (item.get("content") or "").strip()
        if text:
            cues.append({"start": round(float(item.get("from", 0)), 2),
                         "end": round(float(item.get("to", 0)), 2), "text": text})
    return cues


def _time_to_seconds(s):
    parts = s.replace(",", ".").split(":")
    parts = [float(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def parse_srt_vtt(text):
    cues = []
    pattern = re.compile(r"(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})")
    for block in re.split(r"\n\s*\n", text):
        lines = block.strip().splitlines()
        start = end = None
        texts = []
        for line in lines:
            m = pattern.search(line)
            if m:
                start, end = _time_to_seconds(m.group(1)), _time_to_seconds(m.group(2))
            elif start is not None and line.strip() and not line.strip().isdigit():
                clean = re.sub(r"<[^>]+>", "", line).strip()
                if clean and clean != "WEBVTT":
                    texts.append(clean)
        if start is not None and texts:
            cues.append({"start": round(start, 2), "end": round(end, 2), "text": " ".join(texts)})
    return cues


def parse_json3(data):
    cues = []
    for ev in data.get("events") or []:
        segs = ev.get("segs") or []
        text = "".join(s.get("utf8", "") for s in segs).strip()
        if not text:
            continue
        start = ev.get("tStartMs", 0) / 1000
        cues.append({"start": round(start, 2),
                     "end": round(start + ev.get("dDurationMs", 0) / 1000, 2), "text": text})
    return cues


def pick_subtitle(subs, autos):
    """返回 (lang, kind, url, ext)；人工优先中文 > AI 中文 > 英文 > 其他"""
    subs = {k: v for k, v in (subs or {}).items() if k not in FAKE_SUB_LANGS and v}
    autos = {k: v for k, v in (autos or {}).items() if k not in FAKE_SUB_LANGS and v}

    def best_format(formats):
        for pref in ("srt", "vtt", "json3", "json"):
            for f in formats:
                if f.get("ext") == pref and f.get("url"):
                    return f["url"], f["ext"]
        return (formats[0].get("url"), formats[0].get("ext")) if formats else (None, None)

    for source, kind in ((subs, "manual"), (autos, "auto")):
        for lang in LANG_PRIORITY:
            if lang in source:
                url, ext = best_format(source[lang])
                if url:
                    return lang, kind, url, ext
        for lang, formats in source.items():
            url, ext = best_format(formats)
            if url:
                return lang, kind, url, ext
    return None


def fmt_ts(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def cues_to_text(cues, max_chars=MAX_SUBTITLE_CHARS):
    lines = [f"[{fmt_ts(c['start'])}] {c['text']}" for c in cues]
    text = "\n".join(lines)
    if len(text) <= max_chars or not cues:
        return text, False
    avg = max(1, len(text) // len(cues))
    keep = max(2, max_chars // avg)
    step = (len(cues) - 1) / (keep - 1)
    indices = sorted({round(i * step) for i in range(keep)})
    return "\n".join(lines[i] for i in indices), True


def validate_summary(obj):
    if not isinstance(obj, dict):
        raise ValueError("不是 JSON 对象")
    summary = str(obj.get("summary") or "").strip()
    if not summary:
        raise ValueError("缺少 summary")
    chapters = []
    for ch in obj.get("chapters") or []:
        if not isinstance(ch, dict):
            continue
        ts = str(ch.get("timestamp") or "").strip()
        title = str(ch.get("title") or "").strip()
        if not re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", ts) or not title:
            continue
        points = [str(p).strip() for p in (ch.get("points") or []) if str(p).strip()][:6]
        chapters.append({"timestamp": ts, "title": title[:60], "points": points})
    if not chapters:
        raise ValueError("缺少有效 chapters")
    highlights = [str(h).strip() for h in (obj.get("highlights") or []) if str(h).strip()][:8]
    return {"summary": summary, "chapters": chapters[:8], "highlights": highlights}


# ---------- 字幕获取 ----------

def _is_bilibili(url):
    return "bilibili.com" in url or "b23.tv" in url


def _resolve_b23(url):
    if "b23.tv" not in url:
        return url
    try:
        r = requests.get(url, headers=_UA, timeout=15, allow_redirects=True)
        return str(r.url)
    except requests.RequestException:
        raise ValueError("短链接解析失败了，稍后再试一次")


def _fetch_bilibili(url):
    url = _resolve_b23(url)
    m = re.search(r"(BV[a-zA-Z0-9]+)", url)
    av = re.search(r"av(\d+)", url)
    if not m and not av:
        raise ValueError("这个B站链接看起来不太对，粘贴完整的视频链接试试")
    p = 1
    try:
        p = max(1, int(parse_qs(urlparse(url).query).get("p", ["1"])[0]))
    except ValueError:
        pass
    params = {"bvid": m.group(1)} if m else {"aid": av.group(1)}
    try:
        r = requests.get("https://api.bilibili.com/x/web-interface/view",
                         params=params, headers=_UA, timeout=15).json()
    except requests.RequestException:
        raise ValueError("网络开小差了，稍后再试一次")
    if r.get("code") != 0:
        if r.get("code") == -404:
            raise ValueError("视频不存在或已被删除")
        raise ValueError("这个视频暂时看不了，换个链接试试")
    data = r["data"]
    pages = data.get("pages") or []
    page = pages[p - 1] if 0 < p <= len(pages) else None
    cid = page["cid"] if page else data.get("cid")
    title = data.get("title") or "video"
    if page and len(pages) > 1 and page.get("part"):
        title = f"{title} · {page['part']}"
    bvid = data.get("bvid") or (m.group(1) if m else "")
    webpage_url = f"https://www.bilibili.com/video/{bvid}" + (f"?p={p}" if len(pages) > 1 else "")

    try:
        r2 = requests.get("https://api.bilibili.com/x/v2/dm/view",
                          params={"aid": data["aid"], "oid": cid, "type": 1},
                          headers=_UA, timeout=15).json()
        subs = ((r2.get("data") or {}).get("subtitle") or {}).get("subtitles") or []
    except requests.RequestException:
        raise ValueError("网络开小差了，稍后再试一次")
    if not subs:
        raise ValueError("该视频暂无字幕，无法总结")
    best = next((s for s in subs if s.get("lan") in LANG_PRIORITY[:4]), subs[0])
    sub_url = best.get("subtitle_url") or ""
    if sub_url.startswith("//"):
        sub_url = "https:" + sub_url
    elif sub_url.startswith("http://"):
        sub_url = "https://" + sub_url[7:]
    if not sub_url:
        raise ValueError("该视频暂无字幕，无法总结")
    try:
        body = requests.get(sub_url, headers=_UA, timeout=30).json()
    except requests.RequestException:
        raise ValueError("字幕获取失败了，稍后再试一次")
    cues = parse_bcc(body)
    if not cues:
        raise ValueError("该视频暂无字幕，无法总结")
    lan = best.get("lan", "zh")
    kind = "auto" if lan.startswith("ai-") or "aisubtitle" in sub_url else "manual"
    return {"title": title, "webpage_url": webpage_url, "cues": cues, "lang": lan, "kind": kind}


def _fetch_generic(url, sid):
    try:
        proc = dl._run(["-J", "--no-playlist", "--no-warnings", "--", url], timeout=dl.PARSE_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise ValueError("解析超时了，稍后再试一次")
    if proc.returncode != 0:
        raise ValueError(dl._friendly_error(proc.stderr))
    info = json.loads(proc.stdout)
    picked = pick_subtitle(info.get("subtitles"), info.get("automatic_captions"))
    if not picked:
        raise ValueError("该视频暂无字幕，无法总结")
    lang, kind, sub_url, ext = picked
    cues = []
    try:
        resp = requests.get(sub_url, headers=_UA, timeout=30)
        if ext == "json3":
            cues = parse_json3(resp.json())
        elif ext == "json":
            cues = parse_bcc(resp.json())
        else:
            cues = parse_srt_vtt(resp.text)
    except (requests.RequestException, ValueError):
        cues = []
    if not cues:
        cues = _fetch_via_cli(url, sid, lang, kind)
    if not cues:
        raise ValueError("字幕获取失败了，稍后再试一次")
    return {"title": info.get("title") or "video",
            "webpage_url": info.get("webpage_url") or url,
            "cues": cues, "lang": lang, "kind": kind}


def _fetch_via_cli(url, sid, lang, kind):
    args = ["--skip-download", "--no-playlist", "--no-warnings",
            "--write-auto-subs" if kind == "auto" else "--write-subs",
            "--sub-langs", lang, "--convert-subs", "srt",
            "--ffmpeg-location", dl.FFMPEG_LOCATION,
            "-o", str(dl.DOWNLOAD_DIR / f"{sid}.%(ext)s"), "--", url]
    try:
        dl._run(args, timeout=dl.PARSE_TIMEOUT)
    except subprocess.TimeoutExpired:
        return []
    cues = []
    for f in dl.DOWNLOAD_DIR.glob(f"{sid}.*.srt"):
        try:
            cues = parse_srt_vtt(f.read_text(encoding="utf-8", errors="replace"))
        finally:
            f.unlink(missing_ok=True)
        if cues:
            break
    return cues


def fetch_subtitle(url, sid):
    if _is_bilibili(url):
        return _fetch_bilibili(url)
    return _fetch_generic(url, sid)


# ---------- DeepSeek ----------

def _llm_status_error(code):
    if code == 401:
        return "AI 服务认证失败，请联系站长"
    if code == 402:
        return "AI 服务余额不足，请联系站长"
    if code in (429, 503):
        return "AI 服务繁忙，稍后再试一次"
    return "AI 服务出了点问题，稍后再试一次"


def llm_chat(messages, json_mode=False, max_tokens=4096, timeout=LLM_TIMEOUT):
    body = {"model": DEEPSEEK_MODEL, "messages": messages, "max_tokens": max_tokens,
            "stream": False, "thinking": {"type": "disabled"}}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    for attempt in range(2):
        try:
            resp = requests.post(f"{DEEPSEEK_BASE_URL}/chat/completions",
                                 headers={"Authorization": f"Bearer {_api_key()}"},
                                 json=body, timeout=timeout)
        except requests.Timeout:
            raise ValueError("AI 响应超时了，稍后再试一次")
        except requests.RequestException:
            raise ValueError("网络开小差了，稍后再试一次")
        if resp.status_code != 200:
            print(f"[summarizer] LLM HTTP {resp.status_code}: {resp.text[:200]}")
            raise ValueError(_llm_status_error(resp.status_code))
        data = resp.json()
        usage = data.get("usage") or {}
        print(f"[summarizer] model={DEEPSEEK_MODEL} tokens={usage.get('total_tokens')}")
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        if content.strip():
            return content
    raise ValueError("AI 返回的内容有点问题，再试一次")


def build_summary_messages(title, text, kind, partial):
    source = "平台 AI 字幕（可能有识别误差）" if kind == "auto" else "人工字幕"
    note = "（字幕过长，已等距抽取部分片段，时间轴仍覆盖全片）" if partial else ""
    system = (
        "你是视频内容总结助手。用户会给出视频标题和带时间戳的字幕（每行格式 [mm:ss] 文本）。"
        "请仔细阅读全文，输出一个 json 对象，格式如下（所有字段值均为纯文本，禁止使用 Markdown 符号）：\n"
        '{"summary":"150~300字的整体摘要，说清视频主题、核心观点与结论",'
        '"chapters":[{"timestamp":"mm:ss","title":"不超过15字的章节标题","points":["要点1","要点2"]}],'
        '"highlights":["3~5条金句、关键数据或重要结论"]}\n'
        "要求：\n"
        "1. chapters 按内容逻辑划分 3~8 个，timestamp 必须取自真实字幕时间，不得编造；\n"
        "2. 只依据字幕内容，不得虚构字幕中不存在的信息；\n"
        "3. 无论字幕是什么语言，一律用简体中文输出；\n"
        "4. 平台 AI 字幕可能有错别字，按上下文理解，但不要照抄明显错误。"
    )
    user = f"视频标题：{title}\n字幕（来源：{source}）{note}：\n{text}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def summarize(title, text, kind, partial):
    content = llm_chat(build_summary_messages(title, text, kind, partial), json_mode=True)
    try:
        obj = json.loads(content)
    except ValueError:
        content = llm_chat(build_summary_messages(title, text, kind, partial), json_mode=True)
        obj = json.loads(content)
    return validate_summary(obj)


def prepare_chat(task, question):
    question = (question or "").strip()
    if not 1 <= len(question) <= 500:
        raise ValueError("问题长度要在 1~500 字之间")
    if task["chat_rounds"] >= MAX_CHAT_ROUNDS:
        raise ValueError("本次总结的问答次数用完啦，重新生成一份总结即可继续")
    return question


def _sse(obj):
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def stream_chat(task, question):
    system = (
        "你是该视频的问答助手。只依据下方字幕回答，用简体中文纯文本、200字以内；"
        "字幕没提到的就直说「视频里没有提到这一点」，不要编造。\n"
        f"视频标题：{task['title']}\n字幕：\n{task['subtitle_text']}"
    )
    messages = [{"role": "system", "content": system}]
    messages += task["chat"][-10:]
    messages.append({"role": "user", "content": question})
    body = {"model": DEEPSEEK_MODEL, "messages": messages, "max_tokens": 1024,
            "stream": True, "thinking": {"type": "disabled"}}
    parts = []
    try:
        with requests.post(f"{DEEPSEEK_BASE_URL}/chat/completions",
                           headers={"Authorization": f"Bearer {_api_key()}"},
                           json=body, timeout=(15, CHAT_TIMEOUT), stream=True) as resp:
            if resp.status_code != 200:
                print(f"[summarizer] chat HTTP {resp.status_code}: {resp.text[:200]}")
                yield _sse({"error": _llm_status_error(resp.status_code)})
                return
            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    delta = (json.loads(payload).get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                except ValueError:
                    continue
                if delta:
                    parts.append(delta)
                    yield _sse({"delta": delta})
    except requests.Timeout:
        yield _sse({"error": "AI 响应超时了，稍后再试一次"})
        return
    except requests.RequestException:
        yield _sse({"error": "网络开小差了，稍后再试一次"})
        return
    answer = "".join(parts).strip()
    if not answer:
        yield _sse({"error": "AI 返回的内容有点问题，再试一次"})
        return
    task["chat"] += [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
    task["chat_rounds"] += 1
    yield _sse({"done": True, "rounds_left": MAX_CHAT_ROUNDS - task["chat_rounds"]})


# ---------- 任务管理 ----------

def start_summary(url):
    url = dl.validate_url(url)
    if douyin.is_douyin(url):
        raise ValueError("抖音视频暂无字幕，暂不支持 AI 总结")
    if not _api_key():
        raise RuntimeError("AI 总结服务暂未开放，请联系站长")
    sid = uuid.uuid4().hex[:12]
    task = {"id": sid, "status": "queued", "title": None, "error": None,
            "created": time.time(), "url": url, "webpage_url": url,
            "subtitle_lang": None, "subtitle_kind": None, "cues": [],
            "subtitle_text": "", "partial": False, "result": None,
            "chat": [], "chat_rounds": 0}
    summaries[sid] = task
    threading.Thread(target=_run_summary, args=(task, url), daemon=True).start()
    return sid


def _run_summary(task, url):
    with _semaphore:
        try:
            task["status"] = "fetching_subtitle"
            info = fetch_subtitle(url, task["id"])
            task.update(title=info["title"], webpage_url=info["webpage_url"],
                        cues=info["cues"], subtitle_lang=info["lang"], subtitle_kind=info["kind"])
            text, partial = cues_to_text(info["cues"])
            task["subtitle_text"], task["partial"] = text, partial
            task["status"] = "summarizing"
            task["result"] = summarize(info["title"], text, info["kind"], partial)
            task["status"] = "done"
        except ValueError as e:
            task.update(status="error", error=str(e))
        except Exception:
            task.update(status="error", error="总结出了点问题，稍后再试一次")


def public_view(task):
    view = {k: task[k] for k in ("id", "status", "title", "error")}
    if task["status"] == "done":
        view.update({k: task[k] for k in
                     ("subtitle_lang", "subtitle_kind", "partial", "result", "cues", "webpage_url")})
        view["rounds_left"] = MAX_CHAT_ROUNDS - task["chat_rounds"]
    return view


def cleanup_loop():
    while True:
        now = time.time()
        for sid in list(summaries):
            t = summaries.get(sid)
            if t and now - t["created"] > SUMMARY_TTL_SECONDS:
                summaries.pop(sid, None)
        time.sleep(300)