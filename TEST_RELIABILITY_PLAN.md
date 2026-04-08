# Test Reliability Improvement Plan

**Generated:** 2026-04-08  
**Scope:** All 17 test files under `tests/`  
**Constraint:** No source code changes — test files only  

---

## Current State Summary

| Aspect | Status |
|---|---|
| Framework | Node.js built-in test runner (`node:test` + `node:assert/strict`) |
| Test count | 17 files, ~50+ test cases |
| CI | **None** |
| Mocking | Manual `globalThis.fetch` / `process.env` / `fs` monkey-patching |
| Isolation | Ad-hoc helpers duplicated across 6+ files |

**Top reliability risks (severity-ordered):**

1. **P1 CRITICAL** — Global state leakage: `globalThis.fetch`, `process.env`, `fs` builtins are mutated across 7 files with no concurrency guards.
2. **P2 HIGH** — Timing-dependent assertions using `setTimeout(5)`, `setTimeout(250)`, `ttlMs: 5` that flake under load.
3. **P3 MEDIUM** — Duplicated helpers (`withTempConfigDir`, `withMockFetch`, `makeJsonResponse`, etc.) copy-pasted across 6 files, creating drift risk.

---

## Step 1: Serialize All Global-Mutating Tests

### Goal
Eliminate cross-test and cross-file state leakage by ensuring tests that mutate global state never run concurrently.

### Affected Files (7)
| File | Global(s) Mutated |
|---|---|
| `tests/provider.test.js` | `globalThis.fetch` |
| `tests/openai-compatible.test.js` | `globalThis.fetch` |
| `tests/chat-runtime.test.js` | `globalThis.fetch`, `process.env` |
| `tests/config-store.test.js` | `process.env` |
| `tests/memory-store.test.js` | `process.env` |
| `tests/session-store.test.js` | `process.env` |
| `tests/tools.test.js` | `fs.stat`, `fs.readdir`, `process.env` |
| `tests/security-hardening.test.js` | `process.env` |

### Operations
1. Add `{ concurrency: false }` option to every `test()` call in the 8 files listed above.
   ```js
   // Before:
   test('my test', async (t) => { ... });
   // After:
   test('my test', { concurrency: false }, async (t) => { ... });
   ```
2. For `describe()` blocks that contain global mutations, add `{ concurrency: false }` at the `describe` level instead of per-test (reduces diff size).
3. Verify no file-level concurrency override exists that would re-enable parallelism.

### Expected Benefit
- **Eliminates P1 flakes entirely.** Tests that swap `globalThis.fetch` or `process.env` will never see another test's mock leaking in.
- Zero risk of `fs` builtins being patched during unrelated assertions.
- No behavioral change to test logic — only scheduling.

### Estimated Effort
~30 minutes. Mechanical search-and-replace across 8 files.

---

## Step 2: Extract Shared Test Helpers into `tests/helpers.js`

### Goal
Consolidate duplicated mock/setup code into a single importable module, eliminating drift risk and ensuring consistent isolation.

### Helpers to Extract

| Helper | Current Locations | Lines (approx) |
|---|---|---|
| `withTempConfigDir(fn)` | `chat-runtime`, `config-store`, `memory-store`, `session-store` | 4×15 |
| `withTempWorkspace(fn)` | `tools.test`, `security-hardening` | 2×12 |
| `withMockFetch(fn)` | `chat-runtime`, `provider`, `openai-compatible` | 3×10 |
| `makeJsonResponse(data, status)` | `chat-runtime`, `provider`, `openai-compatible` | 3×5 |
| `makeSseResponse(chunks)` | `chat-runtime`, `openai-compatible` | 2×15 |
| `makeAnthropicSseResponse(chunks)` | `provider` | 1×15 |
| `makeCrlfSseResponse(chunks)` | `openai-compatible` | 1×15 |
| `makeSseResponseWithoutDone(chunks)` | `openai-compatible` | 1×12 |
| `makeSseResponseWithoutTrailingSeparator(chunks)` | `openai-compatible` | 1×12 |

### Operations
1. Create `tests/helpers.js` exporting all 9 helpers above.
2. Add robustness improvements during extraction:
   - `withMockFetch`: snapshot `globalThis.fetch` at call time, restore in `finally` regardless of error path.
   - `withTempConfigDir`: snapshot `process.env.CODEMINI_GLOBAL_DIR` (and any other env vars) at call time, restore all in `finally`.
   - All temp-dir helpers: use `{ prefix: 'test-' }` for predictable temp dir names.
3. Replace inline definitions in all 6+ test files with `import { ... } from './helpers.js'`.
4. Run full test suite to confirm zero regressions.

### Expected Benefit
- **Eliminates P3 drift risk.** A bug fix in isolation logic (e.g., better env cleanup) applies to all consumers immediately.
- Reduces total test LOC by ~200 lines of duplication.
- Makes future mocking patterns (e.g., adding `AbortSignal` support) a single-point change.
- Lowers the barrier for writing new tests — contributors import helpers instead of copy-pasting.

### Estimated Effort
~1 hour. Create module, migrate imports, verify.

---

## Step 3: Replace Wall-Clock Waits with Deterministic Signals

### Goal
Remove all timing-dependent `setTimeout` assertions that flake under load, replacing them with explicit coordination or more tolerant timing.

### Affected Tests

| File | Line | Current Pattern | Problem |
|---|---|---|---|
| `tools.test.js` | ~374 | `setTimeout(resolve, 5)` to force fs concurrency overlap | 5ms may be too short on slow CI |
| `tools.test.js` | ~1587 | `setTimeout(resolve, 250)` waiting for subprocess output | 250ms may be insufficient under load |
| `tools.test.js` | ~1617 | `startup_timeout_ms: 1200` for background process | Wall-clock race |
| `bounded-cache.test.js` | ~34,83,94,117 | `ttlMs: 5` + `setTimeout(20)` for TTL expiry | Timer drift causes flakes |

### Operations

**3a. `tools.test.js` concurrency test (~line 374):**
- Replace the `setTimeout(5)` approach with explicit Promise-based coordination:
  ```js
  // Use a barrier: resolve a "gate" promise from inside the mock,
  // then await it to guarantee both operations are in-flight simultaneously.
  let gate, gateResolve;
  const inFlight = new Promise(r => { gateResolve = r; });
  
  mockFsStat = () => { gateResolve(); return new Promise(r => setTimeout(r, 50)); };
  // Start op1, wait for gate, then start op2
  ```
- This guarantees overlap regardless of machine speed.

**3b. `tools.test.js` subprocess output test (~line 1587):**
- Replace `setTimeout(250)` with a polling loop:
  ```js
  async function pollForOutput(filePath, maxMs = 5000, intervalMs = 50) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      try { const content = await fs.readFile(filePath, 'utf8'); if (content) return content; }
      catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`Output not available within ${maxMs}ms`);
  }
  ```
- Clear error message on timeout instead of silent assertion failure.

**3c. `bounded-cache.test.js` TTL tests:**
- Increase `ttlMs` from `5` to `50` and wait from `20` to `150`.
- Add a comment explaining why the values are chosen: "Must be large enough to avoid timer drift on loaded CI runners but small enough to keep tests fast."
- Alternatively, use `FakeTimers` (noted as future option if a stub library is introduced).

### Expected Benefit
- **Eliminates P2 flakes.** Tests no longer depend on wall-clock timing assumptions.
- `tools.test.js` concurrency test becomes deterministic — will pass/fail consistently.
- `bounded-cache.test.js` TTL tests become resilient to CI runner load.
- Better failure diagnostics: polling loop reports exactly how long it waited and what it expected.

### Estimated Effort
~45 minutes. Refactor 4-5 test cases with explicit coordination.

---

## Follow-Up Recommendations (Out of Scope)

These are not part of the 3-step plan but should be considered next:

| Priority | Item | Impact |
|---|---|---|
| HIGH | Add GitHub Actions CI (`.github/workflows/test.yml`) running `node --test tests/*.test.js` on Node 20+ | Catch regressions on every PR |
| MEDIUM | Add `"test"` script to `package.json` | Standard entry point for contributors and CI |
| LOW | Add `tests/helpers.js` export for `pollForOutput` and other async utilities | Reuse across future tests |
| LOW | Add error-path tests: network errors from fetch, encoded path traversal, cache race conditions | Improve coverage |

---

## Verification Checklist

After completing all 3 steps, run:

```bash
# Run full suite 5 times to check for flakes
for i in $(seq 1 5); do echo "=== Run $i ===" && node --test tests/*.test.js || exit 1; done
```

If all 5 runs pass with zero failures, the reliability fixes are validated.
