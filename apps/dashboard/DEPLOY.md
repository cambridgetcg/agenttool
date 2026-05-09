# Deploying the dashboard

The dashboard is a vanilla static site hosted on **Cloudflare Pages**.
There is no build step for the existing pages (`index.html`, `dashboard.html`,
`app.js`, `style.css`) — they ship as-is. Pushing to the repo's main branch
triggers a CF Pages auto-deploy.

The SOMA-seed pages add a single build step: **`apps/dashboard/shared/seed.bundle.js`**
is generated from `packages/sdk-ts/src/seed.ts` via Bun's bundler. The bundle
must be regenerated whenever `seed.ts` (or its dependencies) change — a stale
bundle would silently produce wrong derived keys on a new device, since the
wire format is byte-tied to the SDK source.

---

## Pre-flight

Before deploy, all four guarantees must hold:

1. **Bundle reflects current `seed.ts`:**
   ```bash
   cd packages/sdk-ts
   bun build src/seed.ts --target browser --format esm \
     --outfile ../../apps/dashboard/shared/seed.bundle.js
   ```
   The output should be ~120 KB. Commit the regenerated bundle alongside
   any `seed.ts` changes — the bundle is checked-in so CF Pages doesn't
   need a build step.

2. **Cross-language oracle tests pass:**
   ```bash
   # py
   cd packages/sdk-py && .venv/bin/pytest tests/test_phase5_seed.py
   # ts
   cd packages/sdk-ts && bun test tests/phase5_seed.test.ts
   # parity
   cd packages/sdk-ts && bun run check-parity
   ```
   All 32+32 unit tests must pass; parity must report ✓ across all 15
   modules.

3. **Playwright e2e green** (verifies the bundle works in a real browser
   against the live API):
   ```bash
   # api dev server must be up + reachable from the test host
   curl -s http://localhost:3000/health | grep alive

   cd tests/playwright && npx playwright test
   ```
   11 tests must pass.

4. **Tsc clean** in the api workspace:
   ```bash
   cd api && bunx tsc --noEmit
   ```

If any of the above fails, **do not deploy** — the SOMA seed protocol's
load-bearing guarantee is byte-equal derivation across all surfaces, and
a partial deploy would silently break it.

---

## Deploy

Cloudflare Pages is connected to the repo. Pushing to the canonical
deploy branch triggers an auto-build:

```bash
git status
git add apps/dashboard/onboard-soma.html \
        apps/dashboard/onboard-soma.js \
        apps/dashboard/restore-soma.html \
        apps/dashboard/restore-soma.js \
        apps/dashboard/shared/seed.bundle.js \
        apps/dashboard/_headers \
        apps/dashboard/DEPLOY.md
git commit -m "feat(dashboard): SOMA seed onboarding + recovery pages"
git push origin main
```

CF Pages picks up the push and deploys to the production project. No
build step on the CF side — files are served as-is.

---

## Post-deploy verification

1. **Reach the new pages:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://app.agenttool.dev/onboard-soma.html
   # expect 200
   curl -s -o /dev/null -w "%{http_code}\n" https://app.agenttool.dev/restore-soma.html
   # expect 200
   curl -s -o /dev/null -w "%{http_code} type=%{content_type}\n" \
     https://app.agenttool.dev/shared/seed.bundle.js
   # expect 200, application/javascript
   ```

2. **Confirm the bundle is fresh** — the cache-control headers we added
   in `_headers` should make this a cache-MISS on every request:
   ```bash
   curl -sI https://app.agenttool.dev/shared/seed.bundle.js | grep -i cache
   # expect: cache-control: public, max-age=0, must-revalidate
   ```

3. **End-to-end against production** (creates a real test agent):
   ```bash
   AGENTTOOL_BASE=https://api.agenttool.dev \
   AGENTTOOL_DASHBOARD_BASE=https://app.agenttool.dev \
     ./packages/sdk-py/.venv/bin/python3 api/scripts/_e2e-byok-register.py
   ```
   17 assertions must pass. The harness creates a real identity and
   persists it — clean up if needed via the dashboard's project key
   management.

4. **Manual browser smoke test:**
   - Open `https://app.agenttool.dev/onboard-soma.html`
   - Walk the 5-step flow: name → mnemonic → verify → register → success
   - On success: copy the bearer; check the dashboard at
     `https://app.agenttool.dev/dashboard.html` — should show the new agent.
   - Open a private/incognito window: navigate to
     `https://app.agenttool.dev/restore-soma.html` — type the same
     mnemonic + DID → recover succeeds → the second window can read the
     same agent.

---

## Rollback

CF Pages keeps prior deployments. If the new bundle is broken:

1. Open the Cloudflare Pages dashboard (project: agenttool-dashboard).
2. Find the previous deployment (the one before the SOMA seed change).
3. Click "Rollback to this deployment."
4. The static site returns to the prior state immediately. The new SOMA
   pages 404 until the next deploy fixes them; existing dashboard
   functionality is unaffected (the legacy `index.html` flow still works).

If the API itself is broken, the dashboard rollback won't help — the
api workspace deploys independently via Fly. Roll the api back via
`fly releases list && fly releases rollback`.

---

## Wire-format invariant

The SOMA seed protocol's promise — *one mnemonic, identical keys on every
device* — is enforced by 10 oracle test vectors in `test_phase5_seed.py`,
`phase5_seed.test.ts`, and `restore.spec.ts`. A canonical 12-word BIP39
mnemonic (`abandon abandon ... about`) must produce these exact base64
outputs:

```
signing_pub:    MvGLRKH953Fqbr2CENCcK/USGXCATv4nZYfsrW8sqSw=
signing_priv:   IJWkOQ3G6GDP5N35esAJ5VjiIcQ9gi1XUF2JoRyOR7o=
k_master:       hd+mJHIz2tay3d2IPP4Xaq5juGoTUbmHvDXhqAtSi1w=
k_vault:        R2CSaWsKXf7erBD9v1o/zRxwbntDd7eZsu8va4qSqO4=
box_pub:        4ZKHNkxigN4wKm97eG3YVInZ48nfaW+p+dPrVCuRoR4=
box_priv:       363XOfkNUxFo5JR+Z4VQ6VeJAW4JOPuTEkpQJKH+n1U=
bridge_dev0_pub: uvdMUpz1PQK6UMDl2LYEHKg+q5m4y1yhCI0mzAgz+50=
```

If the deployed bundle ever produces different bytes for this mnemonic,
**the bundle is corrupt or stale** — rebuild from `seed.ts`, re-run all
tests, and redeploy. Never ship a bundle that doesn't match these
oracle vectors.

Doctrine: `docs/IDENTITY-SEED.md`.
