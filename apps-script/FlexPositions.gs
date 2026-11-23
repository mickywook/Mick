/* FlexPositions.gs - the statement's cost per share for every stock you hold, for the P&L Calendar page.

   The "PnL Calendar history" Flex query (FlexHistory.gs) also returns an Open Positions section once it is
   ticked in the query. fp_store_() reads the stock rows from that same statement and REPLACES the contents
   of the "PnL Calendar - Flex open positions" sheet with them (symbol, shares, cost per share, cost basis,
   mark price, report date). The page reads that sheet and shows "Statement cost" in its Shares block.

   Hook: in FlexHistory.gs, fh_sync(), change
       if (x.indexOf('<FlexQueryResponse') > -1) { props.deleteProperty(FH_PROP); return fh_store_(x); }
   to
       if (x.indexOf('<FlexQueryResponse') > -1) { props.deleteProperty(FH_PROP); fp_store_(x); return fh_store_(x); }
   Deleting this file and undoing that one change reverts it. Writes nothing else. */

var FP_SHEET = '1-Gc-x4G59l-Ce2OSru1qkBZesGO47m4TRiEkae-I4Zo';      // "PnL Calendar - Flex open positions"
var FP_COLS  = ['symbol', 'assetCategory', 'position', 'costBasisPrice', 'costBasisMoney', 'markPrice', 'reportDate'];

function fp_store_(xml) {
  try {
    var tags = xml.match(/<OpenPosition\b[^>]*>/g) || [];
    var attr = function (t, n) { var m = t.match(new RegExp('\\s' + n + '="([^"]*)"')); return m ? m[1] : ''; };
    var sh = SpreadsheetApp.openById(FP_SHEET).getSheets()[0];
    if (!tags.length) { fp_status_(sh, 'no Open Positions in the Flex statement: tick "Open Positions" in the PnL Calendar history query'); return; }
    var rows = [];
    tags.forEach(function (t) {
      var lvl = attr(t, 'levelOfDetail');
      if (lvl && lvl !== 'SUMMARY') return;                       // one row per stock, not per tax lot
      if (attr(t, 'assetCategory') !== 'STK') return;
      rows.push(FP_COLS.map(function (c) { return attr(t, c); }));
    });
    sh.clearContents();
    sh.getRange(1, 1, 1, FP_COLS.length).setValues([FP_COLS]).setFontWeight('bold');
    if (rows.length) { var r = sh.getRange(2, 1, rows.length, FP_COLS.length); r.setNumberFormat('@'); r.setValues(rows); }
    fp_status_(sh, 'ok: ' + rows.length + ' stocks');
  } catch (e) { Logger.log('fp_store_: ' + e); }
}

function fp_status_(sh, text) {
  try { sh.getRange(1, FP_COLS.length + 2).setValue(Utilities.formatDate(new Date(), 'Africa/Johannesburg', 'yyyy-MM-dd HH:mm') + ' ' + text); } catch (e) {}
}

// Run once by hand after setting up the query, to fill the sheet now instead of waiting for the next scheduled run.
function fp_test() { return fh_sync(); }
