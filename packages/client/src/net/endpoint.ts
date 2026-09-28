import type { EndpointSettings } from '@colyseus/sdk';

/**
 * Same-origin endpoint so the game works behind any reverse proxy (wss:// under https).
 * In dev, Vite runs on another port, so talk to the game server directly
 * (:2567, or VITE_SERVER_PORT when another project already uses that port).
 */
export function colyseusEndpoint(): EndpointSettings {
  const secure = location.protocol === 'https:';
  if (import.meta.env.DEV) {
    const port = Number(import.meta.env.VITE_SERVER_PORT ?? 2567);
    return { hostname: location.hostname, port, secure };
  }
  const port = location.port ? Number(location.port) : secure ? 443 : 80;
  return { hostname: location.hostname, port, secure };
}
