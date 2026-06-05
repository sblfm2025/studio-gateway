## Improvements to Firestore Quota Handling (June 5, 2026)

### Changes Made

#### 1. **Increased Default Quota Cooldown** (firebaseClient.ts)
   - Previous: 300 seconds (5 minutes)
   - New: 900 seconds (15 minutes)
   - Reason: Google Firestore SDK has an internal 10-minute (600 second) timeout. Our previous 5-minute cooldown was too short; requests were timing out on the backend and retrying immediately, causing more quota exhaustion.

#### 2. **Implemented Exponential Backoff for Transient Errors** (firebaseClient.ts)
   - Added new function: `getExponentialBackoffMs(attempt, baseDelayMs)`
   - Calculates backoff as: `baseDelayMs * Math.pow(2, attempt - 1)` with random jitter (10%)
   - Backoff delays now follow: 1s → 2s → 4s → 8s → max 60s
   - Reason: Fixed 1000ms delays were hammering the backend too frequently. Exponential backoff gives Firestore more breathing room between retries.

#### 3. **Reduced Default Retry Attempts** (firebaseClient.ts)
   - Previous: 2 retries (3 total attempts)
   - New: 1 retry (2 total attempts)
   - Reason: With exponential backoff, even 2 attempts give Firestore enough time. More attempts risk extending operation duration beyond useful limits.

#### 4. **Increased Base Retry Delay** (firebaseClient.ts)
   - Previous: 1000ms
   - New: 2000ms (2 seconds)
   - Reason: First retry now starts with 2 seconds instead of 1, better aligning with Firestore's internal recovery time.

#### 5. **Added Better Sync Skip Tracking** (index.ts)
   - Added `consecutiveSyncSkips` counter
   - Log sync skip only on first 3 attempts and every 5th attempt thereafter
   - Reason: Reduces log spam when polling consistently skips due to slow operations or cooldown.

#### 6. **Enhanced TROUBLESHOOTING.md**
   - Added new section **4. Firestore Quota Exhausted** with detailed:
     - Symptom checklist
     - Root cause analysis
     - Step-by-step diagnostic procedures
     - Immediate mitigation strategies
     - Long-term preventive measures

### Technical Impact

**Before Changes:**
- Timeout error at 10 minutes (Firestore SDK limit)
- Immediate retry at 1 second intervals
- Multiple quota errors accumulating because retries were too aggressive
- Log spam from repeated skip notifications

**After Changes:**
- Gateway waits 15 minutes before attempting after quota exhausted
- Retries use exponential backoff: 2s → 4s
- Less aggressive retry pattern reduces load on exhausted quota
- Cleaner logs with smart skip reporting

### Environment Variables (Optional Tuning)

If you need to override defaults:
```env
# Total quota cooldown when RESOURCE_EXHAUSTED detected (seconds)
FIRESTORE_QUOTA_COOLDOWN_SECONDS=900

# Number of retries for transient errors (e.g., timeouts)
FIRESTORE_RETRY_ATTEMPTS=1

# Base delay for first retry (milliseconds)
FIRESTORE_RETRY_DELAY_MS=2000

# Operation timeout (milliseconds)
FIRESTORE_OP_TIMEOUT_MS=30000
```

### Testing Recommendations

1. **Simulate Quota Error:**
   - Set `POLL_INTERVAL_SECONDS=5` in .env
   - Add multiple concurrent operations
   - Monitor logs for exponential backoff pattern

2. **Verify Cool Down:**
   - Trigger quota error intentionally
   - Check that operations skip for 15 minutes
   - Confirm logs show skip counter incrementing

3. **Performance Baseline:**
   - Measure operation timing before/after
   - Expected: Slower due to longer waits, but more stable
   - Log will show timing breakdown per attempt

### Rollback Plan

If performance degrades, revert to previous values:
```env
FIRESTORE_QUOTA_COOLDOWN_SECONDS=300
FIRESTORE_RETRY_ATTEMPTS=2
FIRESTORE_RETRY_DELAY_MS=1000
```

Then rebuild and redeploy: `npm run build` and `npm run install-autostart`.
