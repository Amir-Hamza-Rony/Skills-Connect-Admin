# Argon2 Vercel Compatibility Report

## Root Cause

The `argon2@0.45.1` package includes a native Node.js addon that requires compilation via `node-gyp rebuild` during `npm install`. npm's install-scripts policy blocks install scripts by default for security reasons. When deploying to Vercel (or any environment using `npm install`), the argon2 native module cannot be built, causing `argon2` to fail at runtime with a "module not found" or similar error.

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added `"mongodb": "^6.8.0"` to dependencies (previously completed); added `"allowScripts": { "argon2@0.45.1": true }` field to approve the argon2 install script |

## argon2 Approval Mechanism

The correct, supported way to approve install scripts in npm is the `allowScripts` field in `package.json`:

```json
"allowScripts": {
  "argon2@0.45.1": true
}
```

This is the npm-recommended mechanism — it approves install scripts for a **specific package only**, without disabling install-script protections globally. It does not disable install-script protection for any other package.

Alternative approaches considered and rejected:
- `npm config set ignore-scripts false` — disables install-script protection globally, not acceptable
- Removing argon2 and replacing with a weaker hashing algorithm — explicitly prohibited
- Using `npm install --ignore-scripts=false` — same global effect as above

## Verification Results

| Check | Result |
|-------|--------|
| `npm install-scripts ls` | `argon2@0.45.1 (install: node-gyp rebuild)` — now approved |
| `npm install` | ✅ PASSED — 3 packages added, `mongodb@6.21.0` and `argon2@0.45.1` installed |
| `npm ls argon2` | ✅ `argon2@0.45.1` installed in root |
| `npm ls mongodb` | ✅ `mongodb@6.21.0` installed in root |
| `argon2.hash()` + `argon2.verify()` | ✅ PASSED — password hashing and verification work correctly |
| `npm run typecheck` | ✅ PASSED |
| `npm run lint` | ✅ PASSED — only pre-existing warnings |
| `npm run build` | ✅ PASSED — all 59 Next.js routes compiled |
| Express regression tests | ✅ 193/195 passing (2 pre-existing QB webhook failures unrelated) |

### Argon2 Verification Test

The following test was executed locally and passed:

```js
const argon2 = require('argon2');
argon2.hash('test-password-12345').then(h => argon2.verify(h, 'test-password-12345'))
  .then(r => console.log('ARGON2 VERIFY RESULT:', r ? 'PASS' : 'FAIL'));
```

Result: `ARGON2 VERIFY RESULT: PASS`

This confirms that:
1. `argon2.hash()` produces a valid argon2id hash
2. `argon2.verify()` correctly verifies a password against that hash
3. The login flow (which uses `verifyPassword(hash, plain)` → `argon2.verify(hash, password)`) will work in production

## Vercel Deployment Configuration

| Item | Value |
|------|-------|
| Build command | `npm run build` |
| Build command installs argon2 | Yes — `npm install` runs as part of Vercel build |
| argon2 install script | Approved via `allowScripts` in `package.json` |
| Native binary compilation | `node-gyp rebuild` will run during install |
| argon2 runtime | Available for password hashing and verification |

## Remaining Limitations

1. **Vercel serverless cold starts:** The argon2 native module must be loaded on each cold start. If `node-gyp rebuild` fails during `npm install` (e.g., missing build tools), argon2 will not be available at runtime. The `allowScripts` approval ensures the install script runs, but the build environment must have a C++ compiler available.

2. **No native module fallback:** If argon2 native binding fails to load, there is no fallback hashing implementation. Login would fail entirely. This is acceptable because argon2id is the required algorithm and no weaker alternative is acceptable.

3. **Vercel function cold start latency:** The first argon2.hash() call on a cold function invocation may be slower due to native module loading. Subsequent calls are fast.

## Conclusion

The Vercel deployment is ready for argon2 password hashing. The install script is approved via the supported `allowScripts` mechanism in `package.json`, the native module is installed and verified working, and password hashing/verification has been tested successfully.

**Do not deploy automatically.** Deploy manually after reviewing this report.