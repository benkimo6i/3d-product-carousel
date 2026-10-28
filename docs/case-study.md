# Case study: a 3D product carousel

**Live demo: https://benkimo6i.github.io/3d-product-carousel/** · [Back to the README](../README.md)

This started with conversations with colleagues about where web UI is heading. A few ideas kept
coming up: pages that feel **composed, like editorial print**, rather than stacked from templates;
**the product itself as the interface**, a live object you handle instead of photos you scroll
past; and, as more of the routine interface gets generated or handled by agents, **less chrome and
more object**, so that what's left to design is the experience itself: the object, the motion, the
feel.

I found a way into that idea in an unexpected place: a vintage computer print ad, with the product
dead center and the copy arranged around it like a magazine spread. I wanted to bring that picture
in my head to life: a row of products you scroll through, each one opening into a print-ad-style
details view where you can pick the product up and turn it.

I set the creative direction and designed the experience (the look, the layouts and how it moves),
and built it with Claude Code doing the hands-on work under my direction, first in Blender (through
MCP for Blender) to set up the scene, then in the codebase for the web build.

This is how it came together: the art direction, the Blender setup, why I built it on React Three
Fiber, what working and debugging with Claude looked like, and where I think this way of working is
heading.

## Art direction

The direction came down to one idea: **nostalgia helps sell**. A familiar, slightly retro
composition makes people slow down and look, and pairing it with a crisp modern aesthetic keeps it
from feeling like a pastiche. So two references shaped the look, one old and one new.

**Modern Apple product pages** set the tone for the carousel: a quiet light-gray stage, big confident
type, one product in focus with its neighbors peeking in at the edges, small round paddles, and
understated "Explore" links. Everything else stays out of the way of the product.

**A vintage computer print ad** set the layout of the details view. I loved how it puts the product
dead center, front-on, with a huge headline above it and short copy blocks arranged around it in
columns, more like a magazine spread than a web page. The details view borrows exactly that
structure, rebuilt in a modern style: no blue-gray paper or period type, just the composition.

<p align="center">
  <img src="media/heathkit-ad.jpg" alt="Vintage Heathkit H89 print ad: a large 'no loose ends' headline, the computer front-on in the center, and copy columns on either side" width="560">
  <br>
  <sub>Layout reference: Heathkit H89 All-In-One Computer advertisement, Heath Company (c. 1979).</sub>
</p>

A few decisions followed from those references:

- **One consistent set.** The products come from different Sketchfab artists, so they were reshaded
  with a shared material library (finishes, glass, satin and matte blacks, emissive screens) so they
  read as one family under one light.
- **Normalized sizes.** A Watch next to an iMac at real scale would be a speck. Every product is
  scaled to fill about the same space on the stage, except the two MacBook Pros, which keep their
  real relative sizes because comparing them is the point of the toggle.
- **A fixed camera.** The carousel camera never moves between products; the row slides under it.
  That makes switching feel like a single continuous object rather than a sequence of shots.
- **Copy that frames the product.** Placeholder, Apple-style copy, written to the shape of the
  layout: a headline, a one-line subline and three short blocks on each side.

## Setting up the scene: Claude + MCP for Blender

My background is in engineering rather than 3D. Materials, lighting, rigging, shadow baking and
export pipelines are a craft of their own, and on my own this is where the project would most
likely have stalled. [MCP for Blender](https://mcp-for-blender.com/) changed that: it lets Claude
drive a live Blender session, so I could direct the 3D work the way I'd direct a 3D artist, while
Claude did the hands-on Blender work. It augmented the design and rendering side I don't
specialize in.

Before writing any web code, I wanted the 3D assets right, so the first phase happened entirely in
Blender. I described what I wanted, Claude wrote and ran the Blender Python and showed me viewport
renders to review. Then I gave notes and we went again.

- **Importing and auditing.** I picked free models on Sketchfab. Claude imported them, put each in
  its own collection and reported the mesh, triangle and material counts, so we knew where the
  weight was (the MacBook Pro 14" alone was 164k triangles and 28 materials).
- **Reshading.** Claude built the shared material library and remapped every model to it, keeping
  only the textures that carry real detail: keycaps, the Watch band, speaker grilles. Screens became
  emission-only so they glow the same everywhere.
- **Layout, camera and light.** The products went into a row on a seamless sweep with a 70mm-style
  camera from the front-left (38° around, 22° down) and a soft key spotlight. I reviewed renders and
  adjusted spacing, the iPhone's lean and the MacBook pairing until the composition held.
- **Rigging the MacBooks.** Each MacBook's lid was split into its own part with a hinge pivot, and
  the hinge angles were checked through the full swing so the lid never dips into the keyboard.
  That's what makes the close-swap-open toggle possible on the web.
- **Web-ready exports.** Every product was exported twice: a decimated carousel version (about
  20–40k triangles) and a full-detail version that only loads for the details view. Cameras, slot
  spacing and per-product settings were written into a JSON manifest the web app reads.
- **Baked shadows.** Real-time shadows in three.js weren't behaving at this tiny scale, so Claude
  rendered soft floor shadows in Cycles with a shadow catcher, one per product (two for the
  MacBooks, open and closed), and the web app lays them on the floor as textures.

## Building it: why React Three Fiber

This piece is half 3D scene and half web page, and [React Three Fiber](https://r3f.docs.pmnd.rs/)
(R3F) lets both live in one React app. It's a
React renderer for three.js: the same engine underneath, but the scene is written as components.
Compared with building it in plain three.js, that paid off in three ways.

**Code and component organization.** In plain three.js, a scene like this is one long imperative
setup: create a renderer, a scene, cameras, lights and loaders, add and remove objects by hand, wire
up a render loop and raycasting, and remember to dispose of everything. In R3F the scene reads like
the page it is part of: a `<Stage>`, a `<Carousel>`, a `<Product>` per item, a `<CameraRig>`. Each
piece owns its own state and its own per-frame logic (a `useFrame` hook), so the camera, the
products, the label anchoring and the drag controls are separate, readable files instead of
branches in one big loop. The copy, labels and controls stay ordinary HTML and CSS on top of the
canvas, which keeps them accessible, selectable and responsive.

**Scalability and flexibility.** The carousel is data-driven: products, their order, cameras and
per-product settings come from a JSON manifest, and the scene maps over it. Adding a product is a
manifest entry, its model files and its copy, not new scene code. React features carry straight
over to 3D: each product loads behind its own `Suspense` boundary (so products stream in independently and one
slow model doesn't block the rest) and its own error boundary (so a broken model fails alone). The
same component can swap its lightweight carousel model for the full-detail one just by rendering a
different child. The drei library adds ready-made loaders and environment lighting, and GSAP and zustand plug in
like they would in any React app.

**Performance.** R3F uses the same three.js renderer, so the speed comes from patterns it makes
easy:

- Rendering on demand is one prop (`frameloop="demand"`): the canvas draws nothing while idle, and
  anything that moves asks for frames only while it's moving.
- Values that change every frame (scroll progress, the details transition, lid angles) live outside
  React and are read in `useFrame`, so animation never re-renders components sixty times a second.
  React state is kept for the slower things: which product is open, which copy is showing.
- Per-component control made the optimizations local: off-screen products skip their own work,
  phones render at a capped pixel ratio, and each model compiles its shaders and uploads its textures
  as soon as it loads, rather than stuttering the first time it appears.

A few other decisions shaped the architecture:

- **Scroll as the single source of truth.** GSAP's ScrollTrigger turns the page's scroll position
  into a progress value, and the row's position comes straight from it. Every way of moving
  (scrolling, swiping, the paddles, snapping) ends up as a change to the page scroll, so there's
  only ever one place the carousel's position can come from.
- **One camera, two poses.** The camera orbits its target in spherical coordinates, so going from the
  carousel to a details view is an arc around the product, and switching products inside details
  slides the row while the camera holds its front-on view.
- **Layout-driven framing.** The details layout is real HTML/CSS with an empty slot where the
  product goes. The camera measures that slot and the product's actual silhouette, then sizes and
  shifts the shot to fit it. Restyling the layout at any breakpoint just works, and the 3D product
  follows.
- **An asset pipeline, not hand edits.** The Blender exports stay lossless; one script
  (`npm run optimize`) dedups and merges materials, resizes textures by role, encodes them as KTX2
  (which stays compressed on the GPU) and compresses geometry with Meshopt. Re-exporting from
  Blender and re-running the script is the whole update loop.

## Collaborating and debugging with Claude

The way we worked settled into a rhythm. I'd describe what I wanted, often as an annotated
screenshot, and Claude would ask clarifying questions before touching anything, then make the
change and verify it in a real browser (via Claude in Chrome) before handing it back: measuring
layout positions, sampling animations frame by frame, and running accessibility scans.

<p align="center">
  <img src="media/tablet-layout-notes.png" alt="Annotated screenshot of the details view: notes to left-align the header copy, stack the copy into one scrollable column whose blocks fade in and out at the edges, and keep the product canvas fixed on the right" width="480">
  <br>
  <sub>My notes for the tablet layout: left-aligned header, one scrolling copy column, fixed product
  canvas.</sub>
</p>

Some of the bugs we tracked down along the way:

- **The product that wandered off on resize.** Resizing the window in the details view sometimes
  left the product off-center. Reproducing it showed the scroll library recalculating positions
  after the page height changed and quietly moving the carousel to a different product. The fix
  remembers which product was open before the layout refresh and returns to it afterward.
- **Scroll-jacking versus scrubbing.** The first carousel moved one product per scroll gesture. It
  worked, but kept needing special cases for trackpad momentum, fast flicks and sideways swipes.
  After trying a scrub mode, I preferred it: scrolling moves the row directly, and it only snaps
  when you stop close to a product. The paddles still step one product at a time.
- **The snap that fought back.** Sideways swipes felt like a tug-of-war. Simulating a swipe with
  small hesitations showed the snap starting during a 250ms pause mid-swipe, then being canceled
  by the next movement, over and over. The snap now waits until there has been no input at all
  for 350ms.
- **Textures that wouldn't compress.** Normal maps came out barely smaller as KTX2. Inspecting the
  encoder commands showed the build tool silently dropping the compression-optimization flags, so
  the pipeline now runs that encoding step directly with the right flags.
- **A stowaway in every model.** Every exported file was bigger than it should have been. A
  second scene used for baking shadows was being exported into every file, with its own copy of a
  laptop. One export setting (active scene only) fixed it.

## What I'd take away

- **Get the assets right first.** Doing the scene, materials, rigging and exports in Blender before
  any web code meant the web build started from a solid, consistent set rather than fighting seven
  different models.
- **Let the layout lead.** Making the 3D framing follow the HTML layout, rather than the other way
  around, made the responsive work far easier.
- **Verify in the real browser.** Most of the hard bugs only showed up with real scrolling, real
  timing or a real resize. Measuring them in the browser was what made them fixable.
- **Directing with AI works best with tight loops.** Clear references, annotated screenshots and
  questions answered up front, followed by small changes checked one at a time, kept the project
  moving without losing the design intent.

## Where I think this is heading

Building this changed how I think about front-end work. A few years ago, a piece like this would
have needed a 3D artist, a motion designer and a front-end engineer; here, one engineer directed
all three disciplines, with AI doing much of the hands-on work. I don't think that replaces those
specialists, but it does change where the leverage is: in knowing what good looks like, framing the
problem clearly, and judging the result, more than in typing every line or placing every vertex.

I also suspect the role of the interface itself is shifting. If more everyday tasks move through
agents and conversation, the generic parts of UI (forms, lists, settings screens) matter less, and
may increasingly be composed on the fly from well-built components. What stays valuable is what
can't be generated generically: distinctive experiences like this one, and the solid, accessible,
well-documented building blocks that people and agents assemble from. For front-end developers
that points toward a blend of engineer, designer and director: building fewer one-off screens and
more of the primitives and experiences everything else is built from. It's a prediction, not a
certainty, but this project felt like a small preview of it.
