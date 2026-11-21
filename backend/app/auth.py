import os
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

ISSUER = os.environ["OIDC_ISSUER"]
INTERNAL_BASE = os.environ["KEYCLOAK_INTERNAL_URL"]
REALM_URL = f"{INTERNAL_BASE}/realms/ritmo"
OIDC_URL = f"{REALM_URL}/protocol/openid-connect"
WEB_CLIENT = "ritmo-web"
jwks = jwt.PyJWKClient(f"{OIDC_URL}/certs", timeout=4)
bearer = HTTPBearer(auto_error=False)


def require_identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(401, "Inicia sesión.", headers={"WWW-Authenticate": "Bearer"})
    try:
        token = credentials.credentials
        key = jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token, key, algorithms=["RS256"], issuer=ISSUER, audience="ritmo-api",
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
        if claims.get("azp") != WEB_CLIENT or claims.get("typ") != "Bearer":
            raise jwt.InvalidTokenError()
        return UUID(claims["sub"]), token
    except (jwt.PyJWTError, ValueError, TypeError):
        raise HTTPException(
            401, "La sesión expiró o no es válida.", headers={"WWW-Authenticate": "Bearer"},
        ) from None


def confirm_active_identity(account_id, token):
    try:
        result = httpx.get(
            f"{OIDC_URL}/userinfo", headers={"Authorization": f"Bearer {token}"}, timeout=5,
        )
        if result.status_code in (401, 403):
            raise HTTPException(401, "La sesión ya no está activa.")
        result.raise_for_status()
        if result.json().get("sub") != str(account_id):
            raise HTTPException(401, "La sesión ya no está activa.")
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, "El servicio de identidad no está disponible.") from None


def delete_identity(account_id):
    with httpx.Client(timeout=6) as client:
        result = client.post(
            f"{OIDC_URL}/token",
            data={
                "grant_type": "client_credentials",
                "client_id": "ritmo-account-cleanup",
                "client_secret": os.environ["KEYCLOAK_CLEANUP_SECRET"],
            },
        )
        result.raise_for_status()
        delete = client.delete(
            f"{INTERNAL_BASE}/admin/realms/ritmo/users/{account_id}",
            headers={"Authorization": f"Bearer {result.json()['access_token']}"},
        )
        if delete.status_code != 404:
            delete.raise_for_status()
