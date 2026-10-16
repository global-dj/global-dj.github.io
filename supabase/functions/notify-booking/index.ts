// Global DJ: Supabase Edge Function, ersetzt den bisherigen Formspree-
// Webhook. Wird vom Database-Webhook "notify-new-message" bei jedem
// INSERT in die "messages"-Tabelle aufgerufen (siehe supabase-schema.sql).
//
// Schickt eine echte E-Mail per Gmail-SMTP:
//   Von:  globaldj.ch@gmail.com
//   An:   die E-Mail-Adresse des jeweiligen DJs (DJ_EMAILS unten)
//   CC:   globaldj.ch@gmail.com (damit Valentin alles mitliest)
//
// Braucht das Secret GMAIL_APP_PASSWORD (Supabase Dashboard -> Edge
// Functions -> Secrets). SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY sind
// automatisch vorhanden, muessen nicht manuell gesetzt werden.

import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// DJ-Slug -> echte E-Mail-Adresse.
// shortcut: hartcodierte Liste statt eigener Tabelle, bei >~10 DJs lohnt
// sich eine kleine "dj_contacts"-Tabelle in Supabase stattdessen.
const DJ_EMAILS: Record<string, string> = {
  deejayvax: "deejayvax909@gmail.com",
  maxxx: "info@dj-maxxx.com",
  haasi: "dj@haasi.ch",
  kincaid: "yves_meier@gmx.ch",
  nachtaktiv: "Nachtaktiv.techno@gmail.com",
};

const ABSENDER = "globaldj.ch@gmail.com";

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record;
    if (!record) return new Response("kein record im Payload", { status: 200 });

    const djSlug: string = record.dj_slug || "";
    const djEmail = DJ_EMAILS[djSlug];

    // Absender-E-Mail des Nutzers ermitteln (sender_id ist nur eine UUID,
    // keine E-Mail) - per Admin-API, die automatisch bereitgestellte
    // Service-Role-Berechtigung umgeht dabei absichtlich die RLS-Regeln
    // der messages-Tabelle (diese Function laeuft serverseitig/vertrauenswuerdig).
    let absenderEmail = "unbekannt";
    if (record.sender_id) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data } = await supabaseAdmin.auth.admin.getUserById(record.sender_id);
      if (data?.user?.email) absenderEmail = data.user.email;
    }

    const betreff = `Global DJ Website: Neue Booking Anfrage fuer ${djSlug}`;
    const text = [
      "Neue Nachricht ueber die Global DJ Website:",
      "",
      `Von: ${absenderEmail}`,
      `Gewuenschtes Datum: ${record.requested_date || "(kein Datum angegeben)"}`,
      "",
      "Nachricht:",
      record.message || "",
    ].join("\n");

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: ABSENDER,
          password: Deno.env.get("GMAIL_APP_PASSWORD")!,
        },
      },
    });

    // Ohne bekannte DJ-E-Mail geht die Mail nur an globaldj.ch@gmail.com
    // (als Empfaenger statt CC), damit trotzdem jemand benachrichtigt wird.
    const empfaenger = djEmail ? [djEmail] : [ABSENDER];
    const cc = djEmail ? [ABSENDER] : [];

    await client.send({
      from: ABSENDER,
      to: empfaenger,
      cc,
      subject: betreff,
      content: text,
    });
    await client.close();

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
