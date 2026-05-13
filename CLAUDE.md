# NEXUS ZC -- CLAUDE.md
# Master context file. Read this at the start of every session.
# Last updated: May 13, 2026 — v8

---

## WHO I AM

**Zach Curtis** -- Denver, CO. Multi-venture entrepreneur running a portfolio of businesses
generating ~$1M/year in revenue. I operate as my own CEO/COO across all ventures.
I am building Nexus to replace myself as COO and eventually productize it.

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

## EDGE FUNCTIONS (all live, all deployed `--no-verify-jwt`)

| Function | Purpose | Trigger |
|----------|---------|---------|
| `assess-project` | Run AI assessment on a project | On demand |
| `auto-fix` | Read code from GitHub → Claude writes fix → commit to dev → notify | Called by health-monitor |
| `brain-api` | REST API for brain browser access | GET/POST from nexus-brain.html |
| `briefing` | Morning brief at 7am MT (13:00 UTC) via pg_cron | Daily cron (job ID 1) |
| `chat` | Core brain: classify → retrieve → Claude → respond | POST from Telegram webhook or web |
| `contractor-auth` | Contractor magic link invite + session lookup | Internal |
| `email-webhook` | Inbound email handling | Resend webhook |
| `generate-queue` | Generate lead call queue | On demand |
| `generate-va-tasks` | Generate daily VA task lists | Cron / on demand |
| `get-dashboard-stats` | Aggregate stats for React dashboard | API call from frontend |
| `health-monitor` | Hourly health check, identify improvements, trigger auto-fix | Every hour cron (job ID 3) |
| `import-leads` | Bulk import leads from CSV or external source | On demand |
| `log-call` | VA logs call outcome + auto-enrolls lead sequences | VA web form |
| `nexus-build` | Consolidated builder: manifest → build → test → stage → notify | On demand (telegram, nexus-core, VPS) |
| `nexus-coo` | COO intelligence: focus, stale_check, momentum_check, health_score | Called by chat + health-monitor |
| `nexus-core` | Consolidated brain: observe, think, act, reflect — every 30 min | Cron (every 30 min) + VPS + manual |
| `nexus-diagnostic` | See function source for details | Internal |
| `nexus-follow-up` | See function source for details | Internal |
| `nexus-intake` | See function source for details | Internal |
| `nexus-quick-scan` | See function source for details | Internal |
| `nexus-router` | See function source for details | Internal |
| `nexus-self-build` | See function source for details | Internal |
| `nexus-unsubscribe` | See function source for details | Internal |
| `nexus-voice` | See function source for details | Internal |
| `process-email-queue` | Batch process email queue | Cron |
| `provision` | Spin up client subdomain + Claude-generated site | chat provision: command or web UI |
| `reclassify` | Re-run classification on existing entries | On demand |
| `refresh-assessments` | Refresh project assessment scores | On demand |
| `reminders` | See function source for details | Internal |
| `roofing-ai` | Roofing AI actions: estimate, contract, invoice, timeline, supplement_request | Internal |
| `roofing-closer` | See function source for details | Internal |
| `roofing-notify` | SMS (Twilio) + email (Resend) dispatcher for all roofing events | Internal |
| `roofing-outreach` | See function source for details | Internal |
| `roofing-payments` | Stripe payment intent creation + payment confirmation | Internal |
| `roofing-product-monitor` | See function source for details | Internal |
| `roofing-prospector` | See function source for details | Internal |
| `send-email` | Send email via Resend | Internal |
| `synthesize-portfolio` | Generate portfolio-level synthesis and insights | On demand |
| `telegram` | Webhook: immediate 200 ACK, processes in waitUntil | Telegram push |

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

## CURRENT BUILD PRIORITIES (as of May 13, 2026)

**DONE this session:**
- (nothing yet this session)

**NEXT:**
1. Fix smoke_test_failed error (PENDING SELF-IMPROVEMENT - simple)
2. Add memory consolidation ability (PENDING SELF-IMPROVEMENT - medium)
3. Add Structured Self-Reflection Capability (PENDING SELF-IMPROVEMENT - medium)
4. Add ability usage analytics and performance tracking (PENDING SELF-IMPROVEMENT - medium)
5. Add conversation memory persistence (PENDING SELF-IMPROVEMENT - medium)
6. Improve health for Denver Pro Roofing client (health: 50 - needs attention)
7. Draft complete operating agreement for Nexus ZC LLC
8. Build complete Roofing OS go-to-market system with public landing page

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
