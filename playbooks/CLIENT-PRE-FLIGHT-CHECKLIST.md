# Client Pre-Flight Checklist
### What I need from you before we start building — plain English

**Purpose:** This is the shortest possible list of things *you* need to do (or give me access to) so I can build your triple-redundant data infrastructure without stalling. Most client engagements that slip on timeline slip right here — a missing email verification, a Google account I can't access, a domain I can't find. This checklist makes sure that doesn't happen to us.

**Time commitment on your end:** ~60–90 minutes total, spread across 2–3 touchpoints over 1 week.

**Who owns what at the end:** You. Every account, every credential, every dollar of billing. I'm a user on your accounts, not the other way around. See §4 for the security model.

---

## 1. One anchor email — pick it now

Every vendor needs an email to send verification codes to. I will use one single business email as the anchor for every account we create. Pick it before we start.

- [ ] **Anchor email confirmed:** `________________@________________`

**Rules:**
- Must be a business email you control (not `gmail.com` unless you're a true solo operator).
- Must be an inbox *you* can access in real time for the next week. If it's a shared inbox, confirm who else gets the mail.
- Do **not** use an email you plan to deprecate in the next 12 months.

This email becomes the root of trust. If this email is compromised or deleted, every account below goes with it. Treat it that way.

---

## 2. Accounts I will create on your behalf (you just relay verification codes)

For these three, I'll drive the account creation. You just need to be at your keyboard for a ~60-minute window to forward the verification codes as they arrive in your anchor inbox. Most codes expire in 10 minutes — that's the whole reason we do it live instead of async.

- [ ] **GitHub** — I create the account in your name, using your anchor email. *You forward the verification code.*
- [ ] **Cloudflare** — I sign up using "Continue with GitHub." *You verify the email confirmation if one arrives.*
- [ ] **Supabase** — I sign up using "Continue with GitHub." *Usually no extra step needed.*

**Why GitHub first and why "Continue with GitHub" for the others:** one login (GitHub) becomes the key that unlocks the other two. Fewer passwords, fewer places for something to leak, and when this engagement ends you revoke one OAuth grant per vendor — not reset four passwords.

**Block on your calendar:** a single 60-min slot, ideally the first morning we work together. Subject: *"OAG engagement — Leg A account setup."* Be at your laptop with the anchor email open. No meetings scheduled during that hour.

---

## 3. Access I need *you* to grant me (I can't create these myself)

### 3.1 Google Workspace access

Google does not let anyone but you create a Workspace on your domain. So you'll need to invite me in.

- [ ] You have a Google Workspace subscription on your business domain. *(If you're still on a free `@gmail.com` address for the business, let me know — we should talk about upgrading before launch. Workspace is ~$7/user/month and it's the right move for any business capturing real customer data.)*
- [ ] Invite me as a user at **Admin Console → Users → Add new user**, OR (if you want to keep scope narrow) share the specific Google Sheet/Drive folder with me as an Editor.
- [ ] Send me the email address of the invited account.
- [ ] I will confirm login works in an incognito window before we proceed.

### 3.2 Domain registrar access

You already own your domain. I don't need you to give me the login — I just need you able to change DNS records *or* transfer the domain into your new Cloudflare account. Most of the time it's the latter.

- [ ] You know which registrar your domain is with (GoDaddy, Namecheap, Google Domains, Squarespace, etc.).
- [ ] You can log into that registrar today. (If you can't, unlock that now — it takes 1–3 business days to recover access to some registrars, and that becomes the critical path for going live.)

### 3.3 Your anchor-inbox availability

- [ ] You will be at your keyboard, with the anchor inbox open, during the scheduled 60-minute Leg A window.
- [ ] If a verification email arrives, you forward it to me (or screenshot the code) within 10 minutes. Codes expire fast.

---

## 4. How I handle your credentials — the security model

This matters. Read it.

- **I never store your passwords.** GitHub, Cloudflare, and Supabase are logged in on my machine via OAuth tokens. Those tokens can be revoked by you at any time from the vendor's UI.
- **I never put your credentials in a file on disk that could be committed to Git.** There is a `.gitignore` in your repo specifically excluding any file matching `*Logins.txt`, `.env`, etc.
- **If you give me any credential by text or email** (e.g., a password for a legacy system), put it in a password manager (1Password, Bitwarden) immediately after and delete the text. I will never paste it into a chat log or a document in your repo.
- **At engagement close** you can rotate every credential I've touched in under 15 minutes: revoke my GitHub OAuth grants on Cloudflare + Supabase, remove me from your Google Workspace, and (optionally) rotate the Supabase anon key. I am deletable from your infrastructure by design.

---

## 5. What happens if any of this is unchecked when we start

Honest answer: we stall. Every item on this list gates a specific downstream step. Examples:

- Anchor email not confirmed → can't create GitHub → can't do OAuth into Cloudflare/Supabase → nothing happens.
- Google Workspace invite not sent → can't wire the real-time data mirror (Layer 1) → verification drill fails the "L1" leg.
- Registrar access not confirmed → domain cutover slips → the "Coming Soon" page can't go live on your real URL.

None of these are disasters — they're just missed mornings. But they compound. An engagement that sails through Pre-Flight lands Phase 0 in ~2–3 days. An engagement that hits the Pre-Flight gates unprepared typically adds 2–5 days.

---

## 6. Your sign-off

When every box above is checked, reply to me (or sign here) with:

> *"Pre-Flight checklist complete. Anchor email is `________________`. Ready to schedule the Leg A window."*

Signed: _______________________________ Date: _______________

Role / title: _______________________________

---

## Appendix — Quick reference

| Item | Who does it | Time |
|---|---|---|
| Confirm anchor email | You | 2 min |
| Be at keyboard for Leg A window | You + Me (live) | 60 min |
| Invite consultant to Google Workspace | You | 5 min |
| Confirm registrar access | You | 5 min (or up to 1–3 days if locked out) |
| Review + sign this checklist | You | 10 min |

**Total client-side time:** ~90 min, spread over 1 week.

---

*Document version 1.0. Part of the OAG Client Engagement playbook. Hand to every new client at engagement kickoff, before Phase 0 Leg A begins.*
