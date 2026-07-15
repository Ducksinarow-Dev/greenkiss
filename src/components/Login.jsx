import React, { useState, useEffect } from 'react';
import { C, getUsers, setCurrentUser, REMOTE_MODE, remoteLogin, remoteLoginOptions } from '../globals.js';
import { Btn, Icon } from './shared.jsx';

function Login({ onLogin }) {
  const [users, setUsers] = useState(() => REMOTE_MODE ? [] : getUsers());
  const [loadingUsers, setLoadingUsers] = useState(REMOTE_MODE);
  const [selectedId, setSelectedId] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!REMOTE_MODE) return;
    let alive = true;
    remoteLoginOptions()
      .then(list => { if (!alive) return; setUsers(list); setSelectedName(list[0]?.name || ""); })
      .catch(() => { if (alive) setError("Couldn't reach the server. Check your connection and reload."); })
      .finally(() => { if (alive) setLoadingUsers(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!REMOTE_MODE && users.length && !selectedId) setSelectedId(users[0].id);
  }, [users, selectedId]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (REMOTE_MODE) {
      if (!selectedName) { setError("Pick your name."); return; }
      setBusy(true);
      try {
        await remoteLogin(selectedName, pin);
        onLogin();
      } catch (err) {
        setError(err.message || "That PIN doesn't match.");
        setPin("");
      } finally {
        setBusy(false);
      }
      return;
    }
    const user = users.find(u => u.id === selectedId);
    if (!user) { setError("Pick your name."); return; }
    if (String(user.pin) !== String(pin)) { setError("That PIN doesn't match."); setPin(""); return; }
    setCurrentUser({ id: user.id, name: user.name, role: user.role });
    onLogin();
  };

  const isSelected = (u) => REMOTE_MODE ? selectedName === u.name : selectedId === u.id;
  const selectUser = (u) => { if (REMOTE_MODE) setSelectedName(u.name); else setSelectedId(u.id); setError(""); };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="gk-fade-in" style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: C.moss, margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center", boxShadow: C.shadowMd,
          }}>
            <Icon name="spa" size={30} style={{ color: "#fff" }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.txt, letterSpacing: -0.3 }}>The Green Kiss</div>
          <div style={{ fontSize: 14, color: C.mut, marginTop: 4 }}>SOPs &amp; task manager</div>
        </div>

        <form onSubmit={submit} style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: C.txt2, display: "block", marginBottom: 8 }}>Who's this?</label>
            {loadingUsers ? (
              <div style={{ fontSize: 13, color: C.mut, padding: "8px 0" }}>Loading…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {users.map(u => (
                  <button key={u.id} type="button" onClick={() => selectUser(u)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10,
                      border: `1.5px solid ${isSelected(u) ? C.moss : C.bdr}`,
                      background: isSelected(u) ? C.mossSoft : C.sur, cursor: "pointer",
                      fontFamily: "inherit", textAlign: "left", transition: "all .15s",
                    }}>
                    <div style={{ width: 30, height: 30, borderRadius: 99, background: C.moss, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{u.name}</div>
                      {u.role && <div style={{ fontSize: 12, color: C.mut, textTransform: "capitalize" }}>{u.role}</div>}
                    </div>
                  </button>
                ))}
                {users.length === 0 && <div style={{ fontSize: 13, color: C.mut }}>No users yet. Ask an admin to add one.</div>}
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: C.txt2, display: "block", marginBottom: 8 }}>PIN</label>
            <input
              type="password" inputMode="numeric" autoComplete="off" value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
              placeholder="••••"
              style={{
                width: "100%", background: C.inset, border: `1.5px solid ${error ? C.red : C.bdr}`,
                borderRadius: 9, padding: "12px 14px", fontSize: 20, letterSpacing: 6, textAlign: "center",
                color: C.txt, outline: "none", fontFamily: "'IBM Plex Mono',monospace",
              }}
            />
          </div>

          {error && <div style={{ fontSize: 13, color: C.red, fontWeight: 600, textAlign: "center" }}>{error}</div>}

          <Btn type="submit" disabled={busy} style={{ justifyContent: "center", padding: "12px 20px", fontSize: 16 }}>
            {busy ? "Logging in…" : "Log In"}
          </Btn>
        </form>
      </div>
    </div>
  );
}

export default Login;
