import axios from "axios";
import { LogOut } from "lucide-react";
import { useState } from "react";
import ChessGame from "./components/ChessGame.jsx";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function AuthPanel({ onToken }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : { username, email, password };
      const response = await axios.post(`${apiBaseUrl}${endpoint}`, body);

      localStorage.setItem("accessToken", response.data.accessToken);
      onToken(response.data.accessToken);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f2ea] px-4 py-8 text-ink">
      <section className="mx-auto flex max-w-md flex-col gap-5 rounded-md border border-[#d7cab1] bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">JChess</h1>
          <p className="mt-1 text-sm text-stone-600">Realtime chess MVP</p>
        </div>

        <div className="grid grid-cols-2 rounded-md border border-stone-300 p-1">
          <button
            className={`rounded px-3 py-2 text-sm font-medium ${
              mode === "login" ? "bg-ink text-white" : "text-stone-700"
            }`}
            type="button"
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            className={`rounded px-3 py-2 text-sm font-medium ${
              mode === "register" ? "bg-ink text-white" : "text-stone-700"
            }`}
            type="button"
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={submit}>
          {mode === "register" ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Username
              <input
                className="rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-boardDark"
                minLength={3}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input
              className="rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-boardDark"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Password
            <input
              className="rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-boardDark"
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            className="rounded-md bg-boardDark px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            {loading ? "Working..." : mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("accessToken") || "");

  function logout() {
    localStorage.removeItem("accessToken");
    setToken("");
  }

  if (!token) {
    return <AuthPanel onToken={setToken} />;
  }

  return (
    <main className="min-h-screen bg-[#f6f2ea] px-4 py-5 text-ink">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">JChess</h1>
            <p className="text-sm text-stone-600">Online match room</p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium shadow-sm"
            type="button"
            onClick={logout}
          >
            <LogOut size={16} />
            Logout
          </button>
        </header>

        <ChessGame token={token} />
      </div>
    </main>
  );
}
