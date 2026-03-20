"""IntelliRAG Worker — FastAPI health + job poller."""

import logging
import signal
import threading
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from .job_poller import run_poller
from .config import config
from .db import get_pool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="IntelliRAG Worker", version="0.1.0")


shutdown_event = threading.Event()


@app.on_event("startup")
async def startup():
    logger.info("Starting IntelliRAG worker...")
    for index in range(config.POLLER_THREADS):
        thread_name = f"job-poller-{index + 1}"
        thread = threading.Thread(
            target=run_poller,
            kwargs={"worker_name": thread_name},
            daemon=True,
            name=thread_name,
        )
        thread.start()
    logger.info("Job poller threads started: count=%s", config.POLLER_THREADS)

    # Register graceful shutdown handlers
    def handle_signal(signum, frame):
        logger.info(f"Received signal {signum}, shutting down gracefully...")
        shutdown_event.set()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "intellirag-worker"}


@app.get("/ready")
async def ready():
    try:
        pool = get_pool()
        conn = pool.getconn()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        pool.putconn(conn)
        return {"status": "ok"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded", "reason": "database_unreachable"})
