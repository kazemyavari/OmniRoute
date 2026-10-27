---
title: "Maintaining the ChatOne OmniRoute fork"
version: 3.8.52
lastUpdated: 2026-10-27
---

# Maintaining the ChatOne OmniRoute fork

This fork carries a small, source-level delta over upstream OmniRoute. Its base tag,
commit, fork revision and Docker base digest are recorded in
`config/chatone-fork.json`. Upstream code and license notices remain intact.

## Current source changes

- Preserve flat and nested URL citations when translating Chat Completions into
  Responses, including late citations and separate messages around tool calls.
- Preserve provider-reported image usage, cost and explicit generation identity in
  the image result and edit HTTP response. A proxy request UUID is generated only
  when absent; it is never presented as a provider generation ID.
- Unknown image cost stays absent. Zero does not become a positive-cost header;
  ChatOne must still reconcile missing, invalid or zero-cost evidence.

These are transport fixes, not a claim that every provider/model supports every
capability. Provider choices and OAuth credentials are runtime configuration.
The existing `interceptSearch: false` setting belongs to the affected OpenRouter
model's configuration; this fork does not change all providers' search behavior.

## Verify and build

Use a supported Node runtime from `package.json` and the committed lockfile:

```sh
npm ci --no-audit --no-fund
npm run check:chatone
npm run test:chatone
npm run typecheck:core
npm run test:unit
npm run test:vitest
docker build --target runner-base \
  --build-arg OMNIROUTE_BUILD_MEMORY_MB=6144 \
  --build-arg OMNIROUTE_BUILD_WORKERS=2 \
  -t "chatone/omniroute:$(git rev-parse --short=12 HEAD)" .
```

Build on a host with at least 16 GB RAM. The 6144 MB heap and one page-data
worker follow the upstream Docker defaults; a 4096 MB override exhausted the
webpack production optimizer during fork verification. Runtime memory settings
are separate from this build budget.

The base image is pinned by digest and application dependencies by lockfile.
Upstream's Dockerfile still installs OS updates and some tools at build time;
this is a source-reproducible build recipe, not a bit-for-bit reproducibility
guarantee. Keep the resulting image digest for release and rollback. Never use
an upstream `latest` image or run `npm update` as a fork upgrade mechanism.

The `ChatOne fork contracts and Docker build` workflow runs contract tests,
core typechecking and Vitest, then builds the committed Docker source. It never
publishes a package or deploys a service. Full unit tests and live acceptance
remain release gates, even when that focused workflow is green.

## Isolated local runtime

```sh
cp config/chatone.env.example .env.chatone
# Fill JWT_SECRET, API_KEY_SECRET and INITIAL_PASSWORD locally.
# Set CHATONE_OMNIROUTE_IMAGE to the exact image tag built above.
docker compose --env-file .env.chatone -f docker-compose.chatone.yml up -d
```

The default port is **20129**, bound to loopback; the data volume is separate
from an existing gateway. Do not copy or mount live data just to test startup.
The image's existing healthcheck verifies readiness. For real cutover, back up
the existing data with SQLite's online backup facility or while the service is
stopped, and preserve the original encryption secrets through secure local
configuration. New secrets cannot decrypt existing provider credentials.

Never commit the local env file, a database, OAuth tokens, captured customer
requests, or a Docker build context containing those files. The `runner-base`
target supports ordinary API/OAuth providers; browser-cookie providers may need
the upstream `runner-web` target and its additional browser dependencies.

## Receiving upstream updates

Maintain two remotes: `origin` is this fork, `upstream` is the original project.
Use an explicit release tag and a dedicated upgrade branch. Do not overwrite the
maintained branch with GitHub's upstream branch or force-push to synchronize it.

```sh
git remote -v
# Add only if absent:
git remote add upstream https://github.com/cheaper-inference/OmniRoute.git
git fetch upstream --tags
# A shallow clone must acquire history before merging:
git rev-parse --is-shallow-repository
# If the preceding command printed true:
git fetch --unshallow upstream
git switch feat/chatone-maintained
git switch -c fix/chatone-upgrade-vX.Y.Z
git merge --no-commit --no-ff vX.Y.Z
```

Replace `vX.Y.Z` with the selected real tag. Inspect changes, resolve conflicts,
and remove a fork patch only when upstream has an equivalent fix and its
regression tests pass. Update the manifest's tag, commit and version to the
merged upstream release, refresh the Docker digest intentionally, and keep the
fork revision distinct. Record a **local candidate merge commit first** so the
ancestry check can validate the new upstream against `HEAD`:

```sh
git add <resolved-files> config/chatone-fork.json Dockerfile
git commit -m "chore: merge selected upstream release"
```

Then run all verification commands above. Fix failures with additional commits
or amend the local candidate; do not promote or deploy it before all gates pass.
Open a PR **in this fork** targeting `feat/chatone-maintained`.

Retain merge ancestry; do not squash away the upstream release relationship.
Check it with `git merge-base --is-ancestor <upstream-commit> HEAD`. Once approved,
build a new immutable image. Promotion and deployment are separate steps.

## Live acceptance before promotion

Use authorized test credentials locally and test each deployed provider/model:

| Capability            | Required evidence                                                                    |
| --------------------- | ------------------------------------------------------------------------------------ |
| Web search            | Final answer plus structured citations, streaming and JSON                           |
| Files                 | Known text from uploaded TXT/PDF/DOCX; verify ChatOne extraction too                 |
| Vision                | Known content of a supplied image                                                    |
| Image generation/edit | Valid output; reference image actually used; usage and identity preserved            |
| Prompt cache          | Repeated eligible prefix and provider-reported cache usage                           |
| OAuth                 | ChatGPT/Codex, Claude and Google channel tested separately; include refresh/failure  |
| Billing               | Positive real cost or explicit unknown/reconciliation; never assume zero is final    |
| Isolation             | Organization key boundaries, access revocation and settlement attribution            |
| Streaming             | Cancellation, tool boundaries, late usage, malformed upstream and reconnect handling |

A green unit suite is not proof of live account entitlements or provider uptime.
In particular a Google AI subscription does not establish every Gemini channel's
available capabilities. Record the tested channel, model and date privately.

## Rollback

Retain the previous image digest and a matching data backup. If an upgrade ran
database migrations, check backwards compatibility before reusing that database;
rolling back the image alone is not a guaranteed database rollback. Restore a
matching backup when required. Never delete the old live data volume as part of
an upgrade test.
