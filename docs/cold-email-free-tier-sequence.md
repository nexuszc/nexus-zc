# Cold Email Sequence — Free Tier (Roofing Contractors)

3-touch sequence. Hook: Free CompanyCam replacement.
CTA on every email: roofingos.dev/dashboard
Plain text only. Under 150 words per email.
Prospect type: roofing_contractor_cold

---

## EMAIL 1 — Day 0 — Cancel CompanyCam

**Subject:** Cancel CompanyCam today

Hey [first name],

CompanyCam charges you $79–199/month to let your crew share job photos.

We built a free replacement — plus a homeowner portal that shows them real-time updates, photos, and insurance claim status so they stop calling you.

No credit card. No contract. First 5 jobs free. Takes 4 minutes to set up.

roofingos.dev/dashboard

One thing: what's your current CompanyCam or job photo setup?

— Zach

---

## EMAIL 2 — Day 3 — What homeowners stop doing

**Subject:** 4 calls you stopped getting

Hey [first name],

Following up on the CompanyCam message.

Contractors using our free portal tell us the same thing: homeowners stop calling.

When they have a real-time portal — photos from the crew, update timeline, insurance status — they don't need to call you. Average contractor saves 20–30 status check interruptions a week during storm season.

4 minutes to set up: roofingos.dev/dashboard

The homeowner demo is here if you want to see what they see: roofingos.dev/portal/demo

— Zach

---

## EMAIL 3 — Day 7 — Last chance + direct offer

**Subject:** Last note on the free portal

Hey [first name],

Last one. I'll keep it short.

Free homeowner portal for every job. Crew uploads photos from any phone. Homeowners track their job in real time. No CompanyCam. No credit card.

Add-ons when you want them: Supplement AI ($99/job), Measurements ($25/report), Aria handles calls and follow-ups ($249/mo).

If it's not for you — no worries. If the timing is wrong — bookmark this and come back.

roofingos.dev/dashboard

— Zach

---

## Load Instructions

Insert into email_sequences table with:
- prospect_type = 'roofing_contractor_cold'
- steps = 3
- status = 'active'

Each email stored in email_log when sent.
Trigger: new prospect added to roofing_prospects with source = 'cold_email'.
