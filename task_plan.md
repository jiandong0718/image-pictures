# Task Plan: Deploy Image Design Workbench

## Goal
Deploy the current `image-design-workbench` Node.js app to `81.70.37.224` without exposing secrets.

## Current Phase
Phase 2

## Phases

### Phase 1: Access & Discovery
- [x] Establish SSH access
- [x] Identify remote OS, package manager, existing panel/nginx state
- [x] Document findings in `findings.md`
- **Status:** complete

### Phase 2: Package & Transfer
- [ ] Prepare deploy archive excluding generated output and local metadata
- [ ] Transfer project to the server
- [ ] Preserve `.env` securely without printing secrets
- **Status:** in_progress

### Phase 3: Runtime Setup
- [ ] Install or confirm Node.js, Python 3, and image normalization tooling
- [ ] Configure a process manager or service
- [ ] Run the app on loopback
- **Status:** pending

### Phase 4: Reverse Proxy & Verification
- [ ] Configure Nginx or existing panel reverse proxy
- [ ] Verify HTTP access and app health
- [ ] Document final URL and commands used
- **Status:** pending

## Key Questions
1. Does SSH login with the updated root password succeed?
2. Is Nginx already managed by BaoTa, and should deployment use that stack?
3. Does the Linux server need ImageMagick support for generated image normalization?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Do not place passwords or API keys in commands or planning files | Avoid shell history, process list, logs, and repository leakage |
| Use loopback Node service behind reverse proxy | The app defaults to `127.0.0.1:4173`, which is safer than direct public exposure |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Previous SSH attempts failed with `Permission denied` | 1 | Retry with newly provided credential through interactive stdin only |
