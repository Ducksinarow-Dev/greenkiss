import { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, canEdit, isAdmin, inp, triggerSaved,
  fetchShopifySales, getSalesTargets, saveSalesTargets, currentSalesTargets, MONTH_NAMES,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, SectionHeader, lbl } from './shared.jsx';

/* Store Update (#21): live Shopify sales vs seasonal targets, shown as
   speedometer gauges. Same "connect the integration" pattern as Omnisend —
   until the Shopify token is in config.php the gauges render in a labelled
   Sample state so the layout is still visible. */

const fmtMoney = (n, cur = "$") => cur + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/* Progress ramp for the gauge arc (#26): red → orange → yellow → green so a
   low number reads "behind" and staff feel it; calm green only near target.
   oklch keeps the steps perceptually even at a soft, low chroma so they stay
   pastel and on-brand (green anchored near the app's moss) rather than alarming. */
function gaugeColor(pct) {
  if (pct >= 0.9) return "oklch(0.66 0.09 150)";   // calm moss green — on/near target
  if (pct >= 0.75) return "oklch(0.80 0.11 132)";  // yellow-green
  if (pct >= 0.55) return "oklch(0.86 0.10 96)";   // soft yellow
  if (pct >= 0.35) return "oklch(0.79 0.11 62)";   // soft orange
  return "oklch(0.71 0.12 28)";                     // soft red — behind
}

/* Hand-rolled semicircle gauge — no chart dependency. Fills an arc from the
   left (0) to the right (target) proportional to value/target; caps the fill
   at 100% but shows the true percentage in the readout. */
function Speedometer({ value, target, label, currency = "$", size = 240, sample = false }) {
  const pct = target > 0 ? value / target : 0;
  const shown = Math.max(0, Math.min(pct, 1));
  const w = size, h = size * 0.60;
  const r = size * 0.40, cx = w / 2, cy = h - 4, sw = size * 0.075;
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const met = pct >= 1;
  const arcColor = gaugeColor(pct);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, opacity: sample ? 0.72 : 1 }}>
      <svg width={w} height={h + 4} viewBox={`0 0 ${w} ${h + 4}`} role="img"
        aria-label={`${label}: ${fmtMoney(value, currency)} of ${fmtMoney(target, currency)} target`}>
        <path d={track} fill="none" stroke={C.bdr} strokeWidth={sw} strokeLinecap="round" />
        {target > 0 && (
          <path d={track} fill="none" stroke={arcColor} strokeWidth={sw} strokeLinecap="round"
            pathLength={100} strokeDasharray="100" strokeDashoffset={100 - shown * 100} />
        )}
        {target > 0 ? (
          <>
            <text x={cx} y={cy - r * 0.26} textAnchor="middle" style={{ fontSize: size * 0.20, fontWeight: 800, fill: C.txt, fontFamily: "'IBM Plex Mono',monospace" }}>
              {Math.round(pct * 100)}%
            </text>
            <text x={cx} y={cy - r * 0.26 + size * 0.095} textAnchor="middle" style={{ fontSize: size * 0.057, fill: C.mut }}>
              {fmtMoney(value, currency)} / {fmtMoney(target, currency)}
            </text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - r * 0.26} textAnchor="middle" style={{ fontSize: size * 0.14, fontWeight: 800, fill: C.txt, fontFamily: "'IBM Plex Mono',monospace" }}>
              {fmtMoney(value, currency)}
            </text>
            <text x={cx} y={cy - r * 0.26 + size * 0.085} textAnchor="middle" style={{ fontSize: size * 0.055, fill: C.faint }}>
              no target set
            </text>
          </>
        )}
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt2, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>{label}</span>
        {met && target > 0 && <Icon name="check_circle" size={15} style={{ color: C.moss }} title="Target met" />}
      </div>
    </div>
  );
}

/* Seasonal target editor — one number per month, reused each year. */
function TargetEditor({ onClose }) {
  const [targets, setTargets] = useState(() => ({ ...getSalesTargets() }));
  const set = (m, v) => setTargets(t => ({ ...t, [m]: v }));
  const save = () => {
    // keep only real numbers, drop blanks
    const clean = {};
    for (let m = 1; m <= 12; m++) { const n = Number(targets[m]); if (n > 0) clean[m] = n; }
    saveSalesTargets(clean); triggerSaved(); onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{ background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", padding: 26 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>Monthly Sales Targets</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div style={{ fontSize: 13, color: C.mut, marginBottom: 16 }}>Set a sales goal for each month. These repeat every year, so busy seasons can carry higher targets. The daily gauge uses the month's target split evenly across its days.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {MONTH_NAMES.map((name, i) => {
            const m = i + 1;
            return (
              <div key={m}>
                <label style={lbl()}>{name}</label>
                <input type="number" min="0" inputMode="numeric" value={targets[m] ?? ""} onChange={e => set(m, e.target.value)}
                  placeholder="0" style={inp({ fontSize: 14, padding: "8px 10px" })} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={save}>Save targets</Btn>
        </div>
      </div>
    </div>
  );
}

function StoreUpdate({ user }) {
  const [sales, setSales] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const editable = canEdit(user);
  const admin = isAdmin(user);

  const load = async () => {
    setLoading(true); setError("");
    try { setSales(await fetchShopifySales()); }
    catch (err) { setError(err.message || "Couldn't load Shopify sales."); setSales(null); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [refresh]);

  const { monthly, daily, weekly } = currentSalesTargets();
  const connected = !!sales;
  const currency = sales?.currency ? (sales.currency === "USD" || sales.currency === "CAD" ? "$" : sales.currency + " ") : "$";
  // Not connected → illustrative sample (62% of target) so the gauges + layout
  // are still visible/verifiable; clearly labelled so nobody mistakes it for real.
  const todayVal = connected ? sales.today : daily * 0.62;
  const weekVal = connected ? sales.weekToDate : weekly * 0.62;
  const monthVal = connected ? sales.monthToDate : monthly * 0.62;

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Store Goals" sub="Today, this week, and month-to-date sales against your targets"
        right={editable && (
          <div style={{ display: "flex", gap: 8 }}>
            {admin && <OBtn onClick={() => setEditing(true)}><Icon name="tune" size={16} />Targets</OBtn>}
            <Btn onClick={() => setRefresh(r => r + 1)} disabled={loading}><Icon name="refresh" size={16} />{loading ? "Loading…" : "Refresh"}</Btn>
          </div>
        )} />

      {!connected && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: "12px 16px", marginBottom: 18 }}>
          <Icon name={error ? "error" : "info"} size={18} style={{ color: error ? C.red : C.clay }} />
          <div style={{ fontSize: 13, color: C.txt2 }}>
            {error
              ? error
              : "Shopify isn't connected yet — the gauges below are a sample. Add your Shopify credentials on the server to see live sales."}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", justifyContent: "center", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, padding: "26px 20px" }}>
        <Speedometer label="Today" value={todayVal} target={daily} currency={currency} sample={!connected} />
        <Speedometer label="This week" value={weekVal} target={weekly} currency={currency} sample={!connected} />
        <Speedometer label="Month to date" value={monthVal} target={monthly} currency={currency} sample={!connected} />
      </div>

      {connected && (
        <div style={{ fontSize: 12, color: C.faint, marginTop: 10, textAlign: "right" }}>
          Live from Shopify · {sales.timezone} · as of {new Date(sales.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
      )}
      {monthly === 0 && (
        <div style={{ fontSize: 13, color: C.mut, marginTop: 14, textAlign: "center" }}>
          No target set for {MONTH_NAMES[new Date().getMonth()]} yet.{admin ? " Use “Targets” to add one." : ""}
        </div>
      )}

      {editing && <TargetEditor onClose={() => { setEditing(false); setRefresh(r => r + 1); }} />}
    </div>
  );
}

export { Speedometer };
export default StoreUpdate;
