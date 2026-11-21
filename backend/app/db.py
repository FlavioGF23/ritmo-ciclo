import os
from pathlib import Path
from uuid import uuid4

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

pool = ConnectionPool(
    os.environ["DATABASE_URL"], min_size=1, max_size=8,
    kwargs={"row_factory": dict_row}, open=False,
)


def prepare_database():
    with pool.connection() as conn:
        conn.execute(Path(__file__).with_name("schema.sql").read_text())


def lock_account(conn, account_id):
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (str(account_id),))
    return conn.execute("SELECT * FROM account WHERE id = %s", (account_id,)).fetchone()


def enqueue_change(conn, account_id):
    conn.execute(
        "UPDATE account SET revision = revision + 1, prediction = NULL WHERE id = %s",
        (account_id,),
    )
    conn.execute(
        "INSERT INTO outbox (id, account_id, kind) VALUES (%s, %s, 'cycles.changed')",
        (uuid4(), account_id),
    )
