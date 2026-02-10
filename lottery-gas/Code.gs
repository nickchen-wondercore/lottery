/**
 * Code.gs — Google Apps Script 入口
 * doGet() 依 mode 參數決定 Master / Viewer，include() 用於模板組裝。
 */

/**
 * Web App 入口：根據 ?mode= 參數決定前端模式
 * - master 或無參數 → Master 模式（完整控制）
 * - viewer → Viewer 模式（唯讀同步觀看）
 */
function doGet(e) {
  const mode = (e.parameter.mode || 'master').toLowerCase();

  // Controller 模式使用獨立頁面模板
  if (mode === 'controller') {
    const template = HtmlService.createTemplateFromFile('ControllerIndex');
    return template.evaluate()
      .setTitle('抽獎遙控器')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, user-scalable=no');
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.mode = mode;

  // 讀取設定中的背景圖 URL
  const settings = SheetService_getSettings();
  template.backgroundUrl = settings.backgroundUrl || '';

  return template.evaluate()
    .setTitle('尾牙抽獎')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * 模板 include helper：將指定 HTML 檔案內容嵌入主模板
 * @param {string} filename - HTML 檔案名稱（不含副檔名）
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── 暴露給前端的 API（google.script.run 呼叫用）──

function api_getListSheetNames() {
  return SheetService_getListSheetNames();
}

function api_getNames(sheetName) {
  return SheetService_getNames(sheetName);
}

function api_getAllNamesWithStatus(sheetName) {
  return SheetService_getAllNamesWithStatus(sheetName);
}

function api_getSettings() {
  return SheetService_getSettings();
}

function api_recordWinner(name, round, sheetName) {
  return SheetService_recordWinner(name, round, sheetName);
}

function api_recordWinnerBatch(names, round, sheetName) {
  return SheetService_recordWinnerBatch(names, round, sheetName);
}

function api_pushCommand(command) {
  return SyncService_pushCommand(command);
}

function api_getSyncState(sinceVersion) {
  return SyncService_getSyncState(sinceVersion);
}

function api_clearSync() {
  return SyncService_clearSync();
}
