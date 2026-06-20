/****************************************************
 * CareLearn Pro Firebase Export Bridge
 * Optional Google Apps Script backend for Google Docs/PDF attendance export.
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 * Then paste the Web App URL into CareLearn Pro Admin > Export Settings.
 *
 * Script Properties recommended:
 *   FIREBASE_WEB_API_KEY = your Firebase Web API key
 *   ATTENDANCE_DOC_TEMPLATE_ID = optional Google Docs template ID
 ****************************************************/

var TZ = 'Asia/Riyadh';
var DEFAULT_ATTENDANCE_DOC_TEMPLATE_ID = '1zsSPyTBmU1VDMXkUbVkTyDvO2mGigj2aOReO49J5xAY';

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'uploadStatus') {
    return uploadStatusJsonp_(e.parameter.uploadId || '', e.parameter.callback || 'callback');
  }
  return HtmlService.createHtmlOutput('<h2>CareLearn Pro Export Bridge</h2><p>Status: Active.</p>');
}

function doPost(e) {
  var payload;
  try {
    var raw = e && e.parameter && e.parameter.payload ? e.parameter.payload : '';
    if (!raw) throw new Error('Missing export payload.');

    var json = Utilities.newBlob(Utilities.base64Decode(raw)).getDataAsString('UTF-8');
    payload = JSON.parse(json);

    var email = verifyFirebaseToken_(payload.idToken);
    if (payload.action === 'uploadCourseFiles') {
      var uploadResult = uploadCourseFiles_(payload.files || [], payload.courseName || 'Untitled Course', email);
      saveUploadStatus_(payload.uploadId, { status: 'complete', files: uploadResult.files || [] });
      return HtmlService.createHtmlOutput(uploadSuccessHtml_(uploadResult));
    }
    var records = payload.records || [];
    if (!records.length) throw new Error('No attendance records received.');

    var result = createAttendanceDocs_(records, payload.filters || {}, email);
    return HtmlService.createHtmlOutput(successHtml_(result));
  } catch (err) {
    if (payload && payload.uploadId) saveUploadStatus_(payload.uploadId, { status: 'error', error: String(err.message || err) });
    return HtmlService.createHtmlOutput(errorHtml_(err));
  }
}

function uploadCourseFiles_(files, courseName, uploadedBy) {
  if (!files.length) throw new Error('No files received.');
  var root = getOrCreateFolder_('CareLearn Pro Course Materials');
  var folder = getOrCreateChildFolder_(root, sanitize_(courseName));
  var uploaded = files.map(function (f) {
    var blob = dataUrlToBlob_(f.dataUrl, f.name || 'course-file');
    var file = folder.createFile(blob).setName(f.name || 'course-file');
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}
    return {
      name: file.getName(),
      url: file.getUrl(),
      id: file.getId(),
      uploadedBy: uploadedBy
    };
  });
  return { files: uploaded };
}

function saveUploadStatus_(uploadId, data) {
  if (!uploadId) return;
  CacheService.getScriptCache().put('upload:' + uploadId, JSON.stringify(data || {}), 600);
}

function uploadStatusJsonp_(uploadId, callback) {
  callback = String(callback || 'callback').replace(/[^\w.$]/g, '');
  var raw = uploadId ? CacheService.getScriptCache().get('upload:' + uploadId) : '';
  var data = raw ? JSON.parse(raw) : { status: 'pending' };
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(data) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function verifyFirebaseToken_(idToken) {
  if (!idToken) throw new Error('Missing Firebase ID token. Please sign in again.');
  var apiKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_WEB_API_KEY');
  if (!apiKey) throw new Error('Apps Script property FIREBASE_WEB_API_KEY is missing.');

  var url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey);
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300 || !body.users || !body.users.length) {
    throw new Error('Firebase token verification failed. Please sign in again.');
  }
  return body.users[0].email || 'unknown';
}

function createAttendanceDocs_(records, filters, exportedBy) {
  var props = PropertiesService.getScriptProperties();
  var templateId = props.getProperty('ATTENDANCE_DOC_TEMPLATE_ID') || DEFAULT_ATTENDANCE_DOC_TEMPLATE_ID;
  var folder = getOrCreateFolder_('CareLearn Pro Attendance Exports');
  var first = records[0] || {};
  var department = filters.department || first.department || 'All Departments';
  var courseName = first.courseName || 'Selected Courses';
  var exportDate = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  var name = 'Attendance - ' + sanitize_(department) + ' - ' + sanitize_(courseName) + ' - ' + exportDate.replace(/[ :]/g, '-');
  var doc;

  if (templateId) {
    var copy = DriveApp.getFileById(templateId).makeCopy(name, folder);
    doc = DocumentApp.openById(copy.getId());
  } else {
    doc = DocumentApp.create(name);
    var f = DriveApp.getFileById(doc.getId());
    folder.addFile(f);
    try { DriveApp.getRootFolder().removeFile(f); } catch (e) {}
  }

  buildDoc_(doc, records, {
    department: department,
    courseName: courseName,
    exportDate: exportDate,
    exportedBy: exportedBy,
    cycle: filters.cycle || 'All Cycles'
  });
  doc.saveAndClose();

  var docFile = DriveApp.getFileById(doc.getId());
  shareFileForExport_(docFile, exportedBy);
  var pdf = folder.createFile(docFile.getBlob().getAs('application/pdf').setName(name + '.pdf'));
  shareFileForExport_(pdf, exportedBy);
  return { docUrl: doc.getUrl(), pdfUrl: pdf.getUrl(), count: records.length, name: name };
}

function shareFileForExport_(file, email) {
  try {
    if (email && email !== 'unknown') file.addViewer(email);
  } catch (e) {}
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
}

function buildDoc_(doc, records, meta) {
  var body = doc.getBody();
  replaceAll_(body, '<<DEPARTMENT>>', meta.department);
  replaceAll_(body, '<<COURSE_NAME>>', meta.courseName);
  replaceAll_(body, '<<DATE>>', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  replaceAll_(body, '<<VENUE>>', 'Online');
  replaceAll_(body, '<<CYCLE>>', meta.cycle);
  replaceAll_(body, '<<EXPORT_DATE>>', meta.exportDate);
  replaceAll_(body, '<<TOTAL_COMPLETED>>', String(records.length));

  var table = findTemplateTable_(body);
  if (!table) {
    body.clear();
    body.appendParagraph('CareLearn Pro').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('Education Attendance Sheet').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('Course Name: ' + meta.courseName);
    body.appendParagraph('Department: ' + meta.department);
    body.appendParagraph('Date: ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
    body.appendParagraph('Venue: Online');
    body.appendParagraph('');
    table = body.appendTable([['SN', 'Name', 'Date', 'Job ID', 'Position', 'Signature']]);
  }

  fillTable_(table, records);
  body.appendParagraph('Generated by CareLearn Pro on ' + meta.exportDate + ' | Exported by: ' + meta.exportedBy)
    .setFontSize(8)
    .setForegroundColor('#64748b');
}

function findTemplateTable_(body) {
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    if (child.getType && child.getType() === DocumentApp.ElementType.TABLE) {
      var table = child.asTable();
      if (table.getText().indexOf('<<SN>>') > -1 || table.getText().indexOf('<<SIGNATURE>>') > -1) return table;
    }
  }
  return null;
}

function fillTable_(table, records) {
  var templateRowIndex = findTemplateRow_(table);
  var templateRow = templateRowIndex > -1 ? table.getRow(templateRowIndex).copy() : null;

  while (table.getNumRows() > 1) table.removeRow(1);

  records.forEach(function (r, i) {
    var row = templateRow ? table.appendTableRow(templateRow.copy()) : table.appendTableRow();
    if (!templateRow) {
      for (var c = 0; c < 6; c++) row.appendTableCell('');
    }
    setCell_(row, 0, String(i + 1));
    setCell_(row, 1, r.name || '');
    setCell_(row, 2, r.date || '');
    setCell_(row, 3, r.jobId || '');
    setCell_(row, 4, r.position || r.jobTitle || r.profession || '');
    setSignatureCell_(row, 5, r.signatureDataUrl || '');
  });

  try {
    var header = table.getRow(0);
    for (var c = 0; c < header.getNumCells(); c++) {
      header.getCell(c).setBackgroundColor('#0b3d66').setForegroundColor('#ffffff').setFontSize(10);
    }
    for (var r = 1; r < table.getNumRows(); r++) {
      for (var j = 0; j < table.getRow(r).getNumCells(); j++) table.getCell(r, j).setFontSize(9);
    }
  } catch (e) {}
}

function findTemplateRow_(table) {
  for (var r = 0; r < table.getNumRows(); r++) {
    if (table.getRow(r).getText().indexOf('<<SN>>') > -1 || table.getRow(r).getText().indexOf('<<SIGNATURE>>') > -1) return r;
  }
  return -1;
}

function setCell_(row, idx, value) {
  while (row.getNumCells() <= idx) row.appendTableCell('');
  row.getCell(idx).clear().setText(value || '');
}

function setSignatureCell_(row, idx, dataUrl) {
  while (row.getNumCells() <= idx) row.appendTableCell('');
  var cell = row.getCell(idx);
  cell.clear();
  if (!dataUrl) return cell.setText('');
  try {
    var blob = dataUrlToBlob_(dataUrl, 'signature.png');
    var img = cell.appendImage(blob);
    img.setWidth(95).setHeight(38);
  } catch (e) {
    cell.setText('Signature saved');
  }
}

function dataUrlToBlob_(dataUrl, name) {
  var m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid file data URL.');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name || 'signature.png');
}

function replaceAll_(body, token, value) {
  try { body.replaceText(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), String(value || '')); } catch (e) {}
}
function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function getOrCreateChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function sanitize_(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 90); }
function uploadSuccessHtml_(r) {
  var json = JSON.stringify({ type: 'carelearn-upload-complete', files: r.files || [] }).replace(/</g, '\\u003c');
  return '<html><body style="font-family:Arial;padding:18px"><p>Upload completed. CareLearn will attach the links automatically.</p><script>if (window.opener) { window.opener.postMessage(' + json + ', "*"); setTimeout(function(){ window.close(); }, 1200); }</script></body></html>';
}
function successHtml_(r) {
  return '<html><body style="font-family:Arial;padding:28px;background:#f6f8fc"><div style="max-width:620px;margin:auto;background:white;border-radius:22px;padding:24px;box-shadow:0 12px 36px #0001"><h2>Attendance Export Completed</h2><p>Total records: <b>' + r.count + '</b></p><p><a href="' + r.docUrl + '" target="_blank">Open Google Docs</a></p><p><a href="' + r.pdfUrl + '" target="_blank">Open PDF</a></p></div></body></html>';
}
function errorHtml_(e) {
  var msg = String(e.message || e).replace(/</g, '&lt;');
  var json = JSON.stringify({ type: 'carelearn-upload-complete', error: String(e.message || e) }).replace(/</g, '\\u003c');
  return '<html><body style="font-family:Arial;padding:28px;background:#fff5f5"><div style="max-width:680px;margin:auto;background:white;border-radius:22px;padding:24px;border:1px solid #fecaca"><h2 style="color:#991b1b">Request Failed</h2><p>' + msg + '</p><pre style="white-space:pre-wrap;background:#111827;color:white;padding:12px;border-radius:12px">' + String(e.stack || '').replace(/</g, '&lt;') + '</pre></div><script>if (window.opener) { window.opener.postMessage(' + json + ', "*"); }</script></body></html>';
}
