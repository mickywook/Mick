# Daily IBKR feed for Mick's journal (routine prompt)

Runs Tue-Sat 09:00 GMT+2. Writes ONE JSON file to the Drive feed folder; the
Apps Script in the journal (`apps-script/IbkrJournal.gs`) imports it hourly
into the `IBKR Inbox` tab. This routine never edits the journal itself.

---

You are the daily IBKR -> journal feed for Mick's options journal. Do these steps exactly; do not
place, modify or cancel any orders, and do not edit the journal spreadsheet.

**Constants**
- Feed folder (Google Drive): `1w5nd1ZrqKs-kZbSH39dOJNeaY8___35U`
- Journal: the Google Sheet titled `MICK my journal with OPTIONS TRADING IQ` (search Drive with
  `title contains 'MICK my journal with OPTIONS TRADING IQ'`; prefer mimeType
  `application/vnd.google-apps.spreadsheet`, fall back to the .xlsx `1Npn_hzAY-SDY20OP2kFJnDMKi0pwTTRP`).
- Helper: `routine/journal_open_rows.py` in this repo (if missing:
  `git fetch origin claude/new-session-kdi0w9 && git checkout origin/claude/new-session-kdi0w9 -- routine`).

**1. Cursor.** In the feed folder, find the newest file named `ibkr-feed-*.json`, download it and
read its `cursor` (ISO UTC). Only trades with `trade_time > cursor` are new. If no file exists,
use the start of the previous UTC day.

**2. Trades.** IBKR `get_account_trades` with `period: DAYS_7`; keep `trade_time > cursor` and
`sec_type == "OPT"` (ignore stock/ETF trades). If none: write the feed file (step 6) with
`rows: []` and the old cursor, then stop.

**3. Context.**
- IBKR `get_account_positions` - option `contract_description` looks like
  `NVDA Nov20'26 215 PUT @AMEX`; negative `position` = short.
- IBKR `get_account_orders` with `show_completed: true` - `primary_description` like
  `Buy 1 HIMS NOV 06 '26 36 Call` or `Buy 1 PLTR Nov20 220/Oct30 200 Diagonal`; join on `order_id`.
- Journal open rows: download the journal (native sheet: `download_file_content` with
  `exportMimeType` `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), base64-decode
  to `$SCRATCH/journal.xlsx`, run `python3 -I routine/journal_open_rows.py $SCRATCH/journal.xlsx`.
  It returns `wheel_tabs`, `open_wheel_rows` and `open_bps_rows` (with row numbers).

**4. Identify each trade's contract** (IBKR trades carry no strike/expiry/right):
- Group legs by `order_id` (same order = spread or roll). Partial fills of one leg = one row:
  sum `size` and `commission`, size-weighted average `price`.
- `realized_pnl != 0` -> closing leg. For a closing BUY of a short option the original open price
  is about `price + (realized_pnl + commission) / (100 * size)`; match it to the journal open row
  with the same symbol whose `open_price` is closest (and qty fits). Take strike/expiry/type from
  that row.
- `realized_pnl == 0` -> opening leg. SELL -> find the short option position for that symbol whose
  `average_price` is within ~0.03 of the trade price; BUY -> long position likewise. Take
  strike/expiry/right from `contract_description`. Fall back to order descriptions.
- If still ambiguous, emit it as `UNMATCHED` with what you know - never guess silently.

**5. Classify into rows** (one row per journal change):
- Single-leg short PUT opened -> `NEW_WHEEL_ROW`, type `CSP`, status `Open`.
  Single-leg short CALL opened -> `NEW_WHEEL_ROW`, type `CC`, status `Open`.
  Tab = the ticker tab whose name equals the symbol, else `OTHER TRADES`.
- Closing BUY of a wheel option -> `CLOSE_WHEEL_ROW`, `target_row` from the journal match,
  status `Closed`; price = close price.
- Same order closes one wheel option and opens another on the same symbol -> it is a roll:
  `CLOSE_WHEEL_ROW` with status `Rolled` + `NEW_WHEEL_ROW` for the new leg; note "roll, order <id>".
- Two-leg PUT order, sell higher strike + buy lower strike, same expiry, both opening ->
  `NEW_BPS_ROW`, tab `Bull PUT SPREAD TRACKER`, type `Bull Put Spread`, `strike` = short,
  `long_strike` = long, `price` = net credit (sell price - buy price), qty = spread count,
  commission = both legs. Two-leg CALL credit spread -> same with type `Bear Call Spread`.
- Two-leg order closing an open spread from `open_bps_rows` -> `CLOSE_BPS_ROW`, `target_row`,
  `price` = net debit paid, status `Closed`.
- Anything else (long calls/LEAPS, diagonals, VIX, unclear) -> `UNMATCHED` with a short note.
- `confidence`: `High` when strike/expiry came from positions/orders/journal with one clear match;
  `Medium` when inferred; `Low` otherwise.

**6. Write the feed file** to the feed folder with `create_file`
(`contentMimeType: application/json`, `disableConversionToGoogleType: true`), title
`ibkr-feed-<YYYY-MM-DD>-<HHMM>.json` (UTC time of this run):

```json
{
  "generated_at": "<ISO UTC now>",
  "cursor": "<max trade_time processed, or the old cursor if none>",
  "rows": [
    {
      "trade_ids": ["..."], "trade_time": "<ISO UTC of the (first) leg>",
      "action": "NEW_WHEEL_ROW|CLOSE_WHEEL_ROW|NEW_BPS_ROW|CLOSE_BPS_ROW|UNMATCHED",
      "tab": "NVDA", "target_row": 27, "symbol": "NVDA",
      "type": "CSP|CC|Bull Put Spread|Bear Call Spread", "status": "Open|Closed|Rolled",
      "expiry": "YYYY-MM-DD", "strike": 215, "long_strike": 210, "qty": 1,
      "price": 3.23, "commission": 1.05, "realized_pnl": 0,
      "confidence": "High|Medium|Low", "note": "short reason"
    }
  ]
}
```

Use `null` for unknown fields. Every trade_id after the cursor must appear in exactly one row.

**7. Finish** with a short summary: number of new trades, rows by action, and any UNMATCHED.
