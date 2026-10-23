"""Build one HTML page: each spread's payoff chart followed by its calculator block."""
import base64, html, shlex, subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
ORDER = ["PLTR", "SPY", "AAPL", "AMZN", "MSFT", "MRK", "DIS"]
LOCAL = {"SPY": "07-Oct-26 09:55 ET (15:55 SAST)", "AAPL": "07-Oct-26 13:13 ET (19:13 SAST)",
         "AMZN": "08-Oct-26 09:39 ET (15:39 SAST)", "MSFT": "12-Oct-26 13:57 ET (19:57 SAST)",
         "MRK": "16-Oct-26 14:02 ET (20:02 SAST)", "PLTR": "19-Oct-26 13:39 ET (19:39 SAST)",
         "DIS": "20-Oct-26 15:11 ET (21:11 SAST)"}

out = subprocess.run([sys.executable, HERE / "entry_blocks.py"], capture_output=True, text=True).stdout
sections = {}
for chunk in out.split("\n===== ")[1:]:
    tkr, body = chunk.split(" =====\n", 1)
    lines = [l for l in body.splitlines() if l and not l.startswith("[")]
    chart = next(l for l in lines if l.startswith("CHART:"))[7:]
    block = [l for l in lines if not l.startswith("CHART:")]
    block = [f"Opened:             {LOCAL[tkr]}" if l.startswith("Opened:") else l for l in block]
    sections[tkr] = (block, shlex.split(chart))

parts = []
for tkr in ORDER:
    block, args = sections[tkr]
    png = HERE / args[0]
    subprocess.run([sys.executable, HERE / "spread_chart.py", str(png)] + args[1:], capture_output=True, check=True)
    text = "\n".join(block)
    img = base64.b64encode(png.read_bytes()).decode()
    parts.append(f'<section><h2>{tkr}</h2><img src="data:image/png;base64,{img}" alt="{tkr} payoff diagram">'
                 f"<pre>{html.escape(text)}</pre></section>")

page = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bull Put Spreads</title>
<style>
:root {{ --bg:#fcfcfb; --ink:#0b0b0b; --muted:#52514e; --line:#e6e5e1; --code:#f3f2ef; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#1a1a19; --ink:#f0efec; --muted:#c3c2b7; --line:#33332f; --code:#242422; }} }}
body {{ background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; margin:0 auto; max-width:1100px; padding:16px; }}
h1 {{ font-size:22px; margin:8px 0 4px; }} p {{ color:var(--muted); margin:0 0 16px; }}
section {{ border-top:1px solid var(--line); padding:20px 0; }} h2 {{ margin:0 0 10px; font-size:18px; }}
img {{ width:100%; height:auto; border-radius:6px; background:#fcfcfb; }}
pre {{ background:var(--code); padding:12px; border-radius:6px; overflow-x:auto; font-size:13px; margin:12px 0 0; }}
</style></head><body>
<h1>Open bull put spreads, as at entry</h1>
<p>Each payoff diagram (with greeks at open) is followed by its calculation. Values use your fill prices and IBKR bars at the fill time.</p>
{''.join(parts)}
</body></html>"""
(HERE / "bull_put_spreads.html").write_text(page)
print("wrote", HERE / "bull_put_spreads.html")
