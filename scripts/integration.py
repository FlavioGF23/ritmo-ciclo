"""Smoke test over TLS using synthetic accounts and the browser's OIDC flow."""
import base64
import hashlib
import os
import secrets
import ssl
import time
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

ORIGIN = os.environ.get("APP_ORIGIN", "https://localhost:8443")
OIDC = "/auth/realms/ritmo/protocol/openid-connect"
ROOT = Path(__file__).resolve().parents[1]
TLS = ssl.create_default_context(cafile=str(ROOT / ".local/tls/cert.pem"))


class Forms(HTMLParser):
    def __init__(self, contents):
        super().__init__()
        self.actions = {}
        self.feed(contents)

    def handle_starttag(self, tag, attrs):
        if tag == "form":
            values = dict(attrs)
            if values.get("id") and values.get("action"):
                self.actions[values["id"]] = values["action"]


def exchange(client, username, password, *, register=False):
    verifier = secrets.token_urlsafe(48)
    state = secrets.token_urlsafe(24)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    path = "/registrations" if register else "/auth"
    response = client.get(f"{OIDC}{path}", params={
        "client_id": "ritmo-web", "redirect_uri": f"{ORIGIN}/", "response_type": "code",
        "scope": "openid", "code_challenge_method": "S256", "code_challenge": challenge.decode(),
        "state": state,
    }, follow_redirects=True)
    response.raise_for_status()
    form_id = "kc-register-form" if register else "kc-form-login"
    forms = Forms(response.text).actions
    if form_id not in forms:
        raise AssertionError(f"No se encontró el formulario {form_id}.")
    fields = {"username": username, "password": password}
    if register:
        fields.update({
            "email": f"{username}@example.test", "firstName": "Cuenta", "lastName": "Ficticia",
            "password-confirm": password,
        })
    submitted = client.post(forms[form_id], data=fields)
    if submitted.status_code not in (302, 303):
        raise AssertionError(f"El formulario {form_id} devolvió {submitted.status_code}.")
    redirect = parse_qs(urlsplit(submitted.headers["location"]).query)
    assert redirect.get("state") == [state] and redirect.get("code"), "OIDC no devolvió un código válido"
    result = client.post(f"{OIDC}/token", data={
        "grant_type": "authorization_code", "code": redirect["code"][0],
        "client_id": "ritmo-web", "redirect_uri": f"{ORIGIN}/", "code_verifier": verifier,
    })
    return result.raise_for_status().json()["access_token"]


def with_account(client, *, register_only=False):
    username = "demo-" + secrets.token_hex(5)
    password = "Cuenta-Ficticia-" + secrets.token_urlsafe(16)
    token = exchange(client, username, password, register=True)
    if not register_only:
        with httpx.Client(base_url=ORIGIN, verify=TLS, timeout=12, trust_env=False) as fresh:
            token = exchange(fresh, username, password)
    return {"Authorization": f"Bearer {token}"}


def api(client, method, route, status, auth=None, **kwargs):
    result = client.request(method, f"/api/v1{route}", headers=auth, **kwargs)
    assert result.status_code == status, f"{method} {route} devolvió {result.status_code}; esperado {status}"
    assert result.headers.get("cache-control") == "no-store"
    return result.json() if result.content else None


def wait_for(check, predicate, description):
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        result = check()
        if predicate(result):
            return result
        time.sleep(1)
    raise AssertionError(f"Se agotó el tiempo de espera: {description}.")


def verify():
    with httpx.Client(base_url=ORIGIN, verify=TLS, timeout=12, trust_env=False) as client:
        page = wait_for(lambda: client.get("/"), lambda result: result.is_success, "página inicial")
        assert "Ritmo" in page.text
        schema = client.get("/api/openapi.json").raise_for_status().json()
        assert "/api/v1/cycles" in schema["paths"]
        assert client.get("/auth/admin/realms/ritmo/users").status_code == 404
        api(client, "GET", "/dashboard", 401)
        account = with_account(client)
        client.cookies.clear()
        other = with_account(client, register_only=True)
        started = date.today() - timedelta(days=8)

        api(client, "POST", "/cycles", 403, account, json={"start_date": started.isoformat()})
        api(client, "POST", "/consent", 422, account, json={"accepted": False})
        for auth in (account, other):
            api(client, "POST", "/consent", 204, auth, json={"accepted": True})

        cycle = api(client, "POST", "/cycles", 201, account, json={
            "start_date": started.isoformat(), "usual_length": 28,
        })
        cycle_path = f"/cycles/{cycle['id']}"
        assert api(client, "GET", "/dashboard", 200, other)["cycles"] == []
        api(client, "PUT", cycle_path, 404, other, json={"start_date": started.isoformat()})
        api(client, "DELETE", cycle_path, 404, other)
        api(client, "POST", "/cycles", 409, account, json={"start_date": started.isoformat()})

        def get_dashboard():
            return api(client, "GET", "/dashboard", 200, account)

        def get_prediction(status):
            return wait_for(
                get_dashboard,
                lambda data: data["prediction"]["status"] == status,
                f"estimación {status}",
            )["prediction"]

        prediction = get_prediction("estimated")
        assert prediction["next_period"] == (started + timedelta(days=28)).isoformat()
        assert prediction["ovulation"] == (started + timedelta(days=13)).isoformat()

        edited = started - timedelta(days=1)
        api(client, "PUT", cycle_path, 200, account, json={"start_date": edited.isoformat()})
        assert get_prediction("estimated")["next_period"] == (edited + timedelta(days=28)).isoformat()
        api(client, "PUT", "/preferences", 204, account, json={"usual_length": 28, "irregular": True})
        assert get_prediction("irregular")["ovulation"] is None

        api(client, "DELETE", "/history", 204, account)
        clean = get_dashboard()
        assert clean["cycles"] == [] and clean["prediction"]["status"] == "insufficient"
        api(client, "DELETE", "/account", 202, account)
        api(client, "DELETE", "/account", 202, other)
        wait_for(
            lambda: client.get(f"{OIDC}/userinfo", headers=account).status_code,
            lambda status: status == 401,
            "eliminación en Keycloak",
        )
        assert api(client, "GET", "/dashboard", 200, account)["cycles"] == []
        api(client, "POST", "/consent", 401, account, json={"accepted": True})
        print("HTTPS, OpenAPI, registro, login OIDC, consentimiento, aislamiento, estimaciones y borrado verificados.")


if __name__ == "__main__":
    verify()
