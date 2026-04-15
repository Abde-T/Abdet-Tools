# MediaHub

The **MediaHub** feature is the left-side media library panel of the timeline editor. It handles all user-facing media management: uploading files, filtering them by type, dragging them onto the timeline, and styling the resulting clips.

---

## Folder Structure

```
mediahub/
├── components/
│   ├── MediaHub.tsx            # Root media library panel
│   ├── EffectsLibrary.tsx      # Transition effects grid
│   ├── SubtitleStylingPanel.tsx # Text/subtitle styling controls
│   └── MediaStylingPanel.tsx   # Visual & audio clip properties panel
└── hooks/
    └── useLibraryNavigation.ts  # Library tab state management
```

---

## Components

### `MediaHub.tsx`

The main library panel component. It:

- Lists all uploaded `MediaItem`s from the Redux store in a responsive [Masonry](https://www.npmjs.com/package/react-masonry-css) grid
- Supports **filtering** by type: `ALL | VIDEOS | AUDIO | IMAGES | TEXT | OTHERS`
- Processes local file uploads **client-side** using Blob URLs (no backend required)
- Runs a **simulated progress animation** (10 steps × 150 ms) to give visual feedback after processing
- Supports both **mouse drag** (native DnD API) and **touch drag** (floating clone + synthetic `DragEvent`) onto the timeline
- Opens a **TextModal** for adding plain text clips
- Handles **deletion** with a confirmation prompt; also removes any associated timeline clips

#### Key Design Decisions

| Decision | Reason |
|---|---|
| Blob URLs for media | No server needed; files stay in the browser session |
| Simulated progress | Files are processed synchronously but the animation improves perceived UX |
| Touch drag via synthetic `DragEvent` | Native drag API doesn't fire on touch; we simulate it manually |
| `memo()` on `MediaHubItem` | Prevents re-rendering unchanged cards when the masonry grid updates |
| Masonry with `ResizeObserver` | Column count is computed from the container width, not viewport width, for correct behaviour inside split panes |

#### File Processing Pipeline

```
FileList
  └─ validateFile()          → reject if > 2 GB or unsupported MIME
      └─ getMediaType()      → map MIME/extension to MediaItem type
          ├─ generateThumbnail()   (parallel)  → canvas-based JPEG data-URL
          └─ getMediaMetadata()    (parallel)  → duration + hasAudio detection
              └─ processFile()     → assemble MediaItem object
                  └─ handleFileUpload() → dispatch to Redux + animate progress
```

#### Subtitle Files (`.srt` / `.vtt`)

Subtitle files are parsed into a structured cue array via `parseSrt` / `parseVtt` (located in `timeline/utils/subtitleParsing`). All cues from the same file share a `subtitleGroupId` UUID so styling changes can be broadcast to the entire group.

---

### `EffectsLibrary.tsx`

A grid of draggable **transition effect cards** that the user drops between two clips on the timeline. Each card shows:

- A static `.jpg` thumbnail at rest
- An animated `.gif` preview on hover

Preview assets live at `mediahub/transitions/img/` and `mediahub/transitions/gif/`.

Effects use the same dual drag strategy as `MediaHub` (mouse DnD + touch clone + synthetic `DragEvent`). The effect payload includes `isEffect: true` so the timeline drop handler knows to insert a transition instead of a media clip.

#### Available Effects

| Effect Type | Description |
|---|---|
| `fade` | Standard crossfade |
| `dissolve` | Smooth pixel blend |
| `wipeleft/right/up/down` | Directional wipes |
| `slideleft/right/up/down` | Push transitions |
| `circleopen / circleclose` | Circular reveal/close |
| `rectcrop` | Rectangular crop |
| `distance` | Distance-based fade |
| `fadeblack / fadewhite` | Fade through black/white |

> **Note:** The browser preview approximates the look of each effect. Final output is rendered by FFmpeg's `xfade` filter and may differ slightly.

---

### `SubtitleStylingPanel.tsx`

A tabbed panel for controlling the visual style of subtitle and text clips. It is reused for two scenarios:

| Usage | Props |
|---|---|
| Subtitle clips | Default (all tabs visible) |
| Plain text clips | `hideKaraoke={true}` + `hidePosition={true}` |

#### Tabs

| Tab | Controls |
|---|---|
| **Text** | Font family, size, primary colour |
| **Outline** | Stroke colour and width |
| **Shadow** | Drop shadow colour and depth |
| **Position** | On-screen position (hidden for text clips) |
| **Presets** | One-click style bundles + animation presets |

#### Style Presets

Pre-built combinations of font, colour, outline, shadow, and animation (e.g. "Impact Modern", "Gaming Fun", "Cyber Glow"). Previewed live using the actual font and colour via inline styles.

#### Animation Presets

| Preset | Description |
|---|---|
| `none` | No animation |
| `word-highlight` | Karaoke-style word highlight |
| `pop-in` | Scale-in entrance per cue |
| `word-pop` | Per-word scale pop |
| `typewriter` | Character-by-character reveal |

All changes are dispatched immediately via `onStylingChange` → Redux `updateClip`.

---

### `MediaStylingPanel.tsx`

A multi-tab properties panel that appears when the user selects a media clip (video, image, GIF, or audio). It reads and writes styling data on the Redux clip object.

#### Tabs by Clip Type

**Visual clips (video / image / GIF):**

| Tab | Controls |
|---|---|
| Position & Size | X/Y center, width, height (as canvas %) |
| Visual Filters | Brightness, contrast, saturation, hue, blur, sharpen, grayscale, sepia, invert |
| Transform | Flip H/V, rotation, rounded corners, z-index, green screen (chroma key) |
| Keyframes | Time-based animation of position/size/opacity |
| Audio | Volume (video only) |
| Subtitles | Embedded subtitle management |

**Audio clips:**

| Tab | Controls |
|---|---|
| Audio Controls | Volume, speed, pitch |
| Audio Effects | Bass boost, treble boost, echo, reverb |
| Subtitles | Associated subtitle track |

#### Performance: rAF-Batched Dispatch

Slider interactions queue changes into `pendingGeometryRef` or `pendingStyleRef`, then call `scheduleFlush()` which batches them into a single `requestAnimationFrame` callback before dispatching to Redux. This prevents hundreds of Redux dispatches during a single slider drag.

```
slider onChange → updateGeometry / updateStyling
                    → setOptions (local state, instant)
                    → pendingRef.current = next
                    → scheduleFlush()
                        → requestAnimationFrame(flushUpdates)
                            → dispatch(updateClip(payload))
```

#### CSS ↔ FFmpeg Conversion

UI sliders use a `0–200 %` range. The conversion functions (`convertBrightnessForCSS`, `convertContrastForCSS`, `convertSaturationForCSS`) map this range to CSS filter values that visually match the output of FFmpeg's `eq` filter so the browser preview is an accurate representation of the final render.

#### Green Screen (Chroma Key)

The green screen controls map directly to FFmpeg's `chromakey` filter parameters:

| UI Control | FFmpeg Parameter | Range |
|---|---|---|
| Similarity | `similarity` | 0.0 – 0.5 |
| Edge Blend | `blend` | 0.0 – 1.0 |
| Key Colour | `color` | hex → `0xRRGGBB` |

---

## Hook

### `useLibraryNavigation.ts`

Manages the state of the left-side library panel tab bar.

**Returns:**

| Value | Type | Description |
|---|---|---|
| `activeTab` | `LibraryTab` | Currently visible tab |
| `setActiveTab` | `fn` | Change the active tab |
| `showSubtitleStyling` | `boolean` | Whether the subtitle tab should appear |
| `showTextStyling` | `boolean` | Whether the text styling tab should appear |
| `showMediaStyling` | `boolean` | Whether the media styling tab should appear |
| `selectedTextClipId` | `string\|null` | ID of the clip open in the text/subtitle panel |
| `selectedMediaClipId` | `string\|null` | ID of the clip open in the media styling panel |
| `hasMediaClips` | `boolean` | True if any media clips exist on the timeline |
| `hasSubtitleClips` | `boolean` | True if any subtitle clips exist |
| `hasTextClips` | `boolean` | True if any text clips exist |

**Key behaviour:** A `useEffect` guard watches the clip map and automatically hides styling tabs and clears selected clip IDs when the relevant clips are removed from the timeline. This prevents stale "empty panel" states after deletions.

---

## Data Flow

```
User uploads file
    │
    ▼
MediaHub.processFile()
    │
    ├─ dispatch(addMediaItem)          ← appears in media grid
    │
    └─ simulate progress → dispatch(updateMediaItem({ isUploading: false }))

User drags item to timeline
    │
    ├─ [mouse] onDragStart → DataTransfer.setData(JSON)
    │                          → canvas onDrop → dispatch(addClip)
    │
    └─ [touch] onTouchStart → clone floating card
               onTouchEnd  → elementFromPoint → dispatch synthetic DragEvent
                              → canvas onDrop → dispatch(addClip)

User selects clip
    │
    └─ useTimelineEvents fires OPEN_MEDIA_STYLING event
           │
           └─ useLibraryNavigation.setSelectedMediaClipId(id)
                  → setShowMediaStyling(true)
                  → setActiveTab("media-styling")
                  → MediaStylingPanel renders for that clipId
```

---

## Supported File Types

| Category | MIME / Extensions |
|---|---|
| Video | `video/mp4`, `video/webm`, `video/ogg`, `video/avi`, `video/mov` |
| Audio | `audio/mp3`, `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/m4a`, `audio/mp4` |
| Image | `image/jpeg`, `image/png`, `image/gif`, `image/webp` |
| Subtitle | `.srt`, `.vtt`, `text/vtt`, `application/x-subrip` |

Maximum file size currently set to: **2 GB**. Maximum video duration: **3 hours**.
