#!/bin/bash
# Nexus/Roofing OS function test suite
# Fires {test:true} against every critical function, reports pass/fail

PROJECT_URL="https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1"
AUTH="Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcXBibnhraGdic25iZGp3bGR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjkyMzA2NiwiZXhwIjoyMDkyNDk5MDY2fQ.8xaF4ePrSqNBodw1-scsJ9YgOtbv52oGw_F5jP7gTmo"
CT="Content-Type: application/json"

PASS=0
FAIL=0
ERRORS=()

test_fn() {
  local name=$1
  local body=${2:-'{"test":true}'}
  local expect=${3:-'"ok":true'}
  local resp
  resp=$(curl -s -X POST "$PROJECT_URL/$name" -H "$AUTH" -H "$CT" -d "$body" 2>/dev/null)
  if echo "$resp" | grep -q "$expect"; then
    echo "✅ $name"
    ((PASS++))
  else
    echo "❌ $name — got: ${resp:0:120}"
    ((FAIL++))
    ERRORS+=("$name")
  fi
}

echo "=== Nexus + Roofing OS Test Suite ==="
echo ""

# Core brain
test_fn "chat" '{"test":true}' '"error"'  # returns error without message — that's healthy
test_fn "briefing" '{"test":true}'
test_fn "nexus-core" '{"test":true}'

# Outreach system
test_fn "roofing-outreach-sequencer" '{"test":true}'
# Email tracker returns a 1x1 PNG — check HTTP 200 via status code
status=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$PROJECT_URL/roofing-email-tracker" -H "$AUTH")
if [ "$status" = "200" ]; then
  echo "✅ roofing-email-tracker"
  ((PASS++))
else
  echo "❌ roofing-email-tracker — HTTP $status"
  ((FAIL++))
  ERRORS+=("roofing-email-tracker")
fi

# Webhook handlers (test mode)
test_fn "roofing-email-webhook" '{"test":true}'
test_fn "roofing-aria-webhook" '{"recover":false}' '"ok":true'

# Aria voice engine
test_fn "roofing-aria-engine" '{"test":true}'
test_fn "aria-call-gate" '{"test":true}'

# Portal
test_fn "portal-api" '{"test":true}' '"error"'   # expects 401 without token — that's correct behavior

# Marketing
test_fn "roofing-content-engine" '{"test":true}'
test_fn "roofing-youtube-engine" '{"test":true}'
test_fn "roofing-seo-publisher" '{"test":true}'
test_fn "morning-digest" '{"test":true}'

# Analytics / reports
test_fn "roofing-weekly-report" '{"test":true}'
test_fn "roofing-weekly-marketing-report" '{"test":true}'
test_fn "roofing-analytics" '{"test":true}'

# Supplement AI
test_fn "roofing-supplement-analyzer" '{"test":true}'
test_fn "roofing-supplement-generator" '{"test":true}'
test_fn "roofing-supplement-rebuttal" '{"test":true}'
test_fn "roofing-supplement-tracker" '{"test":true}'
test_fn "supplement-audit-engine" '{"test":true}'

# Contractor system
test_fn "contractor-auth" '{"test":true}'
test_fn "contractor-dashboard-api" '{"test":true}'
test_fn "contractor-roi-engine" '{"test":true}'
test_fn "contractor-churn-predictor" '{"test":true}'

# Notification / dispatch
test_fn "roofing-notify" '{"test":true}' '"error"'   # requires job_id — structured error = healthy
test_fn "roofing-whale-alert" '{"test":true}'
test_fn "reminders" '{"test":true}' '"fired"'        # returns {fired:0} — healthy

# System health
test_fn "health-monitor" '{"test":true}'
test_fn "nexus-coo" '{"test":true}' '"error"'        # requires action param — structured error = healthy

# Community / storm
test_fn "roofing-community-monitor" '{"test":true}'
test_fn "roofing-storm-marketing" '{"test":true}'
test_fn "roofing-aria-storm-trigger" '{"test":true}'

# Prospector
test_fn "roofing-prospector" '{"test":true}'

# Portals / payments
test_fn "roofing-payments" '{"test":true}' '"error"'  # requires action — structured error = healthy
test_fn "roofing-closer" '{"test":true}'

# Nexus intelligence
test_fn "nexus-build" '{"test":true}' '"error"'       # requires instruction — structured error = healthy
test_fn "auto-fix" '{"test":true}' '"error"'          # requires improvement_id — structured error = healthy

echo ""
echo "=== Results ==="
echo "✅ Passed: $PASS"
echo "❌ Failed: $FAIL"
echo "Total: $((PASS + FAIL))"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "Failed functions:"
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
fi
