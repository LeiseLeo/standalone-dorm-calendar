const locale = document.documentElement.lang.startsWith('en') ? 'en' : 'de';
const translations = {
  de: { birthdays: 'Geburtstage', organizational: 'Organisatorische Stocktermine', official: 'Offizielle Wohnheimtermine', birthdaySearch: 'Nach Name oder Beschreibung filtern', birthdayMonth: 'Nach Monat filtern', allMonths: 'Alle Monate', connected: 'Verbunden', connectionError: 'Verbindungsfehler', disconnected: 'Nicht verbunden', unknownDate: 'Datum unbekannt', yearly: 'jährlich', edit: 'Bearbeiten', delete: 'Löschen', empty: 'Noch keine Einträge vorhanden.', entry: 'Eintrag', entries: 'Einträge', addEvent: 'Ereignis hinzufügen', addBirthday: 'Geburtstag hinzufügen', editEntry: 'Ereignis bearbeiten', birthday: 'Geburtstag hinzufügen', birthdayPlaceholder: 'z. B. Geburtstag von Anna', eventPlaceholder: 'z. B. WG-Sitzung', authError: 'Anmeldung fehlgeschlagen oder keine Berechtigung für diesen Kalender. Prüfe Benutzername, Passwort und Baïkal-Berechtigungen.', calendarNotFound: 'Kalender nicht gefunden. Prüfe den Kalendernamen (standardmäßig „default“) und die CalDAV-Adresse.', baikalError: (status, text) => `Baïkal antwortet mit HTTP ${status} (${text}).`, unexpected: 'Baïkal hat eine unerwartete Antwort geliefert.', notCalendar: 'Die angegebene Ressource ist kein CalDAV-Kalender. Lege in Baïkal einen Benutzer mit Standardkalender an.', connectionEstablished: 'Verbindung hergestellt.', updated: 'Eintrag aktualisiert.', added: 'Eintrag hinzugefügt.', deleted: 'Eintrag gelöscht.', urlCopied: 'CalDAV-Adresse kopiert.', dark: 'Dunkelmodus aktivieren', light: 'Hellmodus aktivieren' },
  en: { birthdays: 'Birthdays', organizational: 'Organizational dates', official: 'Residence events', birthdaySearch: 'Filter by name or description', birthdayMonth: 'Filter by month', allMonths: 'All months', connected: 'Connected', connectionError: 'Connection error', disconnected: 'Not connected', unknownDate: 'Unknown date', yearly: 'yearly', edit: 'Edit', delete: 'Delete', empty: 'No entries yet.', entry: 'entry', entries: 'entries', addEvent: 'Add event', addBirthday: 'Add birthday', editEntry: 'Edit event', birthday: 'Add birthday', birthdayPlaceholder: "e.g. Anna's birthday", eventPlaceholder: 'e.g. House meeting', authError: 'Login failed or you do not have permission for this calendar. Check the username, password, and Baïkal permissions.', calendarNotFound: 'Calendar not found. Check the calendar name (usually “default”) and the CalDAV address.', baikalError: (status, text) => `Baïkal returned HTTP ${status} (${text}).`, unexpected: 'Baïkal returned an unexpected response.', notCalendar: 'The specified resource is not a CalDAV calendar. Create a user with a default calendar in Baïkal.', connectionEstablished: 'Connection established.', updated: 'Entry updated.', added: 'Entry added.', deleted: 'Entry deleted.', urlCopied: 'CalDAV address copied.', dark: 'Enable dark mode', light: 'Enable light mode' },
};
const t = (key, ...args) => typeof translations[locale][key] === 'function' ? translations[locale][key](...args) : translations[locale][key];
const CATEGORIES = [
  { id: 'Geburtstage', title: t('birthdays'), symbol: '✳', tint: '#fceef1', color: '#c56b83' },
  { id: 'Organisatorische Stocktermine', title: t('organizational'), symbol: '▦', tint: '#eef1ff', color: '#6674d9' },
  { id: 'Offizielle Wohnheimtermine', title: t('official'), symbol: '⌂', tint: '#eaf5ef', color: '#4b9872' },
];
const $ = (id) => document.getElementById(id);
const state = { username: '', password: '', calendarName: 'default', caldavUrl: '/dav.php/', calendarHref: '', events: [], connected: false, toastTimer: null, birthdaySearch: '', birthdayMonth: '', nextEventIndex: 0 };
const SESSION_KEY = 'wg-calendar-connection';

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function utf8Base64(value) { const bytes = new TextEncoder().encode(value); let binary = ''; bytes.forEach(b => binary += String.fromCharCode(b)); return btoa(binary); }
function absoluteUrl(path) { return new URL(path, window.location.origin).toString(); }
function normalizePath(path) { return path.endsWith('/') ? path : `${path}/`; }
function authHeaders(extra = {}) { return { Authorization: `Basic ${utf8Base64(`${state.username}:${state.password}`)}`, ...extra }; }
function loadConnection() {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (!saved) return false;
  try {
    const connection = JSON.parse(saved);
    if (!connection.username || !connection.password) return false;
    state.username = connection.username;
    state.password = connection.password;
    state.calendarName = connection.calendarName || 'default';
    state.caldavUrl = connection.caldavUrl || '/dav.php/';
    return true;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return false;
  }
}
function saveConnection() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    username: state.username,
    password: state.password,
    calendarName: state.calendarName,
    caldavUrl: state.caldavUrl,
  }));
}
async function davRequest(url, method, body = null, headers = {}) {
  const response = await fetch(url, { method, headers: authHeaders(headers), body, credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(t('authError'));
    if (response.status === 404) throw new Error(t('calendarNotFound'));
    throw new Error(t('baikalError', response.status, response.statusText));
  }
  return response;
}
function xmlText(xml, tag) { const node = xml.getElementsByTagNameNS('*', tag)[0]; return node?.textContent?.trim() || ''; }
async function connect() {
  const base = normalizePath(state.caldavUrl);
  const href = `${base}calendars/${encodeURIComponent(state.username)}/${encodeURIComponent(state.calendarName)}/`;
  const response = await davRequest(absoluteUrl(href), 'PROPFIND', `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:sync-token/></d:prop></d:propfind>`, { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' });
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error(t('unexpected'));
  if (!xml.getElementsByTagNameNS('*', 'calendar')[0]) throw new Error(t('notCalendar'));
  state.calendarHref = absoluteUrl(href);
  state.connected = true;
  $('subscription-url').value = state.calendarHref;
  $('copy-url').disabled = false;
  $('refresh-button').disabled = false;
  setConnectionStatus('online', t('connected'));
  await loadEvents();
}
function setConnectionStatus(status, label) { const el = $('connection-status'); el.className = `status status-${status}`; el.innerHTML = `<i></i>${escapeHtml(label)}`; }
async function loadEvents() {
  $('loading').hidden = false; $('categories').innerHTML = ''; $('error-banner').hidden = true;
  try {
    const query = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`;
    const response = await davRequest(state.calendarHref, 'REPORT', query, { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' });
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    state.events = [...xml.getElementsByTagNameNS('*', 'response')].map(node => {
      const href = xmlText(node, 'href'); const data = xmlText(node, 'calendar-data');
      if (!data) return null;
      const event = parseIcs(data); if (!event) return null;
      return { ...event, href: new URL(href, state.calendarHref).toString(), ics: data };
    }).filter(Boolean);
    state.nextEventIndex = -1;
    renderCategories();
  } catch (error) { showError(error.message); if (!state.connected) setConnectionStatus('error', t('connectionError')); }
  finally { $('loading').hidden = true; }
}
function unescapeIcs(value = '') { return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function escapeIcs(value = '') { return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function parseIcs(ics) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/); const get = (prefix) => lines.find(line => line.startsWith(prefix));
  const prop = (name) => { const line = get(`${name}`); if (!line) return { value: '', params: '' }; const i = line.indexOf(':'); return { value: line.slice(i + 1), params: line.slice(0, i) }; };
  const summary = unescapeIcs(prop('SUMMARY').value); if (!summary) return null;
  const start = prop('DTSTART'); const end = prop('DTEND'); const desc = prop('DESCRIPTION');
  const dateOnly = start.params.includes('VALUE=DATE') || /^\d{8}$/.test(start.value);
  const date = parseIcsDate(start.value);
  let endDate = parseIcsDate(end.value);
  // In iCalendar, an all-day DTEND is exclusive; the form uses an inclusive end date.
  if (dateOnly && endDate) { const d = new Date(`${endDate}T12:00:00`); d.setDate(d.getDate() - 1); endDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  const category = CATEGORIES.some(c => prop('CATEGORIES').value.split(',').map(unescapeIcs).includes(c.id)) ? prop('CATEGORIES').value.split(',').map(unescapeIcs).find(v => CATEGORIES.some(c => c.id === v)) : 'Organisatorische Stocktermine';
  const rule = get('RRULE:') || '';
  const frequency = (rule.match(/FREQ=([A-Z]+)/) || [])[1] || '';
  return { uid: prop('UID').value, title: summary, description: unescapeIcs(desc.value), category, start, end, date, endDate, dateOnly, yearly: /FREQ=YEARLY/.test(rule), repeating: Boolean(rule), frequency, rule, startTime: dateOnly ? '' : `${start.value.slice(9,11)}:${start.value.slice(11,13)}`, endTime: dateOnly ? '' : `${end.value.slice(9,11)}:${end.value.slice(11,13)}` };
}
function parseIcsDate(value) { if (!value) return ''; const m = value.match(/^(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; }
function nextBirthdayDate(dateString) {
  if (!dateString) return null; const [, month, day] = dateString.split('-').map(Number); const now = new Date(); now.setHours(0,0,0,0);
  let year = now.getFullYear(); let next = new Date(year, month - 1, day);
  if (next < now) next = new Date(++year, month - 1, day);
  return next;
}
function eventSortDate(event) { return event.yearly ? nextBirthdayDate(event.date) || new Date(event.date) : new Date(`${event.date}T${event.startTime || '00:00'}`); }
function sortedEvents() { return state.events.filter(event => !Number.isNaN(eventSortDate(event).getTime())).sort((a, b) => eventSortDate(a) - eventSortDate(b)); }
function isPastEvent(event) {
  const date = eventSortDate(event);
  if (Number.isNaN(date.getTime())) return false;
  if (event.yearly || event.dateOnly) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return date < today;
  }
  return date < new Date();
}
function formatEventDate(event) {
  const date = event.yearly ? nextBirthdayDate(event.date) : new Date(`${event.date}T12:00:00`);
  if (!date || Number.isNaN(date.getTime())) return t('unknownDate');
  const options = { day: '2-digit', month: 'long' };
  if (!event.yearly) options.year = 'numeric';
  let text = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'de-DE', options).format(date);
  if (!event.dateOnly && event.startTime) text += ` · ${event.startTime}${event.endTime ? `–${event.endTime}` : ''}`;
  if (event.yearly) text += ` · ${t('yearly')}`;
  return text;
}
function categoryForEvent(event) { return CATEGORIES.find(category => category.id === event.category) || CATEGORIES[1]; }
function renderNextEvent() {
  const events = sortedEvents();
  const upcomingIndex = events.findIndex(event => !isPastEvent(event));
  if (!events.length) {
    $('next-event-content').innerHTML = `<div class="empty-state">${t('empty')}</div>`;
    $('event-position').textContent = '';
    $('previous-event').disabled = true;
    $('next-event').disabled = true;
    return;
  }
  if (state.nextEventIndex < 0 || state.nextEventIndex >= events.length) state.nextEventIndex = upcomingIndex === -1 ? events.length - 1 : upcomingIndex;
  const event = events[state.nextEventIndex];
  const category = categoryForEvent(event);
  $('event-position').textContent = `${state.nextEventIndex + 1} / ${events.length}`;
  $('previous-event').disabled = state.nextEventIndex === 0;
  $('next-event').disabled = state.nextEventIndex === events.length - 1;
  $('next-event-content').innerHTML = `<article class="next-event ${isPastEvent(event) ? 'is-past' : ''}"><div class="next-event-date"><strong>${escapeHtml(formatEventDate(event))}</strong><span>${isPastEvent(event) ? '· ' + (locale === 'de' ? 'vergangen' : 'past') : ''}</span></div><div class="next-event-main"><strong>${escapeHtml(event.title)}</strong>${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}<span class="category-label" style="background:${category.tint};color:${category.color}"><span aria-hidden="true">${category.symbol}</span> ${escapeHtml(category.title)}</span></div></article>`;
}
function renderCategories() {
  $('categories').innerHTML = CATEGORIES.map(category => {
    let events = state.events.filter(e => e.category === category.id);
    if (category.id === 'Geburtstage') {
      const search = state.birthdaySearch.trim().toLocaleLowerCase();
      events = events.filter(event => {
        const matchesSearch = !search || `${event.title} ${event.description}`.toLocaleLowerCase().includes(search);
        const matchesMonth = !state.birthdayMonth || event.date.slice(5, 7) === state.birthdayMonth;
        return matchesSearch && matchesMonth;
      });
    }
    events.sort((a,b) => eventSortDate(a) - eventSortDate(b));
    const rows = events.length ? events.map(event => {
      const date = event.yearly ? nextBirthdayDate(event.date) : new Date(`${event.date}T12:00:00`);
      const day = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'de-DE',{day:'2-digit'}).format(date) : '–';
      const month = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'de-DE',{month:'short'}).format(date).replace('.','') : '–';
      return `<article class="event-row ${isPastEvent(event) ? 'is-past' : ''}"><div class="event-date"><strong>${day}</strong><span>${month}</span></div><div class="event-main"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(formatEventDate(event))}${event.description ? ` · ${escapeHtml(event.description)}` : ''}</small></div><div class="event-actions"><button class="icon-button" type="button" data-edit="${escapeHtml(event.href)}" aria-label="${escapeHtml(event.title)} ${t('edit')}" title="${t('edit')}">✎</button><button class="icon-button delete" type="button" data-delete="${escapeHtml(event.href)}" aria-label="${escapeHtml(event.title)} ${t('delete')}" title="${t('delete')}">×</button></div></article>`;
    }).join('') : `<div class="empty-state">${t('empty')}</div>`;
    const addLabel = category.id === 'Geburtstage' ? t('addBirthday') : t('addEvent');
    const countLabel = events.length === 1 ? t('entry') : t('entries');
    const birthdayFilters = category.id === 'Geburtstage' ? `<div class="birthday-filters"><label><span class="visually-hidden">${t('birthdaySearch')}</span><input id="birthday-search" type="search" value="${escapeHtml(state.birthdaySearch)}" placeholder="${t('birthdaySearch')}"></label><label><span class="visually-hidden">${t('birthdayMonth')}</span><select id="birthday-month"><option value="">${t('allMonths')}</option>${Array.from({ length: 12 }, (_, index) => { const month = String(index + 1).padStart(2, '0'); const name = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'de-DE', { month: 'long' }).format(new Date(2020, index, 1)); return `<option value="${month}"${state.birthdayMonth === month ? ' selected' : ''}>${escapeHtml(name)}</option>`; }).join('')}</select></label></div>` : '';
    return `<section class="category-card"><div class="category-head"><div class="category-title-wrap"><span class="category-symbol" style="background:${category.tint};color:${category.color}">${category.symbol}</span><div><h3>${escapeHtml(category.title)}</h3></div></div><span class="count">${events.length} ${countLabel}</span></div>${birthdayFilters}<div class="event-list">${rows}</div><button class="add-button" type="button" data-add="${escapeHtml(category.id)}"><span>＋</span> ${addLabel}</button></section>`;
  }).join('');
  renderNextEvent();
}
function dateToIcs(date) { return date.replaceAll('-', ''); }
function buildIcs(form, uid) {
  const endDate = new Date(`${form.end}T12:00:00`);
  endDate.setDate(endDate.getDate() + (form.allDay ? 1 : 0));
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
  const dateProperties = form.allDay
    ? [`DTSTART;VALUE=DATE:${dateToIcs(form.start)}`,`DTEND;VALUE=DATE:${dateToIcs(end)}`]
    : [`DTSTART:${dateToIcs(form.start)}T${form.startTime.replace(':','')}00`,`DTEND:${dateToIcs(form.end)}T${form.endTime.replace(':','')}00`];
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//WG Kalender//DE','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,...dateProperties,`SUMMARY:${escapeIcs(form.title)}`,`CATEGORIES:${form.category}`];
  if (form.description) lines.push(`DESCRIPTION:${escapeIcs(form.description)}`);
  if (form.repeating) lines.push(`RRULE:FREQ=${form.frequency}`);
  lines.push('END:VEVENT','END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
function openEventDialog(categoryId, event = null) {
  const category = CATEGORIES.find(c => c.id === categoryId); if (!category) return;
  $('event-form').reset(); $('event-category').value = categoryId; $('event-href').value = event?.href || '';
  $('event-eyebrow').textContent = event ? (locale === 'en' ? 'EDIT ENTRY' : 'EINTRAG BEARBEITEN') : (locale === 'en' ? category.title.toUpperCase() : category.title.toUpperCase());
  $('event-dialog-title').textContent = event ? t('editEntry') : categoryId === 'Geburtstage' ? t('birthday') : t('addEvent');
  $('event-title').placeholder = categoryId === 'Geburtstage' ? t('birthdayPlaceholder') : t('eventPlaceholder');
  $('event-title').value = event?.title || ''; $('event-description').value = event?.description || '';
  const start = event?.date || new Date().toISOString().slice(0,10);
  $('event-start').value = start; $('event-start-detail').value = start;
  $('event-end').value = event?.endDate || start;
  $('event-all-day').checked = event ? event.dateOnly : true;
  $('event-start-time').value = event?.startTime || '09:00'; $('event-end-time').value = event?.endTime || '10:00';
  $('event-repeating').checked = event?.repeating || false; $('event-frequency').value = event?.frequency || 'WEEKLY';
  $('event-yearly').checked = event?.yearly || categoryId === 'Geburtstage';
  $('birthday-repeat-row').hidden = categoryId !== 'Geburtstage';
  $('birthday-date-row').hidden = categoryId !== 'Geburtstage';
  $('event-detailed-fields').hidden = categoryId === 'Geburtstage';
  $('event-start').required = categoryId === 'Geburtstage';
  $('event-start-detail').required = categoryId !== 'Geburtstage';
  $('event-end').required = categoryId !== 'Geburtstage';
  $('event-frequency-row').hidden = !$('event-repeating').checked;
  $('event-time-row').hidden = $('event-all-day').checked;
  $('event-dialog').showModal();
}
async function saveEvent(event) {
  event.preventDefault(); const category = $('event-category').value;
  const isBirthday = category === 'Geburtstage';
  const form = { title: $('event-title').value.trim(), description: $('event-description').value.trim(), category, start: isBirthday ? $('event-start').value : $('event-start-detail').value, end: isBirthday ? $('event-start').value : $('event-end').value, allDay: isBirthday || $('event-all-day').checked, startTime: $('event-start-time').value, endTime: $('event-end-time').value, repeating: isBirthday || $('event-repeating').checked, frequency: isBirthday ? 'YEARLY' : $('event-frequency').value };
  if (!form.title || !form.start || !form.end || (!form.allDay && (!form.startTime || !form.endTime))) return;
  if (form.end < form.start || (!form.allDay && form.end === form.start && form.endTime <= form.startTime)) {
    showError(locale === 'de' ? 'Bitte prüfe Zeitraum und Uhrzeiten.' : 'Please check the date range and times.');
    return;
  }
  const oldHref = $('event-href').value; const old = state.events.find(e => e.href === oldHref);
  const uid = old?.uid || `${crypto.randomUUID()}@wg-calendar`;
  const ics = buildIcs(form, uid);
  try {
    const href = oldHref || `${state.calendarHref}${encodeURIComponent(uid)}.ics`;
    await davRequest(href, 'PUT', ics, { 'Content-Type': 'text/calendar; charset=utf-8', ...(old ? { 'If-Match': '*' } : { 'If-None-Match': '*' }) });
    $('event-dialog').close(); toast(old ? t('updated') : t('added')); await loadEvents();
  } catch (error) { showError(error.message); }
}
async function deleteEvent(event) { event.preventDefault(); const href = $('delete-href').value; try { await davRequest(href, 'DELETE'); $('confirm-dialog').close(); toast(t('deleted')); await loadEvents(); } catch (error) { showError(error.message); } }
function showError(message) { $('error-banner').textContent = message; $('error-banner').hidden = false; }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function showConnectionDialog() { $('username').value = state.username; $('password').value = state.password; $('calendar-name').value = state.calendarName; $('caldav-url').value = state.caldavUrl; $('connection-dialog').showModal(); }

$('connection-form').addEventListener('submit', async e => {
  e.preventDefault(); state.username = $('username').value.trim(); state.password = $('password').value; state.calendarName = $('calendar-name').value.trim(); state.caldavUrl = $('caldav-url').value.trim();
  try { await connect(); saveConnection(); $('connection-dialog').close(); toast(t('connectionEstablished')); } catch (error) { state.connected = false; setConnectionStatus('error', t('disconnected')); showError(error.message); }
});
$('event-form').addEventListener('submit', saveEvent); $('confirm-form').addEventListener('submit', deleteEvent);
[$('event-all-day'), $('event-repeating')].forEach(input => input.addEventListener('change', () => {
  $('event-time-row').hidden = $('event-all-day').checked;
  $('event-frequency-row').hidden = !$('event-repeating').checked;
}));
$('settings-button').addEventListener('click', showConnectionDialog);
$('header-menu-toggle').addEventListener('click', () => {
  const menu = $('header-menu');
  const expanded = menu.classList.toggle('is-open');
  $('header-menu-toggle').setAttribute('aria-expanded', String(expanded));
});
$('refresh-button').addEventListener('click', loadEvents);
$('previous-event').addEventListener('click', () => { state.nextEventIndex -= 1; renderNextEvent(); });
$('next-event').addEventListener('click', () => { state.nextEventIndex += 1; renderNextEvent(); });
$('copy-url').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.calendarHref); toast('CalDAV-Adresse kopiert.'); } catch { $('subscription-url').select(); document.execCommand('copy'); toast('Adresse kopiert.'); } });
document.addEventListener('input', e => {
  if (e.target.id !== 'birthday-search') return;
  state.birthdaySearch = e.target.value;
  renderCategories();
  const search = $('birthday-search');
  search.focus();
  search.setSelectionRange(search.value.length, search.value.length);
});
document.addEventListener('change', e => {
  if (e.target.id !== 'birthday-month') return;
  state.birthdayMonth = e.target.value;
  renderCategories();
});
document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]'); const edit = e.target.closest('[data-edit]'); const del = e.target.closest('[data-delete]'); const close = e.target.closest('[data-close]');
  if (add) openEventDialog(add.dataset.add);
  if (edit) { const event = state.events.find(item => item.href === edit.dataset.edit); if (event) openEventDialog(event.category, event); }
  if (del) { $('delete-href').value = del.dataset.delete; $('confirm-dialog').showModal(); }
  if (close) $(close.dataset.close).close();
});
function applyTheme(theme) {
  document.body.classList.toggle('dark-mode', theme === 'dark');
  const button = $('theme-toggle');
  const dark = theme !== 'dark';
  button.textContent = dark ? '◐' : '☼';
  button.setAttribute('aria-label', dark ? t('dark') : t('light'));
  button.title = dark ? t('dark') : t('light');
}
const savedTheme = localStorage.getItem('wg-calendar-theme');
applyTheme(savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('theme-toggle').addEventListener('click', () => {
  const theme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
  localStorage.setItem('wg-calendar-theme', theme);
  applyTheme(theme);
});
window.addEventListener('DOMContentLoaded', async () => {
  if (!loadConnection()) {
    showConnectionDialog();
    return;
  }
  try {
    await connect();
  } catch (error) {
    state.connected = false;
    setConnectionStatus('error', t('disconnected'));
    showError(error.message);
    showConnectionDialog();
  }
});
