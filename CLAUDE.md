# NEXUS ZC — CLAUDE.md
# Master context file. Read this at the start of every session.
# Last updated: May 8, 2026 — v4

---

## WHO I AM

**Zach Curtis** — Denver, CO. Multi-venture entrepreneur running a portfolio of businesses
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
Nexus (AI brain — the product)
VA Company (human delivery layer — 100+ VAs trained on Nexus)
    ↓ deployed through vertical channels:
    ├── Roofing OS (roofing contractors)
    ├── Cash Out Refinances (mortgage/refi)
    └── [future verticals]
```

Roofing OS and Cash Out Refinances are NOT separate businesses.
They are GTM beachheads — vertical channels for deploying Nexus + VAs.

**End state:** A system that takes a business owner from zero to fully operational —
websites, CRMs, outreach, research, SOPs — with Nexus as the brain and VAs as the hands.
Then productized and sold to other multi-business operators.

### What a real COO does (what Nexus must do):
1. Maintains state on every initiative — status, next step, blocker, owner
2. Allocates attention — tells me where to focus THIS week vs. delegate/drop
3. Surfaces problems early — notices silence, slipping commitments, conflicts
4. Drives accountability — "You said you'd call Mike Tuesday. It's Wednesday."
5. Synthesizes patterns — "You keep deferring decisions on X. Want to talk about why?"

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Database | Supabase (Postgres + pgvector) |
| Project ref | `koqpbnxkhgbsnbdjwldx.supabase.co` |
| Region | eu-central-1 |
| AI — responses | Claude Sonnet 4.5 (`claude-sonnet-4-5`) |
| AI — embeddings | OpenAI text-embedding-3-small |
| Capture | Telegram bot `@nexuszc_bot` |
| Brain browser | `/Users/zachdaniels/Documents/NEXUS/nexus-brain.html` |
| Edge Functions | Supabase Edge Runtime (Deno), all deployed `--no-verify-jwt` |
| Frontend | React 18 + Vite + Tailwind v3, hosted on Cloudflare Pages |
| Domain | nexuszc.com (Cloudflare) — app.nexuszc.com, [client].nexuszc.com |
| Email | zach@nexuszc.com / brain@nexuszc.com (Google Workspace) |
| Web search | Serper.dev (SERPER_API_KEY set in Supabase secrets) |
| Repo | github.com/nexuszc/nexus-zc |
| Local path | `/Users/zachdaniels/Documents/NEXUS` |

### Git Branch Structure:
- `main` — production (Cloudflare Pages deploys from here)
- `dev` — staging (auto-fix commits here; approve to merge to main)
- **Rule:** auto-fix always syncs dev to main before writing, then commits fix to dev
- **Rule:** `approve` command does a content-based merge (reads files from dev, writes to main — conflict-proof)

---

## EDGE FUNCTIONS (all live, all deployed `--no-verify-jwt`)

| Function | Purpose | Trigger |
|----------|---------|---------|
| `chat` | Core brain: classify → retrieve → Claude → respond | POST from Telegram webhook or web |
| `telegram` | Webhook: immediate 200 ACK, processes in waitUntil | Telegram push |
| `briefing` | Morning brief at 7am MT (13:00 UTC) via pg_cron | Daily cron (job ID 1) |
| `reminders` | Fire due reminders via Telegram | Every 5 min cron (job ID 2) |
| `provision` | Spin up client subdomain + Claude-generated site | chat `provision:` command or web UI |
| `health-monitor` | Hourly health check, identify improvements, trigger auto-fix | Every hour cron (job ID 3) |
| `auto-fix` | Read code from GitHub → Claude writes fix → commit to dev → notify | Called by health-monitor |
| `send-email` | Send email via Resend | Internal |
| `email-webhook` | Inbound email handling | Resend webhook |
| `process-email-queue` | Batch process email queue | Cron |
| `generate-queue` | Generate lead call queue | On demand |
| `log-call` | VA logs call outcome + auto-enrolls lead sequences | VA web form |

---

## DATABASE TABLES (key tables)

### Core brain:
- `entries` — all thoughts, classified with type/importance/tags/project_names/people_names/task_status/client_id
- `conversations` — conversation threads by channel
- `channel_conversations` — maps external IDs (Telegram chat IDs) to conversations
- `embeddings` — pgvector embeddings for semantic search
- `projects` — ventures and ideas (categories: platform, vertical, personal, external, idea, archived)
- `people` — named people extracted from entries
- `reminders` — scheduled Telegram reminders (fire_at, fired, chat_id, message)

### Multi-tenant client layer:
- `clients` — client records (name, deal_type, status, monthly_fee, rev_share_pct, slug, provision_status, site_url)
- `client_context` — per-client brain context (core_offer, goals, target_audience, script, pain_points)
- `va_assignments` — which VA is assigned to which client

### Self-aware system:
- `nexus_health` — hourly function health snapshots (error_count, success_count, avg_response_ms, status)
- `nexus_improvements` — improvement queue (title, problem, recommended_fix, priority, status, auto_fix_code, files_changed, dev_commit_sha)
- `nexus_usage` — ability usage analytics (ability, success, response_ms, channel)
- `nexus_alerts` — instant alerts log (alert_type, message, resolved)
- `platform_insights` — cross-client pattern observations

### Brian's lead system:
- `leads` — lead records linked to client_id
- `sequences` — email/call sequences
- `sequence_enrollments` — lead → sequence enrollment state

### V2 additions:
- `generated_docs` — documents from generate-* abilities (type, client_id, title, content, created_at)
- `knowledge_base` — persistent knowledge store (topic, content, source_url, created_at)
- `va_profiles` — VA accounts linked to Supabase auth user_id
- `va_task_queues` — daily VA task lists (va_assignment_id, date, tasks JSON, completed_count)
- `call_logs` — structured VA call records (lead_id, outcome, notes, va_profile_id)
- `client_portal_access` — token-based portal access (client_id, access_token, last_accessed)

### Project categories:
- `platform` — core businesses (Nexus, VA Company)
- `vertical` — GTM channels (Roofing OS, Cash Out Refinances)
- `personal` — personal investments (Water Station)
- `external` — things Zach contributes to but doesn't drive (Bora)
- `idea` — loose ideas not yet committed
- `archived` — dead or paused

---

## FULL TELEGRAM COMMAND REFERENCE

### Brain / Memory:
- `[anything]` — captures to memory, classifies, responds as Chief of Staff
- `task: [what]` — logs an open task
- `done: [partial match]` — marks matching task done
- `done all` — clears all open tasks

### Abilities — Original:
- `search: [query]` — web search via Serper
- `research: [name/topic]` — deep intelligence brief (2x searches + synthesis)
- `summarize: [url]` — fetch and summarize any webpage
- `competitors: [market]` — competitive landscape analysis
- `draft email: [to] | subject: [x] | about: [x]` — draft email
- `send email: [to] | subject: [x] | body: [x]` — send via Gmail (requires Gmail secrets)
- `generate proposal: [client] | for: [details]`
- `generate script: [client] | objective: [x]`
- `generate report: [client] | for: [details]`
- `generate onepager: [topic]`
- `remind me: [what] | in: [2 hours / 3 days]`
- `report: [client]` — full client status report

### Abilities — V2 (Tier 1: Client Intelligence):
- `client snapshot: [name]` — full client status: context, leads, calls, entries, open tasks
- `prioritize tasks` — Claude sorts all open tasks by urgency × impact
- `task estimate: [task description]` — time/effort estimate + breakdown
- `sprint plan: [timeframe]` — sprint plan from open tasks + client obligations

### Abilities — V2 (Tier 2: Document Generation, saved to generated_docs):
- `generate invoice: [client] | for: [services] | amount: [x]`
- `generate contract: [client] | for: [scope] | amount: [x]`
- `follow up: [name/topic]` — draft follow-up based on conversation history
- `weekly digest: [optional focus]` — 7-day summary saved to generated_docs
- `status update: [project/client]` — status report from entries + open tasks
- `generate sop: [process name]` — full SOP document

### Abilities — V2 (Tier 3: Sales & Marketing, saved to generated_docs):
- `generate pitch: [client/prospect] | for: [context]`
- `generate case study: [client]` — pulls call/lead data for social proof
- `generate ad copy: [product/service] | audience: [x] | goal: [x]`
- `calculate roi: [project] | revenue: [x] | cost: [x]`
- `pricing calculator: [service] | hours: [x] | overhead: [x] | margin: [x]`

### Abilities — V2 (Tier 4: Knowledge Base):
- `save knowledge: [topic] | [content]` — save to knowledge_base table
- `recall knowledge: [topic]` — search knowledge_base
- `learn from: [url]` — fetch URL, extract key insights, save to knowledge_base
- `nexus brain dump` — dump knowledge_base + recent entries + clients + open tasks

### Client management:
- `new client: [name]` — create client brain
- `client context: [name] | deal: [type] | offer: [x] | goals: [x]` — set context
- `assign va: [client] | va: [name]`
- `provision: [name] | type: [business type] | about: [description]` — spin up client site

### System:
- `nexus status` — what's in dev, improvement queue, function health
- `nexus audit` — comprehensive self-assessment with health score (0-100)
- `approve` — merge current dev improvement to main (content-based, conflict-proof)
- `reject` — discard dev improvement, reset dev to main

---

## THE SELF-HEALING LOOP (live as of May 8, 2026)

```
Every hour (pg_cron job 3):
  health-monitor runs
    → checks all function health (nexus_usage data)
    → analyzes ability usage patterns (last 7 days)
    → Claude identifies top 3 improvements
    → sends instant alert if any function has >3 errors/hour
    → triggers auto-fix for top pending improvement (max 1/hour)

auto-fix runs (fire-and-forget):
    → syncs dev branch to main (force-reset)
    → reads target file from GitHub main
    → Claude writes minimal surgical fix
    → commits fixed file to dev branch
    → sends Telegram: "Fix ready — approve or reject"

You reply "approve":
    → reads changed files from dev, writes directly to main
    → no git merge (conflict-proof)
    → Cloudflare deploys in ~60 seconds
    → improvement marked live

You reply "reject":
    → dev branch force-reset to main
    → improvement marked rejected
    → health-monitor tries next improvement next cycle
```

---

## CURRENT PORTFOLIO

### Platform (building):
- **Nexus** — the brain/product (this system)
- **VA Company** — human delivery layer, Sam is the sales lead

### Verticals (GTM channels, paused while platform is built):
- **Roofing OS** — roofing contractor channel
- **Cash Out Refinances** — mortgage/refi channel

### Personal:
- **Water Station** — investment, needs an app then runs itself

### External:
- **Bora** — contributor not driver

---

## KEY PEOPLE

- **Sam** — VA Company sales lead. Calls leads, closes clients. Not yet fluent in pitching Nexus as a standalone product. Needs Nexus to be undeniable before she can sell it.
- **Kristine** — VA onboarding. Manages VA sourcing and deployment.
- **Brian** — Anchor client. Reverse mortgage calling, rev share model. Also considering VA bodies for his operation. Brian is Sam's training ground — when she sees Nexus work for Brian, she can pitch it.
- **Jesse** — Part of cash-out refi deal. Referred Brian.
- **Kevin Cantwell** — Runs HireSuccess.com (25-year-old pre-employment testing SaaS, 2,000+ customers, 4.9 Capterra). Wants AI upgrade + packaging for acquisition. Potential $15-25K project fee OR 2-3% success fee on acquisition. Warm lead, needs dedicated scoping call.

---

## STRATEGIC DECISIONS (LOCKED)

1. **Nexus is the product. VAs are one execution mechanism.** Long-term: sell Nexus with VAs optional. Short-term: sell VAs, include Nexus for anchor clients.

2. **Nexus mandatory pricing trigger:** When Sam can independently pitch the Nexus value prop in 60 seconds and feel good defending the price. Not date-based — capability-based.

3. **Every Nexus build decision passes this test:** "Does this make Sam more confident pitching it?"

4. **Brian-first build sequence:** Ship Brian's lead system before building platform features. Design DB/code so platform wrap is additive, not a rewrite.

5. **VA + Nexus decoupled for now:** Clients can buy either separately. Brian/Jesse/Kevin get Nexus included, not as a separate line item.

6. **$250/mo** established as Nexus floor price for future clients.

7. **Build stack:** Stay on Supabase + React/Vite for now. No Next.js until platform actually needs it.

8. **VA call logging:** Web form (not Telegram) for structured data.

9. **Self-improvement approval gate:** Every auto-generated fix must be approved by Zach before going to production. No autonomous deploys.

---

## CURRENT BUILD PRIORITIES (as of May 8, 2026)

**DONE this session:**
- ✅ Telegram EarlyDrop bug fixed
- ✅ Abilities bundle (8 abilities: search, research, summarize, email, docs, reminders, competitive, reports)
- ✅ Client provisioning system ([client].nexuszc.com auto-deploy)
- ✅ Self-aware system (health monitoring, improvement queue, approve/reject)
- ✅ Self-healing system (auto-fix, instant alerts, retry logic, audit command)
- ✅ dev/prod branch structure with conflict-proof merge
- ✅ React app at app.nexuszc.com (Dashboard, Clients, VA Interface)
- ✅ Nexus V2 — VA layer (va_profiles, va_task_queues, generate-va-tasks), lead pipeline, white-label portal, deal intelligence, Dashboard V2
- ✅ Nexus Abilities V2 — 19 new commands (client intelligence, document generation, sales/marketing, knowledge base)
- ✅ generated_docs + knowledge_base tables live
- ✅ Auto-fix deployed self-improvement to provision.ts (usage analytics)

**NEXT:**
1. Test V2 abilities via Telegram (see test suite in spec)
2. Schedule dedicated scoping call with Kevin Cantwell
3. Brian's lead system — generate-queue + call cadence working, needs tuning
4. Connect Cloudflare Pages `dev` branch → dev.nexuszc.com (manual Cloudflare Dashboard step)
5. Add Gmail secrets to enable email sending
6. Dump session summary to Nexus via Telegram

---

## MY WORKING PREFERENCES

- **Full file rewrites** over targeted edits — always
- **No overengineering** — clean and direct solutions only
- **"Clear and powerful"** — tools and responses should feel that way
- **Short focused sessions** work best — don't over-scope a session
- **Late-night sessions carry higher bug risk** — flag this when relevant
- Commit and push to GitHub after every meaningful change
- Never leave working changes uncommitted at end of session

---

## GIT RULES (Claude Code must follow these every session)

- After every meaningful change: `git commit -am "descriptive message"`
- After every commit: `git push origin main`
- Never end a session with uncommitted working changes
- Always pull before push if remote has diverged: `git pull origin main --rebase`
- Remote: `https://github.com/nexuszc/nexus-zc.git`
- **Never commit to `dev` directly** — dev is managed by the auto-fix system

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
5. Commit: `git commit -am "Update CLAUDE.md — [session summary]"`
6. Push to GitHub

Zach also dumps session summaries to Nexus via Telegram for persistent memory.
CLAUDE.md = structural context. Nexus = living memory. Both must stay current.
