# Findings & Decisions

## Requirements
- Deploy the current local project to server `81.70.37.224`.
- Keep password and API key private.
- Prefer direct deployment by Codex once SSH access works.

## Research Findings
- The runnable app is in `image-design-workbench/`.
- Start command is `node server.js` via `npm start` or `npm run dev`.
- Default binding is `HOST=127.0.0.1` and `PORT=4173`.
- Runtime generated images are under `image-design-workbench/generated-images/` and should not be deployed as source artifacts.
- The app reads `image-design-workbench/.env` for image generation API settings.
- The default image normalizer is `sips`, which is macOS-specific; Linux deployment likely needs ImageMagick support or an app change.
- SSH login as `root` succeeded with the updated credential.
- Remote server is OpenCloudOS 9.4.
- BaoTa is installed and running; `bt status` reports panel/task processes active.
- Nginx is installed and listening on 80/888, though `systemctl is-active nginx` reports inactive, so it appears managed outside normal systemd service state.
- Remote server did not have Node.js, npm, PM2, ImageMagick `magick`, or ImageMagick `convert` before setup.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Upload app source without `generated-images/`, `.git/`, `.DS_Store`, and `node_modules/` | Reduces transfer size and avoids runtime/generated artifacts |
| Keep `.env` on the server as a local secret file | App needs API settings, but secrets must not be printed or committed |
| Add ImageMagick command support before deployment | Linux cannot run macOS `sips`; ImageMagick is the practical server-side normalizer |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| SSH reached authentication but failed for the earlier password | Use new credential interactively and do not echo or log it |

## Resources
- Local app: `image-design-workbench/server.js`
- Local package: `image-design-workbench/package.json`
- Local README: `image-design-workbench/README.md`
