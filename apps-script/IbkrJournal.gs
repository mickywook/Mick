/**
 * ============================================================================
 * IBKR JOURNAL  -  dropdowns + daily IBKR trade import for
 * "MICK my journal with OPTIONS TRADING IQ"
 * ----------------------------------------------------------------------------
 * Paste into Extensions > Apps Script as a new file (IbkrJournal.gs), save,
 * reload the sheet, then use the "IBKR Journal" menu:
 *
 *   1. Set up Type / Status dropdowns   - wheel tabs + Bull PUT SPREAD TRACKER
 *   -  Set up headline metrics             - BPS top stats (credit collected / paid,
 *                                          commission, net premium) + bigger Net
 *                                          premium / Realised P&L on every tab
 *   2. Install hourly import            - run once; checks the feed folder
 *   3. Import IBKR feed now             - same thing, on demand
 *   4. Push ticked inbox rows           - writes ticked rows into the tabs
 *
 * How the daily update works:
 *   09:00 GMT+2 (Tue-Sat) a Claude routine reads new IBKR trades, matches them
 *   to your tabs, and drops a JSON file into FEED_FOLDER_ID. The hourly trigger
 *   below picks that file up and appends each trade to the 'IBKR Inbox' tab.
 *   Tick "Push?" on a row and run "Push ticked inbox rows" to write it into the
 *   ticker tab / BPS tracker. Set AUTO_PUSH = true to push High-confidence rows
 *   automatically on import.
 *
 * Only value columns are written; formula columns are never overwritten, and
 * new rows get their formulas copied from the row above.
 * ============================================================================
 */

var IJ = {
  FEED_FOLDER_ID: '1w5nd1ZrqKs-kZbSH39dOJNeaY8___35U',
  INBOX: 'IBKR Inbox',
  AUTO_PUSH: false,
  TZ: 'Etc/GMT-2',                    // GMT+2 (the sign is inverted in Etc/ names)
  AUTO_TAG: 'AUTO - IBKR',

  WHEEL_TYPES:  ['CSP', 'CC'],
  WHEEL_STATUS: ['Open', 'Closed', 'Rolled', 'Expired', 'Assigned', 'Called Away'],
  BPS_TAB:      'Bull PUT SPREAD TRACKER',
  BPS_STATUS:   ['Open', 'Closed', 'Rolled', 'Expired', 'Assigned'],
  BPS_STRATEGY: ['Bull Put Spread', 'Bear Call Spread', 'Iron Condor'],

  // wheel tab layout (1-based columns)
  W: { HDR: 7, FIRST: 8, DATE: 1, TYPE: 2, SYM: 3, EXP: 4, STRIKE: 5, QTY: 7, OPEN: 8,
       CLOSED: 11, CLOSE: 12, STATUS: 15, COMM: 16, CHECK: 24, LAST_COL: 24 },
  // BPS tracker: header row / first trade row. Columns are found by their row-5 header
  // (see BPS_HDR) so inserting or moving a column never breaks the import.
  B: { HDR: 5, FIRST: 6 },
  BPS_HDR: {
    DATE: /^Trade Date/i,          STATUS: /^Status$/i,          SYM: /^Stock/i,
    EXP: /^Expiration/i,           STRAT: /^Strategy$/i,         QTY: /^No\.?$/i,
    PX_OPEN: /^Stock Price @ ?Open/i, SHORT: /^Strike ?1/i,      LONG: /^Strike ?2/i,
    ENTRY: /^Entry Price/i,        RISK: /^Capi?ti?al at Risk/i,   EXIT_DATE: /^Exit Date/i,
    DTE_PCT: /^% DTE Completed/i,  DAYS: /^Days in Trade/i,      EXIT: /CLOSING Price/i,
    PNL: /^P&L ?\(realised\)/i,   ROC: /^ROC/i,                 NOTES: /^Notes$/i,
    COMM: /^Commission$/i
  },
  BPS_PREFILL: 200,                       // per-row live-price formulas down to this row

  // headline cells: big font + yellow so they stand out
  KEY_LABEL_BG: '#ffe599', KEY_VALUE_BG: '#fff2cc', KEY_FONT: 20,

  INBOX_HDR: ['Push?', 'Result', 'Trade time (GMT+2)', 'Action', 'Tab', 'Target row', 'Symbol',
              'Type', 'Status', 'Expiry', 'Strike', 'Long strike', 'Qty', 'Price', 'Commission',
              'Realised P&L', 'Confidence', 'Note', 'Trade IDs']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('IBKR Journal')
    .addItem('Set up Type / Status dropdowns', 'ij_setupDropdowns')
    .addItem('Set up headline metrics (BPS + wheel tabs)', 'ij_setupMetrics')
    .addItem('Add breakeven columns (BPS tracker)', 'ij_setupBreakeven')
    .addSeparator()
    .addItem('Import IBKR feed now', 'ij_importFeed')
    .addItem('Push ticked inbox rows', 'ij_pushTicked')
    .addSeparator()
    .addItem('Install hourly import', 'ij_installTrigger')
    .addToUi();
}

/* ------------------------------------------------------------------ dropdowns */

function ij_list_(vals) {
  return SpreadsheetApp.newDataValidation().requireValueInList(vals, true)
    .setAllowInvalid(false).build();
}

/** Wheel tabs = every tab whose row 7 reads Date Opened / Type / ... / Status. */
function ij_wheelTabs_(ss) {
  return ss.getSheets().filter(function (sh) {
    if (sh.getMaxRows() < IJ.W.HDR || sh.getMaxColumns() < IJ.W.STATUS) return false;
    var h = sh.getRange(IJ.W.HDR, 1, 1, IJ.W.STATUS).getDisplayValues()[0];
    return h[0] === 'Date Opened' && h[IJ.W.TYPE - 1] === 'Type' && h[IJ.W.STATUS - 1] === 'Status';
  });
}

/** Last row of the option-trade block: two rows above the "... SHARES" title. */
function ij_wheelLastRow_(sh) {
  var n = sh.getMaxRows() - IJ.W.FIRST + 1;
  var a = sh.getRange(IJ.W.FIRST, 1, n, 1).getDisplayValues();
  for (var i = 0; i < a.length; i++) {
    if (/SHARES/i.test(a[i][0])) return IJ.W.FIRST + i - 2;
  }
  return sh.getMaxRows();
}

function ij_applyWheelValidation_(sh) {
  var n = ij_wheelLastRow_(sh) - IJ.W.FIRST + 1;
  if (n < 1) return;
  sh.getRange(IJ.W.FIRST, IJ.W.TYPE, n, 1).setDataValidation(ij_list_(IJ.WHEEL_TYPES));
  sh.getRange(IJ.W.FIRST, IJ.W.STATUS, n, 1).setDataValidation(ij_list_(IJ.WHEEL_STATUS));
}

function ij_applyBpsValidation_(sh) {
  var B = ij_bpsCols_(sh), n = sh.getMaxRows() - IJ.B.FIRST + 1;
  sh.getRange(IJ.B.FIRST, B.STATUS, n, 1).setDataValidation(ij_list_(IJ.BPS_STATUS));
  sh.getRange(IJ.B.FIRST, B.STRAT, n, 1).setDataValidation(ij_list_(IJ.BPS_STRATEGY));
}

/** BPS column numbers keyed like IJ.BPS_HDR (first matching header wins); LAST_COL = last header. */
function ij_bpsCols_(sh) {
  var h = sh.getRange(IJ.B.HDR, 1, 1, sh.getMaxColumns()).getDisplayValues()[0];
  var out = { LAST_COL: 0 };
  h.forEach(function (v, i) {
    v = String(v).trim();
    if (!v) return;
    out.LAST_COL = i + 1;
    Object.keys(IJ.BPS_HDR).forEach(function (k) {
      if (!out[k] && IJ.BPS_HDR[k].test(v)) out[k] = i + 1;
    });
  });
  return out;
}

/** Same as ij_bpsCols_ but throws naming any of `need` that is missing. */
function ij_bpsNeed_(sh, need) {
  var B = ij_bpsCols_(sh);
  var miss = need.filter(function (k) { return !B[k]; });
  if (miss.length) throw new Error(sh.getName() + ': no header found for ' + miss.join(', '));
  return B;
}

function ij_setupDropdowns() {
  var ss = SpreadsheetApp.getActive();
  var tabs = ij_wheelTabs_(ss);
  tabs.forEach(ij_applyWheelValidation_);
  var bps = ss.getSheetByName(IJ.BPS_TAB);
  if (bps) ij_applyBpsValidation_(bps);
  ss.toast('Dropdowns set on ' + tabs.length + ' wheel tabs' + (bps ? ' + BPS tracker' : ''),
           'IBKR Journal', 8);
}

/* ---------------------------------------------------------- headline metrics */

/**
 * BPS tracker rows 2-3 become (left to right):
 *   Spreads traded | Open | Closed | Credit collected | Credit paid (to close) |
 *   Commission | NET PREMIUM | REALISED P&L | Win rate | Avg ROC | Rolled |
 *   Capital at risk | Max profit still open | Avg days held | Avg % of DTE used
 * Net premium = credit collected - credit paid (commission shown separately, not deducted).
 * Realised P&L (column T and the stat) is after commission.
 * Adds a Commission input column after the last header if there is none.
 * Wheel tabs: Net premium + Realised option P/L get a big font and yellow fill.
 * Safe to re-run.
 */
function ij_setupMetrics() {
  var ss = SpreadsheetApp.getActive();
  var bps = ss.getSheetByName(IJ.BPS_TAB);
  if (bps) ij_setupBpsStats_(bps);
  var tabs = ij_wheelTabs_(ss);
  tabs.forEach(ij_highlightWheel_);
  ss.toast('Headline metrics set on ' + tabs.length + ' wheel tabs' + (bps ? ' + BPS tracker' : ''),
           'IBKR Journal', 8);
}

function ij_setupBpsStats_(sh) {
  var F = IJ.B.FIRST, L = sh.getMaxRows();
  var B = ij_bpsCols_(sh);
  if (!B.COMM) {                                   // new input column after the last header
    var c = B.LAST_COL + 1;
    if (sh.getMaxColumns() < c) sh.insertColumnsAfter(sh.getMaxColumns(), c - sh.getMaxColumns());
    sh.getRange(IJ.B.HDR, B.LAST_COL).copyTo(sh.getRange(IJ.B.HDR, c), { formatOnly: true });
    sh.getRange(IJ.B.HDR, c).setValue('Commission');
    sh.getRange(F, B.QTY, L - F + 1, 1).copyTo(sh.getRange(F, c, L - F + 1, 1), { formatOnly: true });
    sh.getRange(F, c, L - F + 1, 1).setNumberFormat('$#,##0.00');
  }
  B = ij_bpsNeed_(sh, ['DATE', 'STATUS', 'QTY', 'ENTRY', 'RISK', 'DTE_PCT', 'DAYS', 'EXIT',
                       'PNL', 'ROC', 'COMM']);

  // per-row realised P&L after commission: rewrite every formula cell in the P&L column
  var A = ij_a1_, r, pnl = sh.getRange(F, B.PNL, L - F + 1, 1).getFormulas();
  for (var i = 0; i < pnl.length; i++) {
    if (!pnl[i][0]) continue;
    r = F + i;
    pnl[i][0] = '=IF(OR($' + A(B.STATUS) + r + '="Closed",$' + A(B.STATUS) + r + '="Rolled"),' +
                '($' + A(B.ENTRY) + r + '-$' + A(B.EXIT) + r + ')*$' + A(B.QTY) + r + '*100' +
                '-N($' + A(B.COMM) + r + '),"")';
  }
  sh.getRange(F, B.PNL, pnl.length, 1).setFormulas(pnl);

  var rg = function (c) { return '$' + A(c) + '$' + F + ':$' + A(c) + '$' + L; };
  var st = rg(B.STATUS);
  var cr = function (c) { return '(SUMIFS(' + rg(c) + ',' + st + ',"Closed")+SUMIFS(' + rg(c) + ',' + st + ',"Rolled"))'; };
  var n = '(COUNTIF(' + st + ',"Closed")+COUNTIF(' + st + ',"Rolled"))';
  var avg = function (c) { return '=IFERROR(' + cr(c) + '/' + n + ',"")'; };
  var money = '$#,##0;[Red]-$#,##0';
  var stats = [  // [label, formula, number format, headline?]
    ['Spreads traded', '=COUNT(' + rg(B.DATE) + ')', '0'],
    ['Open', '=COUNTIF(' + st + ',"Open")', '0'],
    ['Closed', '=COUNTIF(' + st + ',"Closed")', '0'],
    ['Credit collected', '=SUMPRODUCT(' + rg(B.ENTRY) + ',' + rg(B.QTY) + ')*100', money],
    ['Credit paid (to close)', '=SUMPRODUCT(' + rg(B.EXIT) + ',' + rg(B.QTY) + ')*100', money],
    ['Commission', '=SUM(' + rg(B.COMM) + ')', '$#,##0.00'],
    ['NET PREMIUM (collected - paid)', '=D3-E3', money, true],
    ['REALISED P&L (closed + rolled, after commission)', '=' + cr(B.PNL), money, true],
    ['Win rate', '=IFERROR((COUNTIFS(' + st + ',"Closed",' + rg(B.PNL) + ',">0")+COUNTIFS(' + st +
                 ',"Rolled",' + rg(B.PNL) + ',">0"))/' + n + ',"")', '0%'],
    ['Avg return on capital (closed + rolled)', avg(B.ROC), '0.00%'],
    ['Rolled', '=COUNTIF(' + st + ',"Rolled")', '0'],
    ['Capital at risk (open)', '=SUMIFS(' + rg(B.RISK) + ',' + st + ',"Open")', money],
    ['Max profit still open', '=SUMPRODUCT(--(' + st + '="Open"),' + rg(B.ENTRY) + ',' + rg(B.QTY) + ')*100', money],
    ['Avg days held (closed + rolled)', avg(B.DAYS), '0.0'],
    ['Avg % of DTE used (closed + rolled)', avg(B.DTE_PCT), '0%']
  ];
  var k = stats.length;
  // one consistent style from the old "Credit collected" cells, then the headline pair on top
  sh.getRange(2, 4).copyTo(sh.getRange(2, 1, 1, k), { formatOnly: true });
  sh.getRange(3, 4).copyTo(sh.getRange(3, 1, 1, k), { formatOnly: true });
  sh.getRange(2, 1, 1, k).setValues([stats.map(function (x) { return x[0]; })]).setWrap(true);
  sh.getRange(3, 1, 1, k).setFormulas([stats.map(function (x) { return x[1]; })])
    .setNumberFormats([stats.map(function (x) { return x[2]; })]);
  stats.forEach(function (x, j) { if (x[3]) ij_key_(sh.getRange(2, j + 1), sh.getRange(3, j + 1)); });
  sh.setRowHeight(3, 40);
}

/** Wheel tab: find "Realised option P/L" (row 2) and "Net premium..." (row 4) and enlarge their values. */
function ij_highlightWheel_(sh) {
  [[2, /^Realised option P\/?L/i], [4, /^Net premium/i]].forEach(function (t) {
    var h = sh.getRange(t[0], 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    for (var c = 0; c < h.length; c++) {
      if (t[1].test(h[c])) {
        ij_key_(sh.getRange(t[0], c + 1), sh.getRange(t[0] + 1, c + 1));
        sh.setRowHeight(t[0] + 1, 40);
        return;
      }
    }
  });
}

function ij_key_(label, value) {
  label.setBackground(IJ.KEY_LABEL_BG).setFontWeight('bold').setFontSize(12);
  value.setBackground(IJ.KEY_VALUE_BG).setFontWeight('bold').setFontSize(IJ.KEY_FONT)
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, null, null, '#bf9000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

/** 1 -> A, 27 -> AA */
function ij_a1_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

/* ------------------------------------------------------------ BPS breakeven */

/**
 * Four columns after the last header (reused if already there):
 *   Breakeven            short strike - net credit (Bear Call Spread: + credit)
 *   Cushion @ open       breakeven vs Stock Price @ Open
 *   Live price           GOOGLEFINANCE, rows with a symbol only
 *   Live cushion         breakeven vs live price, Open rows only
 * Safe to re-run.
 */
function ij_setupBreakeven() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(IJ.BPS_TAB);
  if (!sh) throw new Error('Tab not found: ' + IJ.BPS_TAB);
  var F = IJ.B.FIRST, max = sh.getMaxRows(), A = ij_a1_;
  var B = ij_bpsNeed_(sh, ['STATUS', 'SYM', 'STRAT', 'PX_OPEN', 'SHORT', 'ENTRY']);
  var hdr = sh.getRange(IJ.B.HDR, 1, 1, sh.getMaxColumns()).getDisplayValues()[0];
  var be = hdr.indexOf('Breakeven (short strike - credit)') + 1 || B.LAST_COL + 1;
  if (sh.getMaxColumns() < be + 3) sh.insertColumnsAfter(sh.getMaxColumns(), be + 3 - sh.getMaxColumns());

  var col = function (c) { return '$' + A(c) + F + ':$' + A(c); };
  var S = col(B.SHORT), E = col(B.ENTRY), BE = col(be), LP = col(be + 2);
  sh.getRange(IJ.B.HDR, be, 1, 4).setValues([[
    'Breakeven (short strike - credit)', 'Cushion to breakeven @ open',
    'Live price', 'Live cushion to breakeven (open)']])
    .setFontWeight('bold').setWrap(true);

  sh.getRange(F, be, max - F + 1, 4).clearContent();
  sh.getRange(F, be).setFormula(
    '=ARRAYFORMULA(IF((' + S + '="")+(' + E + '=""),"",' +
    'IF(' + col(B.STRAT) + '="Bear Call Spread",' + S + '+' + E + ',' + S + '-' + E + ')))');
  sh.getRange(F, be + 1).setFormula(
    '=ARRAYFORMULA(IF((' + BE + '="")+(N(' + col(B.PX_OPEN) + ')=0),"",' + BE + '/' + col(B.PX_OPEN) + '-1))');
  var live = [];
  for (var r = F; r <= Math.min(IJ.BPS_PREFILL, max); r++) {
    live.push(['=IF($' + A(B.SYM) + r + '="","",IFERROR(GOOGLEFINANCE($' + A(B.SYM) + r + '),""))']);
  }
  sh.getRange(F, be + 2, live.length, 1).setFormulas(live);
  sh.getRange(F, be + 3).setFormula(
    '=ARRAYFORMULA(IF((' + col(B.STATUS) + '<>"Open")+(' + BE + '="")+(N(' + LP + ')=0),"",' +
    BE + '/' + LP + '-1))');

  sh.getRange(F, be, max - F + 1, 1).setNumberFormat('$#,##0.00');
  sh.getRange(F, be + 1, max - F + 1, 1).setNumberFormat('0.00%');
  sh.getRange(F, be + 2, max - F + 1, 1).setNumberFormat('$#,##0.00');
  sh.getRange(F, be + 3, max - F + 1, 1).setNumberFormat('0.00%');

  ss.toast('Breakeven columns added at ' + A(be) + ':' + A(be + 3), 'IBKR Journal', 8);
}

/* --------------------------------------------------------------------- import */

function ij_inbox_(ss) {
  var sh = ss.getSheetByName(IJ.INBOX);
  if (sh) return sh;
  sh = ss.insertSheet(IJ.INBOX, 0);
  sh.getRange(1, 1, 1, IJ.INBOX_HDR.length).setValues([IJ.INBOX_HDR])
    .setFontWeight('bold').setBackground('#5f6368').setFontColor('#ffffff').setWrap(true);
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(18, 320);
  return sh;
}

function ij_importFeed() {
  var ss = SpreadsheetApp.getActive();
  var inbox = ij_inbox_(ss);
  var props = PropertiesService.getScriptProperties();
  var done = JSON.parse(props.getProperty('ij_processed') || '{}');

  var seen = {};
  if (inbox.getLastRow() > 1) {
    inbox.getRange(2, 19, inbox.getLastRow() - 1, 1).getValues().forEach(function (r) {
      String(r[0]).split(',').forEach(function (id) { if (id) seen[id.trim()] = true; });
    });
  }

  var files = [];
  var it = DriveApp.getFolderById(IJ.FEED_FOLDER_ID).getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (!done[f.getId()] && /\.json$/i.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });

  var added = 0;
  files.forEach(function (f) {
    var feed = JSON.parse(f.getBlob().getDataAsString());
    var out = [];
    (feed.rows || []).forEach(function (t) {
      var ids = (t.trade_ids || []).join(',');
      if (ids && ids.split(',').some(function (id) { return seen[id]; })) return;
      ids.split(',').forEach(function (id) { seen[id] = true; });
      out.push([false, '', ij_fmtTime_(t.trade_time), t.action || 'UNMATCHED', t.tab || '',
                t.target_row || '', t.symbol || '', t.type || '', t.status || '',
                ij_date_(t.expiry) || '', ij_num_(t.strike), ij_num_(t.long_strike), ij_num_(t.qty),
                ij_num_(t.price), ij_num_(t.commission), ij_num_(t.realized_pnl),
                t.confidence || '', t.note || '', ids]);
    });
    if (out.length) {
      var r0 = inbox.getLastRow() + 1;
      inbox.getRange(r0, 1, out.length, out[0].length).setValues(out);
      inbox.getRange(r0, 1, out.length, 1).insertCheckboxes();
      inbox.getRange(r0, 10, out.length, 1).setNumberFormat('yyyy-mm-dd');
      added += out.length;
    }
    done[f.getId()] = true;
  });
  props.setProperty('ij_processed', JSON.stringify(done));

  if (IJ.AUTO_PUSH && added) ij_push_(ss, function (row) { return row[16] === 'High'; });
  if (added) ss.toast(added + ' new IBKR trade(s) in ' + IJ.INBOX, 'IBKR Journal', 8);
}

/* ----------------------------------------------------------------------- push */

function ij_pushTicked() {
  ij_push_(SpreadsheetApp.getActive(), function (row) { return row[0] === true; });
}

function ij_push_(ss, pick) {
  var inbox = ij_inbox_(ss);
  if (inbox.getLastRow() < 2) return;
  var rng = inbox.getRange(2, 1, inbox.getLastRow() - 1, IJ.INBOX_HDR.length);
  var rows = rng.getValues();
  var ok = 0, bad = 0;
  rows.forEach(function (row, i) {
    if (!pick(row) || /^Pushed/.test(row[1])) return;
    var res;
    try { res = ij_pushOne_(ss, row); ok++; }
    catch (e) { res = 'FAILED: ' + e.message; bad++; }
    inbox.getRange(i + 2, 1, 1, 2).setValues([[false, res]]);
  });
  ss.toast(ok + ' pushed, ' + bad + ' failed (see Result column)', 'IBKR Journal', 8);
}

/** row = one inbox row as values; returns the Result text or throws. */
function ij_pushOne_(ss, row) {
  var t = { time: row[2], action: row[3], tab: row[4], target: Number(row[5]) || 0, sym: row[6],
            type: row[7], status: row[8], exp: row[9], strike: row[10], longStrike: row[11],
            qty: row[12], price: row[13], comm: Number(row[14]) || 0 };
  var date = ij_tradeDate_(t.time);
  var sh = ss.getSheetByName(t.tab);
  if (!sh) throw new Error('tab "' + t.tab + '" not found');

  if (t.action === 'NEW_WHEEL_ROW') {
    var r = ij_freeWheelRow_(sh);
    var W = IJ.W;
    ij_set_(sh, r, W.DATE, date);   ij_set_(sh, r, W.TYPE, t.type);  ij_set_(sh, r, W.SYM, t.sym);
    ij_set_(sh, r, W.EXP, t.exp);   ij_set_(sh, r, W.STRIKE, t.strike);
    ij_set_(sh, r, W.QTY, t.qty);   ij_set_(sh, r, W.OPEN, t.price);
    ij_set_(sh, r, W.STATUS, t.status || 'Open');
    ij_set_(sh, r, W.COMM, t.comm); ij_set_(sh, r, W.CHECK, IJ.AUTO_TAG);
    return 'Pushed -> ' + t.tab + ' row ' + r;
  }

  if (t.action === 'CLOSE_WHEEL_ROW') {
    var W2 = IJ.W;
    var r2 = ij_findOpen_(sh, t, W2.FIRST, ij_wheelLastRow_(sh), W2.SYM, W2.STATUS, W2.STRIKE, W2.EXP);
    ij_set_(sh, r2, W2.CLOSED, date);
    ij_set_(sh, r2, W2.CLOSE, t.price);
    ij_set_(sh, r2, W2.STATUS, t.status || 'Closed');
    ij_set_(sh, r2, W2.COMM, (Number(sh.getRange(r2, W2.COMM).getValue()) || 0) + t.comm);
    ij_set_(sh, r2, W2.CHECK, IJ.AUTO_TAG);
    return 'Pushed -> closed ' + t.tab + ' row ' + r2;
  }

  if (t.action === 'NEW_BPS_ROW') {
    var B = ij_bpsNeed_(sh, ['DATE', 'STATUS', 'SYM', 'EXP', 'STRAT', 'QTY', 'SHORT', 'LONG',
                             'ENTRY', 'COMM']);
    var r3 = ij_freeRow_(sh, IJ.B.FIRST, sh.getMaxRows(), B.LAST_COL);
    ij_set_(sh, r3, B.DATE, date);  ij_set_(sh, r3, B.STATUS, t.status || 'Open');
    ij_set_(sh, r3, B.SYM, t.sym);  ij_set_(sh, r3, B.EXP, t.exp);
    ij_set_(sh, r3, B.STRAT, t.type || 'Bull Put Spread');
    ij_set_(sh, r3, B.QTY, t.qty);  ij_set_(sh, r3, B.SHORT, t.strike);
    ij_set_(sh, r3, B.LONG, t.longStrike); ij_set_(sh, r3, B.ENTRY, t.price);
    ij_set_(sh, r3, B.COMM, t.comm);
    if (B.NOTES) ij_set_(sh, r3, B.NOTES, IJ.AUTO_TAG);
    return 'Pushed -> ' + t.tab + ' row ' + r3;
  }

  if (t.action === 'CLOSE_BPS_ROW') {
    var B2 = ij_bpsNeed_(sh, ['STATUS', 'SYM', 'EXP', 'SHORT', 'EXIT_DATE', 'EXIT', 'COMM']);
    var r4 = ij_findOpen_(sh, t, IJ.B.FIRST, sh.getMaxRows(), B2.SYM, B2.STATUS, B2.SHORT, B2.EXP);
    ij_set_(sh, r4, B2.EXIT_DATE, date);
    ij_set_(sh, r4, B2.EXIT, t.price);
    ij_set_(sh, r4, B2.STATUS, t.status || 'Closed');
    ij_set_(sh, r4, B2.COMM, (Number(sh.getRange(r4, B2.COMM).getValue()) || 0) + t.comm);
    return 'Pushed -> closed ' + t.tab + ' row ' + r4;
  }

  throw new Error('action ' + t.action + ' needs a manual entry');
}

/** Target row if it is still Open for this symbol, else the single Open row matching strike+expiry. */
function ij_findOpen_(sh, t, first, last, cSym, cStatus, cStrike, cExp) {
  var ok = function (r) {
    return r >= first && r <= last && sh.getRange(r, cSym).getValue() === t.sym &&
           sh.getRange(r, cStatus).getValue() === 'Open';
  };
  if (t.target && ok(t.target)) return t.target;
  var v = sh.getRange(first, 1, last - first + 1, Math.max(cSym, cStatus, cStrike, cExp)).getValues();
  var hits = [];
  v.forEach(function (row, i) {
    if (row[cSym - 1] !== t.sym || row[cStatus - 1] !== 'Open') return;
    if (t.strike !== '' && Number(row[cStrike - 1]) !== Number(t.strike)) return;
    if (t.exp instanceof Date && row[cExp - 1] instanceof Date &&
        row[cExp - 1].toDateString() !== t.exp.toDateString()) return;
    hits.push(first + i);
  });
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length ? 'several Open rows match - close it by hand' :
                                'no Open ' + t.sym + ' row matches - check manually');
}

/** First empty row in the option block; inserts one inside the block when it is full. */
function ij_freeWheelRow_(sh) {
  var last = ij_wheelLastRow_(sh);
  var r = ij_freeRow_(sh, IJ.W.FIRST, last, IJ.W.LAST_COL, true);
  if (r) return r;
  // insert inside the block so the summary ranges ($Q$8:$Q$29 etc.) grow with it
  sh.insertRowBefore(last);
  ij_copyFormulas_(sh, last, last - 1, IJ.W.LAST_COL);
  ij_applyWheelValidation_(sh);
  return last;
}

function ij_freeRow_(sh, first, last, lastCol, noThrow) {
  var v = sh.getRange(first, 1, last - first + 1, 3).getValues();
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] === '' && v[i][2] === '') {
      var r = first + i;
      if (r > first) ij_copyFormulas_(sh, r, r - 1, lastCol);
      return r;
    }
  }
  if (noThrow) return 0;
  throw new Error('no empty row left on ' + sh.getName());
}

/** Copy formulas from `from` into empty cells of row `r` (relative refs shift). */
function ij_copyFormulas_(sh, r, from, lastCol) {
  var src = sh.getRange(from, 1, 1, lastCol).getFormulasR1C1()[0];
  var dst = sh.getRange(r, 1, 1, lastCol);
  var curF = dst.getFormulas()[0], curV = dst.getValues()[0];
  src.forEach(function (f, c) {
    if (f && !curF[c] && curV[c] === '') sh.getRange(r, c + 1).setFormulaR1C1(f);
  });
}

function ij_set_(sh, r, c, v) {
  if (v === '' || v === null || v === undefined) return;
  if (sh.getRange(r, c).getFormula()) throw new Error('row ' + r + ' col ' + c + ' is a formula');
  sh.getRange(r, c).setValue(v);
}

/* -------------------------------------------------------------------- helpers */

function ij_num_(v) { return (v === null || v === undefined || v === '') ? '' : Number(v); }

function ij_date_(s) {
  if (!s) return '';
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
}

function ij_fmtTime_(iso) {
  // leading apostrophe keeps it as text so the sheet's own time zone can't shift it
  return iso ? "'" + Utilities.formatDate(new Date(iso), IJ.TZ, 'yyyy-MM-dd HH:mm') : '';
}

/** US trade date for a 'yyyy-MM-dd HH:mm' GMT+2 stamp (journal dates are US session dates). */
function ij_tradeDate_(stamp) {
  if (stamp instanceof Date) stamp = Utilities.formatDate(stamp, IJ.TZ, 'yyyy-MM-dd HH:mm');
  var m = String(stamp).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return '';
  var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 2, +m[5]);
  var ny = Utilities.formatDate(new Date(utc), 'America/New_York', 'yyyy-MM-dd');
  return ij_date_(ny);
}

function ij_installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'ij_importFeed') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('ij_importFeed').timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast('Hourly IBKR import installed', 'IBKR Journal', 8);
}
