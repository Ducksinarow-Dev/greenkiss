import { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, canEdit, isAdmin, inp, triggerSaved,
  fetchShopifySales, getSalesTargets, saveSalesTargets, currentSalesTargets, MONTH_NAMES,
  getDayTargets, saveDayTargets, todayLocalISO, fmtDate, salesPace,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, SectionHeader, lbl, Modal } from './shared.jsx';

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

/* How far through the current day / week (Mon-start) / month we are, plus a
   human "time left" label. Uses the viewer's local clock — staff are in the
   store's timezone, so this is close enough for a pace read (the sales numbers
   themselves still use the shop timezone server-side). */
function periodProgress(period) {
  const now = new Date();
  let start, end, remaining;
  if (period === "week") {
    start = new Date(now); const dow = (start.getDay() + 6) % 7; // Mon = 0
    start.setDate(start.getDate() - dow); start.setHours(0, 0, 0, 0);
    end = new Date(start); end.setDate(end.getDate() + 7);
    const d = Math.ceil((end - now) / 86400000);
    remaining = `${d} day${d === 1 ? "" : "s"} left this week`;
  } else if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const d = Math.ceil((end - now) / 86400000);
    remaining = `${d} day${d === 1 ? "" : "s"} left this month`;
  } else { // day
    start = new Date(now); start.setHours(0, 0, 0, 0);
    end = new Date(start); end.setDate(end.getDate() + 1);
    const ms = end - now, h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    remaining = h >= 1 ? `${h}h ${m}m left today` : `${m}m left today`;
  }
  return { pct: Math.min(1, Math.max(0, (now - start) / (end - start))), remaining };
}

/* Thin "time elapsed" bar shown under a gauge. Neutral fill (not the gauge's
   semantic colors) so it reads as a separate pace reference: if the time bar is
   fuller than the sales arc, you're behind. */
function TimeMeter({ period, width = 160 }) {
  const { pct, remaining } = periodProgress(period);
  return (
    <div style={{ width, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ height: 5, borderRadius: 99, background: C.bdr, overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: C.faint, borderRadius: 99 }} />
      </div>
      <div style={{ fontSize: 10.5, color: C.faint, textAlign: "center" }}>{remaining}</div>
    </div>
  );
}

/* Hand-rolled semicircle gauge — no chart dependency. Fills an arc from the
   left (0) to the right (target) proportional to value/target; caps the fill
   at 100% but shows the true percentage in the readout. */
function Speedometer({ value, target, label, currency = "$", size = 240, sample = false, timePeriod }) {
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
      {timePeriod && <TimeMeter period={timePeriod} width={size * 0.72} />}
    </div>
  );
}

/* Seasonal target editor — one number per month, reused each year. */
function TargetEditor({ onClose }) {
  const [targets, setTargets] = useState(() => ({ ...getSalesTargets() }));
  const set = (m, v) => setTargets(t => ({ ...t, [m]: v }));
  // Per-day overrides (#31) are edited alongside the monthly figures but
  // stored separately, so one can be cleared without touching the other.
  const [days, setDays] = useState(() => ({ ...getDayTargets() }));
  const [dayDate, setDayDate] = useState(todayLocalISO());
  const [dayAmt, setDayAmt] = useState("");
  const addDay = () => {
    const n = Number(dayAmt);
    if (!dayDate || !(n > 0)) return; // a blank or zero override would just hide the monthly figure
    setDays(d => ({ ...d, [dayDate]: n }));
    setDayAmt("");
  };
  const removeDay = (d) => setDays(prev => { const next = { ...prev }; delete next[d]; return next; });
  const save = () => {
    // keep only real numbers, drop blanks
    const clean = {};
    for (let m = 1; m <= 12; m++) { const n = Number(targets[m]); if (n > 0) clean[m] = n; }
    const cleanDays = {};
    for (const d of Object.keys(days)) { const n = Number(days[d]); if (n > 0) cleanDays[d] = n; }
    saveSalesTargets(clean); saveDayTargets(cleanDays); triggerSaved(); onClose();
  };
  return (
    <Modal onClose={onClose} scrim={0.35} zIndex={500} cardStyle={{ maxWidth: 460, maxHeight: "88vh", overflowY: "auto", padding: 26 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>Monthly Sales Targets</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div style={{ fontSize: 13, color: C.mut, marginBottom: 16 }}>Set a sales goal for each month. These repeat every year, so busy seasons can carry higher targets. The daily gauge uses the month's target split evenly across its days, unless that date has an override below.</div>
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

        {/* Per-day overrides (#31) — for the days monthly/days is simply wrong:
            a holiday, a sale, a market day. Kept in a separate kv doc so
            clearing one never disturbs the monthly figures. */}
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1.5px solid ${C.bdr}` }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.txt }}>Specific days</div>
          <div style={{ fontSize: 13, color: C.mut, marginTop: 4, marginBottom: 12 }}>
            Override a single date when the even split isn't realistic — a holiday, a sale,
            a market day. The month's total stays as you set it above.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 150px" }}>
              <label style={lbl()}>Date</label>
              <input type="date" value={dayDate} onChange={e => setDayDate(e.target.value)}
                style={inp({ fontSize: 14, padding: "8px 10px" })} />
            </div>
            <div style={{ flex: "1 1 110px" }}>
              <label style={lbl()}>Target</label>
              <input type="number" min="0" inputMode="numeric" value={dayAmt} onChange={e => setDayAmt(e.target.value)}
                placeholder="0" style={inp({ fontSize: 14, padding: "8px 10px" })} />
            </div>
            <Btn onClick={addDay} style={{ flex: "0 0 auto" }}><Icon name="add" size={16} />Add</Btn>
          </div>
          {Object.keys(days).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {Object.keys(days).sort().map(d => (
                <div key={d} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 11px",
                  background: C.inset, border: `1.5px solid ${C.bdr}`, borderRadius: 9,
                }}>
                  <span style={{ fontSize: 13, color: C.txt, flex: 1 }}>{fmtDate(d)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.txt, fontFamily: "'IBM Plex Mono',monospace" }}>
                    ${Number(days[d]).toLocaleString()}
                  </span>
                  <IconBtn icon="delete" danger title="Remove override" onClick={() => removeDay(d)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={save}>Save targets</Btn>
        </div>
    </Modal>
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

  const { monthly, daily, weekly, dayOverridden } = currentSalesTargets();
  const connected = !!sales;
  const currency = sales?.currency ? (sales.currency === "USD" || sales.currency === "CAD" ? "$" : sales.currency + " ") : "$";
  // Not connected → illustrative sample (62% of target) so the gauges + layout
  // are still visible/verifiable; clearly labelled so nobody mistakes it for real.
  const todayVal = connected ? sales.today : daily * 0.62;
  const weekVal = connected ? sales.weekToDate : weekly * 0.62;
  const monthVal = connected ? sales.monthToDate : monthly * 0.62;
  // #30: computed from the same figure the month gauge shows, so the sample
  // state gets a coherent sample pace rather than a blank or a wrong one.
  const pace = salesPace(monthVal);
  /* #30 comparison. Only shown with a real connection and a real previous
     figure: comparing the 62% SAMPLE against a live last month would invent a
     trend out of a placeholder. A previous month of exactly 0 is skipped too —
     "up 100%" from nothing is noise, not information. */
  const prevMonth = connected ? sales?.lastMonthToDate : null;
  const vsLast = (Number.isFinite(prevMonth) && prevMonth > 0 && monthVal >= 0)
    ? { prev: prevMonth, pct: ((monthVal - prevMonth) / prevMonth) * 100, up: monthVal >= prevMonth, days: new Date().getDate() }
    : null;

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
        <Speedometer label={dayOverridden ? "Today (set target)" : "Today"} value={todayVal} target={daily} currency={currency} sample={!connected} timePeriod="day" />
        <Speedometer label="This week" value={weekVal} target={weekly} currency={currency} sample={!connected} timePeriod="week" />
        <Speedometer label="Month to date" value={monthVal} target={monthly} currency={currency} sample={!connected} timePeriod="month" />
      </div>

      {/* #30 pace — what the gauges can't say: is month-to-date ahead of or
          behind what the targets called for by now. Completed days only. */}
      {pace && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginTop: 14,
          background: C.sur, border: `1.5px solid ${C.bdr}`,
          borderLeft: `4px solid ${pace.ahead ? C.moss : C.clay}`,
          borderRadius: 12, padding: "12px 16px",
        }}>
          <Icon name={pace.ahead ? "trending_up" : "trending_down"} size={22}
            style={{ color: pace.ahead ? C.moss : C.clay, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.txt }}>
              {currency}{Math.abs(Math.round(pace.delta)).toLocaleString()} {pace.ahead ? "ahead of" : "behind"} pace
              {!connected && <span style={{ fontSize: 12, fontWeight: 500, color: C.faint }}> · sample</span>}
            </div>
            <div style={{ fontSize: 12.5, color: C.mut, marginTop: 2 }}>
              {Math.round(pace.pct)}% of the {currency}{Math.round(pace.expected).toLocaleString()} expected
              through {pace.days} completed {pace.days === 1 ? "day" : "days"} this month.
              Today isn't counted yet.
            </div>
            {/* #30 comparison — the same slice of last month, so an 18th-of-
                the-month figure meets another 18-day figure. */}
            {vsLast && (
              <div style={{ fontSize: 12.5, color: C.mut, marginTop: 3 }}>
                <span style={{ color: vsLast.up ? C.moss : C.clay, fontWeight: 700 }}>
                  {vsLast.up ? "▲" : "▼"} {Math.abs(vsLast.pct).toFixed(0)}%
                </span>{" "}
                vs the same {pace.days === 1 ? "day" : `${vsLast.days} days`} of {sales?.lastMonthLabel || "last month"}
                {" "}({currency}{Math.round(vsLast.prev).toLocaleString()})
              </div>
            )}
          </div>
        </div>
      )}

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
