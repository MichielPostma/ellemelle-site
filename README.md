# ELLEMELLE — Launch Site

Static HTML landing page voor de ELLEMELLE chocopasta launch. 7-step signup flow + Tikkie betaling + admin view.

**Live URL (na deploy):** https://ellemelle.netlify.app
**Repo:** https://github.com/MichielPostma/ellemelle-site
**Admin URL:** https://ellemelle.netlify.app/admin

---

## 1. Deploy — 2 opties

### Optie A: Netlify CLI (snelst — als je `netlify` lokaal hebt)

```bash
cd /Users/michielpostma/Library/Application Support/Claude/local-agent-mode-sessions/9caf00c9-12b4-4a6a-afc7-23a0f80496cc/de6ee37c-5854-4624-8dc4-43c7f8884ef4/local_a647cd3b-3a67-440f-94ee-61ba214d013b/outputs/ellemelle-site

# Eenmalig: site aan account koppelen
netlify init                # of: netlify link

# Naam bij "Choose a site name" → ellemelle (geeft je ellemelle.netlify.app)
# Build command: laat leeg
# Publish directory: . (huidige map)

# Deploy
netlify deploy --prod --dir=.
```

### Optie B: Drag-and-drop

1. Ga naar https://app.netlify.com/start/deploy
2. Sleep de hele `ellemelle-site/` folder (de map waar deze README in zit) op het upload-vlak.
3. Wacht op het groene "Published" vinkje.
4. Onder **Site configuration → Site details → Site information → Change site name** → vul `ellemelle` in. URL wordt dan `ellemelle.netlify.app`.

---

## 2. Environment variables instellen

Ga naar **Site configuration → Environment variables** en zet:

| Variable                    | Verplicht? | Waarde                                                              |
|-----------------------------|------------|---------------------------------------------------------------------|
| `ADMIN_PASSWORD`            | ✅ Ja       | `100knuffels` (zie eindrapport — wijzig wanneer je wil) |
| `TIKKIE_LINK_A`             | ✅ Ja       | Je 1e Tikkie betaalverzoek-URL                                      |
| `TIKKIE_LINK_B`             | ✅ Ja       | Je 2e Tikkie betaalverzoek-URL                                      |
| `MAX_SIGNUPS`               | Optioneel  | `25` (default). Hoger zetten = batch openen voor meer klanten.      |
| `SUPABASE_URL`              | Optioneel  | `https://xxx.supabase.co` — als je Supabase gebruikt                |
| `SUPABASE_SERVICE_ROLE_KEY` | Optioneel  | `eyJ…` service-role key                                             |
| `RESEND_API_KEY`            | Optioneel  | `re_…` voor bevestigingsmail                                        |
| `RESEND_FROM`               | Optioneel  | `ELLEMELLE <onboarding@resend.dev>` (default als leeg)              |
| `NETLIFY_API_TOKEN`         | Optioneel  | Personal access token — alleen als je counter wil zonder Supabase   |
| `SITE_ID`                   | Auto       | Netlify zet deze automatisch                                        |

**Na elke env-var wijziging: redeploy** (Deploys → Trigger deploy → Clear cache and deploy site).

---

## 3. Datastore — twee paden

### Pad 1: Netlify Forms (default, werkt out-of-the-box, **geen** Supabase nodig)
- Signups komen binnen onder **Forms → ellemelle-signup** in Netlify dashboard.
- Counter werkt via Netlify Forms API als je `NETLIFY_API_TOKEN` zet (anders blijft hij op 0/25).
- **Beperking:** geen "betaald" toggle — die kolom staat altijd op ✗ in admin.

### Pad 2: Supabase (aanbevolen — counter + betaling toggle)

**Setup (5 min):**

1. Ga naar https://supabase.com → log in (Google OAuth) → **New project** → naam: `ellemelle`, regio: `eu-central-1`, sterk database-password (sla op).
2. Wacht ~1 min tot project ready is.
3. Open **SQL Editor** → New query → plak dit + Run:

```sql
create type kanaal_enum as enum ('whatsapp','email');

create table public.signups (
  id          uuid primary key default gen_random_uuid(),
  voornaam    text not null,
  telefoon    text,
  email       text,
  kanaal      kanaal_enum not null,
  straat      text not null,
  huisnummer  text not null,
  toevoeging  text,
  postcode    text not null,
  plaats      text not null default 'Haarlem',
  created_at  timestamptz default now(),
  betaald     boolean default false
);

-- RLS aan, geen public access. Site gebruikt service_role key.
alter table public.signups enable row level security;
```

4. **Settings → API** → kopieer:
   - **Project URL** → wordt `SUPABASE_URL`
   - **service_role key** (klik "Reveal") → wordt `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **never commit, never paste publicly**
5. Zet beide in Netlify env vars (zie tabel hierboven). Redeploy.

Klaar. Vanaf nu landen signups in Supabase en werkt de "betaald" toggle in /admin.

---

## 4. Admin gebruiken

URL: `https://ellemelle.netlify.app/admin`
Wachtwoord: zie eindrapport (instelbaar via `ADMIN_PASSWORD` env var).

- **Stats bovenaan:** signups totaal / betaald / openstaand.
- **Filter:** alleen openstaand / alleen betaald / alles.
- **Zoek:** filtert live op naam/adres/email.
- **Betaald-toggle:** vink rechts in elke rij. Slaat direct op in Supabase. (Met Netlify Forms werkt deze niet — staat readonly op ✗.)
- **Export CSV:** download alle huidige signups als spreadsheet.
- **Verversen:** force-refresh van de lijst.
- **Uitloggen:** wist wachtwoord uit browsersessie.

---

## 5. Tikkie URLs updaten

Tikkie-links verlopen vaak na een paar dagen of na X scans. Updaten:

1. Maak in de Tikkie-app twee nieuwe verzoeken van €6 (verzoek A en B).
2. Kopieer beide URLs.
3. Netlify dashboard → **Site configuration → Environment variables** → wijzig `TIKKIE_LINK_A` en `TIKKIE_LINK_B`.
4. **Deploys → Trigger deploy → Deploy site**. Wijziging is binnen 30 sec live.

De site rouleert random tussen A en B per bezoeker, om Tikkie's dagslimieten te spreiden.

---

## 6. Nieuwe batch openen (counter resetten of limiet ophogen)

**Optie 1 — limiet ophogen** (oude signups blijven staan, counter loopt door):
- Netlify env vars → wijzig `MAX_SIGNUPS` van `25` naar bv. `50`. Redeploy.

**Optie 2 — nieuwe batch met counter reset op 0** (oude signups bewaren maar nieuwe batch starten):

Met Supabase:
```sql
-- in Supabase SQL Editor — markeer oude batch als historisch
alter table signups add column if not exists batch text default 'batch-1';
update signups set batch = 'batch-1' where batch is null;
-- nieuwe batch: voeg kolom toe aan signup.js insert, OF maak een view

-- Sneller: hernoem tabel + maak nieuwe
alter table signups rename to signups_batch_1;
create table signups (like signups_batch_1 including all);
```
Site begint met telling op 0 voor de nieuwe tabel.

Met Netlify Forms:
- Forms dashboard → **ellemelle-signup** → **Settings** → **Delete form**. Bij volgende submission maakt Netlify hem opnieuw aan, counter staat op 0.
- Of: rename de form in `index.html` (regel met `<form name="ellemelle-signup">`) naar `ellemelle-signup-v2`, commit + redeploy.

---

## 7. Lokaal testen

```bash
cd ellemelle-site
npx netlify dev      # draait op http://localhost:8888 met functies actief
```

Of zonder netlify CLI, alleen statisch:
```bash
python3 -m http.server 8000
# Open http://localhost:8000 — flow werkt, postcode/count/signup vallen terug op fout-paden
```

---

## 8. Troubleshooting

**Counter blijft op 0/25 staan:**
- Supabase: check `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars (na wijziging: redeploy).
- Netlify Forms: zet `NETLIFY_API_TOKEN` (genereer in user-settings → applications → personal access tokens).

**Postcode lookup faalt:**
- PDOK is gratis, geen key. Als hij 500 geeft → check Functions logs in Netlify. Fallback: handmatig adres invoeren werkt altijd.

**Signup-form geeft "er ging iets mis":**
- Functions tab in Netlify → kijk naar logs van `signup`. Meestal Supabase service_role key fout.
- Site valt automatisch terug op Netlify Forms directe POST naar `/` — submissions komen dan onder Forms binnen.

**QR code linkt naar verkeerde site:**
- QR wijst naar `https://ellemelle.netlify.app`. Als je een ander Netlify-naam koos, regenereer met:
  ```bash
  python3 -c "import qrcode; qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=40, border=2); qr.add_data('https://JOUW-NAAM.netlify.app'); qr.make(); qr.make_image(fill_color='#8B1A0E', back_color=(255,255,255,0)).resize((1024,1024)).save('ellemelle-qr.png')"
  ```

---

## Bestanden in deze folder

```
ellemelle-site/
├── index.html          ← landing page, 7-step flow
├── admin.html          ← /admin dashboard
├── netlify.toml        ← redirects + functions config
├── _redirects          ← backup redirects
├── robots.txt          ← blokkeert /admin uit Google
├── package.json
├── .gitignore
├── README.md           ← dit bestand
├── Images/
│   └── product.png     ← pot-foto
└── netlify/functions/
    ├── postcode.js     ← PDOK adres-autofill proxy
    ├── config.js       ← Tikkie URLs + max naar front-end
    ├── count.js        ← live counter (Supabase of Forms)
    ├── signup.js       ← signup insert (Supabase) of fallback
    ├── admin-list.js   ← admin: lijst signups
    └── admin-mark-paid.js  ← admin: toggle betaald
```
