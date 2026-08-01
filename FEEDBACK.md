# FEEDBACK.md

Notes on the Zoo APIs, written **at the moment each friction was hit**, not
reconstructed afterwards. Zoo API Makeathon, 22 July → 5 August 2026, project
**Caisse**.

Severity:

- 🔴 **blocking** — cannot proceed without a workaround
- 🟠 **friction** — costs time, has a workaround
- 🟡 **docs** — the API behaves correctly, the documentation or naming misleads

Reference environment: `@kittycad/lib@4.3.15`, `@msgpack/msgpack@3.1.3`,
`ws@8.21.1`, Node 20.19.6, Linux (WSL2).

**Scope.** This project reuses the WebSocket transport written for an earlier
project of the same Makeathon (a BESS configurator). Frictions found while
writing *that* transport — the undocumented heartbeat, MsgPack-encoded exports,
the SDK's environment variable — are documented in that project's `FEEDBACK.md`
and are not repeated here. This file covers only what is **new for Caisse**:
importing customer STEP, measuring imported geometry, the File Format API, and
Text-to-CAD.

| # | Severity | Surface | One line |
|---|---|---|---|
| [1](#1) | 🟡 | Engine API, `import_files` | `ImportFile.data` typed `number[]` is untenable at real-STEP scale |
| [2](#2) | 🟡 | Engine API, WebSocket | responses are wrapped, except `export`, and nothing says so |
| [3](#3) | 🟠 | Engine API, session open | "connection interrupted" can land at handshake, before any command |
| [4](#4) | 🔴 | File Format API | async switch keyed on file size, gateway times out on conversion time |
| [5](#5) | 🟠 | Engine API, `import_files` | 20× slower than the File Format API, and fails without diagnosis on a real STEP |
| [6](#6) | 🟠 | Engine API, BSON | past 16 MiB, "offset is out of bounds" client-side |
| [7](#7) | 🟡 | `set_object_transform` | `set: true` is documented, then refused |
| [8](#8) | 🔴 | Engine API, `export` | an imported mesh cannot be re-exported in any format |
| [9](#9) | 🔴 | Engine API, sketching | a sketch's Z is silently ignored; extrusion always starts at zero |
| [10](#10) | 🟡 | `entity_set_opacity` | does not apply to b-rep solids |
| [11](#11) | 🟡 | File Format API | `storage` ignored for PLY output, and meshes get de-indexed |
| [12](#12) | 🟡 | ML API, Text-to-CAD | dimensions honoured to the millimetre, but the wait is unobservable |

---

<a id="1"></a>
## #1 — 🟡 `ImportFile.data` is typed `number[]`, which is untenable at real-STEP scale

**Date:** 2026-08-01
**Surface:** Engine API, `import_files` command; TypeScript SDK

The generated type declares:

```ts
export interface ImportFile {
  data: number[];        // format: uint8
  path: string;
}
```

An industrial machine's STEP file routinely weighs 10 to 30 MB. Following the
type literally — `Array.from(buffer)` — builds a JavaScript array of thirteen
million boxed integers before serialising it element by element. On our 12.6 MB
test file that is several hundred megabytes of allocation to transmit 12.6 MB of
data.

Passing a `Buffer` directly works, and lets the serialiser encode the payload as
binary:

```ts
files: [{ path: basename(path), data: bytes as unknown as number[] }]
```

The cast is mandatory to satisfy the compiler, even though it is the only viable
usage. The type should accept `Uint8Array` — as `RawFile.contents` effectively
does on the way out, where the same mismatch exists in mirror image: the type
says `string`, the frame carries bytes.

---

<a id="2"></a>
## #2 — 🟡 Command responses are wrapped, except `export`, and nothing signals it

**Date:** 2026-08-01
**Surface:** Engine API, WebSocket; TypeScript SDK

`import_files` and `bounding_box` answer inside an envelope:

```
resp.type === 'modeling'  →  resp.data.modeling_response.type === 'import_files'
```

`export` arrives flat:

```
resp.type === 'export'  →  resp.data.files
```

Both shapes live in the same `OkWebSocketResponseData` union, with no rule
letting you know *a priori* which one a given command will land in. You find out
by writing a type test that fails:

```
TS2367: This comparison appears to be unintentional because the types
'"debug" | "export" | … | "modeling"' and '"import_files"' have no overlap.
```

The compiler does eventually say it, which limits the damage, but the
per-command documentation would benefit from stating the expected response
shape. The real rule appears to be: everything goes through `modeling`, except
large responses carried over MsgPack. That is written nowhere.

---

<a id="3"></a>
## #3 — 🟠 "modeling connection interrupted" can land at the handshake, before any command

**Date:** 2026-08-01
**Surface:** Engine API, WebSocket session open

Second session of the day, opened a few minutes after one that closed cleanly.
The WebSocket opens, then the engine immediately emits:

```
[internal_api] modeling connection interrupted; please reconnect and retry
```

Two things make this expensive to interpret:

1. **It arrives with no `request_id`.** It cannot be attached to any pending
   command. Our first command — `set_scene_units`, sent to wait for the scene to
   be ready — stayed pending until its 60 s timeout. Without an explicit trace
   of uncorrelated errors, the observed symptom is "the engine is not
   answering", not "the engine refused the connection".
2. **"interrupted" suggests a mid-work cut**, whereas here nothing had been sent
   yet. We first blamed a 12 MB STEP import launched in the same run — the wrong
   conclusion, and an hour down a false trail if the message had been believed.

The message tells you what to do and it is right: reconnecting three seconds
later succeeds with nothing else changed. The correct behaviour is therefore to
**always retry the open**, which no example in the documentation does.

Suggestion: correlate this message to the open request, or distinguish it from a
genuine mid-session cut — for instance `connection rejected, please retry`.

---

<a id="4"></a>
## #4 — 🔴 The async switch is keyed on file size, the gateway times out on conversion time

**Date:** 2026-08-01
**Surface:** File Format API, `PUT /file/conversion/{src}/{output}`
(`create_file_conversion`)

The endpoint documentation says:

> If the file being converted is larger than 25MB, it will be performed
> asynchronously.

The threshold is on **size**. What actually fails the call is **conversion
time**, and the two are uncorrelated. Measurements on five real STEP files, same
endpoint, same OBJ output:

| File | Size | Result |
|---|---|---|
| `as1_pe_203.stp` | 0.13 MB | ✅ 3.2 s — 1 580 vertices |
| `as1-oc-214.stp` | 0.42 MB | ✅ 7.8 s — 4 388 vertices |
| `11752.stp` | **1.51 MB** | ❌ **HTTP 504 at 61.4 s** |
| `Ventilator.stp` | **2.15 MB** | ✅ 50.5 s — 13 054 vertices |
| `KR600_R2830-4.stp` | 12.59 MB | ❌ HTTP 504 at 61.9 s |

**The 1.51 MB file fails and the 2.15 MB file succeeds.** The factor is not
weight, it is geometric complexity: the gateway cuts at ~60 s, and the 25 MB
threshold protects nothing, since a 1.5 MB file can need more. Everything in the
band "under 25 MB but over a minute of tessellation" falls into a 504, with no
message pointing at the async route.

**The 504 is bare:** no JSON body, no Zoo error code, no operation id. Nothing
says whether the conversion continues server-side nor how to collect its result.
And `GET /user/api-calls` listed none of our conversions several minutes later —
only the WebSocket opens — so there is no back door to recover the job either.

**Workaround, which works.** `POST /file/conversion`
(`create_file_conversion_options`) starts a job and returns an id, with no
gateway clock. The same 1.51 MB file that 504'd:

```
job started in 1.5 s — uploaded, id 099a6a0b-…
final status: completed after 107.4 s
19 702 vertices, footprint 1280 × 144 × 133 mm
```

107 s of real conversion against a 61 s gateway budget: the synchronous call
could never have succeeded.

**Suggestions**, most useful first:

1. switch to async on **elapsed time** rather than size — past ~45 s, return the
   operation id instead of waiting for the 504;
2. failing that, return a 202 with the operation id when a conversion exceeds
   the budget, rather than a bodyless 504;
3. failing that, mention in the synchronous endpoint's docs that
   `POST /file/conversion` exists and has no such limit. Today the relationship
   between the two endpoints is only discoverable by reading generated types.

---

<a id="5"></a>
## #5 — 🟠 `import_files` is twenty times slower than the File Format API on the same file, and fails without diagnosis on a real STEP

**Date:** 2026-08-01
**Surface:** Engine API, `import_files` in session

Same file, same output, two paths:

| | `as1_pe_203.stp` (0.13 MB) | `KR600_R2830-4.stp` (12.59 MB) |
|---|---|---|
| Engine `import_files` | 56.2 s | ❌ `[internal_engine] import failed` after 457 s |
| Engine `export` to OBJ after | 33.0 s | — |
| **Billed session total** | **91.4 s** | **457.8 s, for nothing** |
| File Format API (async) | 3.2 s | 365 s |

Two separate points, the second being the costly one:

**Time.** 56 s to import 137 KB into the engine, when converting the same file
takes 3. Since Zoo bills session time, the gap is not merely latency — it is
billed.

**Failure.** On an off-the-shelf industrial robot STEP, `import_files` answers
`[internal_engine] import failed`. Nothing else: no offending entity, no stage,
no distinction between "file rejected", "tessellation too heavy" and
"engine-side timeout". The same file is accepted by the File Format API, so it
is not malformed. Seven minutes of billed session for a six-word message.

**Reproducible.** Second attempt the same day with `split_closed_faces: true`
instead of `false`: same message, after 479 s. So it is neither a fluke nor an
import setting — the engine cannot read this file, which the File Format API
converts without error in 365 s.

An interactive session also has no way to know the import is progressing: no
progress event, no estimate. For a tool that promises a result in thirty
seconds, the difference between "it is working" and "it is dead" is not
observable.

**Suggestions:** an error code distinguishing rejection / timeout / internal
error; a progress event during import; and, if engine-side import must stay
slow, say so in the documentation — the architecture choice depends entirely on
it.

**Consequence for this project.** The machine's footprint is measured by the
File Format API, not by the engine. The Engine API is kept for what it alone
does: building the crate as b-rep and re-exporting a STEP that carries machine
and crate in the same scene.

---

<a id="6"></a>
## #6 — 🟠 Past 16 MiB, `import_files` fails client-side with "offset is out of bounds"

**Date:** 2026-08-01
**Surface:** Engine API, WebSocket, SDK's BSON serialisation

The KUKA mesh, rendered to OBJ by the File Format API, weighs 23.4 MB.
`session.send({type:'import_files', …})` fails **before any network round
trip**, with:

```
offset is out of bounds
```

No mention of BSON, of size, or of a limit. The message comes from the
serialiser: a BSON document is capped at 16 MiB and the payload exceeds it.
Nothing in the `import_files` documentation mentions this bound, even though any
real machine mesh reaches it.

Workaround, sufficient here: strip normals and object names from the OBJ. The
engine recomputes normals on import, and two thirds of the file disappear — face
lines going from `f 1//1 2//1 3//1` to `f 1 2 3`.

```
23.4 MB  →  11.1 MB    174 043 vertices, 350 484 faces, identical geometry
```

**Suggestions:** check size before serialising and raise an error that names the
limit; document the bound on `import_files`; or chunk large payloads in the SDK.

Side effect observed along the way: when serialisation fails like this, the
pending entry registered for the command is never resolved, and the rejection
surfaces later, at session close, as an unhandled rejection. A naive caller sees
its process die well after it has handled the error.

---

<a id="7"></a>
## #7 — 🟡 `set: true` is documented, then refused: "Absolute transforms are currently not supported"

**Date:** 2026-08-01
**Surface:** Engine API, `set_object_transform`

The field is documented without reservation in the generated type:

> If true, overwrite the previous value with this. If false, the previous value
> will be modified.

Sent with `set: true`, the engine answers:

```
[bad_request] Absolute transforms are currently not supported
```

The documented behaviour does not exist. It is not serious — an object starting
from identity is placed just as well in relative mode — but you find out in
production, and "currently" suggests the documentation describes an intention
rather than the implementation.

**Suggestion:** mark the field as unsupported in the schema, or reject it at
parse time rather than at execution time.

---

<a id="8"></a>
## #8 — 🔴 An imported mesh cannot be re-exported, in any format

**Date:** 2026-08-01
**Surface:** Engine API, `export` and `export3d`

Scene containing two things: a machine imported as OBJ, and a crate built with
`extrude` commands. Exporting the whole thing fails:

```
[internal_engine] Exception in graphics engine: No such Brep object exists
```

Verified in all four combinations: `export` and `export3d`, STEP output and glTF
output. The failure is **total** — no partial output, no skipped entity: a
single non-b-rep entity fails the export of every other one.

That is coherent for STEP, which can only carry b-rep. It is much less so for
glTF, which is a mesh format and for which the whole scene is exactly what one
would expect.

**Consequence for this project.** The most interesting artefact we wanted to
produce — a single STEP holding the customer's machine and the crate generated
around it — is only reachable if the machine enters as b-rep, hence if the
engine can import its STEP. On an off-the-shelf robot STEP it cannot (see #5).
We therefore switched the demo to a machine whose STEP the engine does read, and
the common STEP exists; for the KUKA, the crate is exported alone and we say so.

**Suggestions:** at minimum, fail the export naming the offending entity;
better, skip non-exportable entities and report it; ideally, allow meshes in
mesh-format exports.

---

<a id="9"></a>
## #9 — 🔴 A sketch's Z coordinate is silently ignored, and extrusion always starts at zero

**Date:** 2026-08-01
**Surface:** Engine API, `move_path_pen`, `extend_path`, `extrude`

`move_path_pen` takes a `Point3d`. Give it `z = 1505`, extend the path, extrude,
and you expect a solid between 1505 and 1515 mm. You get one between **0 and
10 mm**. X and Y are honoured. No error, no warning: the `z` is simply absorbed.

This is the worst failure mode for this use case. A crate is a stack — skids,
floor, walls, roof. Stacked flat, it still produces a **plausible** image: the
walls dominate, the render looks like a crate. We only caught it by measuring
the height of the solids in the exported glTF:

```
before                    after
0 → 0.010  roof panel     1.505 → 1.515  roof panel
0 → 0.022  floor          0.100 → 0.122  floor
0 → 0.100  skids ×3       0     → 0.100  skids ×3
0 → 1.383  ×28            0.122 → 1.505  ×28
height 1.383 m            height 1.515 m  ← the dimension checked against the gauge
```

115 mm of error on a crate whose shipping verdict turns on 110 mm.

Workaround: sketch at `z = 0`, extrude, then lift the solid with
`set_object_transform`. One extra command per volume, free inside a batch.

**Suggestions**, most useful first: honour the sketch's `z`; failing that,
reject a non-zero `z` with an explicit error; failing that, document that the
point is projected onto the current plane and that you must go through
`enable_sketch_mode` or a translation.

---

<a id="10"></a>
## #10 — 🟡 `entity_set_opacity` does not apply to b-rep solids

**Date:** 2026-08-01
**Surface:** Engine API, `entity_set_opacity`

```
[bad_request] This object cannot be made semi-transparent
```

On solids produced by `extrude`. Nothing in the command's name or documentation
restricts its domain — it speaks of an "entity", and solids are entities.
Showing a machine inside its crate is a common need, and translucency is its
natural answer.

Workaround: hide the walls with `object_visible`, which gives a cutaway view —
the usual representation convention in crate making anyway.

**Suggestion:** state in the docs which entities the command applies to, and
make the error say what is expected.

---

<a id="11"></a>
## #11 — 🟡 The File Format API ignores `storage` for PLY output, and de-indexes meshes

**Date:** 2026-08-01
**Surface:** File Format API, mesh-to-mesh conversions

Trying to compact a 23 MB OBJ before sending it to the engine (#6), we requested
an OBJ → PLY conversion with `storage: 'binary_little_endian'`. The returned
file starts with:

```
format ascii 1.0
comment Generated by zoo.dev
element vertex 1051452
```

Two things:

1. **`storage` is ignored** — the PLY comes out ASCII although binary was
   requested, and binary was the entire point of the conversion;
2. **the mesh is de-indexed** — 174 043 vertices in, 1 051 452 out, exactly
   three per face. Topology is lost and the file grows sixfold, even though PLY
   perfectly supports indexed meshes.

The same de-indexing shows in glTF output, where the file goes from 23 to 32 MB.

Neither conversion is therefore usable for lightening a mesh, which is the
obvious use case for a mesh-to-mesh converter.

**Suggestion:** honour `storage`, and preserve indexing when the output format
supports it.

---

<a id="12"></a>
## #12 — 🟡 Text-to-CAD honours dimensions to the millimetre, but the wait is unobservable

**Date:** 2026-08-01
**Surface:** ML API, `POST /ai/text-to-cad/{output_format}`

Used to produce the demo machine, for want of a freely licensed manufacturer
model large enough to cross a gauge threshold.

**What works remarkably well.** Dimensions asked for in natural language are
honoured **exactly**: "2.0 m wide, 1.9 m deep and 3.1 m tall" returns a solid
measuring 2000 × 1900 × 3100 mm on the converted mesh. The KCL is returned with
the model, which documents the result far better than a screenshot.

Two frictions, minor but real:

1. **No progress.** 278 s in `in_progress`, with no progress, no estimate, no
   stage. On a multi-minute operation the only available information is "not
   finished yet". Same complaint as for engine import (#5): the gap between "it
   is working" and "it is dead" is not observable.
2. **Time varies twofold with nothing to predict it** — 176 s for a first
   prompt, 278 s for a second one barely more detailed.

**One rendering observation to close.** A machine imported as b-rep renders in
the same grey as the solids you have just created with `extrude`: in a scene
meant to show a machine inside a crate, nothing is distinguishable any more. An
imported *mesh*, on the other hand, is given a different colour by the engine.
The difference is documented nowhere and is discovered by looking at the image.
`object_set_material_params_pbr` fixes it in one command — but you have to know
to send it.
