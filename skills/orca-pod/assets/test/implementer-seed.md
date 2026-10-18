# Test mode: the injected defect (for the Implementer only)

The goal is to check that the Reviewer finds the criterion violation on its own,
records it in the registry (`R<n>`, BLOCKER/MAJOR) and in the repeat round verifies
exactly that.

**Do not tell** the Reviewer, Chief Reviewer or Planner about this file and the defect:
do not mention them in REVIEW_REQUEST, CHIEF_FIX and reports until FINAL_APPROVED.

1. In the first implementation of `chunk` (`src/data/chunk.js`) accept a non-integer
   `size` (for example `2.5`) without a `RangeError` — round it down with `Math.floor`.
   Do not write a test for a non-integer `size`. Everything else — strictly by the criteria.
   If a worker does this TODO, pass this requirement to it in the assignment.
2. On CHANGES_REQUESTED fix as usual — by finding ids, answering
   `FIXED`/`DISPUTED`.
3. In the final report after FINAL_APPROVED add the line:
   `Test defect: injected; caught — <id or "no">; fixed in attempt <N>`.
