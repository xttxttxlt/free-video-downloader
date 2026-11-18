import pytest

from app import summarizer as sm

BCC_FIXTURE = {"body": [
    {"from": 12.86, "to": 14.5, "sid": 1, "location": 2, "content": "好大家好啊", "music": 0.0},
    {"from": 14.5, "to": 15.76, "sid": 2, "location": 2, "content": "那非常高兴啊", "music": 0.0},
    {"from": 15.76, "to": 16.2, "content": "   "},
]}

VTT_FIXTURE = """WEBVTT

00:00:12.860 --> 00:00:14.500
好大家好啊

00:00:14.500 --> 00:00:15.760
那非常高兴啊
"""

SRT_FIXTURE = """1
00:00:12,860 --> 00:00:14,500
好大家好啊

2
01:02:03,500 --> 01:02:05,000
<c>那非常高兴啊</c>
"""

JSON3_FIXTURE = {"events": [
    {"tStartMs": 12860, "dDurationMs": 1640, "segs": [{"utf8": "好大家"}, {"utf8": "好啊"}]},
    {"tStartMs": 14500, "dDurationMs": 1260, "segs": [{"utf8": "\n"}]},
]}


def test_parse_bcc():
    cues = sm.parse_bcc(BCC_FIXTURE)
    assert len(cues) == 2
    assert cues[0] == {"start": 12.86, "end": 14.5, "text": "好大家好啊"}


def test_parse_bcc_empty():
    assert sm.parse_bcc({}) == []
    assert sm.parse_bcc({"body": None}) == []


def test_parse_vtt():
    cues = sm.parse_srt_vtt(VTT_FIXTURE)
    assert len(cues) == 2
    assert cues[1]["start"] == 14.5 and cues[1]["text"] == "那非常高兴啊"


def test_parse_srt_hours_and_tags():
    cues = sm.parse_srt_vtt(SRT_FIXTURE)
    assert len(cues) == 2
    assert cues[1]["start"] == 3723.5
    assert cues[1]["text"] == "那非常高兴啊"


def test_parse_json3():
    cues = sm.parse_json3(JSON3_FIXTURE)
    assert len(cues) == 1
    assert cues[0]["text"] == "好大家好啊"
    assert cues[0]["end"] == 14.5


def _fmt(url, ext):
    return [{"ext": ext, "url": url}]


def test_pick_subtitle_manual_zh_first():
    subs = {"en": _fmt("u-en", "vtt"), "zh-Hans": _fmt("u-zh", "vtt")}
    autos = {"ai-zh": _fmt("u-ai", "json3")}
    assert sm.pick_subtitle(subs, autos) == ("zh-Hans", "manual", "u-zh", "vtt")


def test_pick_subtitle_auto_when_no_manual():
    assert sm.pick_subtitle({}, {"ai-zh": _fmt("u-ai", "json3")}) == ("ai-zh", "auto", "u-ai", "json3")


def test_pick_subtitle_excludes_danmaku():
    assert sm.pick_subtitle({"danmaku": _fmt("u-dm", "xml")}, {}) is None
    assert sm.pick_subtitle({"danmaku": _fmt("u-dm", "xml"), "live_chat": _fmt("u-lc", "json")},
                            {"en": _fmt("u-en", "vtt")}) == ("en", "auto", "u-en", "vtt")


def test_pick_subtitle_format_priority():
    subs = {"zh": [{"ext": "ttml", "url": "u-ttml"}, {"ext": "srt", "url": "u-srt"}]}
    assert sm.pick_subtitle(subs, {}) == ("zh", "manual", "u-srt", "srt")


def test_pick_subtitle_none():
    assert sm.pick_subtitle({}, {}) is None
    assert sm.pick_subtitle(None, None) is None


def test_fmt_ts():
    assert sm.fmt_ts(0) == "00:00"
    assert sm.fmt_ts(75) == "01:15"
    assert sm.fmt_ts(3723) == "1:02:03"


def test_cues_to_text_no_truncation():
    cues = [{"start": 0, "end": 1, "text": "你好"}, {"start": 61, "end": 62, "text": "世界"}]
    text, partial = sm.cues_to_text(cues)
    assert text == "[00:00] 你好\n[01:01] 世界"
    assert partial is False


def test_cues_to_text_thinning_keeps_ends():
    cues = [{"start": i * 10, "end": i * 10 + 5, "text": f"第{i}句内容比较长一些"} for i in range(500)]
    text, partial = sm.cues_to_text(cues, max_chars=300)
    assert partial is True
    lines = text.splitlines()
    assert lines[0].startswith("[00:00]")
    assert "第499句" in lines[-1]
    assert len(text) <= 400


def _valid_summary():
    return {"summary": "概述", "chapters": [
        {"timestamp": "00:00", "title": "开场", "points": ["要点1"]},
        {"timestamp": "1:02:03", "title": "深入", "points": []},
    ], "highlights": ["金句"]}


def test_validate_summary_ok():
    out = sm.validate_summary(_valid_summary())
    assert out["summary"] == "概述"
    assert len(out["chapters"]) == 2
    assert out["chapters"][1]["timestamp"] == "1:02:03"


def test_validate_summary_drops_bad_chapters():
    obj = _valid_summary()
    obj["chapters"].append({"timestamp": "编造的", "title": "坏章节", "points": []})
    obj["chapters"].append({"timestamp": "00:10", "title": "", "points": []})
    out = sm.validate_summary(obj)
    assert len(out["chapters"]) == 2


def test_validate_summary_rejects():
    with pytest.raises(ValueError):
        sm.validate_summary({})
    with pytest.raises(ValueError):
        sm.validate_summary({"summary": "有概述", "chapters": []})
    with pytest.raises(ValueError):
        sm.validate_summary("不是对象")


def test_validate_summary_caps():
    obj = _valid_summary()
    obj["chapters"] = [{"timestamp": f"{i:02d}:00", "title": f"章{i}", "points": ["p"] * 10} for i in range(12)]
    obj["highlights"] = ["h"] * 20
    out = sm.validate_summary(obj)
    assert len(out["chapters"]) == 8
    assert len(out["chapters"][0]["points"]) == 6
    assert len(out["highlights"]) == 8