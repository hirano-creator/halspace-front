// =====================================================
// ヒラノポータル Google Apps Script（links対応版）
// =====================================================
const SHEET_EVENTS    = "events";
const SHEET_POSTS     = "posts";
const SHEET_LINKS     = "links";
const SHEET_REMINDERS = "reminders";
const HEADERS_EVENTS    = ["id","name","start","startTime","end","endTime","detail","color","author","facility","facility2","kintaiType"];
const HEADERS_POSTS     = ["id","title","content","author","date","attachments"];
const HEADERS_LINKS     = ["id","title","url","description","author","date","clickCount"];
const HEADERS_REMINDERS = ["id","title","type","pattern","patternDetail","targets","note","timing","author","createdAt","overrideDate","url"];

function doGet(e) {
  try {
    if (e.parameter.payload) {
      const body = JSON.parse(e.parameter.payload);
      const action = body.action;
      if (action === "addEvent")      { const r=addEvent(body.event); clearCache(); return res(r); }
      if (action === "updateEvent")   { const r=updateEvent(body.event); clearCache(); return res(r); }
      if (action === "moveEvent")     { const r=moveEvent(body.id, body.newStart, body.newEnd); clearCache(); return res(r); }
      if (action === "deleteEvent")   { const r=deleteEvent(body.id); clearCache(); return res(r); }
      if (action === "addPost")       { const r=addPost(body.post); clearCache(); return res(r); }
      if (action === "updatePost")    { const r=updatePost(body.post); clearCache(); return res(r); }
      if (action === "deletePost")    { const r=deletePost(body.id); clearCache(); return res(r); }
      if (action === "saveSettings")  return res(saveSettings(body.settings));
      if (action === "addLink")       { const r=addLink(body.link); clearCache(); return res(r); }
      if (action === "updateLink")    { const r=updateLink(body.link); clearCache(); return res(r); }
      if (action === "deleteLink")    { const r=deleteLink(body.id); clearCache(); return res(r); }
      if (action === "incrementLinkClick") { const r=incrementLinkClick(body.id); clearCache(); return res(r); }
      if (action === "addUser")           return res(addUser(body.user));
      if (action === "addReminder")       { const r=addReminder(body.reminder); clearCache(); return res(r); }
      if (action === "updateReminder")    { const r=updateReminder(body.reminder); clearCache(); return res(r); }
      if (action === "deleteReminder")    { const r=deleteReminder(body.id); clearCache(); return res(r); }
      return res({ error: "Unknown action: " + action });
    }
    const action = e.parameter.action;
    // CacheServiceで高速化（キャッシュ有効期間: 3分）
    const cache = CacheService.getScriptCache();
    if (action === "getEvents" || action === "getPosts" || action === "getLinks") {
      const cacheKey = "hp_" + action;
      const cached = cache.get(cacheKey);
      if (cached) {
        const out = ContentService.createTextOutput(cached);
        out.setMimeType(ContentService.MimeType.JSON);
        return out;
      }
    }
    if (action === "getEvents") {
      const d = JSON.stringify(getEventsData());
      cache.put("hp_getEvents", d, 180);
      return res(JSON.parse(d));
    }
    if (action === "getPosts") {
      const d = JSON.stringify(getPostsData());
      cache.put("hp_getPosts", d, 180);
      return res(JSON.parse(d));
    }
    if (action === "getLinks") {
      const d = JSON.stringify(getLinksData());
      cache.put("hp_getLinks", d, 180);
      return res(JSON.parse(d));
    }
    if (action === "getAllData")  {
      const cacheKey = "hp_alldata";
      const cache = CacheService.getScriptCache();
      const cached = cache.get(cacheKey);
      if (cached) { const out=ContentService.createTextOutput(cached); out.setMimeType(ContentService.MimeType.JSON); return out; }
      const d = getAllData();
      return res(d);
    }
    if (action === "getSettings")   return res(getSettings());
    if (action === "getUsers")      return res(getUsersData());
    if (action === "getReminders")  return res(getRemindersData());
    return res({ error: "Unknown action: " + action });
  } catch(err) {
    return res({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === "addEvent")     { const r=addEvent(body.event); clearCache(); return res(r); }
    if (body.action === "updateEvent")  { const r=updateEvent(body.event); clearCache(); return res(r); }
    if (body.action === "moveEvent")    { const r=moveEvent(body.id, body.newStart, body.newEnd); clearCache(); return res(r); }
    if (body.action === "deleteEvent")  { const r=deleteEvent(body.id); clearCache(); return res(r); }
    if (body.action === "addPost")      { const r=addPost(body.post); clearCache(); return res(r); }
    if (body.action === "updatePost")   { const r=updatePost(body.post); clearCache(); return res(r); }
    if (body.action === "deletePost")   { const r=deletePost(body.id); clearCache(); return res(r); }
    if (body.action === "saveSettings") return res(saveSettings(body.settings));
    if (body.action === "addLink")         { const r=addLink(body.link); clearCache(); return res(r); }
    if (body.action === "updateLink")      { const r=updateLink(body.link); clearCache(); return res(r); }
    if (body.action === "deleteLink")      { const r=deleteLink(body.id); clearCache(); return res(r); }
    if (body.action === "addReminder")     { const r=addReminder(body.reminder); clearCache(); return res(r); }
    if (body.action === "updateReminder")  { const r=updateReminder(body.reminder); clearCache(); return res(r); }
    if (body.action === "deleteReminder")  { const r=deleteReminder(body.id); clearCache(); return res(r); }
    return res({ error: "Unknown action" });
  } catch(err) {
    return res({ error: err.message });
  }
}

// 書き込み後にキャッシュをクリア

// 全データを1回のリクエストで取得（高速化）
function getAllData() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "hp_alldata";
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  const result = {
    events: getEventsData(),
    posts: getPostsData(),
    links: getLinksDataFast()
  };
  try { cache.put(cacheKey, JSON.stringify(result), 180); } catch(e) {}
  return result;
}

// ensureLinksClickCountを毎回呼ばない高速版
function getLinksDataFast() {
  const sheet = getSheet(SHEET_LINKS, HEADERS_LINKS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const header = data[0].map(function(h){ return String(h).trim(); });
  var col = {};
  header.forEach(function(h, i){ col[h] = i; });
  if (col['clickCount'] === undefined) return [];
  return data.slice(1).map(function(r) {
    return {
      id:          String(r[col['id']]         ||""),
      title:       String(r[col['title']]       ||""),
      url:         String(r[col['url']]         ||""),
      description: String(r[col['description']] ||""),
      author:      String(r[col['author']]      ||""),
      date:        String(r[col['date']]        ||""),
      clickCount:  Number(r[col['clickCount']]  ||0)
    };
  });
}

// clearCacheをallDataにも対応
function clearCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.removeAll(["hp_getEvents","hp_getPosts","hp_getLinks","hp_alldata","hp_getReminders"]);
  } catch(e) {}
}

function res(data) {
  const out = ContentService.createTextOutput(JSON.stringify(data));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

// ===== 日付・時刻フォーマット =====
function fmtTime(val) {
  if (!val && val !== 0) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
  }
  const s = String(val).trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return m[1].padStart(2,"0") + ":" + m[2];
  return s;
}

function fmtDate(val) {
  const tz = Session.getScriptTimeZone();
  if (val instanceof Date) return Utilities.formatDate(val, tz, "yyyy-MM-dd");
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try { const d = new Date(s); if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, "yyyy-MM-dd"); } catch(e) {}
  return s;
}

// ===== Google Drive =====
function getFolder(name) {
  const it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

function saveAttachments(attachments) {
  if (!attachments || attachments.length === 0) return [];
  const folder = getFolder("ヒラノカレンダー_添付ファイル");
  return attachments.map(function(a) {
    if (!a.data) return { name:a.name, url:"", id:"", type:a.type };
    try {
      var blob = Utilities.newBlob(Utilities.base64Decode(a.data), a.type, a.name);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return { name:a.name, url:"https://drive.google.com/file/d/"+file.getId()+"/view", id:file.getId(), type:a.type };
    } catch(err) { return { name:a.name, url:"", id:"", type:a.type }; }
  });
}

// ===== カレンダー =====
function getEventsData() {
  const sheet = getSheet(SHEET_EVENTS, HEADERS_EVENTS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const header = data[0].map(function(h){ return String(h).trim(); });
  var col = {};
  header.forEach(function(h, i){ col[h] = i; });
  var hasStartTime = (col['startTime'] !== undefined);
  return data.slice(1).map(function(r) {
    if (!hasStartTime) {
      return { id:String(r[0]), name:String(r[1]), start:fmtDate(r[2]), startTime:"", end:fmtDate(r[3]), endTime:"", detail:String(r[4]||""), color:String(r[5]||"#4A90D9"), author:String(r[6]||""), facility:"" };
    }
    return {
      id:String(r[col['id']]||""), name:String(r[col['name']]||""),
      start:fmtDate(r[col['start']]), startTime:fmtTime(r[col['startTime']]),
      end:fmtDate(r[col['end']]),     endTime:fmtTime(r[col['endTime']]),
      detail:String(r[col['detail']]||""), color:String(r[col['color']]||"#4A90D9"),
      author:String(r[col['author']]||""), facility:String(r[col['facility']]||""),
      facility2:String(r[col['facility2']]||""),
      kintaiType:String(r[col['kintaiType']]||"")
    };
  });
}

function addEvent(ev) {
  const sheet = getSheet(SHEET_EVENTS, HEADERS_EVENTS);
  const id = String(Date.now());
  sheet.appendRow([id, ev.name||"", ev.start||"", ev.startTime||"", ev.end||"", ev.endTime||"", ev.detail||"", ev.color||"#4A90D9", ev.author||"", ev.facility||"", ev.facility2||"", ev.kintaiType||""]);
  return { success:true, id:id };
}

function updateEvent(ev) {
  const sheet = getSheet(SHEET_EVENTS, HEADERS_EVENTS);
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(ev.id)) {
      sheet.getRange(i+1,1,1,12).setValues([[ev.id, ev.name||"", ev.start||"", ev.startTime||"", ev.end||"", ev.endTime||"", ev.detail||"", ev.color||"#4A90D9", ev.author||"", ev.facility||"", ev.facility2||"", ev.kintaiType||""]]);
      return { success:true };
    }
  }
  return { error:"Not found" };
}

function moveEvent(id, newStart, newEnd) {
  const sheet = getSheet(SHEET_EVENTS, HEADERS_EVENTS);
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i+1,3).setValue(newStart);
      sheet.getRange(i+1,5).setValue(newEnd);
      return { success:true };
    }
  }
  return { error:"Not found" };
}

function deleteEvent(id) { return deleteRow(SHEET_EVENTS, HEADERS_EVENTS, id); }

// ===== 掲示板 =====
function getPostsData() {
  const sheet = getSheet(SHEET_POSTS, HEADERS_POSTS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var posts = data.slice(1).map(function(r) {
    var att = [];
    try { var raw=String(r[5]); if(raw&&raw!=="") att=JSON.parse(raw); } catch(e) {}
    return { id:String(r[0]), title:String(r[1]), content:String(r[2]), author:String(r[3]), date:String(r[4]), attachments:att };
  });
  return posts.reverse();
}

function addPost(post) {
  const sheet = getSheet(SHEET_POSTS, HEADERS_POSTS);
  const id   = String(Date.now());
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var att = saveAttachments(post.attachments||[]);
  sheet.appendRow([id, post.title||"", post.content||"", post.author||"", date, JSON.stringify(att)]);
  return { success:true, id:id };
}

function updatePost(post) {
  const sheet = getSheet(SHEET_POSTS, HEADERS_POSTS);
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(post.id)) {
      var existing = [];
      try { var raw=String(data[i][5]); if(raw&&raw!=="") existing=JSON.parse(raw); } catch(e) {}
      var merged = existing.concat(saveAttachments(post.attachments||[]));
      sheet.getRange(i+1,1,1,6).setValues([[post.id, post.title||"", post.content||"", post.author||"", data[i][4], JSON.stringify(merged)]]);
      return { success:true };
    }
  }
  return { error:"Not found" };
}

function deletePost(id) { return deleteRow(SHEET_POSTS, HEADERS_POSTS, id); }

// ===== リンク先 =====
function ensureLinksClickCount() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_LINKS);
  if (!sheet) return;
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerStrs = header.map(function(h){ return String(h).trim(); });
  if (headerStrs.indexOf("clickCount") === -1) {
    var nextCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, nextCol).setValue("clickCount");
    // 既存行に0を設定
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      for (var i = 2; i <= lastRow; i++) {
        sheet.getRange(i, nextCol).setValue(0);
      }
    }
  }
}

function getLinksData() {
  ensureLinksClickCount();
  const sheet = getSheet(SHEET_LINKS, HEADERS_LINKS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const header = data[0].map(function(h){ return String(h).trim(); });
  var col = {};
  header.forEach(function(h, i){ col[h] = i; });
  return data.slice(1).map(function(r) {
    return {
      id:          String(r[col['id']]          ||""),
      title:       String(r[col['title']]        ||""),
      url:         String(r[col['url']]          ||""),
      description: String(r[col['description']]  ||""),
      author:      String(r[col['author']]       ||""),
      date:        String(r[col['date']]         ||""),
      clickCount:  Number(r[col['clickCount']]   ||0)
    };
  });
}

function addLink(link) {
  const sheet = getSheet(SHEET_LINKS, HEADERS_LINKS);
  const id = "lnk_" + String(Date.now());
  sheet.appendRow([id, link.title||"", link.url||"", link.description||"", link.author||"", link.date||""]);
  return { success:true, id:id };
}

function updateLink(link) {
  const sheet = getSheet(SHEET_LINKS, HEADERS_LINKS);
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(link.id)) {
      sheet.getRange(i+1,1,1,6).setValues([[link.id, link.title||"", link.url||"", link.description||"", link.author||"", link.date||""]]);
      return { success:true };
    }
  }
  return { error:"Not found" };
}

function deleteLink(id) { return deleteRow(SHEET_LINKS, HEADERS_LINKS, id); }

// ===== 設定（メンバー・施設を1行1件で管理）=====
function getMembersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("members");
  if (!sh) {
    sh = ss.insertSheet("members");
    sh.appendRow(["name"]);
    sh.getRange(1,1,1,1).setFontWeight("bold").setBackground("#4f46e5").setFontColor("#fff");
    sh.setFrozenRows(1);
  }
  return sh;
}

function getFacilitiesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("facilities");
  if (!sh) {
    sh = ss.insertSheet("facilities");
    sh.appendRow(["name"]);
    sh.getRange(1,1,1,1).setFontWeight("bold").setBackground("#4f46e5").setFontColor("#fff");
    sh.setFrozenRows(1);
  }
  return sh;
}

function getSettings() {
  var members = [];
  var facilities = [];
  try {
    var mSh = getMembersSheet();
    var mData = mSh.getDataRange().getValues();
    for (var i = 1; i < mData.length; i++) {
      var n = String(mData[i][0]).trim();
      if (n) members.push(n);
    }
  } catch(e) {}
  try {
    var fSh = getFacilitiesSheet();
    var fData = fSh.getDataRange().getValues();
    for (var i = 1; i < fData.length; i++) {
      var n = String(fData[i][0]).trim();
      if (n) facilities.push(n);
    }
  } catch(e) {}
  // 空の場合はsettingsシートのJSONからマイグレーション
  if (members.length === 0 || facilities.length === 0) {
    try {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("settings");
      if (sh) {
        var d = sh.getDataRange().getValues();
        for (var i = 1; i < d.length; i++) {
          if (String(d[i][0]) === "settings") {
            var p = JSON.parse(String(d[i][1]));
            if (p && p.members && members.length === 0) members = p.members;
            if (p && p.facilities && facilities.length === 0) facilities = p.facilities;
          }
        }
      }
    } catch(e) {}
  }
  if (members.length === 0) members = ["田中","鈴木","佐藤","山田","伊藤","渡辺"];
  if (facilities.length === 0) facilities = ["会議室A","会議室B","応接室","大ホール"];
  return { members: members, facilities: facilities };
}

function saveSettings(settings) {
  if (settings.members) {
    var mSh = getMembersSheet();
    var lr = mSh.getLastRow();
    if (lr > 1) mSh.deleteRows(2, lr - 1);
    settings.members.forEach(function(name) {
      if (name && name.trim()) mSh.appendRow([name.trim()]);
    });
  }
  if (settings.facilities) {
    var fSh = getFacilitiesSheet();
    var lr = fSh.getLastRow();
    if (lr > 1) fSh.deleteRows(2, lr - 1);
    settings.facilities.forEach(function(name) {
      if (name && name.trim()) fSh.appendRow([name.trim()]);
    });
  }
  return { success: true };
}

// ===== 共通ユーティリティ =====
function deleteRow(sheetName, headers, id) {
  const sheet = getSheet(sheetName, headers);
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) { sheet.deleteRow(i+1); return { success:true }; }
  }
  return { error:"Not found" };
}

function getSheet(name, headers) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  var   sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    const h = sheet.getRange(1, 1, 1, headers.length);
    h.setFontWeight("bold").setBackground("#4f46e5").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== デバッグ用 =====
function testGetEvents() { Logger.log(JSON.stringify(getEventsData())); }
function testGetPosts()  { Logger.log(JSON.stringify(getPostsData()));  }
function testGetLinks()  { Logger.log(JSON.stringify(getLinksData()));  }

// ===== ユーザー認証 =====
const HEADERS_USERS = ["id","password","name"];

function getUsersData() {
  const sheet = getSheet("users", HEADERS_USERS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const header = data[0].map(function(h){ return String(h).trim(); });
  var col = {};
  header.forEach(function(h, i){ col[h] = i; });
  return data.slice(1).map(function(r) {
    return {
      id:       String(r[col['id']]       || ""),
      password: String(r[col['password']] || ""),
      name:     String(r[col['name']]     || "")
    };
  });
}

function addUser(user) {
  if (!user.id || !user.password) return {error:"IDとパスワードは必須です"};
  const sheet = getSheet("users", HEADERS_USERS);
  const data  = sheet.getDataRange().getValues();
  // ID重複チェック
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(user.id)) return {error:"このIDはすでに使用されています"};
  }
  sheet.appendRow([user.id, user.password, user.name||user.id]);
  return {success:true};
}

// ===== リマインダー =====
function getRemindersData() {
  const sheet = getSheet(SHEET_REMINDERS, HEADERS_REMINDERS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const header = data[0].map(function(h){ return String(h).trim(); });
  var col = {};
  header.forEach(function(h, i){ col[h] = i; });
  return data.slice(1).map(function(r) {
    return {
      id:            String(r[col['id']]            ||""),
      title:         String(r[col['title']]          ||""),
      type:          String(r[col['type']]           ||""),
      pattern:       String(r[col['pattern']]        ||""),
      patternDetail: String(r[col['patternDetail']]  ||""),
      targets:       String(r[col['targets']]        ||""),
      note:          String(r[col['note']]           ||""),
      timing:        String(r[col['timing']]         ||"same-day"),
      author:        String(r[col['author']]         ||""),
      createdAt:     String(r[col['createdAt']]      ||""),
      overrideDate:  String(r[col['overrideDate']]   ||""),
      url:           String(r[col['url']]            ||"")
    };
  });
}

function addReminder(rem) {
  const sheet = getSheet(SHEET_REMINDERS, HEADERS_REMINDERS);
  const id = "rem_" + String(Date.now());
  const fallbackDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const createdAt = rem.createdAt || fallbackDate;
  sheet.appendRow([id, rem.title||"", rem.type||"", rem.pattern||"", rem.patternDetail||"", rem.targets||"", rem.note||"", rem.timing||"same-day", rem.author||"", createdAt, rem.overrideDate||"", rem.url||""]);
  return { success:true, id:id };
}

function updateReminder(rem) {
  const sheet = getSheet(SHEET_REMINDERS, HEADERS_REMINDERS);
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(rem.id)) {
      sheet.getRange(i+1,1,1,12).setValues([[rem.id, rem.title||"", rem.type||"", rem.pattern||"", rem.patternDetail||"", rem.targets||"", rem.note||"", rem.timing||"same-day", rem.author||"", data[i][9]||"", rem.overrideDate||"", rem.url||""]]);
      return { success:true };
    }
  }
  return { error:"Not found" };
}

function deleteReminder(id) { return deleteRow(SHEET_REMINDERS, HEADERS_REMINDERS, id); }

function incrementLinkClick(id) {
  var sheet = getSheet(SHEET_LINKS, HEADERS_LINKS);
  var data  = sheet.getDataRange().getValues();
  var header = data[0].map(function(h){ return String(h).trim(); });
  var col = {};
  header.forEach(function(h, i){ col[h] = i; });
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col['id']]) === String(id)) {
      var current = Number(data[i][col['clickCount']] || 0);
      sheet.getRange(i+1, col['clickCount']+1).setValue(current + 1);
      clearCache();
      return {success: true, clickCount: current + 1};
    }
  }
  return {error: "not found"};
}
