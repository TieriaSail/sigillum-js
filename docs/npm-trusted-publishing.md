# npm Trusted Publishing (OIDC) — Setup & Troubleshooting

This document records the full configuration of npm Trusted Publishing for `sigillum-js`, including every issue encountered during setup and the corresponding fix.

## What is Trusted Publishing?

npm Trusted Publishing uses OpenID Connect (OIDC) to authenticate GitHub Actions workflows directly with the npm registry. Instead of storing a long-lived `NPM_TOKEN` secret, each publish generates a short-lived, cryptographically-signed token that is scoped to the specific workflow run.

Benefits:
- No secret rotation — tokens are ephemeral
- Supply chain attestation — `--provenance` links every published tarball to its source commit and CI run
- Tamper-proof — the OIDC token cannot be extracted or reused

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| npm CLI | >= 11.5.1 | latest |
| Node.js | >= 22.14.0 | **24.x** (ships npm 11.x+) |
| Runner | GitHub-hosted | GitHub-hosted (self-hosted not supported) |

> **Critical**: Node 22.x ships npm 10.x, which does **not** support OIDC. You must either use Node 24+ or manually upgrade npm. See [Pitfall #1](#pitfall-1-npm-version-too-old).

## npm Side Configuration

1. Go to [npmjs.com](https://www.npmjs.com/) → your package → **Settings**
2. Find the **Trusted Publisher** section
3. Select **GitHub Actions** as the provider
4. Fill in:
   - **Workflow filename**: `publish.yml` (filename only, not the full path; must include `.yml`)
5. Save

> The workflow filename is **case-sensitive** and must exactly match the file in `.github/workflows/`.

## package.json Requirements

The `repository.url` field **must exactly match** your GitHub repository URL. npm uses this to verify the OIDC token's origin.

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/TieriaSail/sigillum-js.git"
  },
  "publishConfig": {
    "provenance": true,
    "access": "public"
  }
}
```

## GitHub Actions Workflow

Final working configuration (`.github/workflows/publish.yml`):

```yaml
name: Publish to npm

on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write    # Required for OIDC

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24               # Must be 24+ for npm 11.x
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Determine npm dist-tag
        id: dist_tag
        run: |
          VERSION=$(node -p "require('./package.json').version")
          if echo "$VERSION" | grep -qE '(alpha|beta|rc)'; then
            echo "tag=beta" >> "$GITHUB_OUTPUT"
          else
            echo "tag=latest" >> "$GITHUB_OUTPUT"
          fi

      - name: Publish to npm
        run: npm publish --provenance --access public --tag ${{ steps.dist_tag.outputs.tag }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

Key points:
- `id-token: write` is **mandatory** — without it, GitHub cannot issue OIDC tokens
- `registry-url` must be set in `actions/setup-node` so npm knows which registry to authenticate against
- **No `NODE_AUTH_TOKEN` env var** — see [Pitfall #2](#pitfall-2-node_auth_token-overrides-oidc)

## Release Process

```bash
# 1. Bump version in package.json
npm version 2.0.0-beta.2 --no-git-tag-version

# 2. Commit
git add package.json package-lock.json
git commit -m "chore: bump version to 2.0.0-beta.2"
git push

# 3. Tag and push (triggers the workflow)
git tag v2.0.0-beta.2
git push origin v2.0.0-beta.2
```

The `Determine npm dist-tag` step automatically publishes:
- Versions containing `alpha`, `beta`, or `rc` → `npm publish --tag beta`
- Stable versions → `npm publish --tag latest`

This prevents prerelease versions from becoming the default `latest` tag that `npm install sigillum-js` resolves to.

---

## Pitfalls & Solutions

### Pitfall #1: npm version too old

**Symptom**: Provenance signing succeeds (you see "Provenance statement published to transparency log"), but publish fails with:

```
npm error code E404
npm error 404 Not Found - PUT https://registry.npmjs.org/sigillum-js - Not found
```

**Root cause**: Node 22.x ships npm 10.9.x. npm OIDC support requires **npm >= 11.5.1**. npm 10.x does not understand OIDC tokens, so the registry rejects the request.

**Why it's confusing**: The provenance signature is handled by sigstore (separate from npm auth), so it succeeds even when npm auth fails. The E404 error message gives no hint about version incompatibility.

**Fix**: Use Node 24 in the workflow, which ships npm 11.x+:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 24    # NOT 22
```

**Alternative** (not recommended): Keep Node 22 and upgrade npm manually:

```yaml
- run: npm install -g npm@latest
```

This can fail on some CI environments due to npm's own dependency resolution issues (we hit `MODULE_NOT_FOUND: promise-retry` on Node 22.22.2). Using Node 24 avoids this entirely.

### Pitfall #2: NODE_AUTH_TOKEN overrides OIDC

**Symptom**:

```
npm error code ENEEDAUTH
npm error need auth This command requires you to be logged in
```

**Root cause**: If `NODE_AUTH_TOKEN` is set as an environment variable — **even if its value is empty** — npm will use it instead of OIDC. When the corresponding GitHub secret doesn't exist, the value is an empty string, which npm treats as "token provided but invalid".

**Fix**: Do **not** set `NODE_AUTH_TOKEN` in the publish step when using Trusted Publishing:

```yaml
# WRONG — breaks OIDC
- name: Publish to npm
  run: npm publish --provenance --access public
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

# CORRECT — let OIDC handle auth
- name: Publish to npm
  run: npm publish --provenance --access public
```

> If you have private dependencies that need a token for `npm ci`, set `NODE_AUTH_TOKEN` only on the install step, not the publish step.

### Pitfall #3: npm install -g npm@latest fails on CI

**Symptom**:

```
Error: Cannot find module '/usr/local/lib/node_modules/npm/node_modules/promise-retry'
```

**Root cause**: Running `npm install -g npm@latest` on Node 22.22.2 CI runners can corrupt npm's own module tree due to version conflicts between the bundled npm and the newly installed one.

**Fix**: Remove the `npm install -g npm@latest` step entirely. Use Node 24 instead, which ships a compatible npm version out of the box.

### Pitfall #4: repository.url mismatch

**Symptom**: Same E404 error as Pitfall #1.

**Root cause**: npm verifies that the OIDC token's repository claim matches `package.json`'s `repository.url`. If they don't match (e.g., publishing from a fork, or the URL format differs), the publish is rejected.

**Fix**: Ensure `repository.url` in `package.json` exactly matches your GitHub repository:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/TieriaSail/sigillum-js.git"
  }
}
```

### Pitfall #5: Workflow filename mismatch

**Symptom**: Same E404 error.

**Root cause**: The workflow filename configured on npmjs.com must exactly match the actual file in `.github/workflows/`. This is case-sensitive and must include the extension.

**Fix**: If your file is `.github/workflows/publish.yml`, the value on npmjs.com must be exactly `publish.yml`.

> npm does **not** validate the filename when you save the configuration. Errors only surface at publish time.

### Pitfall #6: Prerelease versions published to `latest` tag

**Symptom**: Running `npm install sigillum-js` installs `2.0.0-beta.1` instead of the stable `1.3.0`.

**Root cause**: `npm publish` defaults to the `latest` dist-tag. If you publish a prerelease version without specifying `--tag beta`, it becomes the default version for all users.

**Fix**: Detect the version and set the tag dynamically:

```yaml
- name: Determine npm dist-tag
  id: dist_tag
  run: |
    VERSION=$(node -p "require('./package.json').version")
    if echo "$VERSION" | grep -qE '(alpha|beta|rc)'; then
      echo "tag=beta" >> "$GITHUB_OUTPUT"
    else
      echo "tag=latest" >> "$GITHUB_OUTPUT"
    fi

- name: Publish to npm
  run: npm publish --provenance --access public --tag ${{ steps.dist_tag.outputs.tag }}
```

---

## Debugging Checklist

When a publish fails, check in this order:

1. **npm version**: Is it >= 11.5.1? (`npm -v` in CI logs, under "Setup Node.js" → "Environment details")
2. **NODE_AUTH_TOKEN**: Is it set? It should **not** be set for the publish step
3. **Workflow filename**: Does it match exactly what's configured on npmjs.com?
4. **repository.url**: Does `package.json` match the GitHub repo?
5. **Permissions**: Does the job have `id-token: write`?
6. **Runner**: Is it GitHub-hosted? (self-hosted runners are not supported)
7. **npm Trusted Publisher config**: Is it configured for the correct package on npmjs.com?

## Timeline of Issues (v2.0.0-beta.1)

| Attempt | Error | Root Cause | Fix |
|---|---|---|---|
| 1 | `MODULE_NOT_FOUND: promise-retry` | `npm install -g npm@latest` corrupted npm on Node 22 | Removed the step |
| 2 | `TS6196` / `TS2339` DTS build errors | Unused imports and untyped `$on` API | Code fixes in `miniapp.ts` and `ReplayPlayer.tsx` |
| 3 | `E404 Not Found` | npm 10.x doesn't support OIDC | — (misdiagnosed as token issue) |
| 4 | `ENEEDAUTH` | Added `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` (empty) which overrode OIDC | Removed the env var |
| 5 | `E404 Not Found` | Still npm 10.x (Node 22) | Upgraded to Node 24 |
| 6 | **Success** | — | — |

## References

- [npm Trusted Publishing docs](https://docs.npmjs.com/trusted-publishers)
- [npm provenance docs](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub Actions OIDC docs](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [OpenSSF Trusted Publishers specification](https://repos.openssf.org/trusted-publishers-for-all-package-repositories)
