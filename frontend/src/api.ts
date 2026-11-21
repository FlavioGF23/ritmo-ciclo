import Keycloak from 'keycloak-js'
import type { Dashboard } from './calendar'

const root = window.location.origin + '/'
const identity = new Keycloak({
  url: window.location.origin + '/auth',
  realm: 'ritmo',
  clientId: 'ritmo-web',
})
let initialization: Promise<{ authenticated: boolean; available: boolean }> | undefined

export function connect() {
  return initialization ??= (async () => {
    try {
      const result = await fetch('/auth/realms/ritmo/.well-known/openid-configuration', {
        signal: AbortSignal.timeout(4500),
      })
      if (!result.ok || !result.headers.get('content-type')?.includes('application/json')) {
        return { authenticated: false, available: false }
      }
      const authenticated = await identity.init({
        pkceMethod: 'S256',
        checkLoginIframe: false,
        onLoad: 'check-sso',
        redirectUri: root,
      })
      return { authenticated, available: true }
    } catch {
      return { authenticated: false, available: false }
    }
  })()
}

export const login = () => identity.login({ redirectUri: root, locale: 'es' })
export const register = () => identity.register({ redirectUri: root, locale: 'es' })
export const logout = () => identity.logout({ redirectUri: root })

export async function api<T = void>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    await identity.updateToken(20)
  } catch {
    throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.')
  }
  const headers: HeadersInit = { Authorization: 'Bearer ' + identity.token }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const result = await fetch('/api/v1' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (!result.ok) {
    const error = await result.json().catch(() => ({}))
    const message = typeof error.detail === 'string' ? error.detail : 'No se pudo completar la solicitud.'
    throw new Error(message)
  }
  return result.status === 204 ? undefined as T : await result.json() as T
}

export const dashboard = () => api<Dashboard>('/dashboard')
