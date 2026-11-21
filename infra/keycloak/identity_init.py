import os
import time

import httpx

base = os.environ["KEYCLOAK_INTERNAL_URL"]


def admin_token(client):
    for _ in range(80):
        try:
            result = client.post(
                f"{base}/realms/master/protocol/openid-connect/token",
                data={
                    "grant_type": "password", "client_id": "admin-cli", "username": "ritmo-admin",
                    "password": os.environ["KEYCLOAK_ADMIN_PASSWORD"],
                },
            )
            if result.is_success:
                return result.json()["access_token"]
        except httpx.RequestError:
            pass
        time.sleep(3)
    raise SystemExit("Keycloak no está listo o las credenciales de arranque no coinciden.")


def initialize():
    with httpx.Client(timeout=5) as client:
        client.headers["Authorization"] = f"Bearer {admin_token(client)}"
        admin = f"{base}/admin/realms/ritmo"
        cleanup = client.get(f"{admin}/clients", params={"clientId": "ritmo-account-cleanup"})
        cleanup_id = cleanup.raise_for_status().json()[0]["id"]
        management = client.get(f"{admin}/clients", params={"clientId": "realm-management"})
        management_id = management.raise_for_status().json()[0]["id"]
        service_account = client.get(f"{admin}/clients/{cleanup_id}/service-account-user")
        service_id = service_account.raise_for_status().json()["id"]
        role = client.get(f"{admin}/clients/{management_id}/roles/manage-users")
        client.post(
            f"{admin}/users/{service_id}/role-mappings/clients/{management_id}",
            json=[role.raise_for_status().json()],
        ).raise_for_status()


if __name__ == "__main__":
    initialize()
