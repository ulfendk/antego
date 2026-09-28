# Antego 🪖

Myresoldater og Stratego i en god blanding: et 3D-brætspil for børn (6–10 år), hvor små grønne og brune plastiksoldater dyster om flaget. Al tekst læses op.

A Danish 3D board game for kids in the spirit of Stratego, with Toy Story-style green army men. It runs as a PWA from one self-hosted Docker image.

- **Modes:** against the computer (three levels), two players on one screen, and online with a 4-digit room code (or QR / `?rum=1234` link).
- **Rules:** classic Stratego (10×10, 40 pieces each). Close fights are decided by short 3D mini-games (Stormløb, Korkskud, Faldskærm), with a head start for the stronger soldier.
- **Look:** soldiers sculpted in code with Blender, soft plastic shading, a printed folding cardboard board on a wooden table.

## Structure

| Path              | What                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `packages/shared` | Game engine (rules, battles, setups, hidden views), AI, protocol — used by both sides          |
| `packages/client` | three.js + Vite PWA (service worker with safe-point auto-update)                               |
| `packages/server` | Colyseus game rooms + Express (static client, `/healthz`, `/version.json`)                     |
| `content/lines`   | Every text the game shows (Danish), one YAML file per area                                     |
| `tools/models`    | Headless Blender (Docker) that sculpts the 12 soldier models → `packages/client/public/models` |

## Development

```sh
npm install
npm run dev        # server on :2567 + Vite on :5173 (VITE_SERVER_PORT=… if 2567 is taken)
npm test           # vitest (engine, AI, game room)
npm run lint && npm run typecheck
npm run models -- --preview   # rebuild models (needs Docker); previews in tools/models/.cache
```

Add `?debug` to the URL to expose the app in the devtools console.

## Docker

```sh
docker compose up --build   # http://localhost:2567
```

Deployment with Portainer and nginx is covered in [docs/deploy.md](docs/deploy.md).
