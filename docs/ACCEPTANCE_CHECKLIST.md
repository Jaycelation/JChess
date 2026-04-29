# Acceptance Checklist

## 1. MongoDB Schema

- [x] User model exists.
- [x] FriendRequest model exists.
- [x] Friendship model exists.
- [x] Game model exists.
- [x] Conversation model exists.
- [x] Message model exists.
- [x] ExternalChessProfile model exists.
- [x] Game stores `currentFen`.
- [x] Game stores `pgn` and embedded `moves`.
- [x] Game has `status`, `winnerId`, `socketRoom`, `roomCode`, `turn`.
- [x] Game has `timeControl` and `clocks`.
- [x] Game status includes `timeout`.
- [x] `currentFen` is the move-validation source of truth.
- [x] `turn` is treated as a cache and validation uses `chess.turn()`.
- [x] User, friend, game, conversation, and message indexes are declared.
- [x] FriendRequest pending uniqueness uses a Mongoose partial index.

## 2. WebSocket Architecture

- [x] Socket auth uses JWT handshake.
- [x] Socket stores authenticated user in `socket.data.user`.
- [x] Matchmaking events exist.
- [x] Private room events exist.
- [x] Gameplay events exist.
- [x] Chat/social events exist.
- [x] Each game uses `game:{gameId}` Socket.io room.
- [x] Each direct conversation can use `conversation:{conversationId}` room.
- [x] Payloads do not trust client-provided userId.

## 3. Matchmaking Logic

- [x] In-memory queue exists.
- [x] Server pops two different users when queue has at least two entries.
- [x] Server creates a MongoDB Game.
- [x] Server creates `gameId` and `socketRoom`.
- [x] Server assigns white/black randomly.
- [x] Server emits `matchmaking:matched`.

## 4. Move Validation

- [x] Frontend validates with chess.js before emitting.
- [x] Backend validates with chess.js before saving or broadcasting.
- [x] Server checks game membership.
- [x] Server checks turn ownership.
- [x] Server computes turn ownership from `Chess(game.currentFen).turn()`.
- [x] Server does not broadcast invalid moves.
- [x] Server updates FEN and PGN after valid moves.

## 5. Realtime Chat

- [x] Game chat only emits to the game room.
- [x] Direct message emits to the conversation room and participant personal rooms.
- [x] Message is saved to MongoDB.
- [x] Message stores senderId, receiverId or game/conversation id, content, and timestamps.

## 6. Security

- [x] REST API uses JWT middleware.
- [x] Socket.io uses JWT middleware.
- [x] Server does not trust userId from client payloads.
- [x] Server checks game membership.
- [x] Server checks conversation membership.
- [x] Disconnect/reconnect grace flow exists for active games.
