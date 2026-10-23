"""Cash-secured put P&L chart (at expiry and today) with a greeks table under it.

Usage: python3 csp_chart.py OUT.png TICKER EXPIRY STOCK DTE STRIKE IV CREDIT QTY DELTA GAMMA THETA VEGA BETA
Greeks are IBKR per-share values for one long put; rho comes from the model.
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
    return K * math.exp(-R * T) * N(-d2) - S * N(-d1), -K * T * math.exp(-R * T) * N(-d2) / 100

out, tkr, expiry = sys.argv[1:4]
S0, DTE, K, IV, CREDIT, QTY = map(float, sys.argv[4:10])
delta, gamma, theta, vega, BETA = map(float, sys.argv[10:15])
M, T0 = 100 * QTY, DTE / 365

def pnl(S, T):
    return (CREDIT - put(S, K, T, IV)[0]) * M

d, gm, th, vg, rh = (-v * M for v in (delta, gamma, theta, vega, put(S0, K, T0, IV)[1]))
fmt = lambda v, f="{:+.2f}": f.format(v)
row = [f"Sell {K:g} put", f"{-QTY:+g}", f"{delta:+.4f}", fmt(d), fmt(d * S0, "{:+,.0f}"),
       fmt(d * S0 * BETA, "{:+,.0f}"), fmt(gm, "{:+.4f}"), fmt(th), fmt(vg), fmt(rh)]
print(" | ".join(row))

SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
BLUE, ORANGE = "#2a78d6", "#eb6834"
xs = np.linspace(K * 0.75, S0 * 1.15, 401)
BE, gain = K - CREDIT, CREDIT * M
low = pnl(xs[0], 0)

fig, (ax, tax) = plt.subplots(2, 1, figsize=(12, 7.4), facecolor=SURF,
                             gridspec_kw={"height_ratios": [4, 0.8]})
ax.set_facecolor(SURF)
for s in ("top", "right"):
    ax.spines[s].set_visible(False)
for s in ("left", "bottom"):
    ax.spines[s].set_color(GRID)
ax.grid(color=GRID, linewidth=0.8)
ax.axhline(0, color=INK2, linewidth=0.8)
ax.plot(xs, [pnl(S, 0) for S in xs], color=BLUE, linewidth=2, label="At expiry")
ax.plot(xs, [pnl(S, T0) for S in xs], color=ORANGE, linewidth=2, label="Today (T+0)")
for x, lbl, style in ((BE, f"B/E {BE:.2f}", "-"), (S0, f"{tkr} {S0:.2f}", "--")):
    ax.axvline(x, color=GRID if style == "-" else INK2, linewidth=1.2, linestyle=style)
    ax.annotate(lbl, (x, low / 2), rotation=90, fontsize=9, color=INK2,
                xytext=(3, 0), textcoords="offset points", va="center")
ax.text(xs[-1], gain + abs(low) * 0.02, f"Max gain ${gain:,.0f}", ha="right", fontsize=9, color=INK)
ax.text(K, low, f"  Max loss ${(K - CREDIT) * M:,.0f} if the stock goes to zero", fontsize=9, color=INK, va="bottom")
ax.set_xlim(xs[0], xs[-1])
ax.set_xlabel(f"{tkr} price ($)", color=INK2)
ax.set_ylabel("P&L ($)", color=INK2)
ax.tick_params(colors=INK2)
ax.legend(loc="lower right", frameon=False)
ax.set_title(f"{tkr} {expiry} {K:g} Cash-Secured Put  |  {QTY:g} contract(s)  |  credit \\${CREDIT:.2f}  |  {DTE:g} DTE",
             loc="left", fontsize=12, fontweight="bold", color=INK)
tax.axis("off")
tbl = tax.table(cellText=[row], colLabels=["Leg", "Position", "δ (option)", "Δ (position)", "Delta $",
                                           f"Beta Δ $ (β {BETA:g})", "Gamma", "Theta $/day", "Vega $/vol pt", "Rho $/1%"],
                loc="center", cellLoc="center")
tbl.auto_set_font_size(False)
tbl.set_fontsize(9)
tbl.scale(1, 1.6)
for (r, c), cell in tbl.get_celld().items():
    cell.set_edgecolor(GRID)
    cell.set_facecolor(SURF)
    if r == 0:
        cell.set_text_props(fontweight="bold", color=INK)
tax.set_title("Greeks (δ = option per share; all other columns = position, x100, signed by side)",
              loc="left", fontsize=11, fontweight="bold", color=INK)
fig.text(0.01, 0.01, f"Black-Scholes, strike IV {IV:.1%}, {R:.0%} rate, no dividend. Greeks: IBKR; rho from model.",
         fontsize=8.5, color=INK2)
fig.tight_layout(rect=(0, 0.03, 1, 1))
fig.savefig(out, dpi=130, facecolor=SURF)
print("saved", out)
