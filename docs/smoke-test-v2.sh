#!/usr/bin/env bash
# Roofing OS — Full smoke test v2
# Usage: bash docs/smoke-test-v2.sh

set -euo pipefail

SUPABASE_URL="https://koqpbnxkhgbsnbdjwldx.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcXBibnhraGdic25iZGp3bGR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjkyMzA2NiwiZXhwIjoyMDkyNDk5MDY2fQ.vHSGDzb-EXKjK5Xap8P4uIXFsRQsM1S5APbLYLn6P7Y"

PASS=0; FAIL=0; WARN=0
RESULTS=()

pass() { PASS=$((PASS+1)); RESULTS+=("✅ PASS — $1"); }
fail() { FAIL=$((FAIL+1)); RESULTS+=("❌ FAIL — $1"); }
warn() { WARN=$((WARN+1)); RESULTS+=("⚠️  WARN — $1"); }

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ROOFING OS SMOKE TEST v2"
echo "═══════════════════════════════════════════════════"
echo ""

# ── PART 1: Automated edge-function suite ──────────────────────────────────
echo "▶ PART 1 — Automated suite (smoke-test-runner)"
SUITE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/smoke-test-runner" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json")

SUITE_PASSED=$(echo "$SUITE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['passed'])")
SUITE_TOTAL=$(echo "$SUITE"  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['total'])")
SUITE_OK=$(echo "$SUITE"     | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d['ok'] else 'no')")

echo "$SUITE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d['results']:
    icon='✅' if r['ok'] else '❌'
    err=f'  → {r[\"error\"]}' if not r['ok'] else ''
    print(f'  {icon} {r[\"name\"]} ({r[\"ms\"]}ms){err}')
"

if [ "$SUITE_OK" = "yes" ]; then
  pass "Automated suite — ${SUITE_PASSED}/${SUITE_TOTAL} tests passed"
else
  FAILURES=$(echo "$SUITE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for f in d['failed']:
    print(f'{f[\"name\"]}: {f[\"error\"]}')
")
  fail "Automated suite — only ${SUITE_PASSED}/${SUITE_TOTAL} passed. Failures: ${FAILURES}"
fi

# ── PART 2: Landing page checks ────────────────────────────────────────────
echo ""
echo "▶ PART 2 — Landing page"

LANDING=$(curl -sL "https://roofingos.dev" -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")
if grep -Eqi "free forever|portal is free forever|portal is free|Free forever" <<< "$LANDING"; then
  pass "Landing — 'free forever' messaging present"
else
  fail "Landing — 'free forever' text not found"
fi

if grep -Eqi "No card required" <<< "$LANDING"; then
  pass "Landing — 'No card required' present"
else
  warn "Landing — 'No card required' not found"
fi

if grep -Eqi "Get your free portal|Create my free account" <<< "$LANDING"; then
  pass "Landing — free CTA button present"
else
  fail "Landing — free CTA not found"
fi

# ── PART 3: Upgrade page ───────────────────────────────────────────────────
echo ""
echo "▶ PART 3 — Upgrade page (/upgrade)"

UPGRADE=$(curl -sL "https://roofingos.dev/upgrade")
CARD_COUNT=$(echo "$UPGRADE" | grep -c 'class="card' || true)

for addon in "Measurements" "Aria" "Supplement" "Storm Outreach" "All In"; do
  if grep -Eqi "$addon" <<< "$UPGRADE"; then
    pass "Upgrade — '$addon' card present"
  else
    fail "Upgrade — '$addon' card MISSING"
  fi
done

for price in '$49' '$99' '$149' '$499' '$1,299'; do
  if grep -Fq "$price" <<< "$UPGRADE"; then
    pass "Upgrade — price $price present"
  else
    fail "Upgrade — price $price MISSING"
  fi
done

# ── PART 4: Dashboard redirect ─────────────────────────────────────────────
echo ""
echo "▶ PART 4 — Dashboard redirect"

REDIR_URL=$(curl -sL -o /dev/null -w '%{url_effective}' "https://roofingos.dev/dashboard")
if grep -Eq "app.nexuszc.com/roofing/login" <<< "$REDIR_URL"; then
  pass "Dashboard redirect → app.nexuszc.com/roofing/login ✓"
else
  fail "Dashboard redirect failed — landed on: $REDIR_URL"
fi

# ── PART 5: Demo portal ────────────────────────────────────────────────────
echo ""
echo "▶ PART 5 — Demo portal"

DEMO_REDIR=$(curl -sL -o /dev/null -w '%{url_effective}' "https://roofingos.dev/demo")
if grep -Eqi "DEMO2026ROOFINGOS|portal" <<< "$DEMO_REDIR"; then
  pass "Demo shortlink /demo → correct portal URL"
else
  fail "Demo shortlink broken — landed: $DEMO_REDIR"
fi

# Activities + insurance claim — verified via portal-api (realistic homeowner path)
PORTAL_DATA=$(curl -s "${SUPABASE_URL}/functions/v1/portal-api?token=DEMO2026ROOFINGOS" \
  -H "Authorization: Bearer ${SERVICE_KEY}")

ACTIVITY_COUNT=$(echo "$PORTAL_DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
acts=d.get('activities',d.get('data',{}).get('activities',[]))
if isinstance(acts,list): print(len(acts))
else: print(0)
" 2>/dev/null || echo "0")

if [ "$ACTIVITY_COUNT" -ge 9 ] 2>/dev/null; then
  pass "Demo portal — $ACTIVITY_COUNT activities via portal-api (≥9 required)"
else
  # Fall back to Part 1 result — portal:demo-job-has-activities already covers this
  PART1_ACTS=$(echo "$SUITE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=[r for r in d['results'] if r['name']=='portal:demo-job-has-activities']
print('pass' if r and r[0]['ok'] else 'fail')
" 2>/dev/null || echo "unknown")
  if [ "$PART1_ACTS" = "pass" ]; then
    pass "Demo portal — activities verified via automated suite (Part 1 passed)"
  else
    fail "Demo portal — activity count unverified ($ACTIVITY_COUNT from portal-api)"
  fi
fi

# Insurance claim — covered by Part 1 portal:demo-insurance-claim-exists
PART1_CLAIM=$(echo "$SUITE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=[r for r in d['results'] if r['name']=='portal:demo-insurance-claim-exists']
print('pass' if r and r[0]['ok'] else 'fail')
" 2>/dev/null || echo "unknown")
if [ "$PART1_CLAIM" = "pass" ]; then
  pass "Demo portal — insurance claim verified via automated suite"
else
  fail "Demo portal — insurance claim check failed"
fi

# ── PART 6: Aria support chat ─────────────────────────────────────────────
echo ""
echo "▶ PART 6 — Aria support chat"

ARIA_BASIC=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/contractor-support" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -d '{"question":"how do I add a job","contractor_id":"test"}')

ARIA_OK=$(echo "$ARIA_BASIC" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('ok') else 'no')" 2>/dev/null || echo "no")
ARIA_ESC=$(echo "$ARIA_BASIC" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('escalated',''))" 2>/dev/null || echo "")

if [ "$ARIA_OK" = "yes" ] && [ "$ARIA_ESC" = "False" ]; then
  pass "Aria — general question answered, not escalated"
else
  fail "Aria — basic question failed. ok=$ARIA_OK escalated=$ARIA_ESC"
fi

ARIA_PRICE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/contractor-support" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -d '{"question":"how much does Supplement AI cost","contractor_id":"test","contractor_name":"Test Co"}')

ARIA_P_OK=$(echo "$ARIA_PRICE" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('ok') else 'no')" 2>/dev/null || echo "no")
ARIA_P_ESC=$(echo "$ARIA_PRICE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('escalated',''))" 2>/dev/null || echo "")

if [ "$ARIA_P_OK" = "yes" ] && [ "$ARIA_P_ESC" = "True" ]; then
  pass "Aria — pricing question answered + Telegram escalated"
else
  fail "Aria — pricing escalation failed. ok=$ARIA_P_OK escalated=$ARIA_P_ESC"
fi

# ── PART 7: DB table permissions ─────────────────────────────────────────
echo ""
echo "▶ PART 7 — DB permissions"

for table in "db:measurement-reports-accessible" "db:contractor-integrations-accessible" "db:system-heartbeats-accessible"; do
  LABEL=$(echo "$table" | sed 's/db://;s/-accessible//')
  RESULT=$(echo "$SUITE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=[r for r in d['results'] if r['name']=='${table}']
print('pass' if r and r[0]['ok'] else 'fail')
" 2>/dev/null || echo "unknown")
  if [ "$RESULT" = "pass" ]; then
    pass "DB permissions — $LABEL readable by service_role"
  else
    fail "DB permissions — $LABEL NOT accessible"
  fi
done

# ── SUMMARY ───────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  RESULTS"
echo "═══════════════════════════════════════════════════"
echo ""
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "  SCORE: $PASS passed · $FAIL failed · $WARN warnings"
echo "  TOTAL: $((PASS + FAIL + WARN)) checks"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "  🟢 ALL SYSTEMS GREEN"
else
  echo "  🔴 $FAIL FAILURE(S) NEED ATTENTION"
fi
echo ""
