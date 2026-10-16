// Gemeinsame Login/Registrierungs-Logik fuer Global DJ (Supabase Auth).
// Wird von index.html und allen DJ-Detailseiten eingebunden, nach
// supabase-config.js und dem Supabase-JS-SDK (siehe <head> der Seiten).
//
// Sicherheitsprinzip: Dieses Skript tut NICHTS Geheimes - jede Sicherheit
// (wer darf was lesen/schreiben) kommt aus den Row-Level-Security-Regeln
// in Supabase selbst, nicht aus diesem Code. Der anon-Key hier ist absichtlich
// oeffentlich, siehe supabase-config.js.

var gdjSupabase = null;

function gdjInitSupabase() {
  if (gdjSupabase) return gdjSupabase;
  if (!window.supabase || !window.SUPABASE_URL || window.SUPABASE_URL.indexOf('HIER_') === 0) {
    console.warn('Supabase noch nicht konfiguriert (supabase-config.js ausfuellen).');
    return null;
  }
  gdjSupabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  return gdjSupabase;
}

async function gdjGetUser() {
  var client = gdjInitSupabase();
  if (!client) return null;
  var result = await client.auth.getUser();
  return (result.data && result.data.user) ? result.data.user : null;
}

async function gdjSignUp(email, password) {
  var client = gdjInitSupabase();
  if (!client) throw new Error('Supabase nicht konfiguriert.');
  var result = await client.auth.signUp({ email: email, password: password });
  if (result.error) throw result.error;
  return result.data;
}

async function gdjSignIn(email, password) {
  var client = gdjInitSupabase();
  if (!client) throw new Error('Supabase nicht konfiguriert.');
  var result = await client.auth.signInWithPassword({ email: email, password: password });
  if (result.error) throw result.error;
  return result.data;
}

async function gdjSignOut() {
  var client = gdjInitSupabase();
  if (!client) return;
  await client.auth.signOut();
}

// Login/Registrierung per Google (ein Klick, kein Passwort, keine
// Bestaetigungs-E-Mail noetig). Leitet zu Google weiter und zurueck auf
// dieselbe Seite - braucht einmalig Google-Provider-Setup in Supabase
// (Dashboard: Authentication -> Providers -> Google).
async function gdjSignInWithGoogle() {
  var client = gdjInitSupabase();
  if (!client) throw new Error('Supabase nicht konfiguriert.');
  var result = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if (result.error) throw result.error;
}

// Sendet eine Nachricht an einen DJ. djSlug identifiziert den DJ (z.B.
// "deejayvax"), nicht den Namen, damit Umbenennungen den Verweis nicht
// brechen. sender_id wird NICHT mitgeschickt - die Datenbank setzt ihn
// serverseitig selbst auf auth.uid() (Spalten-Default in Supabase, siehe
// supabase-schema.sql), damit niemand im Browser eine fremde User-ID
// faelschen kann.
async function gdjSendMessage(djSlug, messageText, requestedDate) {
  var client = gdjInitSupabase();
  if (!client) throw new Error('Supabase nicht konfiguriert.');
  if (!messageText || !messageText.trim()) throw new Error('Nachricht darf nicht leer sein.');
  var zeile = { dj_slug: djSlug, message: messageText.trim() };
  if (requestedDate) zeile.requested_date = requestedDate;
  var result = await client.from('messages').insert(zeile);
  if (result.error) throw result.error;
  return result.data;
}

// Liefert die bereits GENEHMIGTEN Buchungsdaten eines DJs (nur Datum, kein
// Text/Absender - siehe approved_bookings-View in supabase-schema.sql).
// Funktioniert auch ohne Login (anon-Rolle hat extra SELECT-Recht auf die
// View), damit jeder Besucher sieht wann der DJ schon gebucht ist.
async function gdjHoleGenehmigteTermine(djSlug) {
  var client = gdjInitSupabase();
  if (!client) return [];
  var result = await client
    .from('approved_bookings')
    .select('requested_date')
    .eq('dj_slug', djSlug);
  if (result.error) { console.warn('Konnte Buchungen nicht laden:', result.error.message); return []; }
  return (result.data || []).map(function (zeile) { return zeile.requested_date; });
}

// Rendert einen einfachen, monatsweise navigierbaren Kalender in das
// Element mit der uebergebenen ID. Rote Tage = schon genehmigt gebucht.
// Klick auf ein freies, zukuenftiges Datum uebertraegt es ins Datumsfeld
// der Booking-Anfrage (siehe gdjRenderContactGate).
async function gdjRenderKalender(containerId, djSlug) {
  var container = document.getElementById(containerId);
  if (!container) return;

  var belegteDaten = await gdjHoleGenehmigteTermine(djSlug);
  var heute = new Date();
  var heuteIso = heute.toISOString().slice(0, 10);
  var anzeigeJahr = heute.getFullYear();
  var anzeigeMonat = heute.getMonth(); // 0-basiert

  function zweistellig(n) { return (n < 10 ? '0' : '') + n; }

  function zeichneMonat() {
    var monatsnamen = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    var ersterTag = new Date(anzeigeJahr, anzeigeMonat, 1);
    var anzahlTage = new Date(anzeigeJahr, anzeigeMonat + 1, 0).getDate();
    var startWochentag = (ersterTag.getDay() + 6) % 7; // Montag = 0

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;max-width:380px;">' +
      '<button id="gdj-cal-prev" style="background:var(--grey-mid);border:1px solid var(--border);color:var(--white);padding:4px 12px;cursor:pointer;font-family:inherit;">←</button>' +
      '<strong>' + monatsnamen[anzeigeMonat] + ' ' + anzeigeJahr + '</strong>' +
      '<button id="gdj-cal-next" style="background:var(--grey-mid);border:1px solid var(--border);color:var(--white);padding:4px 12px;cursor:pointer;font-family:inherit;">→</button>' +
      '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;max-width:380px;">';
    ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach(function (t) {
      html += '<div style="text-align:center;font-size:12px;color:var(--grey-light);">' + t + '</div>';
    });
    for (var i = 0; i < startWochentag; i++) html += '<div></div>';
    for (var tag = 1; tag <= anzahlTage; tag++) {
      var iso = anzeigeJahr + '-' + zweistellig(anzeigeMonat + 1) + '-' + zweistellig(tag);
      var belegt = belegteDaten.indexOf(iso) !== -1;
      var vergangen = iso < heuteIso;
      if (belegt) {
        html += '<div title="Bereits gebucht" style="text-align:center;padding:6px 0;background:#5a1f1f;color:#f5a3a3;font-size:13px;">' + tag + '</div>';
      } else if (vergangen) {
        html += '<div style="text-align:center;padding:6px 0;color:var(--grey-light);opacity:0.3;font-size:13px;">' + tag + '</div>';
      } else {
        html += '<div class="gdj-cal-tag" data-date="' + iso + '" style="text-align:center;padding:6px 0;cursor:pointer;font-size:13px;border:1px solid var(--border);">' + tag + '</div>';
      }
    }
    html += '</div>';
    html += '<p style="margin-top:10px;font-size:13px;color:var(--grey-light);">' +
      '<span style="background:#5a1f1f;color:#f5a3a3;padding:1px 6px;">rot</span> = bereits gebucht. ' +
      'Klick auf ein freies Datum, um es fuer deine Anfrage unten zu uebernehmen.</p>';
    container.innerHTML = html;

    document.getElementById('gdj-cal-prev').addEventListener('click', function () {
      anzeigeMonat--; if (anzeigeMonat < 0) { anzeigeMonat = 11; anzeigeJahr--; }
      zeichneMonat();
    });
    document.getElementById('gdj-cal-next').addEventListener('click', function () {
      anzeigeMonat++; if (anzeigeMonat > 11) { anzeigeMonat = 0; anzeigeJahr++; }
      zeichneMonat();
    });
    container.querySelectorAll('.gdj-cal-tag').forEach(function (el) {
      el.addEventListener('click', function () {
        var datumFeld = document.getElementById('gdj-msg-date');
        if (datumFeld) {
          datumFeld.value = el.getAttribute('data-date');
          datumFeld.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  zeichneMonat();
}

// Rendert die Kontakt-Sektion (Login/Registrierung ODER Nachrichtenformular,
// je nach Login-Status) in das Element mit der uebergebenen ID.
// Wird beim Laden der Seite und nach jedem Login/Logout neu aufgerufen.
async function gdjRenderContactGate(containerId, djSlug, djName) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var user = await gdjGetUser();

  if (user) {
    container.innerHTML =
      '<p style="margin-bottom:12px;color:var(--grey-lighter);">Eingeloggt als ' + user.email + ' · ' +
      '<a href="#" id="gdj-logout-link" style="text-decoration:underline;">Abmelden</a></p>' +
      '<label style="display:block;font-size:13px;color:var(--grey-light);margin-bottom:4px;">Gewuenschtes Datum (optional)</label>' +
      '<input type="date" id="gdj-msg-date" style="display:block;width:50%;min-width:220px;padding:10px;margin-bottom:10px;background:var(--grey-mid);border:1px solid var(--border);color:var(--white);font-family:inherit;">' +
      '<textarea id="gdj-msg-text" rows="4" placeholder="Worum geht es? Deine Nachricht an ' + djName + '..." ' +
      'style="display:block;width:75%;min-width:280px;padding:12px;background:var(--grey-mid);border:1px solid var(--border);color:var(--white);font-family:inherit;font-size:15px;"></textarea>' +
      '<button id="gdj-msg-send" class="form-submit" style="margin-top:10px;">Nachricht senden</button>' +
      '<p id="gdj-msg-status" style="margin-top:8px;color:var(--grey-lighter);"></p>';

    document.getElementById('gdj-logout-link').addEventListener('click', async function(e) {
      e.preventDefault();
      await gdjSignOut();
      gdjRenderContactGate(containerId, djSlug, djName);
    });

    document.getElementById('gdj-msg-send').addEventListener('click', async function() {
      var btn = this;
      var statusEl = document.getElementById('gdj-msg-status');
      var text = document.getElementById('gdj-msg-text').value;
      var datum = document.getElementById('gdj-msg-date').value;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await gdjSendMessage(djSlug, text, datum);
        statusEl.textContent = '✓ Nachricht gesendet!';
        document.getElementById('gdj-msg-text').value = '';
        document.getElementById('gdj-msg-date').value = '';
      } catch (err) {
        statusEl.textContent = 'Fehler: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Nachricht senden';
      }
    });
    return;
  }

  // Nicht eingeloggt: Login/Registrierung anzeigen.
  // E-Mail aus einem frueheren Besuch vorausfuellen (gleiches Muster wie
  // die Sprachauswahl der Seite: localStorage, kein Cookie-Banner noetig,
  // rein funktional, kein Passwort wird gespeichert).
  var gemerkteEmail = localStorage.getItem('gdj-last-email') || '';
  container.innerHTML =
    '<p style="margin-bottom:12px;color:var(--grey-lighter);">Melde dich an, um ' + djName + ' direkt zu schreiben.</p>' +
    '<input id="gdj-auth-email" type="email" placeholder="E-Mail" value="' + gemerkteEmail.replace(/"/g, '&quot;') + '" style="display:block;width:50%;min-width:220px;padding:10px;margin-bottom:8px;background:var(--grey-mid);border:1px solid var(--border);color:var(--white);font-family:inherit;">' +
    '<input id="gdj-auth-password" type="password" placeholder="Passwort (min. 6 Zeichen)" style="display:block;width:50%;min-width:220px;padding:10px;margin-bottom:8px;background:var(--grey-mid);border:1px solid var(--border);color:var(--white);font-family:inherit;">' +
    '<button id="gdj-auth-login" class="form-submit" style="display:block;width:50%;min-width:220px;">Anmelden</button>' +
    '<p style="margin-top:10px;font-size:13px;color:var(--grey-light);">Noch kein Konto? ' +
    '<a href="#" id="gdj-auth-register" style="text-decoration:underline;">Jetzt registrieren</a></p>' +
    '<p style="margin:14px 0 4px;font-size:13px;color:var(--grey-light);">oder</p>' +
    '<button id="gdj-auth-google" style="display:block;width:50%;min-width:220px;padding:10px;background:#fff;color:#1f1f1f;border:1px solid var(--border);font-family:inherit;cursor:pointer;">Mit Google anmelden</button>' +
    '<p id="gdj-auth-status" style="margin-top:8px;color:var(--grey-lighter);"></p>';

  var statusEl = document.getElementById('gdj-auth-status');

  // Enter-Taste im Passwortfeld loest denselben Klick wie der
  // "Anmelden"-Knopf aus (click() statt Code-Duplizierung).
  document.getElementById('gdj-auth-password').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('gdj-auth-login').click();
    }
  });

  document.getElementById('gdj-auth-login').addEventListener('click', async function() {
    var email = document.getElementById('gdj-auth-email').value.trim();
    var password = document.getElementById('gdj-auth-password').value;
    if (!email || !password) { statusEl.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
    localStorage.setItem('gdj-last-email', email);
    try {
      await gdjSignIn(email, password);
      gdjRenderContactGate(containerId, djSlug, djName);
    } catch (err) {
      statusEl.textContent = 'Fehler: ' + err.message;
    }
  });

  document.getElementById('gdj-auth-register').addEventListener('click', async function(e) {
    e.preventDefault();
    var email = document.getElementById('gdj-auth-email').value.trim();
    var password = document.getElementById('gdj-auth-password').value;
    if (!email || !password) { statusEl.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
    if (password.length < 6) { statusEl.textContent = 'Passwort muss mindestens 6 Zeichen haben.'; return; }
    localStorage.setItem('gdj-last-email', email);
    try {
      await gdjSignUp(email, password);
      // Felder leeren nach erfolgreicher Registrierung, damit nicht das
      // eingegebene Passwort sichtbar im Formular stehen bleibt (E-Mail
      // bleibt aber in localStorage gemerkt fuers naechste Mal).
      document.getElementById('gdj-auth-email').value = '';
      document.getElementById('gdj-auth-password').value = '';
      statusEl.textContent = '✓ Registriert! Bitte E-Mail bestaetigen, dann anmelden.';
    } catch (err) {
      statusEl.textContent = 'Fehler: ' + err.message;
    }
  });

  document.getElementById('gdj-auth-google').addEventListener('click', async function() {
    try {
      await gdjSignInWithGoogle();
      // Browser leitet sofort zu Google weiter, kein weiterer Code noetig -
      // nach der Rueckkehr laedt die Seite neu und gdjRenderContactGate()
      // erkennt den eingeloggten Zustand automatisch.
    } catch (err) {
      statusEl.textContent = 'Fehler: ' + err.message;
    }
  });
}
