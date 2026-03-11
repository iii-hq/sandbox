#!/bin/bash
set -euo pipefail

API="http://127.0.0.1:3111"
TOKEN="${III_AUTH_TOKEN:-demo123}"
PASS=0
FAIL=0
TOTAL=0

red()   { printf "\033[31m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
bold()  { printf "\033[1m%s\033[0m" "$1"; }

assert_contains() {
    local name="$1" needle="$2" haystack="$3"
    TOTAL=$((TOTAL+1))
    if echo "$haystack" | grep -qE "$needle"; then
        PASS=$((PASS+1))
        echo "  $(green PASS) $name"
    else
        FAIL=$((FAIL+1))
        echo "  $(red FAIL) $name"
        echo "       Expected pattern: $needle"
        echo "       Got: $(echo "$haystack" | head -1 | cut -c1-150)"
    fi
}

api() {
    local method="$1" path="$2" data="${3:-}"
    if [ -n "$data" ]; then
        curl -s -X "$method" "$API$path" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $TOKEN" \
            -d "$data"
    else
        curl -s -X "$method" "$API$path" \
            -H "Authorization: Bearer $TOKEN"
    fi
}

now_ms() { python3 -c "import time; print(int(time.time()*1000))"; }

echo ""
bold "=== iii-sandbox End-to-End Test + Benchmark Suite ==="
echo ""
echo "API: $API | Token: ${TOKEN:0:4}*** | $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ── 1. Health ─────────────────────────────────
echo "$(bold '1. Health Check')"
RESP=$(api GET "/sandbox/health")
assert_contains "health responds" "healthy|ok|status" "$RESP"

# ── 2. Create Sandbox (Cold Start) ────────────
echo ""
echo "$(bold '2. Sandbox Create (cold start)')"
T0=$(now_ms)
CREATE_RESP=$(api POST "/sandbox/sandboxes" '{"image":"alpine:3.20","memory_mb":256}')
T1=$(now_ms)
CREATE_MS=$((T1-T0))

SBX_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
echo "  Cold start: ${CREATE_MS}ms | ID: ${SBX_ID:-NONE}"
assert_contains "returns id" '"id"' "$CREATE_RESP"
assert_contains "status running" "running" "$CREATE_RESP"

if [ -z "$SBX_ID" ]; then
    echo ""
    echo "  $(red 'ABORT') — no sandbox ID. Response: $CREATE_RESP"
    exit 1
fi

# ── 3. Exec ───────────────────────────────────
echo ""
echo "$(bold '3. Command Execution')"

T0=$(now_ms)
EXEC_RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"echo hello-iii"}')
T1=$(now_ms)
EXEC_MS=$((T1-T0))
echo "  Exec latency: ${EXEC_MS}ms"
assert_contains "stdout has hello-iii" "hello-iii" "$EXEC_RESP"
assert_contains "exit code 0" '"exitCode":0|"exit_code":0' "$EXEC_RESP"

RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"uname -m && cat /etc/os-release | head -1"}')
assert_contains "multi-command" "NAME=" "$RESP"

RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"exit 42"}')
assert_contains "exit code 42" "42" "$RESP"

# stderr
RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"echo err >&2"}')
assert_contains "captures stderr" "err" "$RESP"

# ── 4. Filesystem ─────────────────────────────
echo ""
echo "$(bold '4. Filesystem Operations')"

T0=$(now_ms)
WRITE_RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/files/write" '{"path":"/workspace/test.txt","content":"hello from iii-sandbox"}')
T1=$(now_ms)
WRITE_MS=$((T1-T0))
echo "  File write: ${WRITE_MS}ms"
assert_contains "write succeeds" "success|true" "$WRITE_RESP"

T0=$(now_ms)
READ_RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/files/read" '{"path":"/workspace/test.txt"}')
T1=$(now_ms)
READ_MS=$((T1-T0))
echo "  File read: ${READ_MS}ms"
assert_contains "read content" "hello from iii-sandbox" "$READ_RESP"

T0=$(now_ms)
LIST_RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"ls /workspace/"}')
T1=$(now_ms)
LIST_MS=$((T1-T0))
echo "  Dir list (via exec): ${LIST_MS}ms"
assert_contains "workspace has test.txt" "test.txt" "$LIST_RESP"

# nested dir
api POST "/sandbox/sandboxes/$SBX_ID/files/mkdir" '{"path":"/workspace/subdir"}' > /dev/null 2>&1
api POST "/sandbox/sandboxes/$SBX_ID/files/write" '{"path":"/workspace/subdir/nested.txt","content":"nested"}' > /dev/null 2>&1
RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/files/read" '{"path":"/workspace/subdir/nested.txt"}')
assert_contains "nested file read" "nested" "$RESP"

# ── 5. Env Vars ──────────────────────────────
echo ""
echo "$(bold '5. Environment Variables')"
api POST "/sandbox/sandboxes/$SBX_ID/env" '{"vars":{"MY_VAR":"test123"}}' > /dev/null 2>&1
RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"cat /etc/environment"}')
assert_contains "env var written" "MY_VAR=test123" "$RESP"

RESP=$(api GET "/sandbox/sandboxes/$SBX_ID/env")
assert_contains "env list works" "HOME|PATH|HOSTNAME" "$RESP"

# ── 6. Processes ──────────────────────────────
echo ""
echo "$(bold '6. Process Management')"
api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"sleep 300 &"}' > /dev/null 2>&1
sleep 0.5
RESP=$(api GET "/sandbox/sandboxes/$SBX_ID/processes")
assert_contains "process list" "PID|pid|command|sleep" "$RESP"

# ── 7. Metrics ────────────────────────────────
echo ""
echo "$(bold '7. Sandbox Metrics')"
RESP=$(api GET "/sandbox/sandboxes/$SBX_ID/metrics")
assert_contains "has metrics data" "cpu|memory|pids|sandbox" "$RESP"

# ── 8. Pause/Resume ──────────────────────────
echo ""
echo "$(bold '8. Pause / Resume')"
T0=$(now_ms)
PAUSE_RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/pause")
T1=$(now_ms)
PAUSE_MS=$((T1-T0))
echo "  Pause: ${PAUSE_MS}ms"
assert_contains "pause ok" "paused|success|true|status" "$PAUSE_RESP"

T0=$(now_ms)
RESUME_RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/resume")
T1=$(now_ms)
RESUME_MS=$((T1-T0))
echo "  Resume: ${RESUME_MS}ms"
assert_contains "resume ok" "running|success|true|status" "$RESUME_RESP"

RESP=$(api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"echo alive-after-resume"}')
assert_contains "exec after resume" "alive-after-resume" "$RESP"

# ── 9. List & Get ─────────────────────────────
echo ""
echo "$(bold '9. List & Get')"
RESP=$(api GET "/sandbox/sandboxes")
assert_contains "list includes sandbox" "$SBX_ID" "$RESP"

RESP=$(api GET "/sandbox/sandboxes/$SBX_ID")
assert_contains "get returns details" "$SBX_ID" "$RESP"
assert_contains "get includes image" "alpine" "$RESP"

# ── 10. Git Operations ───────────────────────
echo ""
echo "$(bold '10. Git Operations')"
api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"apk add --no-cache git > /dev/null 2>&1"}' > /dev/null 2>&1
api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"cd /workspace && git init && git config user.email test@test.com && git config user.name Test"}' > /dev/null 2>&1
api POST "/sandbox/sandboxes/$SBX_ID/exec" '{"command":"cd /workspace && git add -A && git commit -m init --allow-empty"}' > /dev/null 2>&1
RESP=$(api GET "/sandbox/sandboxes/$SBX_ID/git/status")
assert_contains "git status" "branch|clean|status" "$RESP"

# ── 11. Warm Start ────────────────────────────
echo ""
echo "$(bold '11. Second Sandbox (warm start)')"
T0=$(now_ms)
WARM_RESP=$(api POST "/sandbox/sandboxes" '{"image":"alpine:3.20","memory_mb":256}')
T1=$(now_ms)
WARM_MS=$((T1-T0))
SBX2_ID=$(echo "$WARM_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
echo "  Warm start: ${WARM_MS}ms | ID: ${SBX2_ID:-NONE}"
assert_contains "second sandbox created" '"id"' "$WARM_RESP"

# ── 12. Exec Throughput ───────────────────────
echo ""
echo "$(bold '12. Benchmark: Exec Throughput (20 sequential)')"
BENCH_START=$(now_ms)
for i in $(seq 1 20); do
    api POST "/sandbox/sandboxes/$SBX_ID/exec" "{\"command\":\"echo bench-$i\"}" > /dev/null
done
BENCH_END=$(now_ms)
BENCH_TOTAL=$((BENCH_END-BENCH_START))
BENCH_AVG=$((BENCH_TOTAL/20))
echo "  20 execs: ${BENCH_TOTAL}ms total, ${BENCH_AVG}ms avg"
TOTAL=$((TOTAL+1))
if [ "$BENCH_AVG" -lt 500 ]; then
    PASS=$((PASS+1))
    echo "  $(green PASS) avg exec < 500ms"
else
    FAIL=$((FAIL+1))
    echo "  $(red FAIL) avg exec >= 500ms (${BENCH_AVG}ms)"
fi

# ── 13. File I/O Throughput ───────────────────
echo ""
echo "$(bold '13. Benchmark: File I/O (20 write+read cycles)')"
FIO_START=$(now_ms)
for i in $(seq 1 20); do
    api POST "/sandbox/sandboxes/$SBX_ID/files/write" "{\"path\":\"/workspace/bench-$i.txt\",\"content\":\"data-$i-benchmarkpayload\"}" > /dev/null
    api POST "/sandbox/sandboxes/$SBX_ID/files/read" "{\"path\":\"/workspace/bench-$i.txt\"}" > /dev/null
done
FIO_END=$(now_ms)
FIO_TOTAL=$((FIO_END-FIO_START))
FIO_AVG=$((FIO_TOTAL/20))
echo "  20 write+read: ${FIO_TOTAL}ms total, ${FIO_AVG}ms avg"

# ── 14. Parallel Sandbox Creation ─────────────
echo ""
echo "$(bold '14. Benchmark: Parallel Sandbox Creation (3 concurrent)')"
PARA_START=$(now_ms)
PIDS=""
for i in 1 2 3; do
    api POST "/sandbox/sandboxes" "{\"image\":\"alpine:3.20\",\"memory_mb\":128}" > "/tmp/iii-para-$i.json" &
    PIDS="$PIDS $!"
done
for p in $PIDS; do wait "$p"; done
PARA_END=$(now_ms)
PARA_TOTAL=$((PARA_END-PARA_START))
echo "  3 parallel creates: ${PARA_TOTAL}ms"
PARA_IDS=""
for i in 1 2 3; do
    PID=$(python3 -c "import sys,json; print(json.load(open('/tmp/iii-para-$i.json')).get('id',''))" 2>/dev/null || echo "")
    if [ -n "$PID" ]; then PARA_IDS="$PARA_IDS $PID"; fi
done
TOTAL=$((TOTAL+1))
PARA_COUNT=$(echo "$PARA_IDS" | wc -w | tr -d ' ')
if [ "$PARA_COUNT" -eq 3 ]; then
    PASS=$((PASS+1))
    echo "  $(green PASS) all 3 sandboxes created"
else
    FAIL=$((FAIL+1))
    echo "  $(red FAIL) only $PARA_COUNT/3 created"
fi

# ── 15. Cleanup ───────────────────────────────
echo ""
echo "$(bold '15. Cleanup')"
T0=$(now_ms)
api DELETE "/sandbox/sandboxes/$SBX_ID" > /dev/null 2>&1
T1=$(now_ms)
KILL_MS=$((T1-T0))
echo "  Kill sandbox 1: ${KILL_MS}ms"

if [ -n "$SBX2_ID" ]; then
    api DELETE "/sandbox/sandboxes/$SBX2_ID" > /dev/null 2>&1
    echo "  Kill sandbox 2: done"
fi

for PID in $PARA_IDS; do
    api DELETE "/sandbox/sandboxes/$PID" > /dev/null 2>&1
done
echo "  Kill parallel sandboxes: done"

# ── Results ───────────────────────────────────
echo ""
echo "$(bold '===========================================')"
echo "$(bold '          RESULTS')"
echo "$(bold '===========================================')"
echo ""
if [ $FAIL -eq 0 ]; then
    echo "  $(green "ALL $PASS TESTS PASSED") / $TOTAL total"
else
    echo "  $(green "$PASS passed"), $(red "$FAIL failed") / $TOTAL total"
fi
echo ""
echo "  $(bold 'Latency Benchmarks (Docker backend, macOS arm64):')"
echo "  +-------------------------------+----------+"
echo "  | Operation                     | Latency  |"
echo "  +-------------------------------+----------+"
printf "  | Cold start (pull + create)    | %6dms |\n" "$CREATE_MS"
printf "  | Warm start (image cached)     | %6dms |\n" "$WARM_MS"
printf "  | Exec (echo)                   | %6dms |\n" "$EXEC_MS"
printf "  | File write                    | %6dms |\n" "$WRITE_MS"
printf "  | File read                     | %6dms |\n" "$READ_MS"
printf "  | Dir list                      | %6dms |\n" "$LIST_MS"
printf "  | Pause                         | %6dms |\n" "$PAUSE_MS"
printf "  | Resume                        | %6dms |\n" "$RESUME_MS"
printf "  | Kill                          | %6dms |\n" "$KILL_MS"
printf "  | Exec avg (20x sequential)     | %6dms |\n" "$BENCH_AVG"
printf "  | File I/O avg (20x w+r)        | %6dms |\n" "$FIO_AVG"
printf "  | 3x parallel create            | %6dms |\n" "$PARA_TOTAL"
echo "  +-------------------------------+----------+"
echo ""
echo "  $(bold 'Throughput:')"
if [ "$BENCH_AVG" -gt 0 ]; then
    EXEC_THROUGHPUT=$((1000 / BENCH_AVG))
    echo "    Exec: ~${EXEC_THROUGHPUT} ops/sec"
fi
if [ "$FIO_AVG" -gt 0 ]; then
    FIO_THROUGHPUT=$((1000 / FIO_AVG))
    echo "    File I/O: ~${FIO_THROUGHPUT} write+read cycles/sec"
fi
echo ""

if [ $FAIL -gt 0 ]; then exit 1; fi
