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

// Schickt eine Passwort-Reset-Mail (Supabase-Standardversand, gleiche
// Rate-Limit-Einschraenkung wie die Registrierungs-Bestaetigung). Der Link
// in der Mail fuehrt zurueck auf dieselbe Seite mit #type=recovery im URL-
// Fragment - gdjRenderContactGate() erkennt das und zeigt das
// Neues-Passwort-Formular (siehe renderPasswortSetzenFormular unten).
async function gdjPasswortVergessen(email) {
  var client = gdjInitSupabase();
  if (!client) throw new Error('Supabase nicht konfiguriert.');
  var result = await client.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (result.error) throw result.error;
}

async function gdjSetzeNeuesPasswort(password) {
  var client = gdjInitSupabase();
  if (!client) throw new Error('Supabase nicht konfiguriert.');
  var result = await client.auth.updateUser({ password: password });
  if (result.error) throw result.error;
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

  // Rueckkehr von einer Passwort-Reset-Mail? Supabase haengt dann
  // "type=recovery" ins URL-Fragment. Zeigt statt Login/Registrierung das
  // Neues-Passwort-Formular, unabhaengig vom sonstigen Login-Status.
  if (window.location.hash.indexOf('type=recovery') !== -1) {
    renderPasswortSetzenFormular(container, containerId, djSlug, djName);
    return;
  }

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

  // Nicht eingeloggt (und kein Passwort-Reset im Gang): Login/Registrierung
  // anzeigen. E-Mail aus einem frueheren Besuch vorausfuellen (gleiches Muster wie
  // die Sprachauswahl der Seite: localStorage, kein Cookie-Banner noetig,
  // rein funktional, kein Passwort wird gespeichert).
  var gemerkteEmail = localStorage.getItem('gdj-last-email') || '';
  var TAB_AKTIV = 'background:var(--white);color:var(--black);';
  var TAB_INAKTIV = 'background:transparent;color:var(--grey-lighter);';
  container.innerHTML =
    '<p style="margin-bottom:12px;color:var(--grey-lighter);">Melde dich an, um ' + djName + ' direkt zu schreiben.</p>' +
    '<div style="display:flex;width:50%;min-width:220px;margin-bottom:16px;border:1px solid var(--border);">' +
    '<button id="gdj-tab-login" style="flex:1;padding:10px;border:none;font-family:inherit;cursor:pointer;' + TAB_AKTIV + '">Anmelden</button>' +
    '<button id="gdj-tab-register" style="flex:1;padding:10px;border:none;font-family:inherit;cursor:pointer;' + TAB_INAKTIV + '">Registrieren</button>' +
    '</div>' +
    '<input id="gdj-auth-email" type="email" placeholder="E-Mail" value="' + gemerkteEmail.replace(/"/g, '&quot;') + '" style="display:block;width:50%;min-width:220px;padding:10px;margin-bottom:8px;background:var(--grey-mid);border:1px solid var(--border);color:var(--white);font-family:inherit;">' +
    '<input id="gdj-auth-password" type="password" placeholder="Passwort (min. 6 Zeichen)" style="display:block;width:50%;min-width:220px;padding:10px;margin-bottom:4px;background:var(--grey-mid);border:1px solid var(--border);color:var(--white);font-family:inherit;">' +
    '<p id="gdj-auth-forgot" style="margin:0 0 12px;font-size:13px;width:50%;min-width:220px;text-align:right;"><a href="#" id="gdj-auth-forgot-link" style="color:var(--grey-light);text-decoration:underline;">Passwort vergessen?</a></p>' +
    '<button id="gdj-auth-submit" class="form-submit" style="display:block;width:50%;min-width:220px;">Anmelden</button>' +
    '<p style="margin:16px 0 8px;font-size:13px;color:var(--grey-light);width:50%;min-width:220px;text-align:center;border-top:1px solid var(--border);padding-top:16px;">oder</p>' +
    '<button id="gdj-auth-google" style="display:flex;align-items:center;justify-content:center;gap:10px;width:50%;min-width:220px;padding:11px 16px;font-size:15px;font-weight:500;background:#fff;color:#3c4043;border:1px solid #dadce0;border-radius:4px;font-family:Roboto,Arial,sans-serif;cursor:pointer;">' +
    '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.92c1.7-1.57 2.68-3.88 2.68-6.64z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z"/><path fill="#FBBC05" d="M3.97 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.95H.96A8.996 8.996 0 000 9c0 1.45.35 2.83.96 4.05l3.01-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.95l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"/></svg>' +
    'Mit Google anmelden</button>' +
    '<p id="gdj-auth-status" style="margin-top:8px;color:var(--grey-lighter);"></p>';

  var statusEl = document.getElementById('gdj-auth-status');
  var tabLogin = document.getElementById('gdj-tab-login');
  var tabRegister = document.getElementById('gdj-tab-register');
  var submitBtn = document.getElementById('gdj-auth-submit');
  var forgotP = document.getElementById('gdj-auth-forgot');
  var modus = 'login'; // 'login' oder 'register' - steuert nur Beschriftung/Aktion des gemeinsamen Formulars

  function setModus(neuerModus) {
    modus = neuerModus;
    tabLogin.style.cssText = tabLogin.style.cssText.replace(/background:[^;]+;color:[^;]+;/, modus === 'login' ? TAB_AKTIV : TAB_INAKTIV);
    tabRegister.style.cssText = tabRegister.style.cssText.replace(/background:[^;]+;color:[^;]+;/, modus === 'register' ? TAB_AKTIV : TAB_INAKTIV);
    submitBtn.textContent = modus === 'login' ? 'Anmelden' : 'Registrieren';
    forgotP.style.display = modus === 'login' ? 'block' : 'none';
    statusEl.textContent = '';
  }
  tabLogin.addEventListener('click', function () { setModus('login'); });
  tabRegister.addEventListener('click', function () { setModus('register'); });

  document.getElementById('gdj-auth-forgot-link').addEventListener('click', async function (e) {
    e.preventDefault();
    var email = document.getElementById('gdj-auth-email').value.trim();
    if (!email) { statusEl.textContent = 'Bitte zuerst deine E-Mail-Adresse oben eingeben.'; return; }
    try {
      await gdjPasswortVergessen(email);
      statusEl.textContent = '✓ Falls dieses Konto existiert, kommt gleich eine E-Mail mit einem Link zum Zuruecksetzen.';
    } catch (err) {
      statusEl.textContent = 'Fehler: ' + err.message;
    }
  });

  // Enter-Taste im Passwortfeld loest denselben Klick wie der aktive
  // Submit-Knopf aus (click() statt Code-Duplizierung).
  document.getElementById('gdj-auth-password').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitBtn.click();
    }
  });

  submitBtn.addEventListener('click', async function() {
    var email = document.getElementById('gdj-auth-email').value.trim();
    var password = document.getElementById('gdj-auth-password').value;
    if (!email || !password) { statusEl.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
    localStorage.setItem('gdj-last-email', email);

    if (modus === 'login') {
      try {
        await gdjSignIn(email, password);
        gdjRenderContactGate(containerId, djSlug, djName);
      } catch (err) {
        statusEl.textContent = 'Fehler: ' + err.message;
      }
      return;
    }

    // modus === 'register'
    if (password.length < 6) { statusEl.textContent = 'Passwort muss mindestens 6 Zeichen haben.'; return; }
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

// Formular "Neues Passwort setzen", nur sichtbar wenn der Besucher gerade
// ueber einen Passwort-Reset-Link zurueckgekommen ist (siehe
// gdjRenderContactGate oben, Erkennung via #type=recovery im URL-Fragment).
function renderPasswortSetzenFormular(container, containerId, djSlug, djName) {
  container.innerHTML =
    '<p style="margin-bottom:12px;color:var(--grey-lighter);">Neues Passwort setzen</p>' +
    '<input id="gdj-reset-password" type="password" placeholder="Neues Passwort (min. 6 Zeichen)" style="display:block;width:50%;min-width:220px;padding:10px;margin-bottom:8px;background:var(--grey-mid);border:1px solid var(--border);color:var(--white);font-family:inherit;">' +
    '<button id="gdj-reset-submit" class="form-submit" style="display:block;width:50%;min-width:220px;">Passwort speichern</button>' +
    '<p id="gdj-reset-status" style="margin-top:8px;color:var(--grey-lighter);"></p>';

  var statusEl = document.getElementById('gdj-reset-status');
  document.getElementById('gdj-reset-submit').addEventListener('click', async function () {
    var password = document.getElementById('gdj-reset-password').value;
    if (password.length < 6) { statusEl.textContent = 'Passwort muss mindestens 6 Zeichen haben.'; return; }
    try {
      await gdjSetzeNeuesPasswort(password);
      statusEl.textContent = '✓ Passwort gespeichert!';
      // #type=recovery aus der URL entfernen, damit nach dem Neuladen
      // wieder das normale Login/Nachrichtenformular erscheint.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setTimeout(function () { gdjRenderContactGate(containerId, djSlug, djName); }, 1200);
    } catch (err) {
      statusEl.textContent = 'Fehler: ' + err.message;
    }
  });
}
