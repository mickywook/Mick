"""Bull put spread blocks at entry, built from fill prices and IBKR historical bars.

Prints the calculator block, greeks table and scenario table for each trade, plus the
command line used to render its chart with spread_chart.py.
"""
import math
from datetime import date

N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
n = lambda x: math.exp(-x * x / 2) / math.sqrt(2 * math.pi)
R = 0.04

# ticker, opened (UTC), expiry, stock at fill, short K, short fill, long K, long fill, qty,
# ATM strike, ATM call, ATM put, beta, 30d HV at entry (%), IV percentile 52w (%, today)
TRADES = [
    ("SPY", "2026-10-07 13:55", date(2026, 11, 20), 774.95, 735, 4.23, 730, 3.76, 2, 775, 16.60, 12.95, 1.00, 9.9, 65),
    ("AAPL", "2026-10-07 17:13", date(2026, 11, 20), 336.05, 305, 2.52, 300, 1.96, 2, 335, 13.25, 10.70, 1.09, 21.1, 73),
    ("AMZN", "2026-10-08 13:39", date(2026, 11, 20), 259.40, 230, 3.03, 225, 2.31, 1, 260, 13.65, 13.10, 1.46, 24.7, 90),
    ("MSFT", "2026-10-12 17:57", date(2026, 10, 30), 540.05, 505, 4.35, 500, 3.55, 1, 540, 17.28, 15.50, 1.13, 22.5, 78),
    ("MRK", "2026-10-16 18:02", date(2026, 11, 20), 146.70, 135, 2.23, 130, 1.33, 1, 145, 7.40, 5.50, 0.28, 24.7, 95),
    ("PLTR", "2026-10-19 17:39", date(2026, 11, 20), 195.50, 165, 3.725, 160, 2.925, 2, 195, 14.90, 13.74, 1.57, 39.8, 91),
    ("DIS", "2026-10-20 19:11", date(2026, 11, 20), 111.30, 100, 0.86, 95, 0.36, 2, 110, 5.25, 3.50, 1.10, 21.6, 71),
]


def bs(S, K, T, s, call):
    d1 = (math.log(S / K) + (R + s * s / 2) * T) / (s * math.sqrt(T))
    d2 = d1 - s * math.sqrt(T)
    c = S * N(d1) - K * math.exp(-R * T) * N(d2)
    p = c - S + K * math.exp(-R * T)
    th = (-S * n(d1) * s / (2 * math.sqrt(T)) + R * K * math.exp(-R * T) * N(-d2)) / 365
    return dict(price=c if call else p, delta=N(d1) - (0 if call else 1),
                gamma=n(d1) / (S * s * math.sqrt(T)), theta=th,
                vega=S * n(d1) * math.sqrt(T) / 100)


def iv(S, K, T, price, call):
    lo, hi = 0.01, 3.0
    for _ in range(100):
        m = (lo + hi) / 2
        lo, hi = (lo, m) if bs(S, K, T, m, call)["price"] > price else (m, hi)
    return m


def pnl(S, T, KS, IVS, KL, IVL, credit, M):
    leg = lambda K, s: max(K - S, 0) if T <= 0 else bs(S, K, T, s, False)["price"]
    return (leg(KL, IVL) - leg(KS, IVS) + credit) * M


for (tkr, opened, exp, S, KS, PS, KL, PL, Q, KA, CA, PA, beta, hv, ivpct) in TRADES:
    d0 = date.fromisoformat(opened[:10])
    dte = (exp - d0).days
    T = dte / 365
    M = 100 * Q
    credit = round(PS - PL, 4)
    width = KS - KL
    gain, loss = credit * M, (width - credit) * M
    be = KS - credit
    ret = credit / (width - credit)
    ivs, ivl = iv(S, KS, T, PS, False), iv(S, KL, T, PL, False)
    atm = (iv(S, KA, T, CA, True) + iv(S, KA, T, PA, False)) / 2
    sd = S * atm * math.sqrt(T)
    strad = CA + PA
    alert = (S + KS) / 2
    gs, gl = bs(S, KS, T, ivs, False), bs(S, KL, T, ivl, False)
    exp_s = exp.strftime("%d-%b-%y")
    print(f"\n===== {tkr} =====")
    print(f"{tkr} Bull Put Spread | {KS:g}/{KL:g} | Exp {exp_s} ({dte} DTE at open) | {Q} contract{'s' if Q > 1 else ''}")
    print(f"Opened:             {opened} UTC")
    print(f"Stock price:        ${S:.2f}  (at fill)")
    print(f"Net credit:         ${credit:.2f} per spread  (${gain:,.0f} total)  [your fill]")
    print(f"Max gain:           ${gain:,.0f}")
    print(f"Max loss:           ${loss:,.0f}")
    print(f"Risk to reward:     {(width - credit) / credit:.2f} : 1")
    print(f"Win rate needed to break even: {(width - credit) / width:.0%}")
    print(f"Breakeven:          ${be:.2f}")
    print(f"% return on risk:   {ret:.2%}")
    print(f"% return annualized: {ret * 365 / dte:.2%}  (simple, 365/{dte})")
    print(f"Decline to B/E:     {be / S - 1:.2%}")
    print(f"Decline to short strike: {KS / S - 1:.2%}")
    print(f"Expected move (straddle):   ±${strad:.2f} (±{strad / S:.2%})  Top ${S + strad:.2f}  Bottom ${S - strad:.2f}")
    print(f"50% alert:          ${alert:.2f}  ({alert / S - 1:.2%})")
    print(f"Stop loss (2x premium): close at ${3 * credit:.2f} debit  (loss ${2 * credit * M:,.0f})")
    print()
    print("Volatility (at entry)")
    print(f"IV {KS:g} put (short strike):   {ivs:.1%}")
    print(f"IV {KL:g} put (long strike):    {ivl:.1%}")
    print(f"IV at-the-money ({KA:g}):       {atm:.1%}")
    print(f"Historical volatility (30d): {hv:.1f}%")
    print(f"IV / HV (ATM):               {atm * 100 / hv:.2f}")
    print(f"IV percentile (52w):         {ivpct}%  (today's value; IBKR has no history)")
    print("IV rank (52w):               n/a  (not available from IBKR)")
    print(f"[ATM IV {atm:.1%}; leg IVs {ivs:.1%} / {ivl:.1%}; short-put delta {gs['delta']:.3f}]")
    print("CHART:", " ".join(str(x) for x in (
        f"{tkr}_{KS:g}_{KL:g}_bull_put.png", tkr, f"\"{exp.strftime('%b %d')} '26 (at open {opened} UTC)\"",
        S, dte, KS, round(ivs, 4), KL, round(ivl, 4), credit, Q,
        round(gs["delta"], 5), round(gs["gamma"], 5), round(gs["theta"], 5), round(gs["vega"], 5),
        round(gl["delta"], 5), round(gl["gamma"], 5), round(gl["theta"], 5), round(gl["vega"], 5), beta)))
