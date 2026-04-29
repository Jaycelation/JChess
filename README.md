# JChess MERN Realtime Chess MVP

Small MERN + Socket.io boilerplate for an online chess MVP.

## Structure

- `backend/`: Node.js, Express, Socket.io, MongoDB, Mongoose, JWT, bcrypt, chess.js.
- `client/`: Vite, React, Tailwind CSS, react-chessboard, chess.js, socket.io-client.

Backend socket code is split into:

- `backend/src/sockets/index.js`: Socket.io auth, presence, chat wiring.
- `backend/src/sockets/matchmaking.js`: MVP in-memory matchmaking/private room logic.
- `backend/src/sockets/game.js`: game room, move validation, clocks, reconnect handling.

The in-memory matchmaking queue is only for a single-server MVP. Production should use a Redis-backed queue and the Socket.io Redis adapter so queue state and room broadcasts work across multiple Node.js instances.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create backend env:

```bash
cp backend/.env.example backend/.env
```

3. Start MongoDB locally or point `MONGO_URI` to MongoDB Atlas.

4. Run backend:

```bash
npm run dev:backend
```

5. In another terminal, create client env:

```bash
cp client/.env.example client/.env
```

6. Run frontend:

```bash
npm run dev:client
```

## MVP Flow

- Register/login through the client form. The JWT is stored in `localStorage`.
- Click Find Match in two browser sessions.
- Server creates a MongoDB game, assigns colors, joins both sockets to `game:{gameId}`.
- Client validates moves with chess.js before emitting.
- Server validates moves again from `game.currentFen`, saves FEN/PGN/moves/clocks, then broadcasts.
- `currentFen` is the source of truth. `turn` is a read cache, and the backend derives the active side from `chess.turn()` during `game:move`.

## Required Environment

Backend:

- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `CLIENT_ORIGIN`
- `RECONNECT_GRACE_MS`
- `CHESSCOM_USER_AGENT`
- `CHESSCOM_TIMEOUT_MS`

Client:

- `VITE_API_BASE_URL`
- `VITE_SOCKET_URL`

## Core REST Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users/search?username=`
- `PATCH /api/users/me`
- `POST /api/users/me/chesscom-link`
- `GET /api/external/chesscom/player/:username`
- `GET /api/external/chesscom/player/:username/stats`
- `GET /api/external/chesscom/player/:username/archives`
- `POST /api/friends/requests`
- `GET /api/friends/requests/incoming`
- `GET /api/friends/requests/outgoing`
- `PATCH /api/friends/requests/:id/accept`
- `PATCH /api/friends/requests/:id/reject`
- `DELETE /api/friends/requests/:id`
- `GET /api/friends`
- `GET /api/games/me/history`
- `GET /api/games/:gameId`
- `GET /api/games/:gameId/moves`
- `GET /api/conversations`
- `POST /api/conversations/direct`
- `GET /api/conversations/:conversationId/messages`

## Core Socket Events

- Auth/presence: `socket:connected`, `friend:online`, `friend:offline`
- Matchmaking: `matchmaking:join`, `matchmaking:cancel`, `matchmaking:matched`
- Private room: `room:create`, `room:join`, `room:ready`
- Gameplay: `game:join`, `game:state`, `game:move`, `game:moveMade`, `game:resign`, `game:ended`
- Chat: `conversation:join`, `chat:send`, `chat:message`, `chat:typing`, `chat:read`

See `docs/ACCEPTANCE_CHECKLIST.md` for the implementation checklist.

## Chess.com Public API Boundary

The Chess.com integration is optional and read-only. It can fetch public profile, stats, and archives for display/cache only. It is not used for gameplay, authentication, matchmaking, chat, or friend logic. Requests send a `User-Agent`, use a timeout, and surface rate-limit responses.
