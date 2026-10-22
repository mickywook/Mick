"""Bull put spread P&L chart (at expiry and today) plus model rho per leg.

Usage: python3 spread_chart.py OUT.png TICKER EXPIRY STOCK DTE SHORT_K SHORT_IV LONG_K LONG_IV CREDIT QTY \
       SHORT_DELTA SHORT_GAMMA SHORT_THETA SHORT_VEGA LONG_DELTA LONG_GAMMA LONG_THETA LONG_VEGA
Leg greeks are IBKR per-share values for one long option; rho comes from the model.
"""
import math, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
R = 0.04

def put(S, K, T, s):
    if T <= 0:
        return max(K - S, 0), 0.0
    d1 = (math.log(S / K) + (R + s * s / 2) * T) / (s * math.sqrt(T))
    d2 = d1 - s * math.sqrt(T)
    price = K * math.exp(-R * T) * N(-d2) - S * N(-d1)
    rho = -K * T * math.exp(-R * T) * N(-d2) / 100
    return price, rho

out, tkr, expiry = sys.argv[1:4]
S0, DTE, KS, IVS, KL, IVL, CREDIT, QTY = map(float, sys.argv[4:12])
M, T0 = 100 * QTY, DTE / 365
width = KS - KL

def pnl(S, T):
    return (put(S, KL, T, IVL)[0] - put(S, KS, T, IVS)[0] + CREDIT) * M

rs, rl = put(S0, KS, T0, IVS)[1], put(S0, KL, T0, IVL)[1]
sg = [float(x) for x in sys.argv[12:16]] + [rs]
lg = [float(x) for x in sys.argv[16:20]] + [rl]
short_row = [-v * M for v in sg]
long_row = [v * M for v in lg]
total_row = [a + b for a, b in zip(short_row, long_row)]
fmt = ("{:+.2f}", "{:+.4f}", "{:+.2f}", "{:+.2f}", "{:+.2f}")
greek_rows = [[f"Sell {KS:g} put"] + [f.format(v) for f, v in zip(fmt, short_row)],
              [f"Buy {KL:g} put"] + [f.format(v) for f, v in zip(fmt, long_row)],
              ["Total"] + [f.format(v) for f, v in zip(fmt, total_row)]]
for r in greek_rows:
    print(" | ".join(r))
for pct in (-15, -10, -5, 0, 5, 10):
    S = S0 * (1 + pct / 100)
    print(f"{pct:+d}% {S:.2f} today {pnl(S, T0):+.0f} expiry {pnl(S, 0):+.0f}")

SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
BLUE, ORANGE = "#2a78d6", "#eb6834"
xs = np.linspace(KL - 0.06 * S0, S0 * 1.08, 401)
BE, alert = KS - CREDIT, (S0 + KS) / 2
gain, loss = CREDIT * M, (width - CREDIT) * M

fig, (ax, tax) = plt.subplots(2, 1, figsize=(11, 8), facecolor=SURF,
                             gridspec_kw={"height_ratios": [4, 1.1]})
ax.set_facecolor(SURF)
for s in ("top", "right"):
    ax.spines[s].set_visible(False)
for s in ("left", "bottom"):
    ax.spines[s].set_color(GRID)
ax.grid(color=GRID, linewidth=0.8)
ax.axhline(0, color=INK2, linewidth=0.8)
ax.plot(xs, [pnl(S, 0) for S in xs], color=BLUE, linewidth=2, label="At expiry")
ax.plot(xs, [pnl(S, T0) for S in xs], color=ORANGE, linewidth=2, label="Today (T+0)")
ax.axvline(S0, color=INK2, linewidth=1, linestyle="--")
for x, lbl in ((BE, f"B/E {BE:.2f}"), (alert, f"50% alert {alert:.2f}"), (S0, f"{tkr} {S0:.2f}")):
    ax.axvline(x, color=GRID if x != S0 else INK2, linewidth=1.2, linestyle="-" if x != S0 else "--")
    ax.annotate(lbl, (x, -loss / 2), rotation=90, fontsize=9, color=INK2,
                xytext=(3, 0), textcoords="offset points", va="center")
ax.text(xs[-1], gain + 10, f"Max gain ${gain:.0f}", ha="right", fontsize=9, color=INK)
ax.text(xs[0], -loss + 10, f" Max loss ${loss:.0f}", fontsize=9, color=INK)
ax.set_xlim(xs[0], xs[-1])
ax.set_ylim(-loss - 40, gain + 50)
ax.set_xlabel(f"{tkr} price ($)", color=INK2)
ax.set_ylabel("P&L ($)", color=INK2)
ax.tick_params(colors=INK2)
ax.legend(loc="lower right", frameon=False)
ax.set_title(f"{tkr} {expiry} {KS:g}/{KL:g} Bull Put  |  {QTY:g} contract(s)  |  credit \\${CREDIT:.2f}  |  {DTE:g} DTE",
             loc="left", fontsize=12, fontweight="bold", color=INK)
tax.axis("off")
tbl = tax.table(cellText=greek_rows,
                colLabels=["Leg", "Delta", "Gamma", "Theta $/day", "Vega $/vol pt", "Rho $/1%"],
                loc="center", cellLoc="center")
tbl.auto_set_font_size(False)
tbl.set_fontsize(10)
tbl.scale(1, 1.6)
for (r, c), cell in tbl.get_celld().items():
    cell.set_edgecolor(GRID)
    cell.set_facecolor(SURF)
    if r == 0 or r == len(greek_rows):
        cell.set_text_props(fontweight="bold", color=INK)
tax.set_title("Greeks (whole position, x100)", loc="left", fontsize=11, fontweight="bold", color=INK)
fig.text(0.01, 0.01, f"Black-Scholes, leg IVs {IVS:.1%} / {IVL:.1%}, {R:.0%} rate, no dividend. Greeks: IBKR live; rho from model.",
         fontsize=8.5, color=INK2)
fig.tight_layout(rect=(0, 0.03, 1, 1))
fig.savefig(out, dpi=130, facecolor=SURF)
print("saved", out)
