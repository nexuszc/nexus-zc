# NEXUS ZC â CLAUDE.md
# Master context file. Read this at the start of every session.
# Last updated: May 10, 2026 — v7

---

## WHO I AM

**Zach Curtis** â Denver, CO. Multi-venture entrepreneur running a portfolio of businesses
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
Nexus (AI brain â the product)
VA Company (human delivery layer â 100+ VAs trained on Nexus)
    â deployed through vertical channels:
    âââ Roofing OS (roofing contractors)
    âââ Cash Out Refinances (mortgage/refi)
    âââ [future verticals]
```

Roofing OS and Cash Out Refinances are NOT separate businesses.
They are GTM beachheads â vertical channels for deploying Nexus + VAs.

**End state:** A system that takes a business owner from zero to fully operational â
websites, CRMs, outreach, research, SOPs â with Nexus as the brain and VAs as the hands.
Then productized and sold to other multi-business operators.

### What a real COO does (what Nexus must do):
1. Maintains state on every initiative â status, next step, blocker, owner
2. Allocates attention â tells me where to focus THIS week vs. delegate/drop
3. Surfaces problems early â notices silence, slipping commitments, conflicts
4. Drives accountability â "You said you'd call Mike Tuesday. It's Wednesday."
5. Synthesizes patterns â "You keep deferring decisions on X. Want to talk about why?"

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Database | Supabase (Postgres + pgvector) |
| Project ref | `koqpbnxkhgbsnbdjwldx.supabase.co` |
| Region | eu-central-1 |
| AI â responses | Claude Sonnet 4.5 (`claude-sonnet-4-5`) |
| AI â embeddings | OpenAI text-embedding-3-small |
| Capture | Telegram bot `@nexuszc_bot` |
| Brain browser | `/Users/zachdaniels/Documents/NEXUS/nexus-brain.html` |
| Edge Functions | Supabase Edge Runtime (Deno), all deployed `--no-verify-jwt` |
| Frontend | React 18 + Vite + Tailwind v3, hosted on Cloudflare Pages |
| Domain | nexuszc.com (Cloudflare) â app.nexuszc.com, [client].nexuszc.com |
| Email | zach@nexuszc.com / brain@nexuszc.com (Google Workspace) |
| Web search | Serper.dev (SERPER_API_KEY set in Supabase secrets) |
| Repo | github.com/nexuszc/nexus-zc |
| Local path | `/Users/zachdaniels/Documents/NEXUS` |

### Git Branch Structure:
- `main` â production (Cloudflare Pages deploys from here)
- `dev` â staging (auto-fix and nexus-builder commit here; approve to merge to main)
- **Rule:** auto-fix always syncs dev to main before writing, then commits fix to dev
- **Rule:** `approve` command does a content-based merge (reads files from dev, writes to main â conflict-proof)
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
- `entries` â all thoughts, classified with type/importance/tags/project_names/people_names/task_status/client_id
- `conversations` â conversation threads by channel
- `channel_conversations` â maps external IDs (Telegram chat IDs) to conversations
- `embeddings` â pgvector embeddings for semantic search
- `projects` â ventures and ideas (categories: platform, vertical, personal, external, idea, archived)
- `people` â named people extracted from entries
- `reminders` â scheduled Telegram reminders (fire_at, fired, chat_id, message)

### Multi-tenant client layer:
- `clients` â client records (name, deal_type, status, monthly_fee, rev_share_pct, slug, provision_status, site_url)
- `client_context` â per-client brain context (core_offer, goals, target_audience, script, pain_points)
- `va_assignments` â which VA is assigned to which client

### Self-aware system:
- `nexus_health` â hourly function health snapshots (error_count, success_count, avg_response_ms, status)
- `nexus_improvements` â improvement queue (title, problem, recommended_fix, priority, status, auto_fix_code, files_changed, dev_commit_sha)
- `nexus_usage` â ability usage analytics (ability, success, response_ms, channel)
- `nexus_alerts` â instant alerts log (alert_type, message, resolved)
- `platform_insights` â cross-client pattern observations

### Brian's lead system:
- `leads` â lead records linked to client_id
- `sequences` â email/call sequences
- `sequence_enrollments` â lead â sequence enrollment state

### V2 additions:
- `generated_docs` â documents from generate-* abilities (type, client_id, title, content, created_at)
- `knowledge_base` â persistent knowledge store (topic, content, source_url, created_at)
- `va_profiles` â VA accounts linked to Supabase auth user_id
- `va_task_queues` â daily VA task lists (va_assignment_id, date, tasks JSON, completed_count)
- `call_logs` â structured VA call records (lead_id, outcome, notes, va_profile_id)
- `client_portal_access` â token-based portal access (client_id, access_token, last_accessed)
- `invoice_sequence` â auto-incrementing invoice counter (last_number, produces INV-YYYY-XXXX)
- `known_failure_patterns` â 6 seeded error patterns with auto-fix strategies for health-monitor
- `weekly_reports` â weekly self-improvement reports (Sunday 13:00 UTC, also surfaced in Monday brief)
- `nexus_improvements` (new columns: fix_confidence, fix_verified, fix_verified_at, post_fix_error_count, rollback_triggered)

### V4 Autonomous Engine additions:
- `nexus_audit_log` â permanent log of every autonomous action ever taken
- `nexus_decisions` â decision log with outcome tracking for learning
- `nexus_ability_proposals` â self-generated ability proposals lifecycle
- `nexus_research_findings` â all web research findings saved permanently
- `nexus_action_queue` â actions pending 1-tap approval
- `nexus_agent_cycles` â record of every agent run
- `nexus_preferences` â learned preference model (6 seeds: approval thresholds, comms style, focus areas)

### V5 Build System additions:
- `nexus_build_manifests` â structured build plans with test results (goal, files_to_create, files_to_modify, db_migrations, tests, status, dev_commit_sha, main_commit_sha)
- `nexus_reflections` â what Nexus learned each cycle (cycle_number, observation, insight, action_taken, learned)
- `nexus_self_improvements` â self-identified improvement queue (title, problem, proposed_solution, improvement_type, complexity, directive_priority, status)

### V3 COO additions:
- `voice_memos` â Telegram voice messages (telegram_file_id, transcript, classified_as, entry_id, duration_seconds)
- `contradiction_log` â detected contradictions (entry_id_new, entry_id_existing, topic, new_claim, existing_claim, resolved)
- `focus_sessions` â focus command results (top_priorities, context_snapshot, created_at)
- `stale_alerts` â stale client alerts deduplication (client_id, days_inactive, alerted_at, dismissed)
- `projects` (new columns: last_update_at, momentum_status, next_milestone, owner)
- `clients` (new columns: health_score, health_updated_at, last_activity_at)

### Project categories:
- `platform` â core businesses (Nexus, VA Company)
- `vertical` â GTM channels (Roofing OS, Cash Out Refinances)
- `personal` â personal investments (Water Station)
- `external` â things Zach contributes to but doesn't drive (Bora)
- `idea` â loose ideas not yet committed
- `archived` â dead or paused

---

## FULL TELEGRAM COMMAND REFERENCE

### Brain / Memory:
- `[anything]` â captures to memory, classifies, responds as Chief of Staff
- `task: [what]` â logs an open task
- `done: [partial match]` â marks matching task done
- `done all` â clears all open tasks

### Abilities â Original:
- `search: [query]` â web search via Serper
- `research: [name/topic]` â deep intelligence brief (2x searches + synthesis)
- `summarize: [url]` â fetch and summarize any webpage
- `competitors: [market]` â competitive landscape analysis
- `draft email: [to] | subject: [x] | about: [x]` â draft email
- `send email: [to] | subject: [x] | body: [x]` â send via Gmail (requires Gmail secrets)
- `generate proposal: [client] | for: [details]`
- `generate script: [client] | objective: [x]`
- `generate report: [client] | for: [details]`
- `generate onepager: [topic]`
- `remind me: [what] | in: [2 hours / 3 days]`
- `report: [client]` â full client status report

### Abilities â V2 (Tier 1: Client Intelligence):
- `client snapshot: [name]` â full client status: context, leads, calls, entries, open tasks
- `prioritize tasks` â Claude sorts all open tasks by urgency Ã impact
- `task estimate: [task description]` â time/effort estimate + breakdown
- `sprint plan: [timeframe]` â sprint plan from open tasks + client obligations

### Abilities â V2 (Tier 2: Document Generation, saved to generated_docs):
- `generate invoice: [client] | for: [services] | amount: [x]`
- `generate contract: [client] | for: [scope] | amount: [x]`
- `follow up: [name/topic]` â draft follow-up based on conversation history
- `weekly digest: [optional focus]` â 7-day summary saved to generated_docs
- `status update: [project/client]` â status report from entries + open tasks
- `generate sop: [process name]` â full SOP document

### Abilities â V2 (Tier 3: Sales & Marketing, saved to generated_docs):
- `generate pitch: [client/prospect] | for: [context]`
- `generate case study: [client]` â pulls call/lead data for social proof
- `generate ad copy: [product/service] | audience: [x] | goal: [x]`
- `calculate roi: [project] | revenue: [x] | cost: [x]`
- `pricing calculator: [service] | hours: [x] | overhead: [x] | margin: [x]`

### Abilities â V2 (Tier 4: Knowledge Base):
- `save knowledge: [topic] | [content]` â save to knowledge_base table
- `recall knowledge: [topic]` â search knowledge_base
- `learn from: [url]` â fetch URL, extract key insights, save to knowledge_base
- `nexus brain dump` â dump knowledge_base + recent entries + clients + open tasks

### Client management:
- `new client: [name]` â create client brain
- `client context: [name] | deal: [type] | offer: [x] | goals: [x]` â set context
- `assign va: [client] | va: [name]`
- `provision: [name] | type: [business type] | about: [description]` â spin up client site

### Autonomous Engine Commands (v4 + v5):
- `pending` / `pending actions` / `queue` â show all actions and abilities awaiting approval
- `approve action [id]` â approve a queued autonomous action
- `reject action [id]` â reject a queued action
- `approve ability [id]` â approve building a new ability (or deploy if testing)
- `reject ability [id]` â reject an ability proposal
- `audit` / `audit log` / `audit last [n]` â view autonomous action audit log
- `research now` / `nexus research` â trigger immediate research cycle
- `agent now` / `nexus agent` / `run agent` â trigger nexus-core cycle (replaces old nexus-agent)
- `abilities` / `show abilities` â list all self-built abilities and their status
- `build: [instruction]` â trigger nexus-build with plain English instruction
- `deploy build [id]` â deploy a staged build to production (main branch)
- `discard build [id]` â discard a staged build
- `builds` / `build status` â see recent build status
- `improvements` / `self improvements` â see what Nexus wants to improve about itself
- `core now` / `nexus core` â trigger immediate nexus-core cycle
- `reflections` / `what did you learn` â see what Nexus has learned from recent cycles

### COO Commands (new in v3):
- `focus` / `what should i focus on` / `focus now` â top 3 priorities right now (fetches tasks, clients, projects, recent entries)
- `stale check` / `who needs attention` â clients with no activity 5+ days
- `momentum` / `project momentum` â projects with no update 7+ days
- `health scores` / `client health` â all client health scores (50 baseline + activity + calls - open tasks)
- `project update: [name] | [milestone]` â log progress on a project
- `contradictions` / `show contradictions` â unresolved contradictions in your brain
- Voice memos â send voice messages via Telegram, auto-transcribed via Whisper â classified + saved

### System:
- `nexus status` â what's in dev, improvement queue, function health
- `nexus audit` â comprehensive self-assessment with health score (0-100)
- `nexus heal` â trigger health-monitor immediately (on-demand self-heal cycle)
- `approve` â merge current dev improvement to main (content-based, conflict-proof) + schedules 1hr verification reminder
- `reject` â discard dev improvement, reset dev to main

---

## THE SELF-HEALING LOOP (live as of May 8, 2026)

```
Every hour (pg_cron job 3):
  health-monitor runs
    â checks all function health (nexus_usage data)
    â analyzes ability usage patterns (last 7 days)
    â Claude identifies top 3 improvements
    â sends instant alert if any function has >3 errors/hour
    â triggers auto-fix for top pending improvement (max 1/hour)

auto-fix runs (fire-and-forget):
    â syncs dev branch to main (force-reset)
    â reads target file from GitHub main
    â Claude writes minimal surgical fix
    â commits fixed file to dev branch
    â sends Telegram: "Fix ready â approve or reject"

You reply "approve":
    â reads changed files from dev, writes directly to main
    â no git merge (conflict-proof)
    â Cloudflare deploys in ~60 seconds
    â improvement marked live

You reply "reject":
    â dev branch force-reset to main
    â improvement marked rejected
    â health-monitor tries next improvement next cycle
```

---

## CURRENT PORTFOLIO

### Platform (building):
- **Nexus** â the brain/product (this system)
- **VA Company** â human delivery layer, Sam is the sales lead

### Verticals (GTM channels, paused while platform is built):
- **Roofing OS** â roofing contractor channel
- **Cash Out Refinances** â mortgage/refi channel

### Personal:
- **Water Station** â investment, needs an app then runs itself

### External:
- **Bora** â contributor not driver

---

## KEY PEOPLE

- **Sam** â VA Company sales lead. Calls leads, closes clients. Not yet fluent in pitching Nexus as a standalone product. Needs Nexus to be undeniable before she can sell it.
- **Kristine** â VA onboarding. Manages VA sourcing and deployment.
- **Brian** â Anchor client. Reverse mortgage calling, rev share model. Also considering VA bodies for his operation. Brian is Sam's training ground â when she sees Nexus work for Brian, she can pitch it.
- **Jesse** â Part of cash-out refi deal. Referred Brian.
- **Kevin Cantwell** â Runs HireSuccess.com (25-year-old pre-employment testing SaaS, 2,000+ customers, 4.9 Capterra). Wants AI upgrade + packaging for acquisition. Potential $15-25K project fee OR 2-3% success fee on acquisition. Warm lead, needs dedicated scoping call.

---

## STRATEGIC DECISIONS (LOCKED)

1. **Nexus is the product. VAs are one execution mechanism.** Long-term: sell Nexus with VAs optional. Short-term: sell VAs, include Nexus for anchor clients.

2. **Nexus mandatory pricing trigger:** When Sam can independently pitch the Nexus value prop in 60 seconds and feel good defending the price. Not date-based â capability-based.

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
1. Implement pending ability usage analytics and performance tracking system
2. Build complete Roofing OS go-to-market system with public landing page
3. Address Brian's client health (currently at 65) - investigate and resolve issues
4. Develop comprehensive A-Z task handling automation framework
5. Create persistent memory system for accessing past decisions and context
6. Establish continuous self-improvement loop for immediate implementation
7. Build Roofing OS core infrastructure and automation capabilities
8. Set up proactive client monitoring and health tracking system

---

## MY WORKING PREFERENCES

- **Full file rewrites** over targeted edits â always
- **No overengineering** â clean and direct solutions only
- **"Clear and powerful"** â tools and responses should feel that way
- **Short focused sessions** work best â don't over-scope a session
- **Late-night sessions carry higher bug risk** â flag this when relevant
- Commit and push to GitHub after every meaningful change
- Never leave working changes uncommitted at end of session

---

## GIT RULES (Claude Code must follow these every session)

- After every meaningful change: `git commit -am "descriptive message"`
- After every commit: `git push origin main`
- Never end a session with uncommitted working changes
- Always pull before push if remote has diverged: `git pull origin main --rebase`
- Remote: `https://github.com/nexuszc/nexus-zc.git`
- **Never commit to `dev` directly** â dev is managed by the auto-fix and nexus-builder systems

---

## NEXUS-BUILD RULES (enforced in code â never override)

- nexus-build ONLY writes to dev branch â never main
- Main branch is only updated via Zach's `deploy build [id]` or `approve` commands
- nexus-build aborts if chat/index.ts would drop below 2000 lines (corruption guard)
- Size guard: abort if modified file output < 85% of original size
- Test gate: every build runs automated tests before staging
- `approve all` is capped at 5 abilities per call
- One build per nexus-core cycle maximum
- Every build goes through: planning â building â testing â staged (dev) â Zach deploys â deployed (main)

---

## VPS (Hostinger Phoenix â 31.220.60.77)

- Worker: `/root/nexus-worker/index.js` (PM2, auto-restart on crash)
- **Core cycle:** every 30 min â triggers nexus-core
- **Reflection cycle:** every 30 min (offset 15 min) â decides whether to trigger builds
- **Research cycle:** every 6 hours â web research + saves to knowledge_base
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
5. Commit: `git commit -am "Update CLAUDE.md â [session summary]"`
6. Push to GitHub

Zach also dumps session summaries to Nexus via Telegram for persistent memory.
CLAUDE.md = structural context. Nexus = living memory. Both must stay current.
