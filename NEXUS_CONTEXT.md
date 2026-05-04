# NEXUS — Project Context

## Owner
Zach Curtis, Denver CO. Runs multiple businesses generating ~$1M/year.

## Vision
Building Nexus as a personal Chief of Staff / COO / strategist. Eventual goal: 
24/7 autonomous business operations engine that can be productized for other 
multi-business operators. Tested first on Zach's own businesses.

## Architecture (current)
- **Database:** Supabase (Postgres + pgvector). Project URL: 
  https://koqpbnxkhgbsnbdjwldx.supabase.co
- **Capture:** Telegram bot @nexuszc_bot
- **Brain:** Local HTML file at ~/Documents/NEXUS/nexus-brain.html
- **Models:** Claude Sonnet 4.5 (classification + assessments + generation), 
  OpenAI text-embedding-3-small (semantic search)

## Current Tables
- entries — every captured thought with classification metadata
- projects — with category field (platform/vertical/personal/external/idea/archived)
- people — auto-extracted from entries
- conversations — channel-aware
- channel_conversations — maps Telegram chat IDs to conversations
- embeddings — pgvector semantic search
- summaries — placeholder, not actively used
- project_states — per-project COO assessments
- portfolio_briefs — cross-project strategic synthesis

## Current Edge Functions
- chat — main brain endpoint, layered retrieval, smart classifier
- telegram — Telegram webhook adapter
- brain-api — read/write API for the browser
- reclassify — backfill function
- assess-project — generates per-project strategic assessment
- synthesize-portfolio — generates cross-portfolio brief
- refresh-assessments — wraps assess-project + synthesize-portfolio

## Portfolio (current state)
PLATFORM (the engine being built)
- Nexus
- VA company

VERTICAL (GTM channels — built on platform)
- Roofing OS
- Cash Out Refinances

PERSONAL (Zach's investments, separate from platform strategy)
- Water Station

EXTERNAL (companies Zach contributes to but doesn't drive)
- Bora

ARCHIVED
- Consistent
- Shortcuts

## Working style notes
- Prefers full file rewrites over targeted edits
- Pushes back on overengineering
- Late-night sessions risk bugs
- Values "clear and powerful" feeling from tools
- Single-user for now, multi-tenant is v2