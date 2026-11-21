import logging
import os
import time
from uuid import UUID

import httpx
import pika
import psycopg
from psycopg.types.json import Jsonb

from .auth import delete_identity
from .db import lock_account, pool
from .prediction import estimate

QUEUE = "ritmo.work"
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("pika").setLevel(logging.CRITICAL)
logger = logging.getLogger("ritmo.worker")


def publish_batch(channel):
    with pool.connection() as conn:
        batch = conn.execute(
            """
            SELECT id FROM outbox WHERE published_at IS NULL AND queued_at <= now()
            ORDER BY queued_at LIMIT 20 FOR UPDATE SKIP LOCKED
            """
        ).fetchall()
        for event in batch:
            event_id = str(event["id"])
            channel.basic_publish(
                exchange="", routing_key=QUEUE, body=event_id.encode("ascii"), mandatory=True,
                properties=pika.BasicProperties(content_type="text/plain", delivery_mode=2),
            )
            conn.execute("UPDATE outbox SET published_at = now() WHERE id = %s", (event["id"],))
    return bool(batch)


def process_event(event_id):
    with pool.connection() as conn:
        event = conn.execute(
            "SELECT account_id FROM outbox WHERE id = %s", (event_id,),
        ).fetchone()
        if not event:
            return
        account_id = event["account_id"]
        account = lock_account(conn, account_id)
        task = conn.execute(
            "SELECT kind FROM outbox WHERE id = %s AND queued_at <= now()", (event_id,),
        ).fetchone()
        if not account or not task:
            return

        if task["kind"] == "account.deletion.requested":
            delete_identity(account_id)
            conn.execute("DELETE FROM account WHERE id = %s", (account_id,))
        elif not account["deleting"] and account["prediction_revision"] != account["revision"]:
            cycles = conn.execute(
                "SELECT start_date FROM cycle WHERE account_id = %s ORDER BY start_date DESC LIMIT 7",
                (account_id,),
            ).fetchall()
            prediction = estimate(
                [cycle["start_date"] for cycle in cycles],
                account["usual_length"], account["irregular"],
            )
            conn.execute(
                "UPDATE account SET prediction = %s, prediction_revision = revision WHERE id = %s",
                (Jsonb(prediction), account_id),
            )
        conn.execute("DELETE FROM outbox WHERE id = %s", (event_id,))


def defer_event(event_id):
    with pool.connection() as conn:
        conn.execute(
            """
            UPDATE outbox SET published_at = NULL, queued_at = now() + interval '15 seconds'
            WHERE id = %s
            """,
            (event_id,),
        )


def consume_once(channel):
    method, _properties, body = channel.basic_get(queue=QUEUE, auto_ack=False)
    if method is None:
        return False
    try:
        event_id = UUID(body.decode("ascii"))
    except (ValueError, UnicodeError):
        channel.basic_ack(method.delivery_tag)
        return True

    try:
        try:
            process_event(event_id)
        except httpx.HTTPError:
            logger.warning("El servicio de identidad no respondió. Se reintentará el borrado.")
            defer_event(event_id)
    except psycopg.Error:
        logger.warning("La base de datos no respondió. Se volverá a intentar.")
        channel.basic_nack(method.delivery_tag, requeue=True)
        time.sleep(3)
    else:
        channel.basic_ack(method.delivery_tag)
    return True


def run():
    pool.open(wait=True, timeout=25)
    try:
        while True:
            connection = None
            try:
                params = pika.URLParameters(os.environ["AMQP_URL"])
                params.heartbeat = 30
                connection = pika.BlockingConnection(params)
                channel = connection.channel()
                channel.queue_declare(queue=QUEUE, durable=True)
                channel.confirm_delivery()
                while connection.is_open:
                    published = publish_batch(channel)
                    consumed = consume_once(channel)
                    if not published and not consumed:
                        connection.sleep(0.5)
            except (pika.exceptions.AMQPError, psycopg.Error, OSError):
                logger.warning("Conexión interrumpida. Se volverá a intentar.")
                time.sleep(3)
            finally:
                if connection is not None and connection.is_open:
                    connection.close()
    finally:
        pool.close()


if __name__ == "__main__":
    run()
