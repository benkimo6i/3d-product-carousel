# 3D product carousel

**Live demo: https://benkimo6i.github.io/3d-product-carousel/**

<!-- Preview GIF goes here once recorded:
![Scrolling through the carousel, switching MacBook sizes and opening a product's details view](docs/media/preview.gif)
-->

A scroll-driven 3D product carousel in the style of a modern product page. Scroll or swipe through
the lineup, open any product for a print-ad-style details view, and drag to turn it in your hands.

Portfolio demo: product names and copy are placeholders, not affiliated with Apple.

## Features

- **Scrub-and-snap carousel**: scrolling or swiping moves the row directly; let go near a product
  and it glides into place.
- **Details view**: the camera arcs round to a front-on view with headline and copy laid out around
  the product. Drag to rotate it freely; on release it settles into the nearest good angle.
- **Switch products in place**: step to the next product without leaving the details view.
- **MacBook Pro 14"/16" toggle**: the lid closes, the machines crossfade, the other lid opens, at
  their real relative sizes.
- **Responsive layouts**: a three-column print-ad layout on desktop, product beside a scrolling copy
  column on tablets, and a stacked layout on phones.
- **Accessible**: keyboard and screen-reader friendly (details is a proper modal dialog), AA
  contrast, and reduced-motion support.

### Controls

| | Carousel | Details view |
|---|---|---|
| Scroll / swipe | Scrub the row (vertical or sideways); snaps when you stop near a product | Scroll the copy; swipe sideways to switch products |
| Paddles ‹ › | One product left or right | Previous / next product |
| Click a product or **Explore** | Open its details | — |
| Drag | — | Rotate the product |
| Keyboard | Tab to the paddles and Explore | ← / → switch products, Esc closes |

## Tech

React 19, [React Three Fiber](https://r3f.docs.pmnd.rs/) and [drei](https://drei.docs.pmnd.rs/) on
three.js, [GSAP](https://gsap.com/) (ScrollTrigger, ScrollTo) for scroll and timelines,
[zustand](https://zustand.docs.pmnd.rs/) for state, Vite and TypeScript. Models were prepared in
Blender and optimised with [glTF Transform](https://gltf-transform.dev/) and
[KTX-Software](https://github.com/KhronosGroup/KTX-Software).

### How it works

- **Scroll drives everything.** The page scroll is the carousel's single source of truth:
  ScrollTrigger maps it to a progress value that slides the product row. Snapping and the paddles
  just animate the page scroll.
- **One camera, two poses.** The camera orbits a target in spherical coordinates, so moving between
  the carousel and a details view is an arc around the product rather than a straight dolly.
- **Layout-driven framing.** The details layout is plain HTML/CSS. Each frame the camera reads where
  the layout leaves room for the product, then sizes and shifts the shot to fit it, so the 3D
  product always sits in its slot at any screen size.
- **Render on demand.** The canvas only draws while something moves (scrolling, a tween, a drag),
  and nothing at all while idle, which saves battery on phones and laptops.
- **Lightweight assets.** Products stream in nearest-first; textures are KTX2 (they stay compressed
  on the GPU) and geometry is Meshopt-compressed. Soft floor shadows are baked in Blender rather than
  rendered live.

## How it was made

I art-directed and designed the piece, and built it with Claude Code as my hands-on collaborator:
in Blender through MCP for Blender for the 3D scene, and in the codebase for the web build, checking
every change in the browser along the way. The [case study](docs/case-study.md) walks through the
art direction, the Blender setup, the React Three Fiber architecture and how we debugged it.

<table>
  <tr>
    <td width="55%" valign="top">
      <a href="docs/case-study.md#art-direction"><img src="docs/media/heathkit-ad.jpg" alt="Vintage Heathkit H89 print ad with a large headline, the computer front-on in the centre and copy columns either side"></a>
      <br><sub><b>Art direction:</b> the details view borrows its layout from a vintage print ad
      (Heathkit H89, Heath Company, c. 1979).</sub>
    </td>
    <td width="45%" valign="top">
      <a href="docs/case-study.md#collaborating-and-debugging-with-claude"><img src="docs/media/tablet-layout-notes.png" alt="Annotated screenshot of the details view with notes for the tablet layout"></a>
      <br><sub><b>Working with Claude:</b> annotated screenshots like this one directed each layout
      change.</sub>
    </td>
  </tr>
</table>

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

## Credits & licenses

3D models from Sketchfab, used under their creators' licenses (reshaded and optimised for this
demo):

| Model | Author | License |
|---|---|---|
| [MacBook Neo](https://sketchfab.com/3d-models/macbook-neo-f3dd26684f114b1baffd1b0800876627) | Ranguel | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [MacBook Pro 14-inch M5](https://sketchfab.com/3d-models/macbook-pro-14-inch-m5-652a992f4f244122ae251f9cbb81da1e) | Apple User | Sketchfab Free Standard |
| [MacBook Pro M3 16-inch 2024](https://sketchfab.com/3d-models/macbook-pro-m3-16-inch-2024-8e34fc2b303144f78490007d91ff57c4) | jackbaeten | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [iMac 2021](https://sketchfab.com/3d-models/imac-2021-304cb06ffb554883a7a642b2b56754c1) | DatSketch | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [iPhone 17 Pro](https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec) | Ranguel | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Apple Watch Ultra 2](https://sketchfab.com/3d-models/apple-watch-ultra-2-f33263c457664b43909200c5ed5e6fa2) | polyman Studio | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [AirPods (3e génération)](https://sketchfab.com/3d-models/ed331e742ab944e683dcddd59ab0713e) | polyman Studio | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

The code is released under the [MIT License](LICENSE). The 3D models are not covered by it; they
remain under the licenses above. Product names are trademarks of their owners.
