/**
 * СЕРВЕР ДЛЯ СДАЧИ РАБОТ — Python Turtle курс
 *
 * УСТАНОВКА (один раз, ~7 минут):
 * 1. Создай пустую Google-таблицу (sheets.new), назови, например, «Работы учеников».
 * 2. Меню: Расширения → Apps Script. Удали весь код в редакторе и вставь этот файл целиком.
 * 3. Пароль администратора уже вписан ниже: ADMIN_KEY = 'qwedsa' — тот же,
 *    что при входе под админом на слайдах (index.html) и в admin.html.
 *    Менять его не нужно; если поменяешь — вход на сайте перестанет совпадать.
 * 4. Сохрани (Ctrl+S). Выбери функцию setupSheet и нажми «Выполнить» (один раз,
 *    разреши доступ своему аккаунту) — появится лист «Работы» с шапкой.
 * 5. «Наружу» / «Deploy» → «Новое развёртывание» / «New deployment».
 *    Тип: «Веб-приложение» / «Web app».
 *    Выполнять как: «От моего имени» / «Me».
 *    У кого есть доступ: «Все» / «Anyone».
 *    «Развернуть» / «Deploy» → скопируй адрес вида
 *    https://script.google.com/macros/s/XXXX/exec
 * 6. Вставь этот адрес в config.js репозитория (поле webAppUrl) и закоммить.
 *
 * ЕСЛИ СКРИПТ УЖЕ БЫЛ РАЗВЁРНУТ РАНЬШЕ (обновление версии):
 * вставь этот код поверх старого, сохрани, затем
 * «Развернуть» → «Управление развёртываниями» → карандаш ✏️ →
 * Версия: «Новая версия» → «Развернуть». Адрес /exec останется прежним.
 *
 * Ученики отправляют работы без ключа. Список работ и удаление требуют ключа.
 */

const SHEET_NAME = 'Работы';
const ADMIN_KEY = 'qwedsa';

const HEADERS = ['ID', 'Дата', 'ФИО', 'Урок', 'Тема', 'Тестов пройдено', 'Всего тестов', 'Результат', 'Комментарии (ошибки)', 'Проверки JSON', 'Код', 'ID задания'];

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // обновляем шапку, если скрипт обновился (например, добавился столбец «ID задания»)
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  // текст: иначе Sheets превращает '2-4' в дату, а код с '=' — в формулу
  sheet.getRange(1, 11, sheet.getMaxRows(), 2).setNumberFormat('@');
  return 'Лист готов';
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { setupSheet(); sheet = ss.getSheetByName(SHEET_NAME); }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'submit';
    if (action === 'submit') return submit_(data);
    if (!ADMIN_KEY) {
      return json_({ ok: false, error: 'Администратор не настроил ADMIN_KEY в скрипте' });
    }
    if (data.key !== ADMIN_KEY) return json_({ ok: false, error: 'Неверный ключ администратора' });
    if (action === 'list') return list_();
    if (action === 'delete') return delete_(data.id);
    if (action === 'clear') return clear_();
    return json_({ ok: false, error: 'Неизвестное действие' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    if ((e.parameter || {}).key !== ADMIN_KEY) return json_({ ok: false, error: 'Неверный ключ' });
    return list_();
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function submit_(r) {
  if (!r || !r.id || !r.name || !r.lesson || typeof r.code !== 'string') {
    return json_({ ok: false, error: 'Некорректная работа' });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const last = sheet.getLastRow();
    if (last > 1) {
      const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(r.id)) return json_({ ok: true, duplicate: true });
      }
    }
    const checks = Array.isArray(r.checks) ? r.checks : [];
    const passedCount = checks.filter(c => c.passed).length;
    const comments = checks.filter(c => !c.passed).map(c => '✗ ' + c.label + ' — ' + (c.hint || '')).join('\n');
    sheet.getRange(1, 11, sheet.getMaxRows(), 2).setNumberFormat('@');
    sheet.appendRow([
      r.id,
      r.submittedAt || new Date().toISOString(),
      String(r.name).slice(0, 100),
      Number(r.lesson) || 0,
      r.taskTitle || r.lessonTitle || '',
      passedCount,
      checks.length,
      passedCount === checks.length && checks.length > 0 ? 'зачёт' : 'незачёт',
      comments,
      JSON.stringify(checks),
      r.code,
      r.taskId || '',
    ]);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function list_() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return json_({ ok: true, records: [] });
  const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const records = rows.map(row => ({
    id: String(row[0]),
    submittedAt: row[1] instanceof Date ? row[1].toISOString() : String(row[1]),
    name: String(row[2]),
    lesson: Number(row[3]),
    lessonTitle: String(row[4]),
    passedCount: Number(row[5]),
    total: Number(row[6]),
    result: String(row[7]),
    comments: String(row[8]),
    checks: safeParse_(row[9]),
    code: String(row[10]),
    taskId: String(row[11] || ''),
    taskTitle: String(row[4]),
  }));
  return json_({ ok: true, records: records });
}

function safeParse_(s) {
  try { return JSON.parse(s); } catch (e) { return []; }
}

function delete_(id) {
  if (!id) return json_({ ok: false, error: 'Нет ID' });
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return json_({ ok: true });
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) sheet.deleteRow(i + 2);
  }
  return json_({ ok: true });
}

function clear_() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last - 1);
  return json_({ ok: true });
}