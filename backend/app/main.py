from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import errors
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .auth import confirm_active_identity, require_identity
from .db import enqueue_change, lock_account, pool, prepare_database


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Consent(Payload):
    accepted: bool


class CycleInput(Payload):
    start_date: date

    @field_validator("start_date")
    @classmethod
    def validate_date(cls, value):
        today = datetime.now(timezone.utc).date()
        if value < date(1900, 1, 1) or value > today + timedelta(days=1):
            raise ValueError("Fecha fuera del intervalo permitido.")
        return value


class Preferences(Payload):
    usual_length: int | None = Field(ge=15, le=90)
    irregular: bool


class NewCycle(CycleInput):
    usual_length: int | None = Field(default=None, ge=15, le=90)


class CycleOutput(BaseModel):
    id: UUID
    start_date: date


class PredictionOutput(BaseModel):
    status: str
    basis: str | None = None
    cycle_length: int | None = None
    next_period: date | None = None
    ovulation: date | None = None
    fertile_from: date | None = None
    fertile_to: date | None = None


class Dashboard(BaseModel):
    consented: bool
    cycles: list[CycleOutput]
    usual_length: int | None
    irregular: bool
    prediction: PredictionOutput


@asynccontextmanager
async def lifespan(_app):
    pool.open(wait=True, timeout=20)
    try:
        prepare_database()
        yield
    finally:
        pool.close()


app = FastAPI(
    title="Ritmo · API de seguimiento menstrual", version="1.0.0",
    docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None, lifespan=lifespan,
    swagger_ui_parameters={"persistAuthorization": False},
)


@app.middleware("http")
async def privacy_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(RequestValidationError)
async def invalid_input(_request, _exception):
    return JSONResponse(status_code=422, content={"detail": "Revisa los datos del formulario."})


@app.exception_handler(errors.UniqueViolation)
async def duplicate_date(_request, _exception):
    return JSONResponse(status_code=409, content={"detail": "Ya registraste esa fecha."})


@app.get("/health", include_in_schema=False)
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


def require_consent(conn, account_id):
    account = lock_account(conn, account_id)
    if not account or not account["consent_at"] or account["deleting"]:
        raise HTTPException(403, "Confirma el consentimiento antes de registrar un ciclo.")
    return account


@app.get("/api/v1/dashboard", response_model=Dashboard)
def dashboard(identity=Depends(require_identity)):
    account_id, _ = identity
    with pool.connection() as conn:
        account = lock_account(conn, account_id)
        if not account or not account["consent_at"] or account["deleting"]:
            return {
                "consented": False, "cycles": [], "usual_length": None, "irregular": False,
                "prediction": {"status": "insufficient"},
            }

        cycles = conn.execute(
            "SELECT id, start_date FROM cycle WHERE account_id = %s ORDER BY start_date DESC",
            (account_id,),
        ).fetchall()
        status = {"status": "insufficient"}
        if account["prediction_revision"] != account["revision"] and account["revision"]:
            status = {"status": "pending"}
        elif account["prediction"]:
            status = account["prediction"]
            if status.get("next_period") and date.fromisoformat(status["next_period"]) < date.today():
                status = {"status": "stale"}
        return {
            "consented": True, "cycles": cycles, "usual_length": account["usual_length"],
            "irregular": account["irregular"], "prediction": status,
        }


@app.post("/api/v1/consent", status_code=204)
def save_consent(payload: Consent, identity=Depends(require_identity)):
    account_id, token = identity
    if not payload.accepted:
        raise HTTPException(422, "Debes confirmar el consentimiento para continuar.")
    with pool.connection() as conn:
        account = lock_account(conn, account_id)
        if account and account["deleting"]:
            raise HTTPException(409, "La cuenta se está eliminando.")
        confirm_active_identity(account_id, token)
        conn.execute(
            """
            INSERT INTO account (id, consent_at) VALUES (%s, now())
            ON CONFLICT (id) DO UPDATE SET consent_at = COALESCE(account.consent_at, now())
            """,
            (account_id,),
        )
    return Response(status_code=204)


@app.put("/api/v1/preferences", status_code=204)
def update_preferences(payload: Preferences, identity=Depends(require_identity)):
    account_id, _ = identity
    with pool.connection() as conn:
        require_consent(conn, account_id)
        conn.execute(
            "UPDATE account SET usual_length = %s, irregular = %s WHERE id = %s",
            (payload.usual_length, payload.irregular, account_id),
        )
        enqueue_change(conn, account_id)
    return Response(status_code=204)


@app.post("/api/v1/cycles", response_model=CycleOutput, status_code=201)
def create_cycle(payload: NewCycle, identity=Depends(require_identity)):
    account_id, _ = identity
    with pool.connection() as conn:
        require_consent(conn, account_id)
        cycle = conn.execute(
            """
            INSERT INTO cycle (id, account_id, start_date) VALUES (%s, %s, %s)
            RETURNING id, start_date
            """,
            (uuid4(), account_id, payload.start_date),
        ).fetchone()
        if "usual_length" in payload.model_fields_set:
            conn.execute(
                "UPDATE account SET usual_length = %s WHERE id = %s",
                (payload.usual_length, account_id),
            )
        enqueue_change(conn, account_id)
    return cycle


@app.put("/api/v1/cycles/{cycle_id}", response_model=CycleOutput)
def edit_cycle(cycle_id: UUID, payload: CycleInput, identity=Depends(require_identity)):
    account_id, _ = identity
    with pool.connection() as conn:
        require_consent(conn, account_id)
        cycle = conn.execute(
            """
            UPDATE cycle SET start_date = %s WHERE id = %s AND account_id = %s
            RETURNING id, start_date
            """,
            (payload.start_date, cycle_id, account_id),
        ).fetchone()
        if not cycle:
            raise HTTPException(404, "No se encontró el registro.")
        enqueue_change(conn, account_id)
    return cycle


@app.delete("/api/v1/cycles/{cycle_id}", status_code=204)
def delete_cycle(cycle_id: UUID, identity=Depends(require_identity)):
    account_id, _ = identity
    with pool.connection() as conn:
        require_consent(conn, account_id)
        deleted = conn.execute(
            "DELETE FROM cycle WHERE id = %s AND account_id = %s RETURNING id",
            (cycle_id, account_id),
        ).fetchone()
        if not deleted:
            raise HTTPException(404, "No se encontró el registro.")
        enqueue_change(conn, account_id)
    return Response(status_code=204)


@app.delete("/api/v1/history", status_code=204)
def delete_history(identity=Depends(require_identity)):
    account_id, _ = identity
    with pool.connection() as conn:
        require_consent(conn, account_id)
        conn.execute("DELETE FROM cycle WHERE account_id = %s", (account_id,))
        conn.execute("DELETE FROM outbox WHERE account_id = %s", (account_id,))
        conn.execute(
            """
            UPDATE account SET usual_length = NULL, irregular = false, revision = 0,
                prediction = NULL, prediction_revision = NULL WHERE id = %s
            """,
            (account_id,),
        )
    return Response(status_code=204)


@app.delete("/api/v1/account", status_code=202)
def request_account_deletion(identity=Depends(require_identity)):
    account_id, token = identity
    with pool.connection() as conn:
        account = lock_account(conn, account_id)
        if account and account["deleting"]:
            return {"status": "deletion_pending"}

        confirm_active_identity(account_id, token)
        conn.execute(
            """
            INSERT INTO account (id, deleting) VALUES (%s, true)
            ON CONFLICT (id) DO UPDATE SET deleting = true, consent_at = NULL, usual_length = NULL,
                irregular = false, prediction = NULL, prediction_revision = NULL, revision = 0
            """,
            (account_id,),
        )
        conn.execute("DELETE FROM cycle WHERE account_id = %s", (account_id,))
        conn.execute("DELETE FROM outbox WHERE account_id = %s", (account_id,))
        conn.execute(
            "INSERT INTO outbox (id, account_id, kind) VALUES (%s, %s, 'account.deletion.requested')",
            (uuid4(), account_id),
        )
    return {"status": "deletion_pending"}
