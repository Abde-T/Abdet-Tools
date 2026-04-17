# 🎬 FFmpeg Video Export Engine

A **plug-and-play** TypeScript video composition and export engine powered by FFmpeg.
Drop it into **any** Node.js backend — Express, Fastify, NestJS, plain scripts — zero framework lock-in.

---

## 🚀 Local Testing vs. Production

### Local Testing (Base64 Support)
This module includes a built-in resolver that detects `data:base64` URIs in your media payloads. This allows you to test the full export pipeline directly from your browser using `blob:` URLs without needing a cloud storage integration yet.
- **Frontend**: The `ExportButton` component resolves local blobs to Base64 before sending the JSON request.
- **Backend**: The service decodes these strings and writes them to temporary files for FFmpeg.

### Production Recommendations
> [!CAUTION]
> **Base64 is for testing only.** For large videos, sending Base64 strings inside JSON will consume massive amounts of RAM.
> **Production Workflow:**
> 1. User uploads file to S3/Backblaze/R2.
> 2. Pass the **public URL** to the `FfmpegService`.
> 3. Use `hasAudio: true/false` hints to skip ffprobe probing and speed up renders.

---

## Features

- 🎞️ **Multi-track timeline** — stack images, videos, audio, GIFs, and text layers
- ✂️ **Non-linear editing** — per-clip cuts with in/out points and timeline placement
- 🔄 **Transitions** — fade, dissolve, wipe, slide, circle, and more (powered by xfade)
- 🎨 **Visual effects** — brightness, contrast, saturation, hue, blur, greyscale, sepia, opacity, rotation, flip, chroma key
- 🔑 **Keyframe animation** — animate any property over time within a clip
- 💬 **Subtitles** — burn-in SRT/ASS captions with karaoke, pop-in, word-highlight presets
- 📐 **Resolutions** — 720p, 1080p, 1440p, 4K with multiple aspect ratios
- 📊 **Progress callbacks** — hook into sockets, SSE, or logs with a simple callback
- 🔇 **Watermark** — optional diagonal watermark overlay
- 🔀 **Upscaling** — two-pass upscale for 1440p/4K (renders at 1080p, then upscales)

---

## Table of Contents

1. [Installation](#installation)
2. [File Structure](#file-structure)
3. [Quick Start](#quick-start)
4. [API Reference](#api-reference)
   - [FfmpegService](#ffmpegservice)
   - [GenerateVideoInput](#generatevideoinput)
   - [MediaInput](#mediainput)
   - [FfmpegMediaItem](#ffmpegmediaitem)
   - [CutItemInput](#cutiteminput)
   - [TransitionInput](#transitioninput)
   - [OutputOptionsInput](#outputoptionsinput)
   - [FfmpegSubtitleInput](#ffmpegsubtitleinput)
   - [FfmpegKeyframeInput](#ffmpegkeyframeinput)
5. [Progress Tracking](#progress-tracking)
6. [FFmpeg Binary Setup](#ffmpeg-binary-setup)
7. [Framework Integration Examples](#framework-integration-examples)
8. [Fonts Setup](#fonts-setup)
9. [Supported Transitions](#supported-transitions)
10. [Troubleshooting](#troubleshooting)

---

## Installation

### 1. Install Node.js packages

```bash
npm install fluent-ffmpeg ffmpeg-static @ffprobe-installer/ffprobe axios
```

### 2. Install TypeScript types (dev only)

```bash
npm install -D @types/fluent-ffmpeg @types/node
```

### 3. (Optional) System FFmpeg — recommended for production

Install system FFmpeg for best performance and codec support:

**Ubuntu / Debian:**
```bash
apt-get install -y ffmpeg
```

**macOS (Homebrew):**
```bash
brew install ffmpeg
```

**Windows:**
Download from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html) and set env vars:
```bash
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
```

> **Note:** If no system FFmpeg is found, the service automatically falls back to the bundled `ffmpeg-static` binary.

---

Copy all **files** into your project (any folder name works):

```
your-project/
└── drop-in-ffmpeg/
    └── ffmpeg/
        ├── ffmpeg.service.ts   ← Main export class — this is what you call
        ├── ffmpeg.helpers.ts   ← Internal filter graph builder (no changes needed)
        ├── ffmpeg.model.ts     ← TypeScript interfaces for all input/output types
        ├── ffmpeg.module.ts    ← NestJS module (optional, ignore if not using NestJS)
        ├── ffmpeg.resolver.ts  ← Integration examples (read-only reference)
        └── README.md           ← You are here
```

Also create a `fonts/` directory adjacent to the code for custom fonts:

```
your-project/
└── drop-in-ffmpeg/
    └── fonts/
        ├── Montserrat-VariableFont_wght.ttf
        ├── Bebas Neue-Regular.ttf
        └── ... (any .ttf / .otf files)
```

---

## Quick Start

```typescript
import { FfmpegService } from './ffmpeg/ffmpeg.service';
import { GenerateVideoInput } from './ffmpeg/ffmpeg.model';

// Create one instance (reuse it across requests)
const ffmpegService = new FfmpegService();

const input: GenerateVideoInput = {
  media: {
    videos: [
      {
        url: 'https://your-storage.com/clip.mp4',
        type: 'video',
        startTime: 0,
        endTime: 10,
        duration: 10,
        hasAudio: true,
      },
    ],
    images: [],
    audio: [],
    gif: [],
    text: [],
  },
  output: {
    resolution: '1080p',
    format: 'mp4',
    quality: 'high',
    aspectRatio: '16/9',
  },
};

// Returns the path to the rendered MP4 file on disk.
// Upload it to S3, Cloudflare R2, Backblaze B2, etc. yourself.
const { outputPath } = await ffmpegService.exportVideo(input, ({ percent, message }) => {
  console.log(`${percent.toFixed(1)}% — ${message}`);
});

console.log('Video ready at:', outputPath);
```

---

## API Reference

### `FfmpegService`

```typescript
const svc = new FfmpegService(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outputDir` | `string` | `<cwd>/generated` | Where the final rendered video is saved |
| `tmpDir` | `string` | `<cwd>/tmp_media` | Where temp files are written during rendering |
| `fontsDir` | `string` | `.../drop-in-ffmpeg/fonts` | Path to your custom .ttf/.otf fonts |
| `preset` | `string` | `'ultrafast'` | FFmpeg encoding preset. `'ultrafast'` = fastest; `'medium'` = better quality. See [presets](https://trac.ffmpeg.org/wiki/Encode/H.264#Preset) |

```typescript
// With custom options
const svc = new FfmpegService({
  outputDir: '/var/www/videos/output',
  tmpDir: '/tmp/ffmpeg_work',
  fontsDir: '/usr/share/fonts/truetype',
  preset: 'fast',
});
```

---

### `exportVideo(input, onProgress?)`

```typescript
const { outputPath } = await svc.exportVideo(input: GenerateVideoInput, onProgress?: ProgressCallback)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `GenerateVideoInput` | ✅ | The full timeline descriptor |
| `onProgress` | `(p: ExportProgress) => void` | ❌ | Called periodically with `{ percent, message }` |

**Returns:** `Promise<{ outputPath: string }>`

The `outputPath` is the **absolute path** to the rendered file on disk.
**You are responsible for uploading it** to your storage provider (S3, Backblaze, etc.).

---

### `GenerateVideoInput`

The root input object passed to `exportVideo()`.

```typescript
interface GenerateVideoInput {
  media: MediaInput;               // All your timeline tracks
  transitions?: TransitionInput[]; // Cross-fade / wipe transitions
  output?: OutputOptionsInput;     // Resolution, format, quality
  subtitles?: FfmpegSubtitleInput[]; // Subtitle tracks to burn in
  subtitlesEnabled?: boolean;      // Toggle subtitle burning
  aiCropping?: boolean;            // Reserved for AI auto-crop (advanced)
}
```

---

### `MediaInput`

All media is organised by type. Every array must be present (use `[]` if empty).

```typescript
interface MediaInput {
  videos: FfmpegMediaItem[];  // Video files (.mp4, .mov, .webm, etc.)
  images: FfmpegMediaItem[];  // Image files (.jpg, .png, .webp, etc.)
  audio:  FfmpegMediaItem[];  // Audio-only files (.mp3, .wav, .aac, etc.)
  gif:    FfmpegMediaItem[];  // Animated GIFs
  text:   FfmpegMediaItem[];  // Text overlay layers (no file needed)
}
```

---

### `FfmpegMediaItem`

A single asset placed on the timeline.

```typescript
interface FfmpegMediaItem {
  // --- Required ---
  type: 'video' | 'image' | 'audio' | 'gif' | 'text';
  startTime: number;  // When this item starts on the timeline (seconds)
  endTime: number;    // When it ends (seconds)
  duration: number;   // endTime - startTime

  // --- Source ---
  url?: string;       // HTTP(S) URL or absolute local path
                      // Not needed for type === 'text'

  // --- Performance hint ---
  hasAudio?: boolean; // Set true/false to skip ffprobe probe (saves time)
  isAnimated?: boolean; // Set true for GIFs/videos (prevents -loop 1)

  // --- Layout (applied if no cuts are provided) ---
  position?: { x: number; y: number }; // % of canvas (0–100)
  size?: { width: number; height: number }; // % of canvas (0–100)
  zIndex?: number;    // Layer order — higher = on top

  // --- Text only ---
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  fontWeight?: string;
  textAlign?: string;

  // --- Timeline segments ---
  cuts?: CutItemInput[]; // Use cuts for precise in/out points per segment
}
```

**Example — full-screen video:**
```typescript
{
  url: 'https://cdn.example.com/intro.mp4',
  type: 'video',
  startTime: 0,
  endTime: 8,
  duration: 8,
  hasAudio: true,
  position: { x: 50, y: 50 },
  size: { width: 100, height: 100 },
  zIndex: 0,
}
```

**Example — overlay image (top-right corner):**
```typescript
{
  url: 'https://cdn.example.com/logo.png',
  type: 'image',
  startTime: 0,
  endTime: 30,
  duration: 30,
  position: { x: 85, y: 10 },
  size: { width: 15, height: 10 },
  zIndex: 10,
}
```

**Example — text layer:**
```typescript
{
  type: 'text',
  startTime: 2,
  endTime: 7,
  duration: 5,
  text: 'Hello World!',
  fontSize: 48,
  fontFamily: 'Bebas Neue',
  color: '#ffffff',
  position: { x: 50, y: 90 },
  size: { width: 80, height: 10 },
  zIndex: 20,
}
```

---

### `CutItemInput`

Use cuts when you want to use **specific segments** of a source file and place them at precise timeline positions. Each cut becomes a separate segment in the filter graph.

```typescript
interface CutItemInput {
  id: string;               // unique ID for transition matching
  start: number;            // in-source start (seconds into the source file)
  end: number;              // in-source end
  timelineStart: number;    // where this segment appears on the output timeline

  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex?: number;
  volume?: number;          // 0.0 – 1.0

  // Visual effects
  brightness?: number;      // 0–200 (100 = normal)
  contrast?: number;        // 0–200
  saturation?: number;      // 0–200
  hue?: number;             // 0–360 degrees
  blur?: number;            // 0–20 px
  sharpen?: number;         // 0–100
  grayscale?: number;       // 0–100
  sepia?: number;           // 0–100
  invert?: number;          // 0–100
  opacity?: number;         // 0–100
  rotate?: number;          // -180 to 180 degrees
  flipH?: boolean;
  flipV?: boolean;
  roundedCorners?: number;  // 0–50 px radius
  fadeInDuration?: number;  // seconds
  fadeOutDuration?: number;

  // Green screen / chroma key
  greenScreenEnabled?: boolean;
  greenScreenColor?: string;        // e.g. '#00ff00'
  greenScreenSimilarity?: number;   // 0.0–1.0
  greenScreenBlend?: number;        // 0.0–1.0

  // Per-cut subtitles
  srt?: string;
  subtitlesStyling?: FfmpegSubtitleOptionsInput;

  // Keyframe animation
  keyframes?: FfmpegKeyframeInput[];
}
```

**Example — two segments from the same source video:**
```typescript
{
  url: 'https://cdn.example.com/interview.mp4',
  type: 'video',
  startTime: 0,
  endTime: 15,
  duration: 15,
  hasAudio: true,
  cuts: [
    {
      id: 'cut-1',
      start: 30,            // source: 0:30
      end: 38,              // source: 0:38
      timelineStart: 0,     // appears at 0s on the output
      position: { x: 50, y: 50 },
      size: { width: 100, height: 100 },
    },
    {
      id: 'cut-2',
      start: 62,            // source: 1:02
      end: 69,              // source: 1:09
      timelineStart: 8,     // appears at 8s on the output
      position: { x: 50, y: 50 },
      size: { width: 100, height: 100 },
      brightness: 110,      // slightly brighter
    },
  ],
}
```

---

### `TransitionInput`

Adds a cross-fade / wipe / dissolve between two consecutive clips **on the same z-index layer**.

```typescript
interface TransitionInput {
  type: string;       // e.g. 'fade', 'wipeleft' — see full list below
  start: number;      // timeline time where the transition begins (seconds)
  duration: number;   // how long the transition lasts (seconds)
  fromId?: string;    // ID of the outgoing cut (strongly recommended)
  toId?: string;      // ID of the incoming cut (strongly recommended)
  zIndex?: number;
}
```

**Example:**
```typescript
transitions: [
  {
    type: 'fade',
    start: 7,       // starts 1 second before cut-1 ends (8 - 1 = 7)
    duration: 1,
    fromId: 'cut-1',
    toId: 'cut-2',
  },
]
```

> 💡 **Tip:** Always provide `fromId`/`toId` for reliable matching. Timing-based matching alone can be ambiguous with many clips.

---

### `OutputOptionsInput`

```typescript
interface OutputOptionsInput {
  resolution?: '720p' | '1080p' | '1440p' | '4k';  // default: '1080p'
  format?: 'mp4' | 'webm' | 'mov';                  // default: 'mp4'
  quality?: 'low' | 'medium' | 'high' | 'ultra';    // default: 'medium'
  aspectRatio?: '16/9' | '9/16' | '1/1' | '4/3';   // default: '16/9'
}
```

| Quality | Video Bitrate | Audio Bitrate |
|---------|--------------|--------------|
| `low` | 1000k | 96k |
| `medium` | 2000k | 128k |
| `high` | 3000k | 192k |
| `ultra` | 5000k | 256k |

> ⚠️ `1440p` and `4k` use a **two-pass render** (1080p → upscale). This takes longer but uses significantly less memory.

---

### `FfmpegSubtitleInput`

Burns subtitles directly into the video pixels.

```typescript
interface FfmpegSubtitleInput {
  srt: string;                          // Raw SRT content as a string
  zIndex?: number;                      // Layer order
  styling?: FfmpegSubtitleOptionsInput;
}

interface FfmpegSubtitleOptionsInput {
  fontSize?: number;                    // px, e.g. 36
  fontName?: string;                    // Must be available in src/fonts/
  primaryColor?: string;                // e.g. 'white', '#ffffff'
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
  shadowDepth?: number;
  position?: 'top' | 'bottom' | 'center';
  animationPreset?: 'none' | 'word-highlight' | 'pop-in' | 'word-pop' | 'typewriter';
  enableKaraoke?: boolean;
  highlightColor?: string;              // Active word highlight colour
}
```

**Example:**
```typescript
subtitles: [
  {
    srt: `1\n00:00:01,000 --> 00:00:04,000\nHello, world!\n\n2\n00:00:05,000 --> 00:00:08,000\nThis is a subtitle.`,
    styling: {
      fontSize: 40,
      fontName: 'Montserrat',
      primaryColor: 'white',
      outlineColor: 'black',
      outlineWidth: 2,
      position: 'bottom',
      animationPreset: 'word-pop',
    },
  },
],
```

---

### `FfmpegKeyframeInput`

Animates clip properties over time. Keyframes are defined **relative to the start of the cut** (in seconds).

```typescript
interface FfmpegKeyframeInput {
  at: number;           // offset from cut start in seconds
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  opacity?: number;     // 0–100
  rotate?: number;
  brightness?: number;
  // ...same properties as CutItemInput visual effects
  easing?: 'linear';    // currently 'linear' is supported
}
```

**Example — slide in from left:**
```typescript
cuts: [{
  id: 'animated-clip',
  start: 0, end: 5, timelineStart: 0,
  position: { x: 50, y: 50 },
  size: { width: 100, height: 100 },
  keyframes: [
    { at: 0, position: { x: -50, y: 50 }, easing: 'linear' }, // starts off-screen left
    { at: 1, position: { x: 50, y: 50 } },                     // reaches center by 1s
  ],
}]
```

---

## Progress Tracking

The `onProgress` callback receives updates throughout the render:

```typescript
export interface ExportProgress {
  percent: number;   // 0–100
  message: string;   // human-readable status
}
```

**Socket.io example:**
```typescript
const { outputPath } = await svc.exportVideo(input, ({ percent, message }) => {
  io.to(clientSocketId).emit('export-progress', { percent, message });
});
```

**Server-Sent Events (SSE) example:**
```typescript
app.get('/export-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { outputPath } = await svc.exportVideo(input, ({ percent, message }) => {
    res.write(`data: ${JSON.stringify({ percent, message })}\n\n`);
  });

  res.write(`data: ${JSON.stringify({ percent: 100, outputPath })}\n\n`);
  res.end();
});
```

**Progress milestones:**

| % Range | Phase |
|---------|-------|
| 0–5% | Initialisation |
| 5–15% | Downloading / resolving media |
| 15–25% | Building filter graph |
| 25–30% | Filter graph ready |
| 30–90% | Active FFmpeg render |
| 90–95% | Upscaling pass (4K/1440p only) |
| 100% | Done |

---

## FFmpeg Binary Setup

### Option A — Environment variables (recommended for production)

```bash
# Linux / macOS (add to .env or shell profile)
FFMPEG_PATH=/usr/local/bin/ffmpeg
FFPROBE_PATH=/usr/local/bin/ffprobe

# Windows (PowerShell)
$env:FFMPEG_PATH = "C:\ffmpeg\bin\ffmpeg.exe"
$env:FFPROBE_PATH = "C:\ffmpeg\bin\ffprobe.exe"
```

### Option B — Bundled binary (zero config, good for development)

If no env vars are set, the service automatically uses `ffmpeg-static`.
Just make sure it's installed:

```bash
npm install ffmpeg-static @ffprobe-installer/ffprobe
```

### Checking what binary is being used

The service logs this at startup:
```
[FfmpegService] Using FFmpeg: /usr/local/bin/ffmpeg (xfade: true)
```

---

## 🚀 Production Recommendations

If you are moving from a local environment to a production-scale SaaS, follow these best practices to ensure stability and performance.

### 1. Cloud Storage & Persistence
The `FfmpegService` returns an `outputPath` which is an absolute path on the **local disk**. In production:
- **Upload Immediately**: Use the AWS SDK, Cloudinary, or Backblaze SDK to upload the file to a bucket as soon as `exportVideo` completes.
- **Database Entry**: Store the resulting public URL in your database (e.g., `VideoJob` table) and associate it with the user.
- **Auto-Cleanup**: The service cleans up its own intermediate temporary files, but you are responsible for deleting the final `outputPath` after a successful upload.

### 2. Real-time Progress (Socket.io)
Don't make your users wait in the dark. Use the `onProgress` callback to pipe status updates to the frontend:
```typescript
const { outputPath } = await svc.exportVideo(input, (progress) => {
  // Emit to a specific user/room
  io.to(`user-${userId}`).emit('render-progress', {
    jobId: currentJobId,
    percent: progress.percent,
    message: progress.message
  });
});
```

### 3. Service Failure & Reliability
- **Background Jobs**: For production, never run `exportVideo` directly in your main API thread. Offload it to a background worker (e.g., **BullMQ**, **RabbitMQ**, or **Amazon SQS**).
- **Timeouts**: The service has internal dynamic timeouts, but ensure your worker has a global timeout (e.g., 10 minutes) to prevent zombie FFmpeg processes.
- **Health Checks**: Periodically verify that FFmpeg is accessible via `ffmpeg -version` in your worker's initialization script.
- **Memory Management**: Video rendering is CPU and RAM intensive. Ensure your server/instance has at least 2GB of free RAM and consider using vertical scaling for faster renders.

---

## Framework Integration Examples

### Express

```typescript
import express from 'express';
import { FfmpegService } from './ffmpeg/ffmpeg.service';

const app = express();
const svc = new FfmpegService();
app.use(express.json({ limit: '10mb' }));

app.post('/api/export', async (req, res) => {
  try {
    const { outputPath } = await svc.exportVideo(req.body, ({ percent, message }) => {
      // Emit to your socket / SSE here
    });

    // Upload outputPath to your storage, then respond with the URL
    res.json({ outputPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000);
```

### Fastify

```typescript
import Fastify from 'fastify';
import { FfmpegService } from './ffmpeg/ffmpeg.service';

const app = Fastify();
const svc = new FfmpegService();

app.post('/api/export', async (request, reply) => {
  const { outputPath } = await svc.exportVideo(request.body as any, ({ percent, message }) => {
    // Emit progress
  });
  return { outputPath };
});

app.listen({ port: 3000 });
```

### NestJS

```typescript
// ffmpeg.module.ts — uncomment the module block in that file, then:

// app.module.ts
import { FfmpegModule } from './ffmpeg/ffmpeg.module';

@Module({
  imports: [FfmpegModule],
})
export class AppModule {}

// your.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { FfmpegService } from './ffmpeg/ffmpeg.service';
import { GenerateVideoInput } from './ffmpeg/ffmpeg.model';

@Controller('ffmpeg')
export class FfmpegController {
  constructor(private readonly ffmpegService: FfmpegService) {}

  @Post('export')
  async export(@Body() input: GenerateVideoInput) {
    return this.ffmpegService.exportVideo(input, ({ percent, message }) => {
      // this.socketGateway.emit(clientId, 'progress', { percent, message });
    });
  }
}
```

### Plain Node.js / CLI script

```typescript
import { FfmpegService } from './ffmpeg/ffmpeg.service';

async function main() {
  const svc = new FfmpegService({ preset: 'medium' });

  const { outputPath } = await svc.exportVideo(
    {
      media: {
        videos: [{ url: '/path/to/local/video.mp4', type: 'video', startTime: 0, endTime: 10, duration: 10, hasAudio: true }],
        images: [], audio: [], gif: [], text: [],
      },
      output: { resolution: '1080p', format: 'mp4', quality: 'high', aspectRatio: '16/9' },
    },
    ({ percent, message }) => process.stdout.write(`\r${percent.toFixed(1)}% — ${message}`),
  );

  console.log('\nDone:', outputPath);
}

main().catch(console.error);
```

---

## Fonts Setup

Place your `.ttf` or `.otf` font files in the `fonts/` directory adjacent to the service:

```
your-project/
└── drop-in-ffmpeg/
    ├── ffmpeg/
    └── fonts/
        ├── Montserrat-VariableFont_wght.ttf
        ├── Bungee-Regular.ttf
        ├── BebasNeue-Regular.ttf
        └── MyCustomFont.ttf
```

The built-in font name → file mapping is in `ffmpeg.service.ts` in the `FONT_MAPPING` constant.
Add your own entries there:

```typescript
const FONT_MAPPING: Record<string, string> = {
  Montserrat: 'Montserrat-VariableFont_wght.ttf',
  'Bebas Neue': 'BebasNeue-Regular.ttf',
  'My Font': 'MyCustomFont.ttf',  // ← add yours here
};
```

You can get free fonts from:
- [Google Fonts](https://fonts.google.com/) (download `.ttf`)
- [DaFont](https://www.dafont.com/)
- [Font Squirrel](https://www.fontsquirrel.com/)

---

## Supported Transitions

Pass any of these strings as the `type` field in `TransitionInput`:

| Name | Effect |
|------|--------|
| `fade` | Cross-fade to black then to next clip |
| `dissolve` | Direct cross-dissolve between clips |
| `wipeleft` | Wipe left to right |
| `wiperight` | Wipe right to left |
| `wipeup` | Wipe bottom to top |
| `wipedown` | Wipe top to bottom |
| `slideleft` | Next clip slides in from right |
| `slideright` | Next clip slides in from left |
| `slideup` | Next clip slides in from bottom |
| `slidedown` | Next clip slides in from top |
| `circleopen` | Reveal via expanding circle |
| `circleclose` | Conceal via shrinking circle |
| `rectcrop` | Rectangular crop transition |
| `distance` | Distance-based transition |
| `fadeblack` | Fade to black between clips |
| `fadewhite` | Fade to white between clips |

> ⚠️ Transitions require FFmpeg 4.0+ with `xfade` filter support. The service detects this automatically — if xfade is unavailable, transitions fall back to hard cuts.

---

## Troubleshooting

### `FFmpeg binary not found`
Set `FFMPEG_PATH` and `FFPROBE_PATH` env vars, or run `npm install ffmpeg-static @ffprobe-installer/ffprobe`.

### `Output file was not created by FFmpeg`
Enable debug logging and check the FFmpeg stderr printed to console. Common causes:
- Corrupt or unsupported input file format
- Missing audio stream when `hasAudio: true` is set
- Invalid filter expression (usually a font path issue with subtitles)

### Subtitles not appearing
- Confirm the font file exists in `src/fonts/`
- Check the font name matches the `FONT_MAPPING` in `ffmpeg.service.ts`
- On Windows, paths with `:` must be escaped — the service handles this automatically

### Render is very slow
- Use `preset: 'ultrafast'` (the default)
- Reduce resolution to `720p` during testing
- Avoid `4k` / `1440p` unless needed — they trigger a two-pass upscale

### Progress callback never fires
- The callback fires during the active render phase (30–90%). If your video is very short (< 1s) FFmpeg may complete before emitting progress events.

### Out of memory on large projects
- Lower `concurrencyLimit` in the service (default is 10 parallel downloads)
- Use `-threads 1` (already set) to reduce FFmpeg memory usage
- Switch to `720p` / `medium` quality

---

## Complete Example — Multi-clip with Transitions and Subtitles

```typescript
import { FfmpegService } from './ffmpeg/ffmpeg.service';
import { GenerateVideoInput } from './ffmpeg/ffmpeg.model';

const svc = new FfmpegService({ preset: 'fast' });

const input: GenerateVideoInput = {
  media: {
    videos: [
      {
        url: 'https://cdn.example.com/interview.mp4',
        type: 'video',
        startTime: 0,
        endTime: 20,
        duration: 20,
        hasAudio: true,
        cuts: [
          {
            id: 'clip-a',
            start: 15, end: 25, timelineStart: 0,
            position: { x: 50, y: 50 },
            size: { width: 100, height: 100 },
          },
          {
            id: 'clip-b',
            start: 60, end: 70, timelineStart: 10,
            position: { x: 50, y: 50 },
            size: { width: 100, height: 100 },
            brightness: 110,
          },
        ],
      },
    ],
    images: [
      {
        url: 'https://cdn.example.com/logo.png',
        type: 'image',
        startTime: 0,
        endTime: 20,
        duration: 20,
        position: { x: 88, y: 8 },
        size: { width: 12, height: 8 },
        zIndex: 10,
      },
    ],
    audio: [
      {
        url: 'https://cdn.example.com/background-music.mp3',
        type: 'audio',
        startTime: 0,
        endTime: 20,
        duration: 20,
        hasAudio: true,
      },
    ],
    gif: [],
    text: [],
  },

  transitions: [
    {
      type: 'fade',
      start: 9,       // 1 second before clip-a ends (10 - 1)
      duration: 1,
      fromId: 'clip-a',
      toId: 'clip-b',
    },
  ],

  subtitles: [
    {
      srt: `1\n00:00:00,500 --> 00:00:04,000\nWelcome to our channel!\n\n2\n00:00:10,000 --> 00:00:14,000\nDon't forget to subscribe.`,
      styling: {
        fontSize: 38,
        fontName: 'Montserrat',
        primaryColor: 'white',
        outlineColor: 'black',
        outlineWidth: 2,
        position: 'bottom',
        animationPreset: 'word-pop',
      },
    },
  ],

  output: {
    resolution: '1080p',
    format: 'mp4',
    quality: 'high',
    aspectRatio: '16/9',
  },
};

const { outputPath } = await svc.exportVideo(input, ({ percent, message }) => {
  console.log(`${percent.toFixed(1)}% — ${message}`);
});

console.log('✅ Video saved to:', outputPath);
// → Upload outputPath to your storage provider
```

---
