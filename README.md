# Karta · كارطة

**Tunisian card games online, with friends.** Karta has **Chkobba** (شكبّة), Tunisia's favourite café game, and **Belote** (بلوت), the trick-taking game of the cafés, played on a cartoon 3D terrace in Sidi Bou Said. Rami is planned next.

- **Two games, one table.** Pick Chkobba or Belote on the home screen; the host can switch games in the lobby.
- **1 vs 1 or 2 vs 2** for Chkobba; Belote is played 2 vs 2. Partners sit opposite each other.
- **Public and private tables.** Every table shows up live in the list of tables on the home screen, with its game, host, seats and whether a game is on. Anyone can join a **public** table from the list (or watch one that is full or playing). A **private** table is listed without its code: picking it asks for the 5-letter code, so only friends who have it (or the share link, `/room/ABCDE`) get in. The host chooses when creating the table and can switch in the lobby. A connection that keeps typing wrong codes is stopped for a minute.
- **Spectators.** Anyone can watch with the link (`?watch=1`), or by joining a full table. Spectators can rotate the view and take over a bot's seat or an away player's seat.
- **Voice chat.** Peer-to-peer WebRTC voice for players and spectators, with mute, deafen, per-person volume, push-to-talk (hold **V**), and avatar mouths that move when people talk.
- **Bots** in three levels (easy, normal, hard) to fill empty seats, in both games. A bot also plays for anyone who drops out, until they reconnect.
- **Your café persona.** Pick who you are at the table: eight regulars (El Hajj in his red chechia, the bald café boss in shades, a grandma in her polka-dot headscarf, a curly-haired student…) with a skin tone and a shirt colour, or one of **the crew**, eleven friends drawn after their own avatars: Rafaa, NiNi Nina, Tha3loub, ta7foun, Sn0opr, Bou3ish, 7saan, habboub, Gratos, Birrrraa3 and Snoussi, each with their own hair, beard, glasses, hat and clothes at the table and their picture in the menus. Picking one of the crew also gives you their name, unless you typed your own; bots stick to the regulars. Then order: an express, a tea with pine nuts, a Boga Cidre, or a chicha that stands beside your chair. Tap your drink on the table (or press **D**) to take a sip or a puff, with real drinking sounds; everyone at the table sees and hears it, and bots sip theirs now and then.
- **Quality of life:** an optional turn timer, reconnecting to your seat after a refresh, text chat, quick Tunisian reactions ("Ya3tik sa77a!", "Mabrouk!"), a rules screen, and procedural sound effects (darbuka on a chkobba!).
- **All art is drawn in code.** Card faces (figures wearing a chechia, a golden 7♦, and the 8, 9 and 10 of the Belote deck), the trump token, the terrace, the avatars (the crew's included) and the drinks need no external assets. The exceptions are the crew's portraits in `src/client/assets/crew/` (cropped from their avatars, for the menus) and the four drinking recordings in `src/client/assets/sounds/` (each holds several sips; the game finds them by loudness and plays one per tap). Sound effects are synthesized.

## Chkobba rules implemented

40-card deck, with Queen = 8, Jack = 9 and King = 10. Each player gets 3 cards and 4 go face up on the table. If 3 or more of those table cards share a rank, the cards are redealt. Play goes anticlockwise and the deal passes to the right.

You must capture when you can. A card of the same rank must be taken before any combination that adds up to your card's value. Sweeping the table is a **chkobba** (1 point), except with the last card of the hand. Cards left on the table at the end go to whoever captured last.

At the end of each hand, one point each goes to:
- **Karta:** most cards; 20–20 scores nothing.
- **Dinari:** most diamonds; 5–5 scores nothing.
- **Bermila:** most 7s, then most 6s if tied.
- **Sab'a el Haya:** the 7♦.

Each chkobba adds one more point. Games go to 11, 21 or 31. If both sides reach the target, the higher score wins; a tie plays another hand.

## Belote rules implemented

Tunisian Belote, as Tunisian cafés play it: *belote coinchée* with the Tunisian scale. 32 cards (7 to Ace), four players in two teams, partners opposite. Play goes anticlockwise and the deal passes to the right. The rules follow the ones collected and checked with Tunisian players by the [Kaboot Dineri](https://github.com/othmansouhayl/belote) project, without its house rules (see below).

- **Deal:** 8 cards each, in two lots of 4; no card is turned up.
- **Auction:** from the dealer's right, each player bids a value and a trump suit — 90 to 160 in tens, or **Kabbout** (كبوط: all eight tricks), the highest bid — or passes. Each bid must beat the last; a player may bid again after passing, and may overbid their partner. The other team may say **contre** (×2) to the best bid; the bidders may then answer **surcontre** (×4), which ends the auction. Three passes after a bid end it; four passes with no bid and the next dealer deals again.
- **Play:** the player on the dealer's right leads. You must follow suit; on a trump lead you must beat the best trump if you can. If you cannot follow suit and your partner is winning the trick, you may play anything — unless you hold nothing but trumps, then you must beat the best trump if you can; otherwise you must trump — overtrumping if you can, with a lower trump if you can't. Trumps rank J 9 A 10 K Q 8 7 (20, 14, 11, 10, 4, 3, 0, 0 points), other suits A 10 K Q J 9 8 7 (11, 10, 4, 3, 2, 0, 0, 0); the last trick is worth 10 more, 162 in all.
- **Belote / Rebelote:** King and Queen of trumps in one hand, 20 points, called as they are played. They count toward the contract and are never doubled. No other announcements.
- **Scoring:** each team's card points are rounded to the ten (5 and up rounds up: 96/66 make 100/70), then the belote is added. The bidders must make their bid **and** more than the other team; then each team scores what it made, or 250 for the bidders if they took every trick. Otherwise it is a **chute**: the other team scores 160 (plus the belote, whoever held it). A Kabbout is worth 500, won or lost. After a contre, a contract made scores 160 ×2 (×4 after surcontre; 250 ×2 or ×4 with every trick) for the bidders, a failed one the same for the other team, the belote added undoubled.
- **Thrown in:** as soon as the bid can no longer be made — even winning every trick left — the cards are thrown in and the chute is scored; a Kabbout is lost with the first trick the other team wins.

Games go to 1000, 1500 (the default) or 2000; if both teams reach the target, the higher total wins, and a tie plays another hand. Players can look at the last trick at any time.

Left out, as house rules of one town: the "stolen colour" win, minimum bids that depend on the trumps held, bid timers, claiming the remaining tricks, playing a lone legal card automatically, and matches of several games.

## Run it

```bash
npm install
npm run dev          # game server on :3000 + Vite on :5173 (proxied)
```

Open http://localhost:5173, create a table, and open the invite link in another browser (or a private window) to play against yourself. You can also add bots. Dev-only sheets: `/card-preview.html` (card art) and `/avatar-preview.html` (every crew member's portrait beside their 3D figure).

```bash
npm test             # rules engines, bots, layouts, and a multiplayer server suite over real sockets (both games)
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

Voice chat's TURN relay is coturn on the same server, in `/opt/coturn` (a copy of [`docs/coturn/`](docs/coturn/),
with the address and the secret filled in), on host networking: ufw opens `3478` udp+tcp and `50000:51999/udp`.
`/opt/games/karta/.env` sets `TURN_URLS` (`karta.gamez.tn:3478`, UDP and TCP) and `TURN_SECRET`, the same value as
`static-auth-secret` in `/opt/coturn/turnserver.conf`.

## Deploying

Karta needs a long-running Node process with WebSockets. Render, Fly.io, Railway, a VPS or any container host works. Serverless platforms (for example Vercel functions) do not, because they can't keep the Socket.IO connections open.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000`) |
| `STUN_URLS` | Comma-separated STUN URLs (default: Google's public STUN) |
| `TURN_URLS` | Comma-separated TURN URLs for voice chat behind strict NATs or firewalls (recommended in production), e.g. `turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp` |
| `TURN_SECRET` | coturn's `static-auth-secret` (`use-auth-secret` mode): each player gets their own TURN credentials, valid for a day |
| `TURN_USERNAME`, `TURN_CREDENTIAL` | Fixed TURN credentials instead, handed to every player as they are |
| `ICE_SERVERS_JSON` | Full `RTCIceServer[]` JSON. Overrides the STUN and TURN variables above |
| `CORS_ORIGIN` | Only if the client is served from a different origin |

Voice audio flows directly between browsers (a mesh, up to 12 people per table). Without TURN, players behind symmetric NATs may not hear each other: that includes most phones on mobile data (carrier-grade NAT) and some corporate Wi-Fi. A TURN server such as coturn or a hosted TURN service fixes that; the browser console logs how each voice link connected (`host`/`srflx` is direct, `relay` went through TURN). Browsers only allow microphone access on `https://` or `localhost`.

## How it's built

```
src/shared/   rules engines (chkobba.ts, belote.ts), decks (cards.ts), bots (bot.ts, beloteBot.ts), socket protocol (protocol.ts)
src/server/   Express + Socket.IO: rooms, the live list of tables, seats, spectators, game flow, timers, bots,
              voice signaling; each game plugs into the room through tables.ts
src/client/
  game3d/     Three.js scene: terrace, table, card meshes and art, avatars and characters (the crew's beards,
              hair, glasses and outfits in features.ts and outfits.ts), drinks and smoke, animation system,
              board controller (Chkobba captures, Belote auction and tricks), trump token, portrait renderer
  ui/         DOM overlay: home (with the list of tables), lobby, café menu, HUD, name tags, bidding, results, chat,
              reactions, voice panel
  voice.ts    WebRTC mesh voice chat
  sfx.ts      WebAudio procedural sound effects (drinkAudio.ts plays the drinking recordings)
test/         vitest: engine, bots, end-to-end server tests with socket.io-client
```

The server is authoritative. It deals with a cryptographically secure shuffle, checks every move, and sends each player only their own hand. Clients play back server events (deal, play, capture, chkobba, end of hand) as animations, then snap to the authoritative snapshot, so a refresh or reconnect always restores the table exactly.
