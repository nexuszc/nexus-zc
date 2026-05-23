#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

export DENO_DIR="$PROJECT_ROOT/.deno_cache"
export NO_COLOR=1

FAILED_TESTS=()
PASSED_TESTS=()
TOTAL_TESTS=0

EDGE_FUNCTIONS_DIR="$PROJECT_ROOT/supabase/functions"

if [ ! -d "$EDGE_FUNCTIONS_DIR" ]; then
  echo "Error: Edge functions directory not found: $EDGE_FUNCTIONS_DIR"
  exit 1
fi

echo "Running edge function tests..."
echo "================================"
echo ""

for func_dir in "$EDGE_FUNCTIONS_DIR"/*; do
  if [ -d "$func_dir" ]; then
    func_name=$(basename "$func_dir")
    test_file="$func_dir/test.ts"
    
    if [ -f "$test_file" ]; then
      TOTAL_TESTS=$((TOTAL_TESTS + 1))
      echo "Testing: $func_name"
      echo "--------------------------------"
      
      if deno test \
        --allow-net \
        --allow-env \
        --allow-read \
        --unstable \
        --config="$PROJECT_ROOT/deno.json" \
        "$test_file"; then
        PASSED_TESTS+=("$func_name")
        echo "✓ PASSED: $func_name"
      else
        FAILED_TESTS+=("$func_name")
        echo "✗ FAILED: $func_name"
      fi
      
      echo ""
    fi
  fi
done

echo "================================"
echo "Test Results Summary"
echo "================================"
echo "Total functions tested: $TOTAL_TESTS"
echo "Passed: ${#PASSED_TESTS[@]}"
echo "Failed: ${#FAILED_TESTS[@]}"
echo ""

if [ ${#PASSED_TESTS[@]} -gt 0 ]; then
  echo "Passed tests:"
  for test in "${PASSED_TESTS[@]}"; do
    echo "  ✓ $test"
  done
  echo ""
fi

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo "Failed tests:"
  for test in "${FAILED_TESTS[@]}"; do
    echo "  ✗ $test"
  done
  echo ""
  exit 1
fi

if [ $TOTAL_TESTS -eq 0 ]; then
  echo "Warning: No tests found"
  exit 1
fi

echo "All tests passed!"
exit 0