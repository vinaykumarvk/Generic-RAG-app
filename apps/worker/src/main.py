"""IntelliRAG Worker — FastAPI health + job poller."""

import logging
import threading
from fastapi import FastAPI
from .job_poller import run_poller
from .db import get_pool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="IntelliRAG Worker", version="0.1.0")


@app.on_event("startup")
async def startup():
    logger.info("Starting IntelliRAG worker...")
    # Start poller in background thread
    thread = threading.Thread(target=run_poller, daemon=True)
    thread.start()
    logger.info("Job poller thread started")


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
    except Exception as e:
        return {"status": "degraded", "reason": str(e)}
