# Deployment: Portainer + nginx

The game ships as one Docker image, `ghcr.io/ulfendk/antego`, for `linux/amd64` and `linux/arm64`. It contains:

- the game server (Colyseus + Express),
- the PWA client, including the soldier models and the pre-rendered voice lines.

It speaks **plain HTTP on port 2567**. TLS is handled by your nginx. It keeps no data on disk: games live in memory.

## Images

GitHub Actions (`.github/workflows/ci.yml`) tests every push, then builds and pushes:

| Trigger        | Tags                     |
| -------------- | ------------------------ |
| push to `main` | `latest`, `sha-<short>`  |
| tag `v1.2.3`   | `1.2.3`, `1.2`, `latest` |

GHCR packages are private by default. Either:

- make the package public (GitHub → your profile → Packages → antego → Package settings → Change visibility), **or**
- add a registry in Portainer (Registries → Add → Custom, URL `ghcr.io`, your GitHub username and a PAT with `read:packages`).

## Portainer stack

1. **Stacks → Add stack → Web editor**, and paste `deploy/portainer-stack.yml`.
2. Deploy.

To update after a new image has been built: open the stack, choose **Update the stack**, tick **Re-pull image and redeploy**, and confirm.

## nginx

WebSockets need the upgrade headers, and a long read timeout while a kid thinks about a move.

```nginx
server {
    listen 443 ssl http2;
    server_name antego.example.dk;
    # ssl_certificate ... (as usual)

    location / {
        proxy_pass http://127.0.0.1:2567;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

# In the http {} block (once):
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Notes:

- Serve the game at the **root of a (sub)domain**. The service worker is scoped to `/`.
- The PWA install and the service worker require HTTPS, which nginx provides. Plain `http://localhost` also works for testing.
- Don't let nginx cache `/sw.js`, `/index.html`, `/manifest.webmanifest` or `/version.json`. The server already sends `Cache-Control: no-cache` for them.

## Updates

After a redeploy, installed PWAs pick up the new version by themselves:

- The service worker checks for updates on launch, when the app regains focus, and every 5 minutes.
- An update is applied at the next safe point (the menu, the setup screen or the game-over screen), so a kid is never interrupted mid-game.
- If the server's protocol version changed, older clients are told to update immediately when they join an online game.
- A redeploy restarts the server, so online games running at that moment are lost. Games on one device are not affected.
