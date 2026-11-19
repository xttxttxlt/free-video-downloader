import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import downloader as dl
from . import summarizer as sm

app = FastAPI(title="FlashSave")


class ParseReq(BaseModel):
    url: str


class DownloadReq(BaseModel):
    url: str
    choice: str = "best"
    title: str | None = None
    subtitle: str | None = None


class SummarizeReq(BaseModel):
    url: str


class ChatReq(BaseModel):
    question: str


def _ip(request: Request):
    return request.client.host if request.client else "unknown"


@app.post("/api/parse")
def api_parse(body: ParseReq):
    try:
        return dl.parse(body.url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(500, "解析出了点问题，稍后再试")


@app.post("/api/download")
def api_download(body: DownloadReq, request: Request):
    try:
        task_id = dl.start_download(body.url, body.choice, body.title, _ip(request), body.subtitle)
    except PermissionError as e:
        raise HTTPException(429, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"task_id": task_id}


@app.get("/api/tasks/{task_id}")
def api_task(task_id: str):
    task = dl.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在或已过期")
    return {k: task[k] for k in ("id", "status", "percent", "speed", "title", "error")}


@app.get("/api/files/{task_id}")
def api_file(task_id: str):
    task = dl.tasks.get(task_id)
    if not task or task["status"] != "done" or not task["filepath"]:
        raise HTTPException(404, "文件不存在或已过期")
    fp = Path(task["filepath"])
    safe_title = "".join(c for c in task["title"] if c not in '\\/:*?"<>|').strip() or "video"
    return FileResponse(fp, filename=f"{safe_title}{fp.suffix}", media_type="application/octet-stream")


@app.get("/api/quota")
def api_quota(request: Request):
    return {"remaining": dl.check_quota(_ip(request)), "limit": dl.FREE_DAILY_LIMIT}


@app.get("/api/stats")
def api_stats():
    import time

    if dl.stats["date"] != time.strftime("%Y-%m-%d"):
        return {"downloads": 0}
    return {"downloads": dl.stats["downloads"]}


@app.post("/api/summarize")
def api_summarize(body: SummarizeReq):
    try:
        return {"summary_id": sm.start_summary(body.url)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@app.get("/api/summary/{summary_id}")
def api_summary(summary_id: str):
    task = sm.summaries.get(summary_id)
    if not task:
        raise HTTPException(404, "总结不存在或已过期")
    return sm.public_view(task)


@app.post("/api/summary/{summary_id}/chat")
def api_summary_chat(summary_id: str, body: ChatReq):
    task = sm.summaries.get(summary_id)
    if not task or task["status"] != "done":
        raise HTTPException(404, "总结不存在或尚未完成")
    try:
        question = sm.prepare_chat(task, body.question)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return StreamingResponse(
        sm.stream_chat(task, question),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.on_event("startup")
def _startup():
    threading.Thread(target=dl.cleanup_loop, daemon=True).start()
    threading.Thread(target=sm.cleanup_loop, daemon=True).start()


static_dir = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")