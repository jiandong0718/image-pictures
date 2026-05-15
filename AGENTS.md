# Repository Guidelines

## Project Structure & Module Organization

This repository contains a local product image design workbench and a reusable image-generation skill.

- `image-design-workbench/` contains the runnable Node.js web app.
- `image-design-workbench/server.js` serves the UI, image APIs, upload handling, and generated image output.
- `image-design-workbench/public/` contains browser assets: `index.html`, `styles.css`, and `app.js`.
- `image-design-workbench/tests/` contains Node test files, currently focused on image dimension validation.
- `skills/custom-image-generator/` contains the Python image-generation skill, scripts, and reference docs.
- Runtime output is written under `image-design-workbench/generated-images/` and is ignored by Git.

## Build, Test, and Development Commands

Run commands from `image-design-workbench/` unless noted otherwise.

```bash
npm run dev
```

Starts the local workbench at `http://127.0.0.1:4173`.

```bash
npm start
```

Equivalent to `npm run dev`; runs `node server.js`.

```bash
npm test
```

Runs the built-in Node test suite with `node --test`.

## Coding Style & Naming Conventions

Use CommonJS modules for server-side JavaScript, matching `server.js` and the existing tests. Prefer `const` by default, `let` only when reassignment is needed, and two-space indentation. Keep browser code in `public/app.js`, styling in `public/styles.css`, and server-only logic in `server.js`.

Use descriptive camelCase names for JavaScript variables and functions. Use kebab-case for generated image prefixes and public-facing file names, for example `white-background` and `selling-points`.

## Testing Guidelines

Tests use Node's built-in `node:test` module with `node:assert/strict`. Place test files in `image-design-workbench/tests/` and name them `*.test.js`. Add focused tests for server helpers when changing image validation, normalization, upload parsing, or output path behavior. Run `npm test` before opening a pull request.

## Commit & Pull Request Guidelines

The current history only contains `Initial commit`, so keep new commits short, imperative, and scoped, for example `Add upload size validation` or `Update workbench styles`.

Pull requests should include a brief description, the commands run for verification, and screenshots or screen recordings for UI changes. Link related issues when available. Do not commit `.env`, API keys, generated images, temporary response JSON, or `node_modules/`.

## Security & Configuration Tips

Copy `image-design-workbench/.env.example` to `.env` for local API settings. Keep `CUSTOM_IMAGE_API_KEY` private. Prefer environment variables for alternate Python commands, API bases, models, or custom skill script paths.
