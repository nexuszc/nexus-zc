# NEXUS ZC Ã¢ÂÂ CLAUDE.md
# Master context file. Read this at the start of every session.
# Last updated: May 10, 2026 — v7

---

## WHO I AM

**Zach Curtis** Ã¢ÂÂ Denver, CO. Multi-venture entrepreneur running a portfolio of businesses
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
Nexus (AI brain Ã¢ÂÂ the product)
VA Company (human delivery layer Ã¢ÂÂ 100+ VAs trained on Nexus)
    Ã¢ÂÂ deployed through vertical channels:
    Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Roofing OS (roofing contractors)
    Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Cash Out Refinances (mortgage/refi)
    Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ [future verticals]
```

Roofing OS and Cash Out Refinances are NOT separate businesses.
They are GTM beachheads Ã¢ÂÂ vertical channels for deploying Nexus + VAs.

**End state:** A system that takes a business owner from zero to fully operational Ã¢ÂÂ
websites, CRMs, outreach, research, SOPs Ã¢ÂÂ with Nexus as the brain and VAs as the hands.
Then productized and sold to other multi-business operators.

### What a real COO does (what Nexus must do):
1. Maintains state on every initiative Ã¢ÂÂ status, next step, blocker, owner
2. Allocates attention Ã¢ÂÂ tells me where to focus THIS week vs. delegate/drop
3. Surfaces problems early Ã¢ÂÂ notices silence, slipping commitments, conflicts
4. Drives accountability Ã¢ÂÂ "You said you'd call Mike Tuesday. It's Wednesday."
5. Synthesizes patterns Ã¢ÂÂ "You keep deferring decisions on X. Want to talk about why?"

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Database | Supabase (Postgres + pgvector) |
| Project ref | `koqpbnxkhgbsnbdjwldx.supabase.co` |
| Region | eu-central-1 |
| AI Ã¢ÂÂ responses | Claude Sonnet 4.5 (`claude-sonnet-4-5`) |
| AI Ã¢ÂÂ embeddings | OpenAI text-embedding-3-small |
| Capture | Telegram bot `@nexuszc_bot` |
| Brain browser | `/Users/zachdaniels/Documents/NEXUS/nexus-brain.html` |
| Edge Functions | Supabase Edge Runtime (Deno), all deployed `--no-verify-jwt` |
| Frontend | React 18 + Vite + Tailwind v3, hosted on Cloudflare Pages |
| Domain | nexuszc.com (Cloudflare) Ã¢ÂÂ app.nexuszc.com, [client].nexuszc.com |
| Email | zach@nexuszc.com / brain@nexuszc.com (Google Workspace) |
| Web search | Serper.dev (SERPER_API_KEY set in Supabase secrets) |
| Repo | github.com/nexuszc/nexus-zc |
| Local path | `/Users/zachdaniels/Documents/NEXUS` |

### Git Branch Structure:
- `main` Ã¢ÂÂ production (Cloudflare Pages deploys from here)
- `dev` Ã¢ÂÂ staging (auto-fix and nexus-builder commit here; approve to merge to main)
- **Rule:** auto-fix always syncs dev to main before writing, then commits fix to dev
- **Rule:** `approve` command does a content-based merge (reads files from dev, writes to main Ã¢ÂÂ conflict-proof)
- **Rule:** nexus-builder commits to dev only. Only Zach's `approve` command writes to main.

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
| `nexus-agent` | Legacy agent loop (superseded by nexus-core) | Deprecated |
| `nexus-build` | Consolidated builder: manifest → build → test → stage → notify | On demand (telegram, nexus-core, VPS) |
| `nexus-builder` | Legacy builder (superseded by nexus-build) | Deprecated |
| `nexus-coo` | COO intelligence: focus, stale_check, momentum_check, health_score | Called by chat + health-monitor |
| `nexus-core` | Consolidated brain: observe, think, act, reflect — every 30 min | Cron (every 30 min) + VPS + manual |
| `nexus-execute` | Legacy executor (superseded by nexus-build) | Deprecated |
| `nexus-research` | Legacy research loop (absorbed into nexus-core + VPS) | Deprecated |
| `process-email-queue` | Batch process email queue | Cron |
| `provision` | Spin up client subdomain + Claude-generated site | chat provision: command or web UI |
| `reclassify` | Re-run classification on existing entries | On demand |
| `refresh-assessments` | Refresh project assessment scores | On demand |
| `reminders` | Fire due reminders via Telegram | Every 5 min cron (job ID 2) |
| `roofing-ai` | Roofing AI actions: estimate, contract, invoice, timeline, supplement_request | Internal |
| `roofing-notify` | SMS (Twilio) + email (Resend) dispatcher for all roofing events | Internal |
| `roofing-payments` | Stripe payment intent creation + payment confirmation | Internal |
| `send-email` | Send email via Resend | Internal |
| `synthesize-portfolio` | Generate portfolio-level synthesis and insights | On demand |
| `telegram` | Webhook: immediate 200 ACK, processes in waitUntil | Telegram push |

---

## DATABASE TABLES (key tables)

### Core brain:
- `entries` Ã¢ÂÂ all thoughts, classified with type/importance/tags/project_names/people_names/task_status/client_id
- `conversations` Ã¢ÂÂ conversation threads by channel
- `channel_conversations` Ã¢ÂÂ maps external IDs (Telegram chat IDs) to conversations
- `embeddings` Ã¢ÂÂ pgvector embeddings for semantic search
- `projects` Ã¢ÂÂ ventures and ideas (categories: platform, vertical, personal, external, idea, archived)
- `people` Ã¢ÂÂ named people extracted from entries
- `reminders` Ã¢ÂÂ scheduled Telegram reminders (fire_at, fired, chat_id, message)

### Multi-tenant client layer:
- `clients` Ã¢ÂÂ client records (name, deal_type, status, monthly_fee, rev_share_pct, slug, provision_status, site_url)
- `client_context` Ã¢ÂÂ per-client brain context (core_offer, goals, target_audience, script, pain_points)
- `va_assignments` Ã¢ÂÂ which VA is assigned to which client

### Self-aware system:
- `nexus_health` Ã¢ÂÂ hourly function health snapshots (error_count, success_count, avg_response_ms, status)
- `nexus_improvements` Ã¢ÂÂ improvement queue (title, problem, recommended_fix, priority, status, auto_fix_code, files_changed, dev_commit_sha)
- `nexus_usage` Ã¢ÂÂ ability usage analytics (ability, success, response_ms, channel)
- `nexus_alerts` Ã¢ÂÂ instant alerts log (alert_type, message, resolved)
- `platform_insights` Ã¢ÂÂ cross-client pattern observations

### Brian's lead system:
- `leads` Ã¢ÂÂ lead records linked to client_id
- `sequences` Ã¢ÂÂ email/call sequences
- `sequence_enrollments` Ã¢ÂÂ lead Ã¢ÂÂ sequence enrollment state

### V2 additions:
- `generated_docs` Ã¢ÂÂ documents from generate-* abilities (type, client_id, title, content, created_at)
- `knowledge_base` Ã¢ÂÂ persistent knowledge store (topic, content, source_url, created_at)
- `va_profiles` Ã¢ÂÂ VA accounts linked to Supabase auth user_id
- `va_task_queues` Ã¢ÂÂ daily VA task lists (va_assignment_id, date, tasks JSON, completed_count)
- `call_logs` Ã¢ÂÂ structured VA call records (lead_id, outcome, notes, va_profile_id)
- `client_portal_access` Ã¢ÂÂ token-based portal access (client_id, access_token, last_accessed)
- `invoice_sequence` Ã¢ÂÂ auto-incrementing invoice counter (last_number, produces INV-YYYY-XXXX)
- `known_failure_patterns` Ã¢ÂÂ 6 seeded error patterns with auto-fix strategies for health-monitor
- `weekly_reports` Ã¢ÂÂ weekly self-improvement reports (Sunday 13:00 UTC, also surfaced in Monday brief)
- `nexus_improvements` (new columns: fix_confidence, fix_verified, fix_verified_at, post_fix_error_count, rollback_triggered)

### V4 Autonomous Engine additions:
- `nexus_audit_log` Ã¢ÂÂ permanent log of every autonomous action ever taken
- `nexus_decisions` Ã¢ÂÂ decision log with outcome tracking for learning
- `nexus_ability_proposals` Ã¢ÂÂ self-generated ability proposals lifecycle
- `nexus_research_findings` Ã¢ÂÂ all web research findings saved permanently
- `nexus_action_queue` Ã¢ÂÂ actions pending 1-tap approval
- `nexus_agent_cycles` Ã¢ÂÂ record of every agent run
- `nexus_preferences` Ã¢ÂÂ learned preference model (6 seeds: approval thresholds, comms style, focus areas)

### V5 Build System additions:
- `nexus_build_manifests` Ã¢ÂÂ structured build plans with test results (goal, files_to_create, files_to_modify, db_migrations, tests, status, dev_commit_sha, main_commit_sha)
- `nexus_reflections` Ã¢ÂÂ what Nexus learned each cycle (cycle_number, observation, insight, action_taken, learned)
- `nexus_self_improvements` Ã¢ÂÂ self-identified improvement queue (title, problem, proposed_solution, improvement_type, complexity, directive_priority, status)

### V3 COO additions:
- `voice_memos` Ã¢ÂÂ Telegram voice messages (telegram_file_id, transcript, classified_as, entry_id, duration_seconds)
- `contradiction_log` Ã¢ÂÂ detected contradictions (entry_id_new, entry_id_existing, topic, new_claim, existing_claim, resolved)
- `focus_sessions` Ã¢ÂÂ focus command results (top_priorities, context_snapshot, created_at)
- `stale_alerts` Ã¢ÂÂ stale client alerts deduplication (client_id, days_inactive, alerted_at, dismissed)
- `projects` (new columns: last_update_at, momentum_status, next_milestone, owner)
- `clients` (new columns: health_score, health_updated_at, last_activity_at)

### Project categories:
- `platform` Ã¢ÂÂ core businesses (Nexus, VA Company)
- `vertical` Ã¢ÂÂ GTM channels (Roofing OS, Cash Out Refinances)
- `personal` Ã¢ÂÂ personal investments (Water Station)
- `external` Ã¢ÂÂ things Zach contributes to but doesn't drive (Bora)
- `idea` Ã¢ÂÂ loose ideas not yet committed
- `archived` Ã¢ÂÂ dead or paused

---

## FULL TELEGRAM COMMAND REFERENCE

### Brain / Memory:
- `[anything]` Ã¢ÂÂ captures to memory, classifies, responds as Chief of Staff
- `task: [what]` Ã¢ÂÂ logs an open task
- `done: [partial match]` Ã¢ÂÂ marks matching task done
- `done all` Ã¢ÂÂ clears all open tasks

### Abilities Ã¢ÂÂ Original:
- `search: [query]` Ã¢ÂÂ web search via Serper
- `research: [name/topic]` Ã¢ÂÂ deep intelligence brief (2x searches + synthesis)
- `summarize: [url]` Ã¢ÂÂ fetch and summarize any webpage
- `competitors: [market]` Ã¢ÂÂ competitive landscape analysis
- `draft email: [to] | subject: [x] | about: [x]` Ã¢ÂÂ draft email
- `send email: [to] | subject: [x] | body: [x]` Ã¢ÂÂ send via Gmail (requires Gmail secrets)
- `generate proposal: [client] | for: [details]`
- `generate script: [client] | objective: [x]`
- `generate report: [client] | for: [details]`
- `generate onepager: [topic]`
- `remind me: [what] | in: [2 hours / 3 days]`
- `report: [client]` Ã¢ÂÂ full client status report

### Abilities Ã¢ÂÂ V2 (Tier 1: Client Intelligence):
- `client snapshot: [name]` Ã¢ÂÂ full client status: context, leads, calls, entries, open tasks
- `prioritize tasks` Ã¢ÂÂ Claude sorts all open tasks by urgency ÃÂ impact
- `task estimate: [task description]` Ã¢ÂÂ time/effort estimate + breakdown
- `sprint plan: [timeframe]` Ã¢ÂÂ sprint plan from open tasks + client obligations

### Abilities Ã¢ÂÂ V2 (Tier 2: Document Generation, saved to generated_docs):
- `generate invoice: [client] | for: [services] | amount: [x]`
- `generate contract: [client] | for: [scope] | amount: [x]`
- `follow up: [name/topic]` Ã¢ÂÂ draft follow-up based on conversation history
- `weekly digest: [optional focus]` Ã¢ÂÂ 7-day summary saved to generated_docs
- `status update: [project/client]` Ã¢ÂÂ status report from entries + open tasks
- `generate sop: [process name]` Ã¢ÂÂ full SOP document

### Abilities Ã¢ÂÂ V2 (Tier 3: Sales & Marketing, saved to generated_docs):
- `generate pitch: [client/prospect] | for: [context]`
- `generate case study: [client]` Ã¢ÂÂ pulls call/lead data for social proof
- `generate ad copy: [product/service] | audience: [x] | goal: [x]`
- `calculate roi: [project] | revenue: [x] | cost: [x]`
- `pricing calculator: [service] | hours: [x] | overhead: [x] | margin: [x]`

### Abilities Ã¢ÂÂ V2 (Tier 4: Knowledge Base):
- `save knowledge: [topic] | [content]` Ã¢ÂÂ save to knowledge_base table
- `recall knowledge: [topic]` Ã¢ÂÂ search knowledge_base
- `learn from: [url]` Ã¢ÂÂ fetch URL, extract key insights, save to knowledge_base
- `nexus brain dump` Ã¢ÂÂ dump knowledge_base + recent entries + clients + open tasks

### Client management:
- `new client: [name]` Ã¢ÂÂ create client brain
- `client context: [name] | deal: [type] | offer: [x] | goals: [x]` Ã¢ÂÂ set context
- `assign va: [client] | va: [name]`
- `provision: [name] | type: [business type] | about: [description]` Ã¢ÂÂ spin up client site

### Autonomous Engine Commands (v4 + v5):
- `pending` / `pending actions` / `queue` Ã¢ÂÂ show all actions and abilities awaiting approval
- `approve action [id]` Ã¢ÂÂ approve a queued autonomous action
- `reject action [id]` Ã¢ÂÂ reject a queued action
- `approve ability [id]` Ã¢ÂÂ approve building a new ability (or deploy if testing)
- `reject ability [id]` Ã¢ÂÂ reject an ability proposal
- `audit` / `audit log` / `audit last [n]` Ã¢ÂÂ view autonomous action audit log
- `research now` / `nexus research` Ã¢ÂÂ trigger immediate research cycle
- `agent now` / `nexus agent` / `run agent` Ã¢ÂÂ trigger nexus-core cycle (replaces old nexus-agent)
- `abilities` / `show abilities` Ã¢ÂÂ list all self-built abilities and their status
- `build: [instruction]` Ã¢ÂÂ trigger nexus-build with plain English instruction
- `deploy build [id]` Ã¢ÂÂ deploy a staged build to production (main branch)
- `discard build [id]` Ã¢ÂÂ discard a staged build
- `builds` / `build status` Ã¢ÂÂ see recent build status
- `improvements` / `self improvements` Ã¢ÂÂ see what Nexus wants to improve about itself
- `core now` / `nexus core` Ã¢ÂÂ trigger immediate nexus-core cycle
- `reflections` / `what did you learn` Ã¢ÂÂ see what Nexus has learned from recent cycles

### COO Commands (new in v3):
- `focus` / `what should i focus on` / `focus now` Ã¢ÂÂ top 3 priorities right now (fetches tasks, clients, projects, recent entries)
- `stale check` / `who needs attention` Ã¢ÂÂ clients with no activity 5+ days
- `momentum` / `project momentum` Ã¢ÂÂ projects with no update 7+ days
- `health scores` / `client health` Ã¢ÂÂ all client health scores (50 baseline + activity + calls - open tasks)
- `project update: [name] | [milestone]` Ã¢ÂÂ log progress on a project
- `contradictions` / `show contradictions` Ã¢ÂÂ unresolved contradictions in your brain
- Voice memos Ã¢ÂÂ send voice messages via Telegram, auto-transcribed via Whisper Ã¢ÂÂ classified + saved

### System:
- `nexus status` Ã¢ÂÂ what's in dev, improvement queue, function health
- `nexus audit` Ã¢ÂÂ comprehensive self-assessment with health score (0-100)
- `nexus heal` Ã¢ÂÂ trigger health-monitor immediately (on-demand self-heal cycle)
- `approve` Ã¢ÂÂ merge current dev improvement to main (content-based, conflict-proof) + schedules 1hr verification reminder
- `reject` Ã¢ÂÂ discard dev improvement, reset dev to main

---

## THE SELF-HEALING LOOP (live as of May 8, 2026)

```
Every hour (pg_cron job 3):
  health-monitor runs
    Ã¢ÂÂ checks all function health (nexus_usage data)
    Ã¢ÂÂ analyzes ability usage patterns (last 7 days)
    Ã¢ÂÂ Claude identifies top 3 improvements
    Ã¢ÂÂ sends instant alert if any function has >3 errors/hour
    Ã¢ÂÂ triggers auto-fix for top pending improvement (max 1/hour)

auto-fix runs (fire-and-forget):
    Ã¢ÂÂ syncs dev branch to main (force-reset)
    Ã¢ÂÂ reads target file from GitHub main
    Ã¢ÂÂ Claude writes minimal surgical fix
    Ã¢ÂÂ commits fixed file to dev branch
    Ã¢ÂÂ sends Telegram: "Fix ready Ã¢ÂÂ approve or reject"

You reply "approve":
    Ã¢ÂÂ reads changed files from dev, writes directly to main
    Ã¢ÂÂ no git merge (conflict-proof)
    Ã¢ÂÂ Cloudflare deploys in ~60 seconds
    Ã¢ÂÂ improvement marked live

You reply "reject":
    Ã¢ÂÂ dev branch force-reset to main
    Ã¢ÂÂ improvement marked rejected
    Ã¢ÂÂ health-monitor tries next improvement next cycle
```

---

## CURRENT PORTFOLIO

### Platform (building):
- **Nexus** Ã¢ÂÂ the brain/product (this system)
- **VA Company** Ã¢ÂÂ human delivery layer, Sam is the sales lead

### Verticals (GTM channels, paused while platform is built):
- **Roofing OS** Ã¢ÂÂ roofing contractor channel
- **Cash Out Refinances** Ã¢ÂÂ mortgage/refi channel

### Personal:
- **Water Station** Ã¢ÂÂ investment, needs an app then runs itself

### External:
- **Bora** Ã¢ÂÂ contributor not driver

---

## KEY PEOPLE

- **Sam** Ã¢ÂÂ VA Company sales lead. Calls leads, closes clients. Not yet fluent in pitching Nexus as a standalone product. Needs Nexus to be undeniable before she can sell it.
- **Kristine** Ã¢ÂÂ VA onboarding. Manages VA sourcing and deployment.
- **Brian** Ã¢ÂÂ Anchor client. Reverse mortgage calling, rev share model. Also considering VA bodies for his operation. Brian is Sam's training ground Ã¢ÂÂ when she sees Nexus work for Brian, she can pitch it.
- **Jesse** Ã¢ÂÂ Part of cash-out refi deal. Referred Brian.
- **Kevin Cantwell** Ã¢ÂÂ Runs HireSuccess.com (25-year-old pre-employment testing SaaS, 2,000+ customers, 4.9 Capterra). Wants AI upgrade + packaging for acquisition. Potential $15-25K project fee OR 2-3% success fee on acquisition. Warm lead, needs dedicated scoping call.

---

## STRATEGIC DECISIONS (LOCKED)

1. **Nexus is the product. VAs are one execution mechanism.** Long-term: sell Nexus with VAs optional. Short-term: sell VAs, include Nexus for anchor clients.

2. **Nexus mandatory pricing trigger:** When Sam can independently pitch the Nexus value prop in 60 seconds and feel good defending the price. Not date-based Ã¢ÂÂ capability-based.

3. **Every Nexus build decision passes this test:** "Does this make Sam more confident pitching it?"

4. **Brian-first build sequence:** Ship Brian's lead system before building platform features. Design DB/code so platform wrap is additive, not a rewrite.

5. **VA + Nexus decoupled for now:** Clients can buy either separately. Brian/Jesse/Kevin get Nexus included, not as a separate line item.

6. **$250/mo** established as Nexus floor price for future clients.

7. **Build stack:** Stay on Supabase + React/Vite for now. No Next.js until platform actually needs it.

8. **VA call logging:** Web form (not Telegram) for structured data.

9. **Self-improvement approval gate:** Every auto-generated fix must be approved by Zach before going to production. No autonomous deploys.

---

## CURRENT BUILD PRIORITIES (as of May 10, 2026)

**DONE this session:**
- (nothing yet this session)

**NEXT:**
1. Build complete Roofing OS go-to-market system with public landing page
2. Draft complete operating agreement for Nexus ZC LLC (single member LLC)
3. Improve Brian's client health score from 65 to 80+ through proactive engagement
4. Add ability usage analytics and performance tracking system
5. Implement A-Z task handling automation framework
6. Create future feature request storage and retrieval system
7. Develop continuous Roofing OS building workflow and checkpoints
8. Establish client health monitoring alerts and intervention protocols

---

## MY WORKING PREFERENCES

- **Full file rewrites** over targeted edits Ã¢ÂÂ always
- **No overengineering** Ã¢ÂÂ clean and direct solutions only
- **"Clear and powerful"** Ã¢ÂÂ tools and responses should feel that way
- **Short focused sessions** work best Ã¢ÂÂ don't over-scope a session
- **Late-night sessions carry higher bug risk** Ã¢ÂÂ flag this when relevant
- Commit and push to GitHub after every meaningful change
- Never leave working changes uncommitted at end of session

---

## GIT RULES (Claude Code must follow these every session)

- After every meaningful change: `git commit -am "descriptive message"`
- After every commit: `git push origin main`
- Never end a session with uncommitted working changes
- Always pull before push if remote has diverged: `git pull origin main --rebase`
- Remote: `https://github.com/nexuszc/nexus-zc.git`
- **Never commit to `dev` directly** Ã¢ÂÂ dev is managed by the auto-fix and nexus-builder systems

---

## NEXUS-BUILD RULES (enforced in code Ã¢ÂÂ never override)

- nexus-build ONLY writes to dev branch Ã¢ÂÂ never main
- Main branch is only updated via Zach's `deploy build [id]` or `approve` commands
- nexus-build aborts if chat/index.ts would drop below 2000 lines (corruption guard)
- Size guard: abort if modified file output < 85% of original size
- Test gate: every build runs automated tests before staging
- `approve all` is capped at 5 abilities per call
- One build per nexus-core cycle maximum
- Every build goes through: planning Ã¢ÂÂ building Ã¢ÂÂ testing Ã¢ÂÂ staged (dev) Ã¢ÂÂ Zach deploys Ã¢ÂÂ deployed (main)

---

## VPS (Hostinger Phoenix Ã¢ÂÂ 31.220.60.77)

- Worker: `/root/nexus-worker/index.js` (PM2, auto-restart on crash)
- **Core cycle:** every 30 min Ã¢ÂÂ triggers nexus-core
- **Reflection cycle:** every 30 min (offset 15 min) Ã¢ÂÂ decides whether to trigger builds
- **Research cycle:** every 6 hours Ã¢ÂÂ web research + saves to knowledge_base
- SSH: `ssh root@31.220.60.77`
- Logs: `pm2 logs nexus-worker`
- Restart: `pm2 restart nexus-worker && pm2 save`

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
4. Add new Edge Functions or commands to the reference tables
5. Commit: `git commit -am "Update CLAUDE.md Ã¢ÂÂ [session summary]"`
6. Push to GitHub

Zach also dumps session summaries to Nexus via Telegram for persistent memory.
CLAUDE.md = structural context. Nexus = living memory. Both must stay current.
