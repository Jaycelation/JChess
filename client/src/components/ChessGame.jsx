import { Chess } from "chess.js";
import { Circle, Flag, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { createAuthedSocket } from "../lib/socket.js";

const initialChess = new Chess();

function turnLabel(turn) {
  return turn === "w" ? "White" : "Black";
}

function isMyTurn(color, turn) {
  return (color === "white" && turn === "w") || (color === "black" && turn === "b");
}

export default function ChessGame({ token }) {
  const socketRef = useRef(null);
  const chessRef = useRef(new Chess());
  const currentUserIdRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState("Not connected");
  const [uiStatus, setUiStatus] = useState("connecting");
  const [gameId, setGameId] = useState("");
  const [fen, setFen] = useState(initialChess.fen());
  const [pgn, setPgn] = useState("");
  const [color, setColor] = useState(null);
  const [turn, setTurn] = useState("w");
  const [gameStatus, setGameStatus] = useState("idle");
  const [clocks, setClocks] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const socket = createAuthedSocket(token);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSocketStatus("Connected");
      setUiStatus((previous) => (previous === "connecting" ? "idle" : previous));
    });

    socket.on("connect_error", (err) => {
      setConnected(false);
      setSocketStatus(err.message || "Socket connection failed");
      setUiStatus("connecting");
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setSocketStatus("Disconnected");
      setUiStatus("connecting");
    });

    socket.on("socket:connected", (payload) => {
      currentUserIdRef.current = payload.userId;
    });

    socket.on("matchmaking:joined", () => {
      setUiStatus("searching");
      setError("");
    });

    socket.on("matchmaking:cancelled", () => {
      setUiStatus("idle");
    });

    socket.on("matchmaking:error", (payload) => {
      setError(payload.message);
      setUiStatus("idle");
    });

    socket.on("matchmaking:matched", (payload) => {
      setUiStatus("matched");
      setGameId(payload.gameId);
      setColor(payload.color);
      setOpponent(payload.opponent);
      setTurn(payload.turn);
      setGameStatus(payload.status);
      setClocks(payload.clocks || null);
      setError("");

      const nextChess = new Chess(payload.initialFen);
      chessRef.current = nextChess;
      setFen(nextChess.fen());

      socket.emit("game:join", { gameId: payload.gameId });
    });

    socket.on("room:ready", (payload) => {
      setUiStatus("matched");
      setGameId(payload.gameId);
      setColor(payload.color);
      setOpponent(payload.opponent);
      setTurn(payload.turn);
      setGameStatus(payload.status);
      setClocks(payload.clocks || null);
      setError("");

      const nextChess = new Chess(payload.initialFen);
      chessRef.current = nextChess;
      setFen(nextChess.fen());

      socket.emit("game:join", { gameId: payload.gameId });
    });

    socket.on("game:state", (payload) => {
      const nextChess = new Chess(payload.fen);
      chessRef.current = nextChess;
      setFen(nextChess.fen());
      setPgn(payload.pgn || "");
      setTurn(payload.turn);
      setGameStatus(payload.status);
      setClocks(payload.clocks || null);
      setGameId(payload.gameId);
      setUiStatus(payload.status === "active" ? "in_game" : "ended");

      const currentUserId = currentUserIdRef.current;

      if (currentUserId && payload.whitePlayerId === currentUserId) {
        setColor("white");
      } else if (currentUserId && payload.blackPlayerId === currentUserId) {
        setColor("black");
      }
    });

    socket.on("game:moveMade", (payload) => {
      const nextChess = new Chess(payload.fen);
      chessRef.current = nextChess;
      setFen(nextChess.fen());
      setPgn(payload.pgn || "");
      setTurn(payload.turn);
      setGameStatus(payload.status);
      setClocks(payload.clocks || null);
      setLastMove(payload.move);
      setUiStatus(payload.status === "active" ? "in_game" : "ended");
      setError("");
    });

    socket.on("game:ended", (payload) => {
      setGameStatus(payload.status);
      setUiStatus("ended");
      setError(payload.winnerId ? `Game ended: ${payload.reason}` : "Game ended as draw");
    });

    socket.on("game:error", (payload) => {
      setError(payload.message);
      setFen(chessRef.current.fen());
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  function findMatch() {
    if (!socketRef.current || !connected) {
      setError("Socket is not connected");
      return;
    }

    setUiStatus("searching");
    setError("");
    socketRef.current.emit("matchmaking:join", {
      timeControl: "rapid",
      rated: false
    });
  }

  function cancelMatchmaking() {
    socketRef.current?.emit("matchmaking:cancel");
  }

  function resign() {
    if (!gameId) {
      return;
    }

    socketRef.current?.emit("game:resign", { gameId });
  }

  function onPieceDrop(sourceSquare, targetSquare) {
    if (!gameId || gameStatus !== "active") {
      setError("No active game");
      return false;
    }

    if (!isMyTurn(color, turn)) {
      setError("Not your turn");
      return false;
    }

    const candidate = new Chess(chessRef.current.fen());
    let move = null;

    try {
      move = candidate.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q"
      });
    } catch (_err) {
      move = null;
    }

    if (!move) {
      setError("Illegal move");
      return false;
    }

    setFen(candidate.fen());
    setError("");

    socketRef.current?.emit("game:move", {
      gameId,
      from: sourceSquare,
      to: targetSquare,
      promotion: "q"
    });

    return true;
  }

  const boardOrientation = color === "black" ? "black" : "white";
  const statusTone = connected ? "text-emerald-700" : "text-red-700";
  const canFindMatch = connected && !["searching", "matched", "in_game"].includes(uiStatus);
  const canResign = Boolean(gameId) && uiStatus === "in_game" && gameStatus === "active";

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(320px,680px)_minmax(280px,360px)]">
      <div className="min-w-0">
        <div className="aspect-square w-full overflow-hidden rounded-md border border-[#c9bda6] bg-white shadow-sm">
          <Chessboard
            boardOrientation={boardOrientation}
            boardWidth={Math.min(680, Math.max(320, window.innerWidth - 32))}
            customDarkSquareStyle={{ backgroundColor: "#50705a" }}
            customLightSquareStyle={{ backgroundColor: "#e8dcc2" }}
            onPieceDrop={onPieceDrop}
            position={fen}
          />
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <section className="rounded-md border border-[#d7cab1] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Match</h2>
            <span className={`inline-flex items-center gap-2 text-sm ${statusTone}`}>
              <Circle size={10} fill="currentColor" />
              {socketStatus}
            </span>
          </div>

          <div className="grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-stone-600">UI state</span>
              <span className="font-medium">{uiStatus}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-stone-600">Game</span>
              <span className="font-medium">{gameStatus}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-stone-600">Color</span>
              <span className="font-medium">{color || "-"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-stone-600">Turn</span>
              <span className="font-medium">{turnLabel(turn)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-stone-600">Opponent</span>
              <span className="truncate font-medium">{opponent?.username || "-"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-stone-600">Last move</span>
              <span className="font-medium">{lastMove?.san || "-"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-stone-600">Clock</span>
              <span className="font-medium">
                {clocks
                  ? `${Math.ceil(clocks.whiteMs / 1000)}s / ${Math.ceil(clocks.blackMs / 1000)}s`
                  : "-"}
              </span>
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {uiStatus === "searching" ? (
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold"
                type="button"
                onClick={cancelMatchmaking}
              >
                <X size={16} />
                Cancel
              </button>
            ) : (
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md bg-boardDark px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canFindMatch}
                type="button"
                onClick={findMatch}
              >
                <Search size={16} />
                Find Match
              </button>
            )}

            <button
              className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canResign}
              type="button"
              onClick={resign}
            >
              <Flag size={16} />
              Resign
            </button>
          </div>
        </section>

        <section className="rounded-md border border-[#d7cab1] bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">PGN</h2>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-stone-100 p-3 text-xs leading-relaxed text-stone-800">
            {pgn || "No moves yet"}
          </pre>
        </section>
      </aside>
    </section>
  );
}
