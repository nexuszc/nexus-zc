# Smoke Test Failure Analysis

## Document Information
- **Date:** YYYY-MM-DD
- **Investigator:** [Name]
- **Incident ID:** [Reference Number]
- **System Version:** [Version/Commit Hash]

---

## Failure Symptoms

### Observable Issues
- [ ] Test suite timeout
- [ ] Assertion failures
- [ ] Network connectivity issues
- [ ] Database connection failures
- [ ] Authentication/authorization errors
- [ ] Service unavailability
- [ ] Performance degradation
- [ ] Other: _______________

### Environment
- **Environment:** [Production/Staging/Development]
- **Date/Time of Failure:** 
- **Frequency:** [One-time/Intermittent/Consistent]
- **Impact Scope:** [Single service/Multiple services/System-wide]

---

## Affected Test Cases

| Test Case ID | Test Name | Status | Error Type | Priority |
|-------------|-----------|--------|------------|----------|
| | | FAIL/TIMEOUT/ERROR | | P0/P1/P2 |
| | | | | |
| | | | | |

---

## Error Logs & Stack Traces

### Primary Error
[Paste main error message here]
### Stack Trace
```
[Paste complete stack trace here]
```

### Related Logs
```
[Paste relevant system/application logs]
```

### Test Output
```
[Paste test runner output]
```

---

## Smoke Test Implementation Review

### Test File Location
- Path: 
- Language/Framework: 
- Test Runner: 

### Test Code Analysis
**What the test validates:**
- 

**Test dependencies:**
- 

**External services called:**
- 

**Expected vs Actual behavior:**
- Expected: 
- Actual: 

### Specific Failing Checks
1. **Check Name:**
   - Assertion: 
   - Expected Value: 
   - Actual Value: 
   - Line Number: 

2. **Check Name:**
   - Assertion: 
   - Expected Value: 
   - Actual Value: 
   - Line Number: 

---

## Recent Changes Timeline

### Code Changes (Last 7 Days)
| Date | Commit/PR | Author | Component | Description | Risk Level |
|------|-----------|--------|-----------|-------------|------------|
| | | | | | HIGH/MED/LOW |
| | | | | | |

### Configuration Changes
| Date | Change Type | Component | Description | Changed By |
|------|------------|-----------|-------------|------------|
| | | | | |

### Deployment History
| Date/Time | Environment | Version | Status | Notes |
|-----------|-------------|---------|--------|-------|
| | | | SUCCESS/FAILED | |

### Infrastructure Changes
- [ ] Database schema updates
- [ ] API endpoint modifications
- [ ] Environment variable changes
- [ ] Dependency updates
- [ ] Network/firewall changes
- [ ] Third-party service changes

---

## Root Cause Analysis

### Investigation Steps Taken
1. 
2. 
3. 

### Hypothesis Testing
**Hypothesis 1:**
- Theory: 
- Test Method: 
- Result: ✓ Confirmed / ✗ Rejected

**Hypothesis 2:**
- Theory: 
- Test Method: 
- Result: ✓ Confirmed / ✗ Rejected

### Root Cause Identified
**Primary Cause:**


**Contributing Factors:**
- 
- 

**Why It Wasn't Caught Earlier:**


---

## Remediation Steps

### Immediate Fix
**Action Taken:**


**Code/Config Changes:**
```
[Paste fix code or configuration]
```

**Verification:**
- [ ] Local testing passed
- [ ] Smoke tests passed
- [ ] Integration tests passed
- [ ] Deployed to staging
- [ ] Deployed to production

### Long-term Prevention

#### Code Improvements
- [ ] Add additional test coverage
- [ ] Improve error handling
- [ ] Add logging/monitoring
- [ ] Refactor problematic code
- [ ] Update documentation

#### Process Improvements
- [ ] Add pre-deployment checks
- [ ] Update CI/CD pipeline
- [ ] Enhance monitoring/alerts
- [ ] Improve change management
- [ ] Conduct team training

### Related Tasks
- [ ] [TASK-ID] Description - Owner - Due Date
- [ ] [TASK-ID] Description - Owner - Due Date

---

## Test Results Post-Fix

### Verification Test Runs
| Date/Time | Environment | Test Suite | Result | Duration | Notes |
|-----------|-------------|------------|--------|----------|-------|
| | | | PASS/FAIL | | |
| | | | | | |

### Performance Metrics
- Test execution time before fix: 
- Test execution time after fix: 
- Resource usage impact: 

---

## Lessons Learned

### What Went Well
- 

### What Could Be Improved
- 

### Action Items
1. 
2. 
3. 

---

## References

### Related Documentation
- 

### Related Incidents
- 

### External Resources
- 

---

## Sign-off

- **Investigated By:** _______________ Date: ______
- **Reviewed By:** _______________ Date: ______
- **Approved By:** _______________ Date: ______