# JChess MERN Realtime Chess MVP

Small MERN + Socket.io boilerplate for an online chess MVP.

## Structure

- `server/`: Express, Socket.io, MongoDB, Mongoose, JWT, bcrypt, chess.js.
- `client/`: Vite, React, Tailwind CSS, react-chessboard, chess.js, socket.io-client.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create server env:

```bash
cp server/.env.example server/.env
```

3. Start MongoDB locally or point `MONGO_URI` to MongoDB Atlas.

4. Run backend:

```bash
npm run dev:server
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

- Register/login through REST.
- Put the JWT in the client token field.
- Click Find Match in two browser sessions.
- Server creates a MongoDB game, assigns colors, joins both sockets to `game:{gameId}`.
- Client validates moves with chess.js before emitting.
- Server validates moves again with chess.js before saving and broadcasting.

## Core REST Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users/search?username=`
- `PATCH /api/users/me`
- `POST /api/users/me/chesscom-link`
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
