# Backlog

Ideas and follow-ups that aren't scheduled yet. Newest at the bottom of each section.

## Feel and animation

- **Mini-game demos:** a short animated demo on each mini-game's intro card.

## Easter eggs

- On the plus board the arms are full at the start of a 3–4 player game, so vehicles can only cross it once soldiers have moved out (or on the menu). A route that enters and leaves through the same open arm would fix that.

## 3–4 players

- Online 3–4 player rooms: seats, computer players filling empty seats, lobby.
- Team mode online (it works on one device already).
- Voice lines for the grey-blue and brown armies and for knock-outs.

## Tabletop race

- Online racing: 2–4 players in a room, each on their own phone. Computer racers fill the empty places. It needs synced starts, car positions streamed through the Colyseus server, and the finishing order decided on the server.

## Robustness and checks

- A failed model download should offer a retry instead of leaving the loading screen stuck.
- Measure frame rate on a mid-range phone; run a Lighthouse PWA audit.
- CI check that every text line has a rendered voice clip (once the clips are in).

## Small options

- Turn timer for online rooms (off by default), volume setting, toggle for rank badges.
