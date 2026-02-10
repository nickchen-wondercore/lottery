/**
 * SyncService.gs — CacheService 同步機制
 * Master 推送指令，Viewer polling 拉取。使用 LockService 防止衝突。
 *
 * 同步指令類型：
 *   INIT, SEALED, START_TURBULENCE, STOP_TURBULENCE,
 *   DRAW_START, EJECT, BATCH_DONE, RESET
 */

var CACHE_KEY_COMMANDS = 'lottery_sync_commands';
var CACHE_KEY_VERSION = 'lottery_sync_version';
var CACHE_KEY_SNAPSHOT = 'lottery_sync_snapshot';
var CACHE_EXPIRY = 21600; // 6 小時（秒）

/**
 * Master 推送指令到 CacheService
 * @param {Object} command - { action: string, payload: any }
 * @return {number} 新版本號
 */
function SyncService_pushCommand(command) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    var cache = CacheService.getScriptCache();

    // 取得目前版本
    var versionStr = cache.get(CACHE_KEY_VERSION);
    var version = versionStr ? parseInt(versionStr, 10) : 0;
    version++;

    // 讀取現有指令列表
    var commandsStr = cache.get(CACHE_KEY_COMMANDS);
    var commands = commandsStr ? JSON.parse(commandsStr) : [];

    // 新增指令（附帶版本號和時間戳）
    command.version = version;
    command.timestamp = new Date().getTime();
    commands.push(command);

    // 保留最近 200 條指令（避免超過 CacheService 100KB 限制）
    if (commands.length > 200) {
      commands = commands.slice(-200);
    }

    // 寫回
    cache.put(CACHE_KEY_COMMANDS, JSON.stringify(commands), CACHE_EXPIRY);
    cache.put(CACHE_KEY_VERSION, String(version), CACHE_EXPIRY);

    // 更新狀態快照（用於 late-join）
    _updateSnapshot(cache, command, version);

    return version;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Viewer 拉取新指令 + 狀態快照
 * @param {number} sinceVersion - 上次已處理的版本號（0 表示首次）
 * @return {Object} { version, commands, snapshot }
 */
function SyncService_getSyncState(sinceVersion) {
  var cache = CacheService.getScriptCache();

  var versionStr = cache.get(CACHE_KEY_VERSION);
  var currentVersion = versionStr ? parseInt(versionStr, 10) : 0;

  // 無新指令
  if (currentVersion <= sinceVersion) {
    return { version: currentVersion, commands: [], snapshot: null };
  }

  // 首次連線（sinceVersion = 0）：回傳完整快照
  var snapshot = null;
  if (sinceVersion === 0) {
    var snapshotStr = cache.get(CACHE_KEY_SNAPSHOT);
    snapshot = snapshotStr ? JSON.parse(snapshotStr) : null;
  }

  // 取得 sinceVersion 之後的新指令
  var commandsStr = cache.get(CACHE_KEY_COMMANDS);
  var allCommands = commandsStr ? JSON.parse(commandsStr) : [];
  var newCommands = allCommands.filter(function(cmd) {
    return cmd.version > sinceVersion;
  });

  return {
    version: currentVersion,
    commands: newCommands,
    snapshot: snapshot
  };
}

/**
 * 清除所有同步狀態（重置用）
 */
function SyncService_clearSync() {
  var cache = CacheService.getScriptCache();
  cache.removeAll([CACHE_KEY_COMMANDS, CACHE_KEY_VERSION, CACHE_KEY_SNAPSHOT]);
}

/**
 * 更新狀態快照（用於 late-join 恢復）
 * 快照記錄目前的關鍵狀態，讓新加入的 Viewer 能快速同步。
 */
function _updateSnapshot(cache, command, version) {
  var snapshotStr = cache.get(CACHE_KEY_SNAPSHOT);
  var snapshot = snapshotStr ? JSON.parse(snapshotStr) : {
    state: 'IDLE',
    names: [],
    settings: {},
    winners: [],
    turbulenceActive: false,
    version: 0
  };

  switch (command.action) {
    case 'INIT':
      snapshot.state = 'LOADING';
      snapshot.names = command.payload.names || [];
      snapshot.settings = command.payload.settings || {};
      snapshot.winners = [];
      snapshot.turbulenceActive = false;
      break;
    case 'SEALED':
      snapshot.state = 'READY';
      break;
    case 'START_TURBULENCE':
      snapshot.state = 'SPINNING';
      snapshot.turbulenceActive = true;
      break;
    case 'STOP_TURBULENCE':
      snapshot.state = 'READY';
      snapshot.turbulenceActive = false;
      break;
    case 'DRAW_START':
      snapshot.state = 'DRAWING';
      break;
    case 'EJECT':
      if (command.payload && command.payload.name) {
        snapshot.winners.push(command.payload.name);
      }
      break;
    case 'BATCH_DONE':
      if (command.payload && command.payload.hasRemaining) {
        snapshot.state = 'READY';
      } else {
        snapshot.state = 'COMPLETE';
      }
      snapshot.turbulenceActive = false;
      break;
    case 'RESET':
      snapshot.state = 'IDLE';
      snapshot.winners = [];
      snapshot.turbulenceActive = false;
      break;
  }

  snapshot.version = version;
  cache.put(CACHE_KEY_SNAPSHOT, JSON.stringify(snapshot), CACHE_EXPIRY);
}
