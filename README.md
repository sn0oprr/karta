# Karta · كارطة

**Tunisian card games online, with friends.** Karta starts with **Chkobba** (شكبّة), Tunisia's favourite café game, played on a cartoon 3D terrace in Sidi Bou Said. Rami and Belote are planned next.

- **1 vs 1 or 2 vs 2.** In 2 vs 2, partners sit opposite each other.
- **Private tables.** Create a table and invite friends with a share link (`/room/ABCDE`) or the 5-letter code.
- **Spectators.** Anyone can watch with the link (`?watch=1`), or by joining a full table. Spectators can rotate the view and take over a bot's seat or an away player's seat.
- **Voice chat.** Peer-to-peer WebRTC voice for players and spectators, with mute, deafen, per-person volume, push-to-talk (hold **V**), and avatar mouths that move when people talk.
- **Bots** in three levels (easy, normal, hard) to fill empty seats. A bot also plays for anyone who drops out, until they reconnect.
- **Your café persona.** Pick who you are at the table: eight regulars (El Hajj in his red chechia, the bald café boss in shades, a grandma in her polka-dot headscarf, a curly-haired student…) with a skin tone and a shirt colour, or one of **the crew**, nine friends drawn after their own avatars: Rafaa, NiNi Nina, Tha3loub, ta7foun, Sn0opr, Bou3ish, 7saan, habboub and Gratos, each with their own hair, beard, glasses and clothes at the table and their picture in the menus. Picking one of the crew also gives you their name, unless you typed your own; bots stick to the regulars. Then order: an express, a tea with pine nuts, a Coke, or a chicha that stands beside your chair. Tap your drink on the table (or press **D**) to take a sip or a puff, with real drinking sounds; everyone at the table sees and hears it, and bots sip theirs now and then.
- **Quality of life:** an optional turn timer, reconnecting to your seat after a refresh, text chat, quick Tunisian reactions ("Ya3tik sa77a!", "Mabrouk!"), a rules screen, and procedural sound effects (darbuka on a chkobba!).
- **All art is drawn in code.** Card faces (figures wearing a chechia, a golden 7♦), the terrace, the avatars (the crew's included) and the drinks need no external assets. The exceptions are the crew's portraits in `src/client/assets/crew/` (cropped from their avatars, for the menus) and the four drinking recordings in `src/client/assets/sounds/` (each holds several sips; the game finds them by loudness and plays one per tap). Sound effects are synthesized.

## Chkobba rules implemented

40-card deck, with Queen = 8, Jack = 9 and King = 10. Each player gets 3 cards and 4 go face up on the table. If 3 or more of those table cards share a rank, the cards are redealt. Play goes anticlockwise and the deal passes to the right.

You must capture when you can. A card of the same rank must be taken before any combination that adds up to your card's value. Sweeping the table is a **chkobba** (1 point), except with the last card of the hand. Cards left on the table at the end go to whoever captured last.

At the end of each hand, one point each goes to:
- **Karta:** most cards; 20–20 scores nothing.
- **Dinari:** most diamonds; 5–5 scores nothing.
- **Bermila:** most 7s, then most 6s if tied.
- **Sab'a el Haya:** the 7♦.

Each chkobba adds one more point. Games go to 11, 21 or 31. If both sides reach the target, the higher score wins; a tie plays another hand.

## Run it

```bash
npm install
npm run dev          # game server on :3000 + Vite on :5173 (proxied)
```

Open http://localhost:5173, create a table, and open the invite link in another browser (or a private window) to play against yourself. You can also add bots. Dev-only sheets: `/card-preview.html` (card art) and `/avatar-preview.html` (every crew member's portrait beside their 3D figure).

```bash
npm test             # rules engine, bots, and a multiplayer server suite over real sockets
npm run typecheck
npm run build        # client → dist/client, server → dist/server
npm start            # production server (serves the client too) on $PORT (default 3000)
```

### Docker

```bash
docker compose up -d --build     # http://localhost:3000 (KARTA_BIND=127.0.0.1:3510 to change the host side)
```

Production runs at https://karta.gamez.tn on `radyou.tn`: the repo is cloned in `/opt/games/karta` (read-only
deploy key, ssh alias `github-karta`), `~/bin/deploy-karta.sh` fast-forwards it to `origin/main` and rebuilds the
container (compose project `karta`) on `127.0.0.1:3510`, and the host Caddy proxies `karta.gamez.tn` to it.
Every push to `main` (except docs-only changes) runs that script through `.github/workflows/deploy.yml`.

## Deploying

Karta needs a long-running Node process with WebSockets. Render, Fly.io, Railway, a VPS or any container host works. Serverless platforms (for example Vercel functions) do not, because they can't keep the Socket.IO connections open.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000`) |
| `STUN_URLS` | Comma-separated STUN URLs (default: Google's public STUN) |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | A TURN server for voice chat behind strict NATs or firewalls (recommended in production) |
| `ICE_SERVERS_JSON` | Full `RTCIceServer[]` JSON. Overrides the STUN and TURN variables above |
| `CORS_ORIGIN` | Only if the client is served from a different origin |

Voice audio flows directly between browsers (a mesh, up to 12 people per table). Without TURN, players behind symmetric NATs (some mobile networks and corporate Wi-Fi) may not hear each other. A TURN server such as coturn or a hosted TURN service fixes that. Browsers only allow microphone access on `https://` or `localhost`.

## How it's built

```
src/shared/   rules engine (chkobba.ts), deck (cards.ts), bots (bot.ts), socket protocol (protocol.ts)
src/server/   Express + Socket.IO: rooms, seats, spectators, game flow, timers, bots, voice signaling
src/client/
  game3d/     Three.js scene: terrace, table, card meshes and art, avatars and characters (the crew's beards,
              hair, glasses and outfits in features.ts and outfits.ts), drinks and smoke, animation system,
              board controller, portrait renderer for the café menu
  ui/         DOM overlay: home, lobby, café menu, HUD, name tags, results, chat, reactions, voice panel
  voice.ts    WebRTC mesh voice chat
  sfx.ts      WebAudio procedural sound effects (drinkAudio.ts plays the drinking recordings)
test/         vitest: engine, bots, end-to-end server tests with socket.io-client
```

The server is authoritative. It deals with a cryptographically secure shuffle, checks every move, and sends each player only their own hand. Clients play back server events (deal, play, capture, chkobba, end of hand) as animations, then snap to the authoritative snapshot, so a refresh or reconnect always restores the table exactly.
