# Player

The **Player** feature is the live preview canvas of the timeline editor. It composites all active clips (video, audio, image, GIF, text, subtitles) at the current playhead position and renders them as an interactive canvas with real-time effects.

---

## Folder Structure

```
player/
├── Player.tsx                      # Root player component (orchestrator)
├── components/
│   ├── AspectRatioSettings.tsx     # Aspect ratio toggle buttons (16:9, 9:16, etc.)
│   ├── ChromaKeyCanvas.tsx         # Software chroma-key canvas renderer
│   ├── ClipRenderer.tsx            # Per-clip rendering (video, image, GIF, text)
│   ├── Controls.tsx                # Play/pause, volume, and timeline controls panel
│   ├── PlayerControls.tsx          # Scrubber bar and fullscreen button overlay
│   ├── SubtitleRenderer.tsx        # Animated subtitle text overlay
│   └── TransitionRenderer.tsx      # Cross-clip transition effect renderer
└── hooks/
│   ├── useCanvasInteraction.ts     # Drag-to-move and edge-drag-to-resize on canvas
│   ├── usePlayerAudio.ts           # Web Audio API processing graph for audio clips
│   └── usePlayerMediaSync.ts       # play/pause/seek synchronisation for <video>/<audio>
└── utils/
    └── PlayerMath.ts               # Pure math helpers (colour parsing, keyframe interpolation)
```

---

## Components

### `Player.tsx`

Root orchestrator component.  Reads the Redux store (`clips`, `mediaItems`, `currentTime`, `isPlaying`) and coordinates all child components:

- Passes clip data to `ClipRenderer` and `SubtitleRenderer`
- Forwards audio elements to `usePlayerAudio`
- Forwards video elements to `usePlayerMediaSync`
- Connects `useCanvasInteraction` for canvas resize/drag interactions
- Controls fullscreen mode via the native Fullscreen API

---

### `ClipRenderer.tsx`

Renders each active clip onto the player canvas as a positioned, styled HTML element.  Handles:

- **Video clips** – `<video>` element with CSS filter transforms
- **Image / GIF clips** – `<img>` with optional `ChromaKeyCanvas` overlay
- **Audio clips** – hidden `<audio>` element (visual handled by waveform)
- **Text clips** – absolutely positioned styled `<div>`
- **Subtitle cues** – delegates to `SubtitleRenderer`

Applies all `MediaStylingOptions` as CSS filters (brightness, contrast, saturation, hue, blur, grayscale, sepia, invert) and CSS transforms (rotate, flip H/V, scale, roundedCorners).

Keyframe animation is applied by calling `getInterpolatedKeyframeValues` (from `PlayerMath.ts`) on each render.

---

### `ChromaKeyCanvas.tsx`

Software chroma-key component that replaces a `<video>` or `<img>` element with a `<canvas>` where the background colour has been made transparent.

**Algorithm (per pixel):**
```
Euclidean distance in RGB space from keyColor
  ≤ similarity           → alpha = 0    (fully transparent)
  ≤ similarity + blend   → alpha lerp   (smooth edge)
  > similarity + blend   → alpha = 255  (fully opaque)
```

Parameters map 1:1 to FFmpeg's `chromakey` filter so the browser preview accurately represents the final render.

> `getImageData` requires same-origin media or CORS headers. A `SecurityError` is caught and logged if cross-origin access is attempted.

---

### `SubtitleRenderer.tsx`

Renders a single subtitle cue with one of the available animation presets.

**Windowing**: Long cue strings are split into character-width windows that fit the canvas aspect ratio so text doesn't overflow:

| Aspect Ratio | Max chars per window |
|---|---|
| 9:16 | 22 |
| 1:1  | 35 |
| 16:9 | 60 |

**Animation presets:**

| Preset | Description |
|---|---|
| `none` | Static text, entire window visible |
| `word-highlight` | Words change colour as they are "spoken" (karaoke) |
| `pop-in` | Each word springs in from scale 0 when reached |
| `word-pop` | Only the current word is shown, with a spring scale-in |
| `typewriter` | Characters revealed one-by-one based on playback progress |

---

### `PlayerControls.tsx`

Minimal scrubber overlay at the bottom of the player canvas.  Shows:
- **Seek bar** — clickable/draggable progress bar
- **Timestamps** — `mm:ss.d / mm:ss.d`
- **Scrubber toggle** — Eye/EyeOff button (fullscreen only)
- **Fullscreen toggle** — Maximize/Minimize button

The entire overlay fades out in fullscreen when `showPlayerScrubber` is false.

---

### `AspectRatioSettings.tsx`

Four-button toggle for choosing the canvas aspect ratio:

| Value | Icon | Use case |
|---|---|---|
| `16:9` | Monitor | YouTube / desktop |
| `9:16` | Smartphone | TikTok / Shorts |
| `4:3` | Tablet | Legacy video |
| `1:1` | Square | Instagram posts |

---

## Hooks

### `usePlayerAudio`

Manages the **Web Audio API** processing graph for audio clips.  For each clip that is within its playback window it builds (or reuses) this signal chain:

```
<audio> element
    │
    └─► MediaElementAudioSourceNode
            │
    ┌───────┴──────────────────────────────┐
    ▼                                      │ (parallel paths)
  bass (lowshelf 200 Hz)                   │
    │                                      │
  treble (highshelf 4 kHz)                 │
    ├──────────────────────────────────────┘
    │
    ├──► gain ──► AudioContext.destination    (main output)
    │
    ├──► delay (250 ms) ──► delayGain ──► gain    (echo)
    │
    └──► convolver (synthetic IR) ──► reverbGain ──► gain    (reverb)
```

Settings applied from `clip.styling`:

| Setting | Node | Range |
|---|---|---|
| `volume` | gain.gain | 0–1 |
| `audioBassBoost` | bass.gain | 0–20 dB |
| `audioTrebleBoost` | treble.gain | 0–20 dB |
| `audioEcho` | delayGain.gain | 0–1 |
| `audioReverb` | reverbGain.gain | 0–1 |
| `audioSpeed` | el.playbackRate | 0.5–2 |

Graphs for clips outside their active window are **disconnected** and removed to free AudioContext resources.

---

### `usePlayerMediaSync`

Keeps `<video>` and `<audio>` elements synchronised with the Redux `currentTime`.  Three separate effects handle different scenarios:

| Effect | When | What it does |
|---|---|---|
| **Playback timer** | `isPlaying = true` | Advances `currentTime` at ~30 fps via `setInterval`; stops at `totalDuration` |
| **Seek sync** | `isPlaying = false` | Corrects elements that have drifted > 0.1 s from the expected local time |
| **Cut switch sync** | `isPlaying = true` | Detects active clip changes within a video group and seeks to `sourceStart + local` |

**Video groups**: Multiple clips that reference the same source file share one `<video>` element via `videoRefsByMedia`.  The seek target is computed as `clip.sourceStart + localTime`.

---

### `useCanvasInteraction`

Handles direct manipulation of clips on the player canvas.

**Resize types:**

| Type | Handle | Behaviour |
|---|---|---|
| `move` | Clip body | Translates x/y; snaps to 0/50/100 % (±2 % threshold) |
| `width` | Right edge | Resizes width; locks aspect ratio for visual media |
| `height` | Bottom edge | Resizes height; locks aspect ratio for visual media |
| `both` | Corner | Uniform scale; locks aspect ratio for visual media |

**Performance:**
- Local `mediaTransforms` state is updated on every `requestAnimationFrame` for smooth visual feedback
- Redux `updateClip` is only dispatched every **3 frames** during drag, plus once on pointer-up (the final value)
- Snap guidelines are shown via `showResizeGuidelines` action during moves

**Redux → local sync:** When an external change (e.g. `MediaStylingPanel` slider or undo/redo) updates a clip's position/size in Redux, the effect mirrors it to local state — skipping the currently dragged clip to avoid jitter.

---

## Utils

### `PlayerMath.ts`

Pure, side-effect-free math utilities.

| Export | Description |
|---|---|
| `hexToRgb(hex)` | Parses `#RRGGBB` or `0xRRGGBB` → `{r, g, b}` or `null` |
| `interpolate(v1, v2, progress, easing)` | Linear or jump-cut interpolation between two values |
| `getInterpolatedKeyframeValues(keyframes, localTime, baseValues)` | Interpolates all animatable clip properties at `localTime` using surrounding keyframes |

---

## Data Flow

```
Redux store (clips, currentTime, isPlaying)
    │
    └─► Player.tsx
            │
            ├─► ClipRenderer (per-clip visual output)
            │       ├─► ChromaKeyCanvas  (if greenScreenEnabled)
            │       └─► SubtitleRenderer (if subtitle clip)
            │
            ├─► usePlayerAudio      (Web Audio graph management)
            ├─► usePlayerMediaSync  (video/audio element seek & play/pause)
            └─► useCanvasInteraction (drag/resize → dispatch updateClip)
```

---

## Key Constraints

- **Blob URLs**: All media is stored as Blob URLs created by `MediaHub`. These expire when the tab is closed.
- **CORS**: `ChromaKeyCanvas` requires same-origin media for `getImageData`. Cross-origin Blob URLs work fine; remote URLs may not.
- **AudioContext**: Must be resumed after a user gesture. `usePlayerAudio` calls `.resume()` when `isPlaying` becomes true.
- **Video groups**: Clips from the same source file share one `<video>` element. `sourceStart` tracks the offset into the original file for each cut.
