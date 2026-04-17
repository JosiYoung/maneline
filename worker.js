/**
 * Mane Line — Cloudflare Worker entry point.
 *
 * Thin edge in front of the React SPA in `./app`. Owns these routes:
 *
 *   POST /webhook/sheets          — forwards Supabase DB webhooks to Apps
 *                                   Script so the L1 Google Sheets mirror
 *                                   stays warm. MUST REMAIN — the live
 *                                   waitlist depends on it.
 *   GET  /api/flags               — returns feature flags read from the
 *                                   FLAGS KV namespace (see wrangler.toml).
 *   GET  /api/_integrations-health — Phase 0 smoke test. Reports which
 *                                   placeholder integrations are wired
 *                                   (all "mock" today) and which env keys
 *                                   are present. Never returns secret
 *                                   values.
 *   GET  /join                    — legacy single-step waitlist form (v1).
 *                                   Preserved so existing bookmarks +
 *                                   indexed URLs keep working.
 *   GET  /healthz                 — trivial liveness probe.
 *
 * Every other request is handed to the Workers Assets binding (see
 * wrangler.toml `[assets]`), which serves the built SPA from `app/dist`.
 *
 * Env expected:
 *   SUPABASE_URL, SUPABASE_ANON_KEY            (public vars)
 *   SUPABASE_WEBHOOK_SECRET                    (secret)
 *   GOOGLE_APPS_SCRIPT_URL / _SECRET           (secrets)
 *   FLAGS                                      (KV namespace binding)
 *   ASSETS                                     (Workers Assets binding)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/webhook/sheets') {
        return handleSheetsWebhook(request, env);
      }
      if (url.pathname === '/api/flags') {
        return handleFlags(request, env);
      }
      if (url.pathname === '/api/_integrations-health') {
        return handleIntegrationsHealth(request, env);
      }
      if (url.pathname === '/join') {
        return new Response(LEGACY_JOIN_HTML, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=120',
          },
        });
      }
      if (url.pathname === '/healthz') {
        return new Response('ok', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      // Everything else is the SPA (or one of its static assets).
      return env.ASSETS.fetch(request);
    } catch (err) {
      return new Response('Server error: ' + (err?.message ?? 'unknown'), {
        status: 500,
      });
    }
  },
};

/* =============================================================
   Feature flags
   ============================================================= */
async function handleFlags(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  // Default behaviour: v2 signup is enabled UNLESS the KV key is present
  // AND set to the literal string "false". This is the operator opt-out
  // model — flipping to v1 is a one-liner:
  //
  //   wrangler kv key put --binding=FLAGS feature:signup_v2 false --remote
  let signupV2 = true;
  try {
    if (env.FLAGS) {
      const raw = await env.FLAGS.get('feature:signup_v2');
      if (raw !== null && raw !== undefined) {
        signupV2 = String(raw).trim().toLowerCase() !== 'false';
      }
    }
  } catch (err) {
    // KV is down / binding missing → fail open to the modern flow.
    console.warn('[flags] KV read failed, defaulting signup_v2=true:', err?.message);
  }

  return new Response(JSON.stringify({ signup_v2: signupV2 }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Short TTL so operator flips are visible within a minute.
      'cache-control': 'public, max-age=30',
    },
  });
}

/* =============================================================
   /api/_integrations-health — Phase 0 smoke test
   -------------------------------------------------------------
   Reports the status of every placeholder integration and which
   non-secret env keys are present. NEVER returns secret values —
   only whether they exist.

   Each integration is marked "mock" today. When we flip one to
   real in its Phase, swap the value to "live" (or a version tag)
   here AND in the corresponding src/integrations/* module.
   ============================================================= */
async function handleIntegrationsHealth(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  // Non-secret env keys — safe to echo back.
  const PUBLIC_ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];

  // Secret keys — we only report presence (true/false), never values.
  const SECRET_KEYS = [
    'SUPABASE_WEBHOOK_SECRET',
    'GOOGLE_APPS_SCRIPT_URL',
    'GOOGLE_APPS_SCRIPT_SECRET',
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_STOREFRONT_TOKEN',
    'SHOPIFY_ADMIN_API_TOKEN',
    'HUBSPOT_PRIVATE_APP_TOKEN',
    'HUBSPOT_PORTAL_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];

  const publicEnv = {};
  for (const k of PUBLIC_ENV_KEYS) {
    publicEnv[k] = typeof env[k] === 'string' && env[k].length > 0;
  }

  const secretsPresent = {};
  for (const k of SECRET_KEYS) {
    secretsPresent[k] = typeof env[k] === 'string' && env[k].length > 0;
  }

  const body = {
    shopify:    'mock',   // flips in Phase 3
    hubspot:    'mock',   // flips in Phase 5
    workersAi:  'mock',   // flips in Phase 4
    stripe:     'mock',   // flips in Phase 2
    bindings: {
      FLAGS:              Boolean(env.FLAGS),
      ASSETS:             Boolean(env.ASSETS),
      AI:                 Boolean(env.AI),
      VECTORIZE_PROTOCOLS: Boolean(env.VECTORIZE_PROTOCOLS),
    },
    env: publicEnv,
    secrets_present: secretsPresent,
    generated_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/* =============================================================
   Supabase -> Google Sheets webhook forwarder (L0 -> L1 mirror)
   ============================================================= */
async function handleSheetsWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const got = request.headers.get('x-webhook-secret') || '';
  if (!env.SUPABASE_WEBHOOK_SECRET || got !== env.SUPABASE_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const record = body.record || {};
  const event = (body.type || 'insert').toLowerCase();

  if (!env.GOOGLE_APPS_SCRIPT_URL) {
    return new Response('apps script url not configured', { status: 500 });
  }

  const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      secret: env.GOOGLE_APPS_SCRIPT_SECRET || '',
      event,
      row: {
        id: record.id,
        email: record.email,
        full_name: record.full_name,
        phone: record.phone,
        location: record.location,
        discipline: record.discipline,
        marketing_opt_in: record.marketing_opt_in,
      },
    }),
  });

  const text = await res.text();
  return new Response(text, { status: res.ok ? 200 : 502 });
}

/* =============================================================
   Legacy /join HTML (v1 single-step waitlist)
   -------------------------------------------------------------
   This is the original Mane Line waitlist form. It posts to Supabase
   with the shape the handle_new_user() trigger expects
   (role defaults to 'owner', first_horse object for the barn_name/etc).
   Kept as a permanent fallback route so:
     - Existing inbound traffic to /join keeps working.
     - The `feature:signup_v2 = false` KV flip tells the SPA to redirect
       users here (see SignupPage.tsx).
   Reads Supabase config at runtime from window.__MANELINE__ — wired via
   the <script> block below using the same public env as the SPA.
   ============================================================= */
const LEGACY_JOIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Join the Waitlist — Mane Line</title>
<meta name="description" content="Mane Line is the Horse OS. Join the waitlist to pre-populate your barn." />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --primary:#1E3A5F; --accent:#C9A24C; --bg:#FAF8F3; --sage:#8BA678;
    --ink:#1A1A1A; --muted:#5c6160; --line:rgba(30,58,95,.15); --surface:#fff;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:'Inter',sans-serif;color:var(--ink);background:var(--bg);line-height:1.55;-webkit-font-smoothing:antialiased}
  .container{max-width:760px;margin:0 auto;padding:0 24px}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;max-width:1100px;margin:0 auto}
  .brand{font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:var(--primary);text-decoration:none}
  .nav-links{display:flex;gap:18px;align-items:center}
  .nav-links a{color:var(--primary);font-size:14px;font-weight:500;text-decoration:none}
  h1{font-family:'Playfair Display',serif;color:var(--primary);letter-spacing:-.5px;line-height:1.04}
  h2{font-family:'Playfair Display',serif;color:var(--primary)}
  .eyebrow{display:inline-block;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:18px}
  .lede{margin-top:22px;font-size:17px;color:#2a3130;max-width:56ch}
  .card{background:var(--surface);border-radius:16px;padding:28px;border:1px solid var(--line);box-shadow:0 10px 30px -18px rgba(30,58,95,.35)}
  label{display:block;font-size:13px;font-weight:600;color:var(--primary);margin-bottom:6px}
  input,select{width:100%;padding:12px 14px;font-size:15px;border-radius:10px;border:1.5px solid var(--line);background:var(--bg);color:var(--ink);outline:none;font-family:inherit}
  input:focus,select:focus{border-color:var(--primary);background:var(--surface)}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:520px){.grid-2{grid-template-columns:1fr}}
  .field{margin-bottom:14px}
  .radio-row{display:flex;gap:10px;flex-wrap:wrap}
  .radio-row label{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg);border:1.5px solid var(--line);border-radius:10px;cursor:pointer;font-weight:500;color:var(--ink);margin-bottom:0}
  .radio-row input{width:auto;margin:0}
  .radio-row label:has(input:checked){border-color:var(--primary);background:var(--surface);box-shadow:0 0 0 3px rgba(30,58,95,.12)}
  .btn{display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;background:var(--primary);color:#fff;border:0;border-radius:10px;cursor:pointer;font-family:inherit;text-decoration:none}
  .btn:hover{opacity:.94}
  .btn.ghost{background:transparent;color:var(--primary);padding:10px 0}
  .msg{padding:12px 14px;border-radius:10px;font-size:14px;margin-bottom:14px;display:none}
  .msg.on{display:block}
  .msg.err{background:#fbe9e6;color:#7a1d10;border:1px solid #e9bdb5}
  .hint{font-size:12px;color:var(--muted);margin-top:4px}
  footer{text-align:center;padding:30px 20px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<header class="nav">
  <a class="brand" href="/">Mane Line</a>
  <div class="nav-links">
    <a href="/login">Sign In</a>
  </div>
</header>

<main class="container" style="padding-top:12px;padding-bottom:60px">
  <a href="/" class="btn ghost">&larr; Back</a>
  <span class="eyebrow">Join the Waitlist</span>
  <h1 style="font-size:clamp(32px,4.4vw,46px)">Ride in the first wave.</h1>
  <p class="lede">Sign up with you and your horse. We'll pre-populate your barn so when Mane Line opens, your profile is ready. Fields marked with <strong>*</strong> are required.</p>

  <form id="join-form" class="card" style="margin-top:28px" novalidate>
    <div id="msg" class="msg"></div>

    <h2 style="font-size:20px;margin-bottom:14px">About you</h2>
    <div class="grid-2">
      <div class="field">
        <label for="full_name">Your name *</label>
        <input id="full_name" name="full_name" type="text" required autocomplete="name" placeholder="Sherry Cervi" />
      </div>
      <div class="field">
        <label for="email">Email *</label>
        <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@yourranch.com" />
      </div>
      <div class="field">
        <label for="phone">Phone <span style="color:var(--muted);font-weight:400">(optional)</span></label>
        <input id="phone" name="phone" type="tel" autocomplete="tel" />
      </div>
      <div class="field">
        <label for="location">State / Region *</label>
        <input id="location" name="location" type="text" required placeholder="Texas, Wyoming, Alberta..." />
      </div>
    </div>
    <div class="field">
      <label for="owner_discipline">What do you do with horses? <span style="color:var(--muted);font-weight:400">(optional)</span></label>
      <select id="owner_discipline" name="owner_discipline">
        <option value="">Choose one</option>
        <option>Barrel racing</option><option>Roping / team roping</option><option>Ranch work</option>
        <option>Cutting / reining</option><option>Trail / pleasure</option><option>Breeding / foaling</option>
        <option>Show / hunter-jumper</option><option>Dressage / eventing</option><option>Endurance</option>
        <option>Other</option>
      </select>
    </div>

    <hr style="margin:24px 0;border:0;border-top:1px solid var(--line)">

    <h2 style="font-size:20px;margin-bottom:4px">Your first horse</h2>
    <p style="color:var(--muted);font-size:13.5px;margin-bottom:14px">You can add more once you're in.</p>
    <div class="grid-2">
      <div class="field">
        <label for="barn_name">Barn name *</label>
        <input id="barn_name" name="barn_name" type="text" required placeholder="Stingray" />
      </div>
      <div class="field">
        <label for="breed">Breed *</label>
        <select id="breed" name="breed" required>
          <option value="">Choose breed</option>
          <option>Quarter Horse</option><option>Paint</option><option>Appaloosa</option>
          <option>Thoroughbred</option><option>Arabian</option><option>Warmblood</option>
          <option>Morgan</option><option>Tennessee Walker</option><option>Mustang</option>
          <option>Draft</option><option>Pony</option><option>Mixed / unknown</option><option>Other</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Sex *</label>
      <div class="radio-row">
        <label><input type="radio" name="sex" value="mare" required> Mare</label>
        <label><input type="radio" name="sex" value="gelding"> Gelding</label>
        <label><input type="radio" name="sex" value="stallion"> Stallion</label>
      </div>
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="year_born">Year born *</label>
        <input id="year_born" name="year_born" type="number" min="1990" max="2026" required placeholder="2018" />
        <div class="hint">Approximate is fine</div>
      </div>
      <div class="field">
        <label for="horse_discipline">Primary discipline *</label>
        <select id="horse_discipline" name="horse_discipline" required>
          <option value="">Choose one</option>
          <option>Barrel racing</option><option>Roping</option><option>Ranch work</option>
          <option>Cutting / reining</option><option>Trail / pleasure</option><option>Breeding</option>
          <option>Show</option><option>Dressage / eventing</option><option>Endurance</option>
          <option>Retired / companion</option><option>Other</option>
        </select>
      </div>
    </div>

    <hr style="margin:24px 0;border:0;border-top:1px solid var(--line)">
    <label style="display:flex;gap:10px;align-items:flex-start;font-weight:500">
      <input type="checkbox" id="opt_in" name="opt_in" checked style="width:auto;margin-top:3px">
      <span style="font-size:13.5px;color:#2a3130">Send me product updates from Mane Line. Unsubscribe anytime.</span>
    </label>

    <button type="submit" class="btn" id="join-submit" style="margin-top:20px;width:100%">Send Me the Magic Link</button>
    <div class="hint" style="margin-top:10px;text-align:center">We'll email a one-tap sign-in link. No passwords.</div>
  </form>
</main>

<footer>&copy; <span id="y"></span> Mane Line &middot; <a href="/" style="color:var(--primary)">maneline.co</a></footer>

<script>
  window.__MANELINE__ = {
    SUPABASE_URL: "https://vvzasinqfirzxfduenjx.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2emFzaW5xZmlyenhmZHVlbmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzcyMTksImV4cCI6MjA5MTg1MzIxOX0.25G0D11vS6M5JqMC_Z2jE69RKfXsR_I9NAEMwxMPR4o"
  };
  document.getElementById('y').textContent = new Date().getFullYear();
</script>
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  const sb = createClient(window.__MANELINE__.SUPABASE_URL, window.__MANELINE__.SUPABASE_ANON_KEY);
  const form = document.getElementById('join-form');
  const msg  = document.getElementById('msg');
  const btn  = document.getElementById('join-submit');
  function show(kind, text){ msg.className='msg on '+kind; msg.textContent=text; window.scrollTo({top:0,behavior:'smooth'}); }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const email = (d.get('email')||'').toString().trim().toLowerCase();
    if (!email) return show('err','Please enter your email.');
    const full_name = (d.get('full_name')||'').toString().trim();
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin + '/auth/callback?next=%2Fapp',
          data: {
            role: 'owner',
            full_name,
            display_name: full_name,
            phone: (d.get('phone')||'').toString().trim(),
            location: (d.get('location')||'').toString().trim(),
            owner_discipline: (d.get('owner_discipline')||'').toString().trim(),
            marketing_opt_in: !!document.getElementById('opt_in').checked,
            first_horse: {
              barn_name: (d.get('barn_name')||'').toString().trim(),
              breed: (d.get('breed')||'').toString().trim(),
              sex: (d.get('sex')||'').toString().trim(),
              year_born: (d.get('year_born')||'').toString().trim(),
              discipline: (d.get('horse_discipline')||'').toString().trim()
            }
          }
        }
      });
      if (error) throw error;
      sessionStorage.setItem('ml_pending_email', email);
      sessionStorage.setItem('ml_signup_role', 'owner');
      window.location.href = '/check-email';
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Send Me the Magic Link';
      show('err', err.message || 'Something went wrong. Please try again.');
    }
  });
</script>
</body>
</html>`;
