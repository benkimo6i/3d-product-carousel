# 3D product carousel

A scroll-driven 3D product carousel (React Three Fiber, GSAP). Scroll, swipe or use the paddles to
step through the lineup; open any product for a rotatable details view.

Portfolio demo: product names and copy are placeholders, not affiliated with Apple. 3D model credits
are listed in the site footer.

## Develop

```sh
npm install
npm run dev
```

## Models

`public/models/` holds the web-ready models (KTX2 textures, Meshopt geometry). They're built from
lossless Blender exports by `npm run optimize` (`scripts/optimize-models.mjs`), which needs
[KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases) 4.x installed. The Blender
sources aren't part of this repo.

## Deploy

- Pushes to `main` publish to GitHub Pages (`.github/workflows/deploy.yml`).
- Every pull request gets a preview at `…/pr-preview/pr-<number>/`, linked in a PR comment
  (`.github/workflows/preview.yml`).
