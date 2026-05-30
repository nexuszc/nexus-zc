# NEXUS ZC -- CLAUDE.md
# Master context file. Read this at the start of every session.
# Last updated: May 28, 2026 — v17

---

## WHO I AM

**Zach Curtis** -- Denver, CO. Multi-venture entrepreneur running a portfolio of businesses
generating ~$1M/year in revenue. I operate as my own CEO/COO across all ventures.
I am building Nexus to replace myself as COO and eventually productize it.

---

## DEBUGGING RULES — NON-NEGOTIABLE

When something is broken:

1. DIAGNOSE FIRST. Never write a fix before reading the actual error.
   - Check browser console errors FIRST
   - Check function logs FIRST
   - Read the actual file before changing it
   - One curl test beats 10 guesses

2. ONE FIX AT A TIME. Never stack multiple changes for one bug.
   - Fix one thing, test it, confirm it works, then move on
   - If a fix doesn't work in 2 attempts — stop and re-diagnose

3. NEVER TOUCH WORKING SYSTEMS. If auth worked yesterday,
   the bug is in what changed today — not in auth itself.

4. SAY WHAT'S BROKEN PLAINLY before writing any code.
   "The CORS header is missing on contractor-auth"
   not "let me try a few things"

5. BROWSER CONSOLE IS THE ANSWER. For any frontend issue --
   read the console errors before writing a single line.
   If Zach sends a screenshot, check the console panel first.

6. ROLLBACK IS ALWAYS AN OPTION. If 2 fixes fail,
   git revert to last working state and start clean.

---

## THE THREE-SYSTEM SETUP

| Tool | Role | What it does |
|------|------|-------------|
| **Nexus** | The Brain | Persistent memory, strategic advisor, source of truth |
| **Claude (claude.ai)** | The Workshop | Strategy, architecture, thinking partner |
| **Claude Code (terminal)** | The Builder | Writes code, deploys, commits to Git |

**Claude Code does NOT make architectural decisions.** It implements what the Workshop designs.

---

## WHAT NEXUS IS

Nexus is NOT a second brain or note-taking tool.

**Nexus is a personal Chief of Staff / COO / strategist.**

A second brain stores. A Chief of Staff *acts*.
A second brain answers when asked. A COO *advises continuously*.
A second brain organizes information. A strategist *organizes attention*.

### The full vision (locked):

```
Nexus (AI brain -- the product)
VA Company (human delivery layer -- 100+ VAs trained on Nexus)
    deployed through vertical channels:
    - Roofing OS (roofing contractors)
    - Cash Out Refinances (mortgage/refi)
    - [future verticals]
```

Roofing OS and Cash Out Refinances are NOT separate businesses.
They are GTM beachheads -- vertical channels for deploying Nexus + VAs.

**End state:** A system that takes a business owner from zero to fully operational --
websites, CRMs, outreach, research, SOPs -- with Nexus as the brain and VAs as the hands.
Then productized and sold to other multi-business operators.

### What a real COO does (what Nexus must do):
1. Maintains state on every initiative -- status, next step, blocker, owner
2. Allocates attention -- tells me where to focus THIS week vs. delegate/drop
3. Surfaces problems early -- notices silence, slipping commitments, conflicts
4. Drives accountability -- "You said you'd call Mike Tuesday. It's Wednesday."
5. Synthesizes patterns -- "You keep deferring decisions on X. Want to talk about why?"

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Database | Supabase (Postgres + pgvector) |
| Project ref | `koqpbnxkhgbsnbdjwldx.supabase.co` |
| Region | eu-central-1 |
| AI -- responses | Claude Sonnet 4.5 (`claude-sonnet-4-5`) |
| AI -- embeddings | OpenAI text-embedding-3-small |
| Capture | Telegram bot `@nexuszc_bot` |
| Brain browser | `/Users/zachdaniels/Documents/NEXUS/nexus-brain.html` |
| Edge Functions | Supabase Edge Runtime (Deno), all deployed `--no-verify-jwt` |
| Frontend | React 18 + Vite + Tailwind v3, hosted on Cloudflare Pages |
| Domain | nexuszc.com (Cloudflare) -- app.nexuszc.com, [client].nexuszc.com |
| Email | zach@nexuszc.com / brain@nexuszc.com (Google Workspace) |
| Web search | Serper.dev (SERPER_API_KEY set in Supabase secrets) |
| Repo | github.com/nexuszc/nexus-zc |
| Local path | `/Users/zachdaniels/Documents/NEXUS` |

### Git Branch Structure:
- `main` -- production (Cloudflare Pages deploys from here)
- `dev` -- staging (auto-fix and nexus-build commit here; approve to merge to main)
- **Rule:** auto-fix always syncs dev to main before writing, then commits fix to dev
- **Rule:** `approve` command does a content-based merge (reads files from dev, writes to main -- conflict-proof)
- **Rule:** nexus-build commits to dev only. Only Zach's `approve` command writes to main.

---

## DOMAIN SEPARATION (CRITICAL — never mix these)

| Product | Domain | Audience |
|---------|--------|----------|
| **Nexus** (admin) | `app.nexuszc.com` | Zach only — internal dashboard, purple `#7c3aed` |
| **Roofing OS** (landing) | `roofingos.dev` | Public — marketing, blog, SEO |
| **Roofing OS** (roofer app) | `app.roofingos.dev` | Roofer dashboard, signup, login |
| **Roofing OS** (homeowner) | `portal.roofingos.dev` | Homeowner job portals |

**Rule:** Any URL shown to a roofer or homeowner must use `roofingos.dev` — never `nexuszc.com`.  
**Rule:** `app.nexuszc.com` is Zach-only admin. Never link to it from landing pages, emails, or roofer UI.  
**Rule:** `_redirects` in `roofingos-landing/` must never reference `nexuszc.com`.  
**Rule:** Do NOT add `/auth/verify /auth/verify.html 200` rewrite rules to `_redirects` — Cloudflare Clean URLs handles `.html` → clean URLs natively. Adding the rule creates an infinite redirect loop.

---

## EDGE FUNCTIONS (all live, all deployed `--no-verify-jwt`)

| Function | Purpose | Trigger |
|----------|---------|---------|
| `ae-login` | See function source for details | Internal |
| `ae-tasks` | See function source for details | Internal |
| `aria-call-gate` | See function source for details | Internal |
| `aria-queue-daily` | See function source for details | Internal |
| `aria-queue-processor` | See function source for details | Internal |
| `assess-project` | Run AI assessment on a project | On demand |
| `auto-fix` | Read code from GitHub → Claude writes fix → commit to dev → notify | Called by health-monitor |
| `brain-api` | REST API for brain browser access | GET/POST from nexus-brain.html |
| `briefing` | Morning brief at 7am MT (13:00 UTC) via pg_cron | Daily cron (job ID 1) |
| `chat` | Core brain: classify → retrieve → Claude → respond | POST from Telegram webhook or web |
| `contractor-auth` | Contractor magic link invite + session lookup | Internal |
| `contractor-churn-predictor` | See function source for details | Internal |
| `contractor-competitive-engine` | See function source for details | Internal |
| `contractor-dashboard-api` | See function source for details | Internal |
| `contractor-roi-engine` | See function source for details | Internal |
| `contractor-signup` | See function source for details | Internal |
| `contractor-support` | See function source for details | Internal |
| `email-webhook` | Inbound email handling | Resend webhook |
| `generate-queue` | Generate lead call queue | On demand |
| `generate-va-tasks` | Generate daily VA task lists | Cron / on demand |
| `get-dashboard-stats` | Aggregate stats for React dashboard | API call from frontend |
| `get-public-config` | See function source for details | Internal |
| `health-monitor` | Hourly health check, identify improvements, trigger auto-fix | Every hour cron (job ID 3) |
| `import-leads` | Bulk import leads from CSV or external source | On demand |
| `job-intake` | See function source for details | Internal |
| `log-call` | VA logs call outcome + auto-enrolls lead sequences | VA web form |
| `monthly-truth` | See function source for details | Internal |
| `morning-digest` | See function source for details | Internal |
| `nexus-admin-api` | See function source for details | Internal |
| `nexus-build` | Consolidated builder: manifest → build → test → stage → notify | On demand (telegram, nexus-core, VPS) |
| `nexus-coo` | COO intelligence: focus, stale_check, momentum_check, health_score | Called by chat + health-monitor |
| `nexus-core` | Consolidated brain: observe, think, act, reflect — every 30 min | Cron (every 30 min) + VPS + manual |
| `nexus-diagnostic` | See function source for details | Internal |
| `nexus-follow-up` | See function source for details | Internal |
| `nexus-intake` | See function source for details | Internal |
| `nexus-job-intake-sms` | See function source for details | Internal |
| `nexus-job-intake-voice` | See function source for details | Internal |
| `nexus-prospector` | See function source for details | Internal |
| `nexus-quick-scan` | See function source for details | Internal |
| `nexus-router` | See function source for details | Internal |
| `nexus-self-build` | See function source for details | Internal |
| `nexus-unsubscribe` | See function source for details | Internal |
| `nexus-vertical-router` | See function source for details | Internal |
| `nexus-voice` | See function source for details | Internal |
| `nexus-voice-compliance` | See function source for details | Internal |
| `nexus-voice-engine` | See function source for details | Internal |
| `nexus-voice-learning` | See function source for details | Internal |
| `nexus-voice-webhook` | See function source for details | Internal |
| `portal-activity-generator` | See function source for details | Internal |
| `portal-api` | See function source for details | Internal |
| `portal-magic-link` | See function source for details | Internal |
| `process-email-queue` | Batch process email queue | Cron |
| `provision` | Spin up client subdomain + Claude-generated site | chat provision: command or web UI |
| `reclassify` | Re-run classification on existing entries | On demand |
| `refresh-assessments` | Refresh project assessment scores | On demand |
| `reminders` | See function source for details | Internal |
| `roofing-ai` | Roofing AI actions: estimate, contract, invoice, timeline, supplement_request | Internal |
| `roofing-analytics` | See function source for details | Internal |
| `roofing-aria-engine` | See function source for details | Internal |
| `roofing-aria-inbound` | See function source for details | Internal |
| `roofing-aria-learning` | See function source for details | Internal |
| `roofing-aria-setup` | See function source for details | Internal |
| `roofing-aria-storm-trigger` | See function source for details | Internal |
| `roofing-aria-webhook` | See function source for details | Internal |
| `roofing-click-tracker` | See function source for details | Internal |
| `roofing-closer` | See function source for details | Internal |
| `roofing-community-monitor` | See function source for details | Internal |
| `roofing-content-api` | See function source for details | Internal |
| `roofing-content-engine` | See function source for details | Internal |
| `roofing-content-publisher` | See function source for details | Internal |
| `roofing-content-repurposer` | See function source for details | Internal |
| `roofing-crew-manager` | See function source for details | Internal |
| `roofing-depreciation-tracker` | See function source for details | Internal |
| `roofing-email-nurture` | See function source for details | Internal |
| `roofing-email-tracker` | See function source for details | Internal |
| `roofing-email-webhook` | See function source for details | Internal |
| `roofing-financial` | See function source for details | Internal |
| `roofing-integration-companycam` | See function source for details | Internal |
| `roofing-integration-crm` | See function source for details | Internal |
| `roofing-integration-webhook` | See function source for details | Internal |
| `roofing-job-create` | See function source for details | Internal |
| `roofing-job-pipeline` | See function source for details | Internal |
| `roofing-lead-scout` | See function source for details | Internal |
| `roofing-linkedin-poster` | See function source for details | Internal |
| `roofing-material-order` | See function source for details | Internal |
| `roofing-measurements` | See function source for details | Internal |
| `roofing-non-roofer-redirect` | See function source for details | Internal |
| `roofing-notify` | SMS (Twilio) + email (Resend) dispatcher for all roofing events | Internal |
| `roofing-nudge-email` | See function source for details | Internal |
| `roofing-outreach` | See function source for details | Internal |
| `roofing-outreach-sequencer` | See function source for details | Internal |
| `roofing-page-visit` | See function source for details | Internal |
| `roofing-partner-scout` | See function source for details | Internal |
| `roofing-payments` | Stripe payment intent creation + payment confirmation | Internal |
| `roofing-permit-tracker` | See function source for details | Internal |
| `roofing-product-monitor` | See function source for details | Internal |
| `roofing-prospector` | See function source for details | Internal |
| `roofing-qa-bot` | See function source for details | Internal |
| `roofing-referral-engine` | See function source for details | Internal |
| `roofing-self-improve` | See function source for details | Internal |
| `roofing-seo-publisher` | See function source for details | Internal |
| `roofing-shotstack-webhook` | See function source for details | Internal |
| `roofing-social-poster` | See function source for details | Internal |
| `roofing-storm-marketing` | See function source for details | Internal |
| `roofing-supplement-analyzer` | See function source for details | Internal |
| `roofing-supplement-generator` | See function source for details | Internal |
| `roofing-supplement-rebuttal` | See function source for details | Internal |
| `roofing-supplement-tracker` | See function source for details | Internal |
| `roofing-unsubscribe` | See function source for details | Internal |
| `roofing-video-webhook` | See function source for details | Internal |
| `roofing-voiceover-engine` | See function source for details | Internal |
| `roofing-weekly-marketing-report` | See function source for details | Internal |
| `roofing-weekly-report` | See function source for details | Internal |
| `roofing-whale-alert` | See function source for details | Internal |
| `roofing-youtube-analytics` | See function source for details | Internal |
| `roofing-youtube-engage` | See function source for details | Internal |
| `roofing-youtube-engine` | See function source for details | Internal |
| `roofing-youtube-publisher` | See function source for details | Internal |
| `roofing-youtube-uploader` | See function source for details | Internal |
| `send-email` | Send email via Resend | Internal |
| `send-partnership-emails` | See function source for details | Internal |
| `smoke-test` | See function source for details | Internal |
| `smoke-test-runner` | See function source for details | Internal |
| `stripe-setup` | See function source for details | Internal |
| `stripe-webhook` | See function source for details | Internal |
| `supplement-audit-engine` | See function source for details | Internal |
| `supplement-jobs` | See function source for details | Internal |
| `synthesize-portfolio` | Generate portfolio-level synthesis and insights | On demand |
| `system-heartbeat` | See function source for details | Internal |
| `telegram` | Webhook: immediate 200 ACK, processes in waitUntil | Telegram push |
| `tier-enforcement` | See function source for details | Internal |
| `upgrade-engine` | See function source for details | Internal |

---

## DATABASE TABLES (key tables)

### Core brain:
- `entries` -- all thoughts, classified with type/importance/tags/project_names/people_names/task_status/client_id
- `conversations` -- conversation threads by channel
- `channel_conversations` -- maps external IDs (Telegram chat IDs) to conversations
- `embeddings` -- pgvector embeddings for semantic search
- `projects` -- ventures and ideas (categories: platform, vertical, personal, external, idea, archived)
- `people` -- named people extracted from entries
- `reminders` -- scheduled Telegram reminders (fire_at, fired, chat_id, message)

### Multi-tenant client layer:
- `clients` -- client records (name, deal_type, status, monthly_fee, rev_share_pct, slug, provision_status, site_url)
- `client_context` -- per-client brain context (core_offer, goals, target_audience, script, pain_points)
- `va_assignments` -- which VA is assigned to which client

### Self-aware system:
- `nexus_health` -- hourly function health snapshots (error_count, success_count, avg_response_ms, status)
- `nexus_improvements` -- improvement queue (title, problem, recommended_fix, priority, status, auto_fix_code, files_changed, dev_commit_sha, fix_confidence, fix_verified, fix_verified_at, post_fix_error_count, rollback_triggered)
- `nexus_usage` -- ability usage analytics (ability, success, response_ms, channel)
- `nexus_alerts` -- instant alerts log (alert_type, message, resolved)
- `platform_insights` -- cross-client pattern observations
- `known_failure_patterns` -- 6 seeded error patterns with auto-fix strategies for health-monitor
- `weekly_reports` -- weekly self-improvement reports (Sunday 13:00 UTC, surfaced in Monday brief)

### Brian's lead system:
- `leads` -- lead records linked to client_id
- `sequences` -- email/call sequences
- `sequence_enrollments` -- lead to sequence enrollment state

### V2 additions:
- `generated_docs` -- documents from generate-* abilities (type, client_id, title, content, created_at)
- `knowledge_base` -- persistent knowledge store (topic, content, source_url, created_at)
- `va_profiles` -- VA accounts linked to Supabase auth user_id
- `va_task_queues` -- daily VA task lists (va_assignment_id, date, tasks JSON, completed_count)
- `call_logs` -- structured VA call records (lead_id, outcome, notes, va_profile_id)
- `client_portal_access` -- token-based portal access (client_id, access_token, last_accessed)
- `invoice_sequence` -- auto-incrementing invoice counter (last_number, produces INV-YYYY-XXXX)

### Roofing OS GTM (added May 12, 2026):
- `roofing_prospects` -- leads being sold to (scored, 16-touch outreach, full pipeline lifecycle)
- `roofing_outreach_log` -- every email sent/received per prospect (direction, touch number, sentiment)
- `roofing_captures` -- landing page form submissions (roofingos-landing/index.html → roofingos.dev)
- `hail_events` -- hail storm events monitored for prospecting triggers
- `roofing_improvements` -- Roofing OS product improvement proposals (AI-generated, approved by Zach)
- `roofing_health_snapshots` -- daily product health metrics (contractors, jobs, errors, pipeline)
- `competitor_intel` -- competitor feature tracking (JobNimbus, Roofr, AccuLynx, CompanyCam, Jobber)

### Roofing OS Dashboard + Admin (added May 15, 2026):
- `contractor_employees` -- contractor team members (role, phone, PIN, is_owner, active)
- `contractor_team_members` -- team members who can call/text job updates (phone UNIQUE, role: owner/pm/sales/crew/admin, links to contractor_accounts)
- `inbound_sessions` -- SMS/voice conversation state per phone number (state machine: idle → awaiting_homeowner_phone → awaiting_job_selection, pending_data jsonb)
- `contractor_sessions` -- magic link + PIN sessions (token, expires_at, 7-day rolling)
- `system_heartbeats` -- per-function probe results (status, response_ms, error_message)
- `system_health_snapshots` -- hourly rollup (ok_calls, error_calls, avg_ms, p95_ms)
- `nexus_roofing_proposals` -- AI-generated Roofing OS improvement proposals (approve/reject flow)
- `contractor_dashboard_config` -- per-contractor widget/notification preferences
- `aria_call_queue` -- outbound calls blocked by compliance gate, queued for next valid window (fire_at, status, attempt_count)

### Roofing OS Auto-Marketing (added May 14, 2026):
- `contractor_accounts` -- paid contractor subscribers (plan, Stripe, trial, churn_risk_score, subdomain, referral_code)
- `supplement_audit_leads` -- free audit form submissions (score, aria_call_queued, converted_to_contractor)
- `contractor_competitive_intel` -- weekly competitive intel records per contractor (competitors JSON, email_sent_at)
- `contractor_roi_reports` -- monthly ROI reports (supplement_revenue_cents, roi_multiple, net_gain_cents)
- `contractor_referrals` -- referral tracking (referring_contractor_id, referred_contractor_id, status)
- `nexus_verticals` -- vertical router config (slug, name, status, storm_detection_enabled, etc.) — seeded: roofing, mortgage

### V4 Autonomous Engine additions:
- `nexus_audit_log` -- permanent log of every autonomous action ever taken
- `nexus_decisions` -- decision log with outcome tracking for learning
- `nexus_ability_proposals` -- self-generated ability proposals lifecycle
- `nexus_research_findings` -- all web research findings saved permanently
- `nexus_action_queue` -- actions pending 1-tap approval
- `nexus_agent_cycles` -- record of every agent run
- `nexus_preferences` -- learned preference model (6 seeds: approval thresholds, comms style, focus areas)

### Nexus Autonomous Business OS (added May 13, 2026):
- `nexus_consents` -- email/SMS/voice consent records per lead (CAN-SPAM + TCPA compliance)
- `nexus_diagnostics` -- full diagnostic records (slug, score, routing_model, internal_report, client_report)
- `nexus_diagnostic_layers` -- individual layer results (24 layers per diagnostic, score + findings + gaps)
- `nexus_outreach_log` -- every outbound/inbound touch per diagnostic (email, voice, SMS)
- `nexus_referrals` -- referral tracking (referrer, referred, credit tier, status)
- `nexus_benchmarks` -- rolling industry averages for nexus_score (seeded per industry)
- `nexus_vertical_proposals` -- detected vertical opportunities (detecting → threshold_met → approved)
- `nexus_acquisition_targets` -- businesses flagged for acquisition routing (score, estimated_value)
- `nexus_unsubscribes` -- unsubscribe records (email, channel, timestamp)
- `nexus_developer_waitlist` -- developer API waitlist (email, use_case, created_at)

### Voice Engine (added May 13, 2026):
- `voice_calls` -- every call ever made (transcript, outcome, buy signals, objections, revenue)
- `voice_scripts` -- versioned modular call scripts with conversion rate tracking
- `voice_objections` -- objection library with resolution rates and champion tracking
- `voice_learning` -- weekly learning reports (best opener, best time, improvements)
- `voice_compliance` -- pre-call compliance check log (TCPA, consent, DNC, two-party)

### Roofing OS Homeowner Portal (added May 13, 2026):
- `homeowner_sessions` -- magic link tokens, 1-year expiry, maps to roofing_jobs
- `portal_activities` -- bilingual activity feed (English + Spanish titles/descriptions)
- `portal_photos` -- before/after job photos with stage tagging
- `portal_messages` -- homeowner ↔ contractor chat thread
- `insurance_claims` -- claim number, adjuster info, status tracking
- `supplement_tracker` -- supplement items with status and amounts
- `portal_documents` -- contracts, permits, warranty docs with e-signature
- `portal_payments` -- payment records (deposit, progress, final)
- `roof_monitoring` -- post-job monitoring events (storm, aging, damage detected)
- `portal_referrals` -- homeowner referrals with unique codes
- `aria_portal_conversations` -- Aria chat history within portal

### Roofing OS Aria Voice System (added May 13, 2026):
- `roofing_aria_calls` -- every outbound/inbound call (transcript, outcome, buy_signals, script_used, duration)
- `roofing_aria_scripts` -- champion scripts per call_type + language with conversion tracking
- `roofing_aria_learning` -- weekly learning reports per call type (best/worst script, rates)
- `roofing_inbound_calls` -- inbound call routing records (caller lookup, contact_type)

### Roofing OS Supplement AI (added May 13, 2026):
- `supplement_packages` -- full supplement packages (line items, amounts, carrier info, status pipeline)
- `supplement_photo_analysis` -- per-photo AI analysis (damage types, severity, suggested Xactimate codes)
- `roofing_codes` -- building code database (CO seeded: 8 code types with Xactimate line items)
- `carrier_intelligence` -- carrier behavior patterns + tips (6 carriers seeded with approval rates)
- `supplement_rebuttals` -- AI-generated denial rebuttal letters (strategy, evidence, outcome tracking)
- `depreciation_tracking` -- depreciation held/released tracking with auto follow-up alerts

### Roofing OS Auto-Marketing (added May 14, 2026):
- `roofing_content` -- all generated content (type, title, body, status, channel, hook, thumbnail_text, tags[], market, carrier, scheduled_topic, scheduled_day, telegram_message_id, views, signups_attributed, mp3_url, voiceover_chars, blog_url, youtube_description, youtube_upload_ready, published_url)
- `content_queue` -- outbound email/SMS queue per content piece (channel, recipient, scheduled_for, status, sent_at)
- `marketing_performance` -- weekly channel metrics (week_of, channel, metric_name, metric_value)
- `roofing_community_posts` -- Reddit/FB community posts with AI responses (platform, thread_url, our_response, status, portal_mentioned, telegram_message_id)

### Roofing OS Content Machine (added May 15, 2026):
- `email_sequences` -- 7-touch nurture sequences per prospect (current_step, next_send_at, completed, unsubscribed, total_opens, total_clicks)
- `email_log` -- every email sent record (sequence_id, step, subject, body, resend_id, status, opened_at, clicked_at)

### Supabase Storage buckets:
- `voiceovers` -- public bucket, 50MB limit, audio/mpeg; stores `{content_id}.mp3` files generated by roofing-youtube-publisher
- `roofing-content` -- public bucket, 50MB limit, audio/mpeg + image/png; stores `youtube/{content_id}.mp3` files from roofing-voiceover-engine

### Project categories:
- `platform` -- core businesses (Nexus, VA Company)
- `vertical` -- GTM channels (Roofing OS, Cash Out Refinances)
- `personal` -- personal investments (Water Station)
- `external` -- things Zach contributes to but doesn't drive (Bora)
- `idea` -- loose ideas not yet committed
- `archived` -- dead or paused

---

## CURRENT PORTFOLIO

### Platform (building):
- **Nexus** -- the brain/product (this system)
- **VA Company** -- human delivery layer, Sam is the sales lead

### Verticals (GTM channels, paused while platform is built):
- **Roofing OS** -- roofing contractor channel
- **Cash Out Refinances** -- mortgage/refi channel

### Personal:
- **Water Station** -- investment, needs an app then runs itself

### External:
- **Bora** -- contributor not driver

---

## KEY PEOPLE

- **Sam** -- VA Company sales lead. Calls leads, closes clients. Not yet fluent in pitching Nexus as a standalone product. Needs Nexus to be undeniable before she can sell it.
- **Kristine** -- VA onboarding. Manages VA sourcing and deployment.
- **Brian** -- Anchor client. Reverse mortgage calling, rev share model. Also considering VA bodies for his operation. Brian is Sam's training ground -- when she sees Nexus work for Brian, she can pitch it.
- **Jesse** -- Part of cash-out refi deal. Referred Brian.
- **Kevin Cantwell** -- Runs HireSuccess.com (25-year-old pre-employment testing SaaS, 2,000+ customers, 4.9 Capterra). Wants AI upgrade + packaging for acquisition. Potential $15-25K project fee OR 2-3% success fee on acquisition. Warm lead, needs dedicated scoping call.

---

## STRATEGIC DECISIONS (LOCKED)

1. **Nexus is the product. VAs are one execution mechanism.** Long-term: sell Nexus with VAs optional. Short-term: sell VAs, include Nexus for anchor clients.
2. **Nexus mandatory pricing trigger:** When Sam can independently pitch the Nexus value prop in 60 seconds and feel good defending the price. Not date-based -- capability-based.
3. **Every Nexus build decision passes this test:** "Does this make Sam more confident pitching it?"
4. **Brian-first build sequence:** Ship Brian's lead system before building platform features. Design DB/code so platform wrap is additive, not a rewrite.
5. **VA + Nexus decoupled for now:** Clients can buy either separately. Brian/Jesse/Kevin get Nexus included, not as a separate line item.
6. **$250/mo** established as Nexus floor price for future clients.
7. **Build stack:** Stay on Supabase + React/Vite for now. No Next.js until platform actually needs it.
8. **VA call logging:** Web form (not Telegram) for structured data.
9. **Self-improvement approval gate:** Every auto-generated fix must be approved by Zach before going to production. No autonomous deploys.

---

## ROOFING OS — CONTRACTOR AUTH FLOW (working as of May 22, 2026)

| Step | URL | Notes |
|------|-----|-------|
| Signup | `roofingos.dev/signup` | Creates `contractor_accounts` row, sends welcome email/SMS |
| Login | `app.roofingos.dev/roofing/login` | Email magic link via Supabase OTP |
| Dashboard | `app.roofingos.dev/roofing/jobs` | React app, requires Supabase session |

**Auth implementation details:**
- `ContractorContext.jsx` calls `contractor-auth` with `action: get_contractor` on every load
- `get_contractor` extracts email from JWT via `atob(token.split('.')[1])` — do NOT use `supabase.auth.getUser(token)` (service role client overrides auth header, always returns 401)
- `contractor-auth` deployed `--no-verify-jwt` with full CORS headers
- `roofingos.dev/dashboard` and `roofingos.dev/dashboard/*` redirect to `app.nexuszc.com/roofing/jobs` via `_redirects`
- Sessions in `contractor_sessions` table use 7-day rolling expiry
- Magic links can be generated manually by inserting into `contractor_sessions` with `contractor_id` (useful when owner has no phone on record)

---

## VPS STACK (Hostinger — 31.220.60.77)

- SSH key: `~/.ssh/hostinger_vps` — alias `hostinger-vps`
- pm2 processes: `nexus-worker`, `hail-trigger` (cron: */30 * * * *), `lead-sniper` (cron: 0 */6 * * *), `video-renderer` (cron: 0 * * * *), `youtube-recorder` (cron: 0 12 * * 1), `youtube-producer` (PM2 ID 8, cron: 0 */4 * * *)
- Files: `/root/nexus-worker/index.js`, `/opt/roofing/sniper/hail-trigger.js`, `/opt/roofing/sniper/lead-sniper.js`, `/opt/roofing/sniper/video-renderer.js`, `/opt/roofing/youtube/recorder.js`, `/opt/roofing/youtube/producer.js`
- Env: `/opt/roofing/.env` — contains ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SERPER_API_KEY, OPENAI_API_KEY, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, YOUTUBE_CHANNEL_ID, YOUTUBE_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
- nginx serves `/health` at port 80 → `{"ok":true,"service":"roofing-vps"}`
- nexus-worker v3: 4-hour build dedup, smoke-test exclusion in reflection prompt, extractJSON() handles trailing text after Claude JSON responses
- video-renderer: uses ffmpeg (not Creatomate — 402 no credits), outputs 1080x1920 MP4 to `roofing-content` bucket
- lead-sniper: Playwright headless scrapes Google Maps for roofing contractors 3.8–4.6 stars, 10–100 reviews, inserts into `roofing_prospects`
- hail-trigger: weather.gov alerts API, dedupes via `/opt/roofing/sniper/processed_alerts.json`, inserts into `hail_events`, sends Telegram alert
- youtube-recorder: Playwright captures portal/dashboard screenshots, OpenAI TTS (tts-1, onyx voice) for voiceovers, ffmpeg renders 1920x1080 MP4, uploads via YouTube Data API OAuth2; 5 videos live: v1=4N1kn0O9tl0, v2=0z3yVttDFAo, v3=OskqZbT3ufo, v4=2d7D_qDbik8, v5=MCIwRmbPCQo

## ARIA CALL GATE RULES

- `aria-call-gate` blocks `cold_outbound_contractor` calls on weekends + federal holidays + outside 9am–5pm local time
- If all calls show `blocked` on a Sunday — that is CORRECT BEHAVIOR, not a bug
- Blocked calls are rescheduled to next Monday 9–10am local time in `aria_call_queue`
- `aria_call_queue` schema has NO `prospect_id` column — use `contact_phone`, `contact_name`, `contact_type`

## ARIA EMERGENCY STOP — May 26, 2026

**ALL ARIA CALLS ARE PAUSED. DO NOT RE-ENABLE WITHOUT FIXING DEDUP.**

- 1,000 queued calls set to `paused` on May 26
- 207 calls had already fired before stop
- Worst offenders: Storm & Hail AL called **11 times**, Weather Shield called **10 times** — both since May 17
- Root cause: no dedup guard in queue processor — same contacts re-queued daily for 9 days
- `aria-queue-processor` and `aria-queue-daily` crons were not in cron table (already absent)
- Re-queuing source: likely `nexus-core` or the edge functions themselves

**Before re-enabling Aria calls:**
1. Add dedup: check `aria_call_queue` for prior entries per `contact_phone` before inserting
2. Add max-attempts cap (e.g. 3 attempts per contact per 30 days)
3. Audit `aria-queue-processor` for the re-queuing loop
4. Update this section when fixed and re-enabled

## EMAIL TEMPLATE SUBJECTS (Hormozi-style, updated May 24 2026)

- Touch 1: "your homeowners are calling you too much"
- Touch 2: "CompanyCam charged you $99 again"
- Touch 3: "your competitor just signed up for free"
- Touch 4: "hail hit Denver — did you get the leads?"
- Touch 5: "last email — free tool for roofers"
- Touches 6-11 unchanged (story arc continues)
- Subjects live in `email_templates` keyed by `touch_number`, NOT in `email_sequences`
- `email_sequences` has `type` column (not `sequence_type`), no `subject` column

## DEMO PORTAL (roofingos.dev/portal/DEMO2026ROOFINGOS)

- Homeowner: Sarah Johnson, 4821 Maple Ave, Aurora CO 80016
- Job ID: `a65e6ef8-1205-44d0-89ef-612393aea2f6`
- Session ID: `751ddb4d-1435-4bd6-8c57-5890d5c6f9ae`
- Column for token lookup: `homeowner_sessions.magic_link_token` (NOT `token`)
- Status: completed, GAF Timberline HDZ Charcoal, 28 squares
- 20 photos, $4,200 supplement approved, insurance claim fully paid ($18,400 total)
- 6 messages (realistic conversation), 9 activities
- Contractor: Apex Roofing (contractor_id: d2eabbb4-e221-4ca2-ad65-6bedfec6517d)

## CURRENT BUILD PRIORITIES (as of May 30, 2026)

**V10 Master Build (May 30, 2026):**
- YouTube pipeline: youtube-script-generator edge function (Haiku, 150-200 word scripts per post), cron #72 at 12:30 UTC daily, 10 scripts generated for existing posts
- VPS YouTube producer (PM2 ID 8, cron 0 */4 * * *): ElevenLabs voiceover → ffmpeg render → YouTube Data API upload; picks up seo_posts WHERE youtube_script IS NOT NULL AND youtube_id IS NULL
- Schema markup: Article schema injected into 29 blog posts; SoftwareApplication schema added to index.html (Free/Starter/Pro offers)
- Bug fix: roofing-job-create status 'active' → 'lead' (jobs were invisible in active filter), portal URL format fixed to path-based /portal/:token
- Bug fix: roofing-job-create .catch() anti-pattern fixed (x2)
- Dashboard: JobCard now shows "● Portal sent" (blue) and "📐 Measured" (teal) badges when applicable

**VPS YouTube pipeline (PM2 ID 8):**
- /opt/roofing/youtube/producer.js — runs every 4 hours
- Picks up: seo_posts WHERE status=published AND youtube_script IS NOT NULL AND youtube_id IS NULL
- Flow: ElevenLabs TTS → ffmpeg (thumbnail + looped video + audio) → YouTube Data API OAuth2 upload → saves youtube_id to seo_posts
- Max 3 videos per run to avoid quota issues

**youtube-script-generator cron (job #72):**
- Schedule: 30 12 * * * (12:30 UTC daily, 6:30am MT)
- Generates scripts for 5 posts per run, targets posts with most impressions first

**PREVIOUS SESSIONS (as of May 24, 2026)

**DONE this session (Marketing V1 — May 24):**
- Phase 1: VPS YouTube recorder — /opt/roofing/youtube/recorder.js, Playwright + ElevenLabs + ffmpeg + YouTube OAuth, pm2 cron "0 12 * * 1" (Monday 6am MT), 5 videos queued. BLOCKED: needs ELEVENLABS_API_KEY + YOUTUBE_* keys in /opt/roofing/.env (get from Supabase vault)
- Phase 2: email_templates touches 1-5 rewritten — new Hormozi subjects + 5-sentence bodies
- Phase 3: outreach-sequencer v18 deployed — FROM_NAME "Zach from Roofing OS", plain-text fallback, List-Unsubscribe header
- Phase 4: email-webhook v2 deployed — first open fires Telegram "👀 [company] opened your email [subject] [phone] Call them now."; Resend webhook confirmed registered (ID: 2d3d95a4)

**FREE + STARTER build (May 24):**
- FREE FIX 1: 10-photo banner in RoofingJobDetail — triggers when photos >= 10, portal not yet sent
- FREE FIX 2: 3 portal/month limit enforced in roofing-notify (portal_limit_reached → upgrade modal)
- STARTER Feature 1: Inspector Checklist tab in RoofingJobDetail (10 items, pass/fail/na, print PDF)
- STARTER Feature 2: Permit Tracker in Overview tab (status, municipality, expiry, cost)
- STARTER Feature 3: Review + referral SMS/email on job complete (google_review_link on contractor_accounts)
- STARTER Feature 4: Job Scheduler page at /roofing/schedule (weekly calendar, crew lead, material date)
- STARTER Feature 5: Estimate Builder at /roofing/estimate/:id (line items, tax, signature pad)
- STARTER Feature 6: Follow-up sequences (contractor-lead-followup v1, cron 0 15 * * *, day 3/7/14 SMS)
- DB migrations: job_inspections, job_permits, job_schedule, job_estimates tables
- DB columns: portal_sent, portal_sent_at, review_requested, review_requested_at, last_contacted_at, follow_up_opted_out, follow_up_complete on roofing_jobs; google_review_link on contractor_accounts
- roofing-notify v47: portal limit + review_request event + full CORS
- contractor-lead-followup v1: day 3/7/14 SMS sequences, marks follow_up_complete on day 14

**Roofing OS V2 build (May 24 — session 2):**
- Phase 1: DB migrations — job_payments, job_costs, supplement_status, job_weather, contractor_briefings, lead_scores, insurance_adjusters, canvass_knocks tables; new columns on roofing_jobs/crew_assignments/contractor_accounts/portal_documents
- Phase 2: GPS photo tagging in RoofingJobDetail — 📍 badge, coords captured on upload
- Phase 3: Payment Tracking tab — auto-creates 33/33/34% milestones on contract_signed
- Phase 4: Job Completion modal — gates on after-photos + payments before marking complete
- Phase 5: Supplement tab — Xactimate line items, CSV export, adjuster info
- Phase 6: RoofingCrewMobile (/roofing/crew/:token) — public GPS photo + arrival/complete
- Phase 7: roofing-weather-check — 5am MT cron, rain/wind warnings
- Phase 8: contractor-morning-briefing — 7am MT cron, paid plans only
- Phase 9: storm-to-lead — VPS trigger → leads with score=75 + Aria queue
- Phase 10: roofing-lead-scorer — 0-100 formula, 8am MT cron
- Phase 11: Financials tab — job costing, margin % color-coded
- Phase 12: RoofingCanvass (/roofing/canvass) — door-knocking tracker, closer script, GPS, convert to job
- Phase 15: Dashboard — 🔥/🟡/⚪ score badge, supplement pill, payment dot, ⛈️ warning, Today section, Hot Leads stat
- Phase 16: All verified — tables, crons, smoke tests, routes

**Roofing OS V3 build (May 24, 2026 — session 3):**
- Phase 1: Route collision fix — `/roofing/settings` admin renamed to `/roofing/admin/settings`
- Phase 1: RoofingJobDetail — 10 tabs → 5 tabs (overview+inspection / photos / messages / money / docs)
  - TAB_COMPAT backward mapping preserves old `?tab=` URL params
- Phase 1: RoofingTeam route added at `/roofing/team` (ProtectedRoute/admin)
- Phase 1: RoofingOS.jsx activeTab() cleaned of dead legacy route patterns
- Phase 2-4 (DB): portal_payments→job_payments, supplement_tracker→supplement_status migrated;
  job_financials→job_costs migrated; nexus_improvements deduped to 68; crons staggered (no more 5@14:00 collision)
- Phase 5: RoofingEstimate — material visualizer (6 shingle swatches) + financing calculator (12/36/60 mo @ 7.99% APR, Hearth link)
- Phase 5: RoofingCanvass — weekly leaderboard (top 5 reps by knock count, gold/silver/bronze)
- Phase 5: RoofingOnboardingSetup — 3-step wizard at `/roofing/onboarding-setup` (city → review link → done)
- Phase 5: PWA — sw.js service worker (cache-first assets, network-first nav, Supabase bypass); manifest.json dark bg; SW registered in main.jsx
- Phase 7: Removed 5 dead legacy route aliases (pipeline/outbound/calls/contractors/exposure)
- Phase 6: Apex Roofing market_city populated to "Denver"; outreach sequencer confirmed healthy (running daily since May 22)

## ROOFING OS V3 — SCHEMA NOTES (V3 consolidation)
- `job_payments` is canonical — `portal_payments` is deprecated (still exists, 6 rows migrated)
- `supplement_status` is canonical — `supplement_tracker` is deprecated
- `job_costs` is canonical — `job_financials` is deprecated
- `canvass_knocks` is canonical — `door_knock_log` had 0 rows, deprecated
- `contractor_accounts.market_city` — set via onboarding-setup wizard or Settings; Apex=Denver
- `contractor_accounts.onboarding_complete` — set true after step 2 of onboarding-setup wizard
- Job detail tabs: 5 tabs now. Old ?tab= values map: inspection→overview, notes→docs, payments/supplement/financials→money, portal/documents→docs

**Routing + stability fixes (May 24, 2026 — session 5):**
- App.jsx: 5 dead route redirects added (/roofing/onboarding → /roofing/onboarding-setup, /home → /, /roofing/funnel → /roofing/sales, /roofing/content → /roofing/marketing, /dashboard → /)
- App.jsx: ADMIN_EMAILS guard in SIGNED_IN handler — prevents zach@nexuszc.com from being redirected to /roofing/jobs when signing in at /
- Login.jsx: replaced password login with magic link (signInWithOtp), emailRedirectTo: https://app.nexuszc.com; shows "check your email" confirmation state
- NexusDashboard.jsx: localStorage caching (5-min TTL, CACHE_KEY = 'nexus-dashboard-stats') — renders from cache instantly, refreshes in background
- nexus-worker (/root/nexus-worker/index.js): extractJSON() helper added — handles Claude API responses with trailing text after JSON (regex fallback `\{[\s\S]*\}`); both reflection and research cycles use it; added process.on('unhandledRejection') crash guard
- RoofingSettings.jsx: Tools section added — Measurements (📐 → /roofing/measurements) and Integrations (🔌 → /roofing/integrations) tappable rows with chevron
- YouTube recorder v3 (/opt/roofing/youtube/recorder.js): OpenAI TTS (tts-1, onyx), Playwright auth via Supabase admin generate_link, per-video scene sequences, 5 videos published; all /opt/roofing/.env YouTube/OpenAI/ElevenLabs secrets populated

**Nexus Dashboard v1 build (May 24, 2026 — session 4):**
- NexusDashboard.jsx at / — replaces Home; revenue banner, verticals grid, brain stats
- RoofingVertical.jsx at /roofing/dashboard — 6 stat cards, 6 section cards with nav
- RoofingMarketing.jsx at /roofing/marketing — 4 tabs (Email/YouTube/Outreach/Content)
- RoofingSales.jsx at /roofing/sales — hot leads table, funnel flow, Aria queue
- RoofingFinance.jsx at /roofing/finance — MRR, CSS bar chart, billing table
- RoofingCustomers.jsx at /roofing/customers — contractor table, magic link
- PWA: nexus-sw.js, nexus-icon-192.png/512.png, manifest → Nexus ZC / #7c3aed
- RoofingOS.jsx: updated to 6-tab nav pointing to standalone routes
- App.jsx: new routes under ProtectedRoute without Layout shell; / → NexusDashboard
- supabase.js storageKey: nexus-admin-session
- briefing v5 deployed: email 24h (sent/opened/clicked/HOT openers), YouTube live count + views, funnel movement 24h

## NEXUS ADMIN NAVIGATION (as of May 24, 2026)
- `/` → NexusDashboard (Nexus admin home — portfolio view)
- `/roofing/dashboard` → RoofingVertical (standalone, has own back nav to /)
- `/roofing/marketing` → RoofingMarketing (standalone, 4 tabs)
- `/roofing/sales` → RoofingSales (standalone)
- `/roofing/finance` → RoofingFinance (standalone)
- `/roofing/customers` → RoofingCustomers (standalone)
- `/roofing` → RoofingOS (admin shell, now 6-tab nav pointing to standalone pages)
- `/home` → redirects to / (NexusDashboard)
- Standalone pages have their own sticky headers with "← Nexus" back nav to /
- All under ProtectedRoute (Supabase admin session), no Layout shell

**Master Fix Session (May 26, 2026):**
- FIX 9: RoofingDashboard — redirect to /roofing/onboarding-setup when onboarding_complete=false && no jobs
- FIX 10: contractor-welcome-sequence edge function deployed — 3-email drip day 0/2/5, pg_cron job 59 at 14:00 UTC, CAN-SPAM compliant
- FIX 11: RoofingSales — URGENT whale leads section (whale_alerted=true, call_attempts=0, last_contacted_at IS NULL) with tap-to-call/SMS buttons + pre-written text
- FIX 15: VPS crontab: `0 7 * * * /opt/roofing/youtube-upload-cron.sh` (midnight PT = quota reset)
- FIX 16: nexus-core — exponential backoff 15/30/60s + retry-after header; shared anthropicFetch() replaces both ai() and aiHaiku()
- UPGRADE 1: All 31 blog posts — og:url, og:image, og:site_name added; 4 missing og:title/og:description fixed
- UPGRADE 2: sitemap.xml rebuilt — 37 URLs (7 main + 30 blog), lastmod 2026-05-26, no .html in paths
- UPGRADE 3: briefing v6 — whale uncalled leads in NEEDS YOU section with name/phone/company
- UPGRADE 6: RoofingSettings — Google Review Link field saves to contractor_accounts.google_review_link
- VPS nexus-worker: .catch() on awaited inserts fixed — worker online (pid 82296)
- VPS video-renderer: escapeFFmpeg strips "#"'"'`; renderer online (pid 82719)
- nexus-unsubscribe v4: replaced `.catch(() => {})` anti-pattern with explicit `{error}` destructuring + top-level try/catch; added UNIQUE constraint on `nexus_unsubscribes(email, channel)`; confirmed working
- Full 20-item smoke test: **20/20 PASS** (legal, revenue, system, security, content, Aria TCPA — all green)
- NOTE: hail-trigger and lead-sniper are stopped on VPS (intentional during Aria emergency stop — re-enable after dedup fix)
- Magic link UX: roofingos.dev/auth/verify handles all auth redirects — zero Supabase branding
  - roofingos-landing/auth/verify.html — branded loading page, reads #access_token, redirects to app.roofingos.dev/roofing/jobs
  - _redirects: NO .html rewrite rules — Cloudflare Clean URLs serves verify.html natively at /auth/verify (adding 200 rewrite causes infinite redirect loop)
  - contractor-signup: generates magic link with redirectTo=roofingos.dev/auth/verify; sends simple welcome email; FROM "Zach from Roofing OS <zach@roofingos.dev>"
  - RoofingLogin: emailRedirectTo=roofingos.dev/auth/verify, shouldCreateUser=false
  - Supabase auth redirect URLs locked down May 28: uri_allow_list = roofingos.dev/**, app.roofingos.dev/**, portal.roofingos.dev/**; site_url = https://roofingos.dev (set via management API)
  - Custom SMTP configured May 28: smtp.resend.com:465, user=resend, sender="Zach from Roofing OS", admin=zach@roofingos.dev — magic links now send from roofingos.dev not noreply@mail.supabase.io
  - Magic link email template branded May 28: subject "Open your Roofing OS dashboard", RoofingOS dark header + blue CTA, Denver address, unsubscribe link — no Supabase branding anywhere
  - roofingos.dev verified in Resend (us-east-1); nexuszc.com also verified

**Roofing OS SEO Machine (May 26, 2026):**
- DB: 6 tables — seo_pillars, seo_posts, seo_keyword_queue, seo_competitor_content, seo_performance, seo_internal_links
- 6 edge functions deployed (all `--no-verify-jwt`, all verified with `{"test":true}`):
  - seo-pillar-builder: builds 4 cornerstone guides (3500+ words each), auto-skips if already published
  - seo-keyword-finder v4: Google Autocomplete × 8 seeds × 13 letters + Reddit + 5 competitor blogs + portal_messages, saves top 20/run (score ≥8); `.catch()` bug fixed May 28
  - seo-content-writer: pulls highest-score keyword → Claude with Zach voice → quality gate (0-7 score) → auto-rewrite at 5 → approved/needs_review
  - seo-internal-linker: single post mode (resolves [LINK:topic] placeholders + injects backlinks) and sweep mode (10 published posts with 0 links per run)
  - seo-performance-tracker: GSC JWT auth via Web Crypto RS256 → per-slug DB updates → content boosts + title rewrites → weekly snapshot
  - seo-competitor-hunter v5: scrapes 5 competitor blogs + sitemaps as Googlebot, enqueues new keywords at intent_score:18, tracks counter-post coverage; `.catch()` bug fixed May 28 (5 instances)
- 5 pg_cron jobs (IDs 60-64): keyword-finder 11:00 UTC daily, content-writer 12:00 UTC daily, performance-tracker 13:00 UTC Monday, competitor-hunter 12:00 UTC Tue+Fri, internal-linker 13:00 UTC Sunday
- Blog template: roofingos-landing/blog/_template.html — schema markup, sticky CTA sidebar, TOC, author bio, related posts, category pills
- VPS publisher: /opt/roofing/seo/publisher.js — polls approved posts/pillars, renders HTML via template, git commit + push, Telegram summary; cron "0 14 * * *" (8am MT); **exits after each run** — pm2 shows "stopped" between runs, that is correct
- RoofingSEO.jsx: /roofing/seo — 5 tabs (Overview/Posts/Keywords/Competitors/Pillars), action buttons, live GSC data, quality check detail, write now + boost buttons
- RoofingOS.jsx: SEO tab added (7 tabs now) between Marketing and Sales
- REQUIRED MANUAL STEP: Set up Google Search Console service account + add GOOGLE_SC_CLIENT_EMAIL + GOOGLE_SC_PRIVATE_KEY to Supabase secrets for performance tracker to pull GSC data

**Telegram Flood Fix + YouTube Uploader Retire + VPS Publisher (May 26, 2026):**
- telegram_digest_queue table created (id, message, category, priority, sent, created_at); index on unsent rows
- telegram-daily-digest edge function: runs 2am UTC daily (pg_cron job 65); groups by category, sends ONE message; test ping works
- 6 SEO functions (pillar-builder, keyword-finder, content-writer, internal-linker, performance-tracker, competitor-hunter): sendTelegram now inserts to telegram_digest_queue (category:'seo') instead of direct API call
- nexus-core: added tgDigest() helper; weekly financial summary routes to digest; all critical alerts (build staged, Nexus Alert, Aria model revert, churn risk) stay immediate
- health-monitor: sendTelegram updated to accept category; 'system_down' = immediate, 'health' = digest; operational refill/enroll/YouTube queue messages → digest; critical degraded alerts stay immediate
- roofing-youtube-uploader: RETIRED (stub v8) — Creatomate removed, returns 302 to VPS recorder info
- seo-pillar-builder: fixed 150s timeout — now returns immediately, uses EdgeRuntime.waitUntil for background Claude calls; pillars build in BG and report via digest
- VPS: /opt/roofing/repo cloned (github.com/nexuszc/nexus-zc), seo-publisher pm2 process registered (ID 5), runs 0 14 * * * (8am MT)

**Roofing OS V3 — Visualization System (May 27, 2026):**
- Phase 1 (DB): product_manufacturers, roofing_products, product_colors, contractor_products, job_inspection_photos, job_visualizations, homeowner_color_selections tables; storage buckets inspection-photos + job-visualizations; 4 manufacturers + 27 colors seeded; GRANT ALL on all new tables (missing grants caused silent 0-row returns in edge functions)
- Phase 2 (VPS): /opt/roofing/visualization/engine.py — pm2 process, polls every 120s, Replicate SAM segmentation + heuristic fallback, 45% blend overlay, uploads to job-visualizations bucket
- Phase 3: RoofingInspection.jsx — new file at /roofing/jobs/:id/inspection; 10-shot guided capture; rear camera; uploads to inspection-photos; inserts job_inspection_photos with angle metadata
- Phase 4: RoofingSettings.jsx — Products & Colors section added before Tools; 4 manufacturer accordions; swatch circles; Add All; individual toggles auto-save to contractor_products
- Phase 5: RoofingPortal.jsx — Colors 5th tab (PaletteIcon); ColorsTab with angle selector, rendered preview, swatches, ❤️ CTA → saves to homeowner_color_selections + Telegram alert; portal-api v41 returns visualizations + colors
- Phase 6: RoofingTeam.jsx — full rewrite; 7 roles with permission labels; expandable contractor cards; add employee form; SMS invite button saves invite_token
- Phase 7: App.jsx + RoofingJobDetail.jsx — inspection route wired; overview tab shows inspection banner (0 photos → Start, N photos → status pill)
- CRITICAL LESSON: Tables created via SQL without GRANT ALL are invisible to edge functions even with service_role key — always run GRANT ALL ON <table> TO anon, authenticated, service_role after creating new tables

**Roofing OS V3 — Tiered Visualization + Pricing Pages (May 27, 2026):**
- Tiered visualization logic: `getVisualizationTier(plan)` in RoofingPortal.jsx
  - free/null → 'swatches': color circles only + 🔒 upsell block ("See these colors on your actual home" → roofingos.dev/pro)
  - starter → 'basic': hero photo with CSS mix-blend-mode:multiply overlay on upper 55% at 0.4 opacity using selected hex + "upgrade to PRO" nudge
  - pro/custom → 'ai': full AI renders (existing behavior) + "Colors ✨" badge in tab bar via DarkTabBar plan prop
- DB: visualization_count (int, default 0) + visualization_limit (int, default 0) added to contractor_accounts
  - 0 = free/none, 50 = starter basic, 500 = pro AI, -1 = unlimited
- Landing page pricing overhaul (roofingos-landing/index.html):
  - Pricing cards: 6 bullets each + "See everything included →" links to /plans/{free,starter,pro,custom}
  - Full comparison table added after pricing section (5 categories: Portal, CRM, AI, Sales, White-label)
- Plan detail pages created at roofingos-landing/plans/:
  - free.html — $0, feature breakdown, upgrade nudges to Starter
  - starter.html — $149/mo, automation features, upgrade nudge to Pro
  - pro.html — $499/mo, MOST POPULAR badge, AI viz section, competitor replacement table (~~CompanyCam~~ ~~JobNimbus~~ etc. = ~$600+/mo vs $499)
  - custom.html — $3k–5k/mo, white-label, dedicated strategist, done-for-you content
  - All pages: dark #0a0f1a, Inter font, sticky mobile CTA bar, OG tags, 100% static HTML

**roofingos.dev Landing Page Overhaul (May 27, 2026 — session 4):**
- Hero: headline → "Run your entire roofing business from one place." / removed false "500+ contractors" claim → "Built for roofing contractors"
- Nav: added "Start free →" CTA button alongside "Sign in"
- New: 6-card features grid (SVG icons, no emoji in titles): Portal, AI Supplements, Storm Leads, CRM, Visualization, Aria AI
- New: 3-step "How it works" section above pricing (Create job → Send portal → Get paid + reviewed)
- Pricing cards: trimmed to 5 bullets max, 12px feature text, cleaner spacing
- Social proof: honest — "Used by roofing contractors across Colorado and growing."
- Demo button: links to /portal/demo (redirect already existed in _redirects → /portal/DEMO2026ROOFINGOS)
- Footer: updated with address (1700 Lincoln St, Denver CO 80203) + 6 links (Plans/Blog/Login/Privacy/Terms/Unsubscribe)
- SMS bubble: SVG chat icon replacing emoji; collapses to icon-only circle on mobile

**100X SEO System (May 27, 2026):**
- Phase 1 (DB): 5 new tables — competitor_pages, seo_location_pages, seo_vs_pages, seo_questions, seo_tools; 50 hail-market cities seeded, 6 VS pages seeded, 5 free tools seeded; GRANT ALL on all tables
- Phase 2 (Edge Function): seo-competitor-hunter v2 deployed — parseSitemap() parses sitemap index + sub-sitemaps, slugToKeyword() extracts keyword from URL slug, scoreGap() 0-17 scoring (+5 high traffic, +4 question-based, +3 competitor mention/how-to/vs, +2 roofing keyword), saves gaps to competitor_pages, queues score≥8 to seo_keyword_queue at intent_score=15
- Phase 3 (VPS): /opt/roofing/seo/content-generator.js — pm2 ID 7, cron 0 5 * * * (11pm MT); TASK 1: 5 location pages/night (Haiku — templated 650 words); TASK 2: 1 VS page/night (Sonnet — 900 words with comparison table); TASK 3: 3 question posts/night via Google Autocomplete; TASK 4: supplement checklist tool (weekly, Sundays — 40 line items, localStorage, value calc); TASK 5: 5 homeowner education posts (weekly, Sundays — Haiku, audience:homeowner); updates sitemap, git commits, sends Telegram digest
- Phase 4 (Landing): roofingos-landing/locations/index.html (50 cities grid, high/medium/low hail badge sections), vs/index.html (6 competitor cards with pricing), tools/index.html (5 tool cards with type badges), homeowners/index.html (homeowner education hub with 6 seed cards)
- Phase 5 (Sitemap): content-generator.js walkDir() auto-discovers all HTML files, sets priority by path: vs=0.9, locations/plans/tools=0.8, blog/homeowners=0.7, others=0.6
- Phase 6 (Dashboard): RoofingSEO.jsx — 6 new stat cards (Location Pages X/50, VS Pages X/6, Competitor Gaps N, Questions Queued N, Free Tools X/5); Content Map tab: location page grid with hail badges + Build buttons, VS page cards with Write Now, tools table, competitor gaps table with priority score + Write Counter, questions queue with Write Now
- CRITICAL MODEL RULES: Haiku (claude-haiku-4-5-20251001) for location pages + questions + homeowner posts. Sonnet (claude-sonnet-4-6) for VS comparison pages only.

**Roofing OS — Job Creation + UX Fixes (May 28, 2026):**
- BUG FIX: `roofing_jobs` RLS INSERT policy was permanently broken — `contractor_auth` table had 0 rows and `contractor_accounts` has no `client_id` column, so every insert silently failed. Replaced with: `contractor_id IN (SELECT id FROM contractor_accounts WHERE owner_email = auth.jwt() ->> 'email')`. Migration: `fix_roofing_jobs_rls_insert`.
- Removed `storm_damage` job type from `RoofingNewJob.jsx` and `RoofingOnboarding.jsx` — new jobs now offer Insurance / Retail / Repair only. Old jobs with `storm_damage` still display via `JOB_TYPE_LABELS` map in KanbanView.
- Kanban rewrite: 4 new columns (New / In Progress / Complete / Review Requested); priority assignment: `review_requested=true` takes top priority, then status-based bucketing; mobile-first single-column list at <768px with colored left border, 4-column grid at ≥768px.
- Domain separation completed: all `app.nexuszc.com` refs removed from roofer-facing pages, landing pages, CORS origins; verify.html redirects to `app.roofingos.dev`; contractor auth flow updated in docs.

**SEO Machine + Sitemap Overhaul (May 28, 2026 — session 2):**
- sitemap-index.xml: removed 5 empty child sitemaps (blog/locations/vs/tools/homeowners all had 0 URLs); now references only sitemap.xml — GSC errors fixed
- sitemap.xml: rebuilt with 58 URLs (added /plans/free, /plans/starter, /plans/pro, /plans/custom, /demo, /demo/contractor, /locations, /vs, /tools, /tools/supplement-checklist, /homeowners and all blog posts dated 2026-05-28)
- RoofingJobDetail.jsx: prominent standalone Measurements CTA card added to Overview tab (before action grid); duplicate 📐 tile removed from action grid; shows "$25", "Order Measurements →", "✓ Measurement Report Ordered" states
- seo-keyword-finder v4: fixed `.catch()` on PromiseLike — Supabase v2 PostgrestFilterBuilder has no `.catch()` method; replaced with `try { await ... } catch {}`
- seo-competitor-hunter v5: same `.catch()` fix applied to all 5 instances (sendTelegram, analyzeCompetitorSitemap upsert, updateVsPagePricing, processCompetitor insert + upsert)
- VPS content-generator: installed `@anthropic-ai/sdk` in `/opt/roofing/seo/` (was missing from package.json); fixed `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SERVICE_KEY` env var name mismatch; process now **online and generating pages** nightly
- VPS seo-publisher: confirmed working — runs at 14:00 UTC daily, publishes approved posts to GitHub, exits after completion ("stopped" in pm2 is correct between runs); published `how-to-track-roofing-insurance-claim` and `storm-damage-roof-lead-generation` on May 28

## SUPABASE V2 — CRITICAL PATTERN (permanent rule)
- `supabase.from(...).insert/update/upsert/delete(...)` returns `PostgrestFilterBuilder` which is `PromiseLike` (has `.then()`) but NOT a full `Promise` (NO `.catch()` method)
- **NEVER write:** `await supabase.from(...).insert({...}).catch(() => {})`
- **ALWAYS write:** `try { await supabase.from(...).insert({...}) } catch {}`
- This has crashed seo-keyword-finder and seo-competitor-hunter — do not repeat

## ROOFING OS — RLS NOTES (critical)
- `roofing_jobs` INSERT/UPDATE/DELETE: policy checks `contractor_id IN (SELECT id FROM contractor_accounts WHERE owner_email = auth.jwt() ->> 'email')`
- `roofing_jobs` SELECT: two permissive policies (`owner_select` = all authenticated, `anon portal read jobs` = all anon) — any logged-in user can SELECT all jobs; filtering happens in application layer
- `contractor_auth` table exists but is empty — do NOT write RLS policies that depend on it

**NEXT:**
1. Re-enable Aria calling — requires: (a) dedup guard in queue processor, (b) max 3 attempts/contact/30 days cap, (c) audit aria-queue-processor for re-queuing loop; then restart hail-trigger + lead-sniper on VPS
2. Add Self-Learning Pattern Recognition
3. Add memory consolidation ability
4. Draft operating agreement for Nexus ZC LLC
5. Delete stale YouTube video YF63mpQB7_g manually via YouTube Studio (OAuth lacks delete scope)
6. Check seo_pillars table — pillars were building in background (waitUntil) after May 26 session
7. Add GOOGLE_SC_CLIENT_EMAIL + GOOGLE_SC_PRIVATE_KEY to Supabase secrets (GSC performance tracker)

---

## TELEGRAM CHANNEL (personal push only)

Telegram is **not** a dashboard or an approval queue. It is a personal push channel for time-sensitive signals that need immediate human attention.

**Rule:** Functions do NOT send Telegram for routine operation results (prospector found leads, community monitor found posts, supplement saved, etc.). Those live in the dashboard at app.nexuszc.com.

**What Telegram sends (10 automatic alerts):**
1. Morning digest (7:30am MT) — whales, email stats, Aria queue, content pending, one priority action
2. Monthly truth (1st of month) — portfolio performance report
3. Briefing (7am MT) — nexus daily brief
4. Whale alert — prospect clicked portal (hot lead, call now)
5. Storm alert — hail event in monitored ZIPs
6. Portal sent — homeowner portal dispatched to new job
7. nexus-core think cycle — strategic insights and flags
8. Auto-fix deployed — code change staged to dev branch
9. Health monitor — critical function errors
10. First job created — contractor's first job (they're live, call to check in)

**What Telegram accepts (6 commands):**
1. Free-form message → brain responds (chat function)
2. `provision: [client]` → spin up new client subdomain
3. `remind [time] [message]` → set a reminder
4. `roofing-outreach now` → run outreach sequencer manually
5. `deploy build [id]` → promote nexus-build dev build to main
6. `approve` → merge dev branch to main (content-based, conflict-proof)

**Everything else → app.nexuszc.com** (Pipeline, Content, Calls, Contractors, System, Community)

---

## MY WORKING PREFERENCES

- **Full file rewrites** over targeted edits -- always
- **No overengineering** -- clean and direct solutions only
- **"Clear and powerful"** -- tools and responses should feel that way
- **Short focused sessions** work best -- don't over-scope a session
- **Late-night sessions carry higher bug risk** -- flag this when relevant
- Commit and push to GitHub after every meaningful change
- Never leave working changes uncommitted at end of session

---

## GIT RULES (Claude Code must follow these every session)

- After every meaningful change: `git commit -am "descriptive message"`
- After every commit: `git push origin main`
- Never end a session with uncommitted working changes
- Always pull before push if remote has diverged: `git pull origin main --rebase`
- Remote: `https://github.com/nexuszc/nexus-zc.git`
- **Never commit to `dev` directly** -- dev is managed by the auto-fix and nexus-build systems

---

## NEXUS-BUILD RULES (enforced in code -- never override)

- nexus-build ONLY writes to dev branch -- never main
- Main branch is only updated via Zach's `deploy build [id]` or `approve` commands
- nexus-build aborts if chat/index.ts would drop below 2000 lines (corruption guard)
- Size guard: abort if modified file output < 85% of original size

---

## SESSION START CHECKLIST

When starting a new Claude Code session, do this in order:
1. Read this file (`CLAUDE.md`)
2. Run `git status` and `git log --oneline -5` to orient
3. Check Supabase Edge Function logs if anything seems broken
4. Ask Zach: "What's the priority this session?"

---

## HOW TO UPDATE THIS FILE

At the end of every significant session, Claude Code should:
1. Update "Current Build Priorities" section
2. Update any decisions that changed
3. Add new key people if introduced
4. Commit: `git commit -am "Update CLAUDE.md -- [session summary]"`
5. Push to GitHub

Zach also dumps session summaries to Nexus via Telegram for persistent memory.
CLAUDE.md = structural context. Nexus = living memory. Both must stay current.
