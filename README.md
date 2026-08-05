# AutoCrate ✕ Zoo.dev

**Drop in the STEP file of a machine. Seconds later, know whether its shipping
crate fits in a container — and what it costs if it doesn't.**

Built for the [Zoo API Makeathon](https://zoo.dev/events/api-makeathon), a fully virtual
makeathon running 22 July to 5 August 2026.

**[Watch the one-minute demo video](https://github.com/YacineMojo/Zoo_Makeathon-Autocrate/blob/main/docs/demo.mp4)**
— the whole chain, from a customer STEP file to a costed crate.

![The landing page: what the tool does, and which Zoo APIs it uses](docs/accueil.png)

![The studio, opened on the KUKA KR 6 with its tool: parameters on the left, the generated crate in 3D, and the two exports](docs/atelier.png)

---

## The problem

A special-machine builder ships 5 to 50 unique machines a year. Nobody models
the crate: someone sketches it on a sheet of A4, the crate maker comes to
measure, and the crate comes out oversized "to be safe". It is packaging, not
product — nobody has time to open a CAD package for it.

The real cost is not the cubic metres of air being shipped. It is **crossing a
threshold**: three centimetres too much and you go from a standard 40-foot
container to a flat rack, or to an oversize road convoy. That is a multiplier on
price, and — worse — a multiplier on **lead time**. For a machine builder,
missing a shipping window costs more than the freight itself.

And nobody sees it until the crate has already been ordered, which is to say
until it is too late.

## What this does

You drop in the machine's STEP file — or a mesh, if you already have one — and
enter its mass. Seconds later you get a **crate pre-design**: the real
footprint, the generated crate structure, and a table of orientations with a
gauge verdict, a cost and a lead time for each.

It does not decide for you, and when there is nothing to decide it says so.

The worked example is the **KUKA KR 6 with its tool** — real manufacturer CAD,
5.4 MB of STEP, 10 bodies, MIT licence. It is the machine the studio opens on,
and `./script.sh` fetches it and has Zoo convert it, so every figure below is
reproducible. All of them are measured, none projected.

**What Zoo does with it:**

| Step | Whose | Measured |
|---|---|---|
| customer STEP → mesh | Zoo **File Format API**, async route | 239 s for 5.4 MB |
| reading the mesh | ours | 42,216 vertices, 172,676 faces, 10 bodies |
| footprint, poses, gauge verdicts | ours | 382 ms |
| the crate as b-rep | Zoo **Engine API** | 33 solids, 19 of them blocking, 0.1 s |
| STEP and glTF export | Zoo **Engine API** | one session, 4.5 s billed |
| re-measuring our own export | ours, on the returned glTF | 1,450 × 846 × 478 mm, matches the verdict |

The mesh is compacted 9.0 → 4.1 MB before it goes out, and the machine itself is
left out of the b-rep export: above 2 MB the Engine API fails after several
minutes. Both are measured limits, written up in [`FEEDBACK.md`](FEEDBACK.md)
among twelve notes on the Zoo APIs.

**And the study it produces:**

| Orientation | Crate L × W × H | Gauge | Cost |
|---|---|---|---|
| CAD frame (naive) | 1.13 × 0.53 × 1.17 m | LCL groupage | 953 € |
| Pose A — upright | 1.12 × 0.53 × 1.17 m | LCL groupage | 952 € |
| Pose B — laid on X | 1.21 × 0.53 × 1.08 m | LCL groupage | 950 € |
| Pose C — laid on Y | 1.45 × 0.85 × 0.48 m | LCL groupage | 908 € |

Four poses, one gauge, 45 € between the best and the worst. So the tool
recommends nothing, and says why:

> All poses fall in the same gauge — Ocean groupage (LCL), 12 days. The gap
> between them is plywood: keep the CAD frame, there is nothing to arbitrate.

An 88 cm robot crosses no gauge threshold, and that is the honest result at this
size. It is also the point: the tool arbitrates when there is something to
arbitrate, and stays quiet when there is not. On a machine that does cross a
threshold the same study saves **9,873 € and 9 days** — `./script.sh demo` runs
that case, on the one machine we are free to publish.

### Why the crate, and never the machine

The KR 6 laid on Y measures 1,200 × 596 × 276 mm. Its crate measures
1,450 × 846 × 478 mm: blocking, studs and panels add **250 mm on width and
202 mm on height**. It is the crate that meets the container door, never the
machine, so a margin measured on the machine is a number that will never be
loaded. On this robot it costs nothing. On the demo machine it turns a
comfortable-looking 340 mm into a 110 mm squeak — which is why the tool always
confronts the crate.

![The KUKA KR 6 with its tool inside its generated crate, chocks included](docs/caisse-ecorchee.png)

## Where Zoo does the work, and where we do

```
Zoo — File Format API   reads the customer's STEP, returns a mesh
our code                vertices → oriented footprint, poses, verdicts, costs
Zoo — Engine API        builds the crate as b-rep, exports the common STEP
Zoo — ML / Text-to-CAD  generated the demo machine (see "Machines" below)
```

**Zoo does no simulation and no business logic.** What makes this a Zoo showcase
rather than a Python script is that the generated geometry is **the consequence
of other geometry**: we consume the customer's CAD, measure it, compute, build
around it, and emit STEP that goes back into their PLM.

Three capabilities no three.js can replace, and which the project therefore
exercises end to end: **import real STEP**, **generate b-rep**, **export STEP**.

Timed end to end on the demo machine, by `./script.sh demo`:

```
reading the STEP (File Format API)       1.06 s  Zoo
reading the mesh, footprints, poses      0.01 s  us
crate, verdicts, costs                   0.00 s  us
opening the session (Engine API)         1.13 s  Zoo
importing the STEP as b-rep              0.35 s  Zoo
placing the machine in its pose          0.04 s  Zoo
building the crate as b-rep              0.12 s  Zoo
exporting the common STEP                0.13 s  Zoo
exporting the glTF for the viewer        2.20 s  Zoo
─────────────────────────────────────────────────
total                                    5.11 s
                                         99 % Zoo, 1 % us
```

**The ratio is the point, not the absolute.** Three consecutive runs gave 5.11 s,
5.78 s and 8.56 s: Zoo-side latency moves, and since 99 % of the wall clock is
Zoo, so does the total. Our own arithmetic stays at 0.01 s whatever happens.

`out/bout-en-bout.step` contains **the machine and the crate in one file**: 32
solids, the customer's b-rep and ours, in the same scene.

## Running it

```bash
git clone git@github.com:YacineMojo/Zoo_Makeathon-Autocrate.git && cd Zoo_Makeathon-Autocrate
cp .env.example .env     # then open .env and set ZOO_API_TOKEN=your_token
./script.sh              # installs, fetches and converts the KUKA KR 6, opens the studio
```

Then open <http://localhost:5174>.

**Without a Zoo API token, nothing runs.** Every conversion, every crate and every
render goes through the Zoo API, so the token is not optional: create one at
<https://zoo.dev/account/api-tokens> and put it in `.env` as `ZOO_API_TOKEN=…`.
If `.env` is missing, `script.sh` creates it from `.env.example` and stops with an
explicit message rather than letting you discover the problem on the first API
call. `KITTYCAD_TOKEN` is accepted as an alias.

**The first launch takes four to five minutes**, and says so before it waits: no
third-party STEP is committed here, so `script.sh` fetches the KR 6 from its MIT
source and has Zoo convert it — 5.4 MB of STEP is about four minutes. Every
launch after that is immediate. Drop your own STEP or OBJ at any time and the
studio uses it instead.

The other requirement is Node 20 or later; `script.sh` checks the version before
doing anything else.

```bash
./script.sh demo       # the full chain in the console, timed post by post
./script.sh test       # 74 unit tests
./script.sh verifier   # drives the workshop in a real browser, fails on any console error
```

## How it works

**Oriented footprint.** A STEP file is modelled in an arbitrary frame. An
axis-aligned bounding box on a machine drawn askew is visibly too big. We
project the vertices onto the horizontal plane, take the 2D convex hull, then
sweep 180 steps of 0.5° over 90° and keep the **narrowest** rectangle, not the
smallest one (see *Yaw minimises width, not area* below; area only breaks ties
between two angles of equal width). The vertical axis never moves, so height is
free. No rotating calipers: brute force at half a degree is exact at the
precision that matters and fits in thirty readable lines.

**Three poses, not six.** The six permutations of a triplet only make sense for
a box aligned to the file's axes. Once yaw is optimised, the (length, width)
permutation is already absorbed by the sweep. What remains is which machine axis
points up. Flipping 180° changes no dimension. Plus **one reference line** — the
naive box in the CAD frame. That is not a fourth pose, it is the *before*.

**The crate.** Skids sized to the mass, floor, stud spacing by span, plywood
panels. Boxes only — no booleans, no fillets, no real joinery. Rules of thumb,
parameterised and displayed on screen as assumptions. Never a timber
calculation note.

**Blocking, against where the machine actually is.** A bounding box is not
enough — and neither is a single slice. Laid on its side, our demo machine
touches the floor over a 160 mm strip at one end: a stop placed anywhere else
along that same wall bears on the crate and on nothing else. It looks like a
chock and is not one.

So the placed mesh is cut into **columns**, and each column is measured
separately. A stop is only placed in a column where the machine is actually
present at that height, and it runs from the wall to the machine *as measured in
that column*. Where the machine is not, there is no chock. Verified on the demo
machine: every stop that should bear on the part does, to within 5 mm.

**Clearance is a sum, and the sum is shown.** 70 mm per face is 45 mm of side
rail plus 25 mm of placement tolerance; 95 mm above is 70 mm of top batten plus
the same 25 mm. Blocking that fills the entire clearance leaves nothing to lower
the machine through — on paper it no longer fits its own crate. That mistake
was in the code for a day.

**And the blocking is weighed and priced.** Wood in the chocks is roughly 40 kg
on the demo machine and the tare feeds the payload check, so leaving it out
understated the gross mass. The estimate used for the tare is deliberately
conservative — it assumes the heavy case — and the geometry actually drawn stays
under it.

**No three-metre blocks.** When a machine sits far from a wall, the gap is
closed with two pieces and a void between them, the way a crate maker does it.
Before that fix one chock came out 3,000 mm deep in solid timber.

This is a **blocking principle**: position and envelope, nothing else. No bill of
materials, no nailing pattern, no section justified by a calculation. And it
does not say where the machine may be pushed against — a sheet-metal cover and a
cast-iron frame look alike in a mesh. Without material and an assembly tree you
block against the envelope, and you say so. The crate maker stays in the loop.

No diagonal bracing either: real bracing is oblique, and our model only produces
axis-aligned boxes. Rather than calling a horizontal member "bracing", we place
what we actually place — a mid-height side rail that stiffens the panel.

**Yaw minimises width, not area.** This is not a detail. The verdict never
depends on floor area: it depends on one dimension, the one that touches the
gauge. Height is fixed by the pose, length only binds at twelve metres — width
is all yaw can act on. Minimising area is a proxy, and it betrays. Measured on
our two large files:

```
machine-demo, X axis   min area 3100 × 1900   min width 3635 × 1725   175 mm
KUKA KR 600,  Y axis   min area 3168 × 2201   min width 3627 × 2090   111 mm
```

On the KR 600 those 111 mm take the crate from 2431 to 2320 mm, under the
2340 mm door opening of a 40-foot container: the same machine changes gauge.
(The KR 600 R2830, the measurement file — not the KR 6 the studio opens on,
which at 88 cm crosses no threshold at all.)

**Five gauges, two cost regimes.** LCL groupage, 20' and 40' standard, 40' High
Cube, road trailer. Groupage is not a container, it is a **pricing regime**: you
pay per cubic metre, not per box. It is also the first threshold a builder
shipping five machines a year actually meets — long before a flat rack. The
gauge retained is the cheapest **in total**, not the one with the smallest flat
fee, since those are no longer the same thing.

**The verdict is an `if`.** Container and trailer dimensions are constants.
Door opening and internal height are checked **separately**, because a load can
fit the volume and not clear the doors. Best value-for-effort in the whole
project. Any clearance under 50 mm is reported as *passes narrowly, confirm with
the crate maker* — nineteen millimetres is a warped panel or a nail head.

**A payload refusal is invariant under orientation.** 45 t in a one-cubic-metre
crate is a mass problem: no pose fixes it and neither does a flat rack. The tool
says so in one sentence instead of showing a pose table that implies otherwise.

**If nothing fits**, both outcomes are priced: out-of-gauge (flat rack, OOG,
special convoy) and splitting into two crates. **The tool does not split.** It
does not read the assembly tree and does not decide the split — that is an
engineering decision that does not belong to it. It prices both and lets you
choose.

**But it can say what costs.** The assembly tree looked like the trap of the
project: product hierarchy does not survive the import path, and the names come
out as `Unnamed-0`, `Unnamed-1`. **The grouping survives, though**: fifteen
bodies for the demo machine, thirty-seven for the KUKA KR 600, ten for the KR 6.
Names are lost, bodies are not, and naming pieces is not what is needed
here — geometry is.

So when nothing fits, the tool tries cutting planes from the top down and
reports which bodies stick out. On the demo machine standing upright:

> Five bodies out of fifteen carry the overrun. Cut at 1.67 m and shipped
> separately: main crate 2.25 × 2.15 × 1.73 m, second crate 3.19 × 2.25 ×
> 0.54 m, **7,013 € in 19 days** — against 13,639 € and 21 days out of gauge.

It still does not decide. A distinct body in a mesh is not a removable part: it
may be a weld, or a converter artefact. The tool says which ones cost; the
engineering department rules.

**And before announcing an oversize convoy**, it checks the other shipping mode:
on one test machine no container fitted, but a standard trailer cleared by
21 mm. Announcing 20,205 € of special convoy there would have been wrong.

## Reused from my first Makeathon project

Written by me during the same window, for the BESS configurator, and reused
here as-is. Declaring it is the honest thing to do and costs nothing:

| File | What it is |
|---|---|
| `src/engine/session.ts` | Engine API WebSocket transport: batching, the undocumented heartbeat, MsgPack decoding of exports |
| `src/engine/box.ts` | sketch-and-extrude of a box |
| `src/zoo-client.ts` | authentication |
| `public/style.css` | the stylesheet |

`session.ts` has two additions made for this project, both marked in the source:
`reserveIds()`, needed to build a batch whose commands reference each other, and
cleanup of the pending entry when serialisation throws — see FEEDBACK #6.

## Machines: the studio opens on a real robot

The submission is public, so the licence of every file shown is not a detail.
Every candidate we audited was eliminated but one — the audit is in
[`fixtures/README.md`](fixtures/README.md).

The general finding: **a machine big enough to cross a gauge threshold is a
machine whose CAD belongs to its manufacturer.** Every freely licensed model we
found is under one metre, and a one-metre crate fits everywhere.

That gives the two machines of this repository, and they answer two different
questions:

**The KUKA KR 6 with tool** is what the studio opens on. Real manufacturer CAD,
5.4 MB of STEP, 10 bodies, **MIT licence** — the only real machine we may fetch
and show. It is what proves the tool reads industrial CAD rather than a shape we
drew ourselves. And it is honest about its own verdict: at 88 cm it crosses no
threshold, all four poses land in the same gauge, and the console report refuses
to invent an arbitration rather than recommending a pose worth 45 € (`npm run
etude out/async-kuka_kr6_with_tool.obj 150`, translated from the French):

> All poses fall in the same gauge — Ocean groupage (LCL), 12 days. The gap
> between them is plywood: keep the CAD frame, there is nothing to arbitrate.

That refusal to dramatise is a feature, and the KR 6 is what exercises it.

One thing the KR 6 cannot show: at 5.4 MB it is far above the 2 MB ceiling where
the Engine API's b-rep import fails after several minutes (FEEDBACK #5), so on it
the studio generates the crate on its own and says so on screen. The **single
STEP holding machine and crate** is therefore demonstrated on the demo machine,
whose 106 KB the engine imports in 1.37 s.

**The generated demo machine** is what carries the threshold case, because a
threshold has to be crossed for a saving to exist at all. It is **generated by
Zoo Text-to-CAD** (`npm run machine-demo`, prompt in
`src/machine-demo.ts`, KCL in `fixtures/machine-demo.kcl`): no rights question, a
third flagship API in the project, and a geometry chosen for what it has to
demonstrate. It is the only STEP committed here, and `./script.sh demo` replays
the whole chain on it. The tool itself knows nothing of any of this: it receives
a STEP and measures it.

The KUKA KR 600 R2830 stayed as the **API measurement file** — most of
`FEEDBACK.md` comes from it. See [`fixtures/README.md`](fixtures/README.md).

## What we found in the Zoo APIs

[`FEEDBACK.md`](FEEDBACK.md) holds 12 entries written as the frictions were hit,
not reconstructed afterwards. The three that cost us the most:

- **#9 — a sketch's Z coordinate is silently ignored**, so everything extrudes
  from zero. A crate stacked flat still *looks* like a crate; we only caught the
  missing 115 mm by measuring the solids in the exported glTF. On a crate whose
  verdict turns on 110 mm, that is the difference between right and plausible.
- **#4 — the File Format API switches to async on file size (25 MB), while the
  gateway times out on conversion time (~60 s).** The two are uncorrelated: a
  1.51 MB file fails where a 2.15 MB file succeeds. The naked 504 carries no
  operation id, so there is no way to recover the job.
- **#8 — an imported mesh cannot be re-exported in any format**, by `export` or
  `export3d`, and one non-b-rep entity fails the export of every other one.

## Limits, stated plainly

- **The oriented footprint gains nothing on the files we had.** 0 % on the demo
  machine, 0.2 % on the KR 6, 1.8 % on the KR 600: all three are drawn aligned
  to their own axes. The
  algorithm is right — it recovers 2000 × 800 from a box rotated by 37°, and the
  tests prove it — but the "your CAD is in an arbitrary frame" argument did not
  pay off on any real file we got our hands on. The demonstration rests on the
  poses, where the gap is large.
- **Prices and gauge dimensions are indicative** and displayed with their
  values. A freight forwarder's quote remains a freight forwarder's quote.
- **No centre of gravity, no inertia tensor, no timber structural calculation,
  no non-rectangular envelope.** Skids are sized to mass alone, which is the
  trade rule anyway.
- **The tool produces a crate pre-design.** It is not a fabrication drawing and
  not a lifting plan. That statement is in the output, not only in this README.
- **ISPM-15** applies to the solid timber only — skids, floor, studs. Panel
  products are exempt. Also stated in the output.

## Repository map

| Path | What is in it |
|---|---|
| `src/domain/` | the tables: five gauges, price grid, crating assumptions, shared types |
| `src/moteur/` | the pure engine: crate sizing, gauge verdicts, costs, lead times. No CAD, 29 tests |
| `src/geometrie/` | oriented footprint, poses, unit and vertical-axis guards, placement. 22 tests |
| `src/engine/` | Zoo Engine API: session, boxes, batched scene, crate layout. 17 tests |
| `src/mesh/` | OBJ reading and compaction, glTF re-measurement. 6 tests |
| `src/serveur.ts` + `public/` | the workshop: pose table and 3D view |
| `src/bout-en-bout.ts` | the whole chain, timed post by post |
| `tools/verifier-ui.mjs` | drives the workshop in a real browser, fails on any console error |
| `FEEDBACK.md` | 12 notes on the Zoo APIs |
| `fixtures/README.md` | the two machines, the licence audit, the measurement files |
| `docs/demo.mp4` | the one-minute demo video linked at the top |

## Licence

MIT. See [`LICENSE`](LICENSE).

Code comments are in French, the author's working language. Everything a reader
needs — this README, `FEEDBACK.md`, the assumptions and disclaimers shown in the
product — is in English.
