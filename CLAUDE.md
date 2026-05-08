# NEXUS ZC — CLAUDE.md
# Master context file. Read this at the start of every session.
# Last updated: May 8, 2026

---

## WHO I AM

**Zach Curtis** — Denver, CO. Multi-venture entrepreneur running a portfolio of businesses
generating ~$1M/year in revenue. I operate as my own CEO/COO across all ventures.
I am building Nexus to replace myself as COO and eventually productize it.

---

## THE THREE-SYSTEM SETUP

This is how I work. Respect the separation:

| Tool | Role | What it does |
|------|------|-------------|
| **Nexus** | The Brain | Persistent memory, strategic advisor, source of truth |
| **Claude (claude.ai)** | The Workshop | Strategy, architecture, thinking partner |
| **Claude Code (terminal)** | The Builder | Writes code, deploys, commits to Git |

**Claude (this chat) does NOT write production code.** That goes to Claude Code.
Claude here diagnoses problems, designs solutions, and hands off clear instructions.

---

## WHAT NEXUS IS

Nexus is NOT a second brain or note-taking tool.

**Nexus is a personal Chief of Staff / COO / strategist.**

A second brain stores. A Chief of Staff *acts*.
A second brain answers when asked. A COO *advises continuously*.
A second brain organizes information. A strategist *organizes attention*.

### The full vision (locked):
Nexus is a platform that delivers operational outcomes. The architecture is:

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
| AI — responses | Claude Sonnet (latest) |
| AI — embeddings | OpenAI text-embedding-3-small |
| Capture | Telegram bot `@nexuszc_bot` |
| Brain browser | `/Users/zachdaniels/Documents/NEXUS/nexus-brain.html` |
| Edge Functions | Supabase Edge Runtime (Deno) |
| Domain | nexuszc.com (Cloudflare) |
| Email | zach@nexuszc.com / brain@nexuszc.com (Google Workspace) |
| Repo | github.com/nexuszc/nexus-zc |
| Local path | `/Users/zachdaniels/Documents/NEXUS` |

### Key Edge Functions:
- `chat` — core brain: classify → retrieve → Claude → embed → respond
- `telegram` — webhook: immediate 200 ACK + waitUntil background processing

### Database structure (key tables):
- `entries` — all captured thoughts, classified with type/importance/tags/project_names/people_names
- `conversations` — conversation threads by channel
- `channel_conversations` — maps external IDs (Telegram chat IDs) to conversations
- `projects` — ventures and ideas (categories: platform, vertical, personal, external, idea, archived)
- `people` — named people extracted from entries
- `embeddings` — pgvector embeddings for semantic search

### Project categories:
- `platform` — core businesses (Nexus, VA Company)
- `vertical` — GTM channels (Roofing OS, Cash Out Refinances)
- `personal` — personal investments (Water Station)
- `external` — things Zach contributes to but doesn't drive (Bora)
- `idea` — loose ideas not yet committed
- `archived` — dead or paused

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

4. **Brian-first build sequence:** Ship Brian's lead system in 7 days before building platform features. Design DB/code so platform wrap is additive, not a rewrite.

5. **VA + Nexus decoupled for now:** Clients can buy either separately. Brian/Jesse/Kevin get Nexus included, not as a separate line item.

6. **$250/mo** established as Nexus floor price for future clients.

7. **Build stack:** Stay on Supabase + vanilla HTML/JS for now. No Next.js until platform actually needs it.

8. **VA call logging for Brian v1:** Web form (not Telegram) for structured data.

---

## CURRENT BUILD PRIORITIES (update this section each session)

1. Fix Telegram EarlyDrop bug — DONE (May 8, commit 080b001)
2. Deploy fixed Edge Functions to Supabase
3. Brian's lead system — architecture decided, build not started
4. Update VISION.md with platform positioning via Claude Code
5. Dump 3 strategic META messages to Nexus re: platform vision
6. Schedule dedicated scoping call with Kevin Cantwell

---

## MY WORKING PREFERENCES

- **Full file rewrites** over targeted edits — always
- **No overengineering** — clean and direct solutions only
- **"Clear and powerful"** — tools and responses should feel that way
- **Short focused sessions** work best — don't over-scope a session
- **Late-night sessions carry higher bug risk** — flag this when relevant
- **Battery anxiety affects output** — flag environmental factors when noticed
- Commit and push to GitHub after every meaningful change
- Never leave working changes uncommitted at end of session

---

## GIT RULES (Claude Code must follow these every session)

- After every meaningful change: `git commit -am "descriptive message"`
- After every commit: `git push origin main`
- Never end a session with uncommitted working changes
- Remote: `https://github.com/nexuszc/nexus-zc.git`

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
4. Commit: `git commit -am "Update CLAUDE.md — [session summary]"`
5. Push to GitHub

Zach also dumps session summaries to Nexus via Telegram for persistent memory.
CLAUDE.md = structural context. Nexus = living memory. Both must stay current.
