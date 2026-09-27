# Memory Visualization — Design Document

**Feature:** live memory layout (stack / heap / pointers) for the LearnC workbench.
**Metaphor:** the debugger's memory window, redrawn by someone who cares. Not a schematic — a stage.

---

## 1. Where it lives

A full-width **drawer** that opens beneath the editor, opened from a `Memory` button in the action rail (next to "Run sample"). It does not fight the test-cases rail — it replaces the editor's vertical space when open, so the page never scrolls sideways and the desk keeps its two-column calm. Closing the drawer returns the editor to full height.

Rationale: memory visualization needs *width* (two regions side by side plus arrow space between them) and *attention* (you read it while stepping). Both argue for a drawer, not a sidebar.

```
┌─────────────┬──────────────────────────────────────────────┐
│ statement   │  editor + diagnostics                        │
│             ├──────────────────────────────────────────────┤
│             │  [Memory drawer — open]                      │
│             │  ┌───────── STACK ─────────┐ ┌── HEAP ──────┐│
│             │  │ main()       ▸ x, sum   │ │ 0x7f3a… node ││
│             │  │ build_list() ▸ head, n  │ │ 0x7f3b… node ││
│             │  └─────────────────────────┘ └──────────────┘│
│             │  ◀ step ▶   step 4/12   [close]              │
└─────────────┴──────────────────────────────────────────────┘
```

---

## 2. The two regions

### Stack — left column

**Representation: nested frames, not cards.** A call stack is literally nested lifetimes, so the visual nests: each frame is an inset panel inside its caller. `main` contains `build_list`, which contains `make_node`. Depth reads as indentation; you *see* the recursion shape of your program.

```
┌ STACK ─────────────────────────────┐
│ main()                frame #0     │
│   int n = 3                       │
│   Node* head ───────────────┐     │
│ ┌─ build_list(3)   frame #1 ┘───┐ │
│ │   int count = 2               │ │
│ │   Node* node ────────────┐    │ │
│ │ ┌─ make_node(2)  #2 ─┐   │    │ │
│ │ │   int val = 2      │   │    │ │
│ │ │   Node* next = NULL│   │    │ │
│ │ └────────────────────┘   │    │ │
│ └──────────────────────────┘    │ │
└───────────────────────────────────┘
```

Frame anatomy:
- **Header:** `name(args)` in mono, frame number right-aligned, current-frame marked with a left accent bar
- **Variables:** `type name = value` rows, mono, values right-aligned with tabular numerals
- **Dead frames are gone, not greyed.** When `make_node` returns, its panel collapses with a 180 ms scale-fade. (A returned frame's memory is *gone* in C — showing it greyed teaches the wrong model.)
- **Uninitialised values** show `?` in the muted color — this is a teaching tool and `int x;` printing garbage-looking `0` is a lie.

### Heap — right column

**Representation: free-floating blocks in address order.** The heap has no nesting — it's a sea of allocations — so blocks sit in a vertical list sorted by address, each labeled with its real (or synthetic-but-plausible) address:

```
┌ HEAP ───────────────────────────┐
│ 0x7f3a2010   Node               │
│   val: 3     next: 0x7f3a2030 ──┼──→ (points to block below)
│ 0x7f3a2030   Node               │
│   val: 2     next: NULL         │
└─────────────────────────────────┘
```

- Block header: address (mono, tabular) + the `malloc`'d type name
- Fields mirror the struct layout
- **Orphaned blocks** (allocated, then the last pointer to them was overwritten — the classic leak) get a dashed border and a small `leaked?` tag. Not an error — a question mark, because that's what a leak is at this moment.

---

## 3. Pointers — the hard part

**Rule: arrows live in the whitespace between the columns. Never through the panels.**

Each pointer variable row (stack or heap field) shows the *value* it holds — an address, or `NULL`. When that address matches a heap block, an SVG connector is drawn from the row's right edge to the block's left edge, routed through the gutter between the columns:

- **Curved bezier** paths (orthogonal elbows look like circuit diagrams; curves read as "references")
- **Color = origin kind:** stack→heap arrows in blue, heap→heap arrows (linked lists!) in green, stack→stack (out-params) in amber
- **Arrowheads sit on the target's left edge**, nudged to the row of the block header
- **No crossing-arrow spaghetti:** connectors are drawn with a per-arrow horizontal offset in the gutter (fan-out), so two pointers to the same block run parallel, 6px apart
- **Hover a pointer row** → its arrow brightens, everything else fades to 30%. This is the "what does `head` actually point at" moment and it must be instant
- `NULL` pointers render as a `∅` glyph with a stub arrow that stops mid-gutter — pointing at nothing is a thing students need to *see*

### What changes when pointers change

Pointer rewires are the whole show. When `head = node;` executes:
1. The old arrow (if any) fades out over 150 ms
2. The new arrow *draws itself* left-to-right over 250 ms (stroke-dashoffset animation)
3. The pointer row's value ticks from the old address to the new with a brief blue flash on the row

`free()`'d blocks: dissolve with a 200 ms fade + slight downward drift, address releases, any arrows that pointed into it snap-cut to red for 300 ms then vanish — "dangling" should hurt a little.

---

## 4. Lifecycles at a glance

| Event | Animation | Duration |
|---|---|---|
| Frame pushed | panel expands from top edge of caller, ease-out | 220 ms |
| Frame popped | scale-fade + collapse, children die first | 180 ms |
| Variable written | value flashes blue, ticks over | 150 ms |
| Heap block allocated | block fades in, slight rise from below, address types out | 220 ms |
| Heap block freed | fade + downward drift | 200 ms |
| Pointer assigned | old arrow fades, new arrow draws L→R | 250 ms |
| Pointer to freed block | arrow flashes red, snaps away | 300 ms |

Reduced-motion: all of the above become instant state swaps; only a brief opacity change remains. Arrows appear at full length.

---

## 5. Execution flow & stepping

**Where the steps come from:** the sandbox runs the program under a tiny tracer (gdb batch mode, or an `-finstrument`-style compile with callback hooks — implementation note in §7). Each step is one source line and carries:

- the line number
- stack: frames + locals (name, type, value, address)
- heap: blocks (address, type, fields, freed?)
- which variable the current line *just* wrote (for the flash)

**Controls** (bottom of the drawer, transport-style):

```
◀ prev   ▶ next   ⏮ restart     step 4 / 12     [auto-play 2×/s]
```

- **Next/prev step line-by-line**; prev is possible because the tracer records all steps up-front (programs here run in milliseconds), so time-travel is just re-rendering an earlier snapshot — trivially correct, no reverse-execution magic
- The editor **highlights the current source line** for the active step, so code and memory read together
- Scrubber: a thin timeline bar under the controls for jumping
- Steps are only recorded for **Run sample**, not Submit — submitting grades and closes the drawer

**Scope of the tracer (v1 honesty):** it traces `main` + user-defined functions with scalar/struct locals and `malloc`'d structs. No function pointers, no pointer arithmetic on `void*`, no arrays-of-arrays decay animations. Documented limits in the drawer footer.

---

## 6. Interaction inventory (a11y per web-interface-guidelines)

- Drawer open/close: button with `aria-expanded`, `Escape` closes
- Stepper buttons: real `<button>`s, focus-visible rings, disabled state at ends
- Every frame/block expandable region keyboard-operable (`tabindex`, Enter/Space)
- Step announcements: `aria-live="polite"` one-liner — "step 4 of 12: `sum += x` → sum = 3"
- Pointer hover-fade also triggers on keyboard focus of the pointer row
- Reduced-motion: swaps to instant transitions (§4)
- All addresses/values in `font-variant-numeric: tabular-nums`

---

## 7. Implementation notes (for tomorrow's build)

- **Tracer choice:** compile with `-finstrument-functions` + a `__cyg_profile` shim that logs enter/exit, plus a `malloc`/`free` interposer via `LD_PRELOAD`... rejected — fragile in the unshare sandbox. **Chosen: gdb batch mode** — `gdb -batch -ex "record full" style scripting is also heavy. Final call: a debug-info walker using **gdb's Machine Interface (MI)**, stepping line-by-line and querying locals/heap via `-stack-list-variables` + a malloc-tracking breakpoint. Runs inside the same unshare session; output is one JSON event per step on stdout. Effort ~1 day.
- **Fallback (if gdb unavailable in sandbox):** single-step with `-O0 -g` and a compiler-generated call-log (`-finstrument-functions`) + libefence-style malloc logging. Degraded (no per-line heap state) but still useful.
- **Frontend:** one `MemoryDrawer.tsx`, one SVG overlay layer, state = `steps[]` + `cursor`. All animation CSS-driven; the SVG layer recomputes connector paths on layout via `ResizeObserver`.
- **Feature flag:** `?memory=1` query param first, then a Preferences toggle (gear menu, naturally) once stable.
