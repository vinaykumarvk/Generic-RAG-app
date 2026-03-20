"""PostgreSQL connection pool for the worker."""

import psycopg2
import psycopg2.pool
import psycopg2.extras
from contextlib import contextmanager
from .config import config

_pool = None


def get_pool():
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=config.DB_POOL_MAXCONN,
            dsn=config.DATABASE_URL,
        )
    return _pool


@contextmanager
def get_connection():
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


@contextmanager
def get_cursor(conn=None):
    if conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
        finally:
            cur.close()
    else:
        with get_connection() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                yield cur
            finally:
                cur.close()
