import math, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
n = lambda x: math.exp(-x * x / 2) / math.sqrt(2 * math.pi)

def put(S, K, T, s, r):
    if T <= 0:
        return dict(p=max(K - S, 0), d=-1.0 if S < K else 0.0, g=0, t=0, v=0, rho=0)
    d1 = (math.log(S / K) + (r + s * s / 2) * T) / (s * math.sqrt(T))
    d2 = d1 - s * math.sqrt(T)
    p = K * math.exp(-r * T) * N(-d2) - S * N(-d1)
    return dict(
        p=p,
        d=N(d1) - 1,
        g=n(d1) / (S * s * math.sqrt(T)),
        t=(-S * n(d1) * s / (2 * math.sqrt(T)) + r * K * math.exp(-r * T) * N(-d2)) / 365,
        v=S * n(d1) * math.sqrt(T) / 100,
        rho=-K * T * math.exp(-r * T) * N(-d2) / 100,
    )

# Trade inputs
S0, DTE, R = 886.99, 29, 0.04
KS, IVS = 810, 0.33929   # short put
KL, IVL = 805, 0.34010   # long put
CREDIT, QTY = 0.80, 1
M = 100 * QTY
T0 = DTE / 365

def spread(S, T):
    a, b = put(S, KS, T, IVS, R), put(S, KL, T, IVL, R)
    return {k: (b[k] - a[k]) * M for k in a}  # long 805, short 810

now = spread(S0, T0)
print("model spread value", -now["p"] / M, "greeks", {k: round(v, 4) for k, v in now.items()})
for pct in (-15, -10, -5, 0, 5, 10, 15):
    S = S0 * (1 + pct / 100)
    print(pct, round(S, 2), "today", round(spread(S, T0)["p"] + CREDIT * M, 2),
          "expiry", round(spread(S, 0)["p"] + CREDIT * M, 2))

# Chart
SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
BLUE, ORANGE = "#2a78d6", "#eb6834"
xs = np.linspace(760, 960, 401)
curves = {k: [] for k in ("p", "d", "g", "t", "v", "rho")}
exp = []
for S in xs:
    c = spread(S, T0)
    for k in curves:
        curves[k].append(c[k])
    exp.append(spread(S, 0)["p"] + CREDIT * M)
pnl_now = np.array(curves["p"]) + CREDIT * M

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": INK,
                     "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2})
fig, axes = plt.subplots(3, 2, figsize=(13, 12), facecolor=SURF)
fig.suptitle(f"GS Nov 20 '26 810/805 Bull Put  |  {QTY} contract  |  credit \\${CREDIT:.2f}  |  GS \\${S0:.2f}  |  {DTE} DTE",
             fontsize=13, fontweight="bold", x=0.02, ha="left")

panels = [
    ("P&L ($)", None),
    ("Delta (share-equivalent)", "d"),
    ("Gamma (delta change per $1)", "g"),
    ("Theta ($ per day)", "t"),
    ("Vega ($ per 1 vol point)", "v"),
    ("Rho ($ per 1% rate)", "rho"),
]
BE = KS - CREDIT
alert = (S0 + KS) / 2
for ax, (title, key) in zip(axes.flat, panels):
    ax.set_facecolor(SURF)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.grid(color=GRID, linewidth=0.8)
    ax.axhline(0, color=INK2, linewidth=0.8)
    ax.axvline(S0, color=INK2, linewidth=1, linestyle="--")
    ax.set_title(title, loc="left", fontsize=11, fontweight="bold")
    ax.set_xlim(xs[0], xs[-1])
    if key is None:
        ax.plot(xs, exp, color=BLUE, linewidth=2, label="At expiry")
        ax.plot(xs, pnl_now, color=ORANGE, linewidth=2, label="Today (T+0)")
        ax.legend(loc="lower right", frameon=False)
        ax.text(925, CREDIT * M + 12, f"Max gain ${CREDIT*M:.0f}", color=INK, fontsize=9)
        ax.text(762, -(5 - CREDIT) * M + 12, f"Max loss ${(5-CREDIT)*M:.0f}", color=INK, fontsize=9)
        for x, lbl in ((BE, f"B/E {BE:.2f}"), (alert, f"50% alert {alert:.2f}")):
            ax.axvline(x, color=GRID, linewidth=1.2)
            ax.annotate(lbl, (x, -200), rotation=90, fontsize=8.5, color=INK2,
                        xytext=(3, 0), textcoords="offset points", va="center")
        ax.set_ylim(-(5 - CREDIT) * M - 40, CREDIT * M + 60)
    else:
        ax.plot(xs, curves[key], color=ORANGE, linewidth=2)
        ax.plot([S0], [now[key]], "o", color=ORANGE, markersize=8, markeredgecolor=SURF, markeredgewidth=2)
        ax.annotate(f"now {now[key]:+.3f}", (S0, now[key]), xytext=(8, -16 if key == "t" else 8), textcoords="offset points",
                    fontsize=9, color=INK)
    ax.text(S0, ax.get_ylim()[1], f" GS {S0:.2f}", fontsize=8.5, color=INK2, va="top")
for ax in axes[-1]:
    ax.set_xlabel("GS price at the time shown ($)")
fig.text(0.02, 0.005, "Black-Scholes using IBKR live leg IVs (33.9% / 34.0%), 4% rate, no dividend. "
         "Greeks are for the whole position (x100). Greek panels show today's values.",
         fontsize=8.5, color=INK2)
fig.tight_layout(rect=(0, 0.02, 1, 0.96))
out = sys.argv[1]
fig.savefig(out, dpi=130, facecolor=SURF)
print("saved", out)
