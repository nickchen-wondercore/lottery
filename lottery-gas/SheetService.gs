/**
 * SheetService.gs — Google Sheets CRUD
 * 名單 Sheet 由前端下拉選單動態指定。
 *
 * 名單 Sheet 結構（含標題列）：
 *   Row 1: 標題列（中文姓名 | 英文名 | 已中獎 | 未報到）
 *   Row 2+: 資料
 *   Column A: 中文姓名
 *   Column B: 英文名（球上顯示用）
 *   Column C: 已中獎標記（TRUE）
 *   Column D: 未報到標記（TRUE）
 */

// ── 常數：Sheet 名稱與欄位索引 ──

var SHEET_NAME_SETTINGS = '設定';
var SHEET_NAME_RECORDS = '中獎紀錄';

// 不納入名單選單的 Sheet 名稱
var EXCLUDED_SHEETS = [SHEET_NAME_SETTINGS, SHEET_NAME_RECORDS];

// 名單 Sheet 欄位（0-based index）
var COL_CHINESE_NAME = 0;  // Column A: 中文姓名
var COL_ENGLISH_NAME = 1;  // Column B: 英文名（球上顯示）
var COL_WON_FLAG = 2;      // Column C: 已中獎
var COL_ABSENT = 3;        // Column D: 未報到

// ── 工具：取得目前 Spreadsheet ──

function _getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _getSheet(name) {
  return _getSpreadsheet().getSheetByName(name);
}

// ── 工作表列表 ──

/**
 * 取得可作為名單的工作表名稱列表
 * 排除「設定」和「中獎紀錄」
 * @return {string[]}
 */
function SheetService_getListSheetNames() {
  var sheets = _getSpreadsheet().getSheets();
  var names = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (EXCLUDED_SHEETS.indexOf(name) === -1) {
      names.push(name);
    }
  }
  return names;
}

// ── 名單 Sheet ──

/**
 * 讀取未中獎名單（Column C != TRUE, Column D != TRUE）
 * @param {string} sheetName - 工作表名稱
 * @return {string[]} 未中獎的英文名陣列
 */
function SheetService_getNames(sheetName) {
  var sheet = _getSheet(sheetName);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var names = [];
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][COL_ENGLISH_NAME]).trim();
    var won = String(data[i][COL_WON_FLAG]).trim().toUpperCase();
    var absent = String(data[i][COL_ABSENT]).trim().toUpperCase();
    if (name && won !== 'TRUE' && absent !== 'TRUE') {
      names.push(name);
    }
  }
  return names;
}

/**
 * 讀取全部名單（含中獎狀態，排除未報到）
 * @param {string} sheetName - 工作表名稱
 * @return {Array<{name: string, won: boolean}>}
 */
function SheetService_getAllNamesWithStatus(sheetName) {
  var sheet = _getSheet(sheetName);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][COL_ENGLISH_NAME]).trim();
    var won = String(data[i][COL_WON_FLAG]).trim().toUpperCase() === 'TRUE';
    var absent = String(data[i][COL_ABSENT]).trim().toUpperCase() === 'TRUE';
    if (name && !absent) {
      result.push({ name: name, won: won });
    }
  }
  return result;
}

// ── 設定 Sheet ──

/**
 * 讀取設定 key-value
 * @return {Object}
 */
function SheetService_getSettings() {
  var sheet = _getSheet(SHEET_NAME_SETTINGS);
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = data[i][1];
    if (key) {
      var num = Number(val);
      settings[key] = (val !== '' && !isNaN(num)) ? num : String(val);
    }
  }
  return settings;
}

// ── 中獎紀錄 Sheet ──

/**
 * 記錄單一中獎者
 * @param {string} name - 中獎者英文名
 * @param {number} round - 輪次
 * @param {string} sheetName - 名單工作表名稱
 */
function SheetService_recordWinner(name, round, sheetName) {
  // 先標記名單
  _markWonInNameSheet(name, sheetName);

  // 寫入中獎紀錄
  var sheet = _getSheet(SHEET_NAME_RECORDS);
  if (!sheet) return;

  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([name, now, round || 1, sheetName || '']);
}

/**
 * 批次記錄多位中獎者
 * @param {string[]} names - 中獎者英文名陣列
 * @param {number} round - 輪次
 * @param {string} sheetName - 名單工作表名稱
 */
function SheetService_recordWinnerBatch(names, round, sheetName) {
  if (!names || names.length === 0) return;

  names.forEach(function(name) {
    _markWonInNameSheet(name, sheetName);
  });

  var sheet = _getSheet(SHEET_NAME_RECORDS);
  if (!sheet) return;

  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  var rows = names.map(function(name) {
    return [name, now, round || 1, sheetName || ''];
  });

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 4).setValues(rows);
}

/**
 * 在指定名單 Sheet 中將英文名的 Column C 標記為 TRUE
 * @param {string} name - 英文名
 * @param {string} sheetName - 名單工作表名稱
 */
function _markWonInNameSheet(name, sheetName) {
  var sheet = _getSheet(sheetName);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, COL_ENGLISH_NAME + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === name) {
      sheet.getRange(i + 2, COL_WON_FLAG + 1).setValue('TRUE');
      break;
    }
  }
}
