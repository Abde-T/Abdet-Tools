# 🎬 React Timeline Editor (Premium Drop-In Source Code)

A high-performance, **drop-in timeline editor for React**.  
Build web-based video, audio, and subtitle editing experiences in **minutes, not months**.

## ⚡ Quick Start (Running in 2 Minutes)

Get a working editor instantly.

1. **Install dependencies**: Make sure you have the required packages installed in your host project's `package.json`:
   ```bash
   npm install @reduxjs/toolkit react-redux react-konva konva framer-motion lucide-react moment sonner tailwind-merge clsx class-variance-authority uuid gifuct-js react-masonry-css embla-carousel-react @radix-ui/react-accordion @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-popover @radix-ui/react-progress @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slider @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-tooltip
   ```
2. **Copy the code**: Drop the `timeline` folder into your project (e.g., `src/components/timeline`).
   add the main timeline component to your App:

   ```tsx
   import Timeline from "./timeline-editor/components/timeline/Timeline";
   import "./timeline-editor/theme.css";

   export default function App() {
     return (
       <div className="timeline-theme-root">
         <Timeline />
       </div>
     );
   }
   ```

👉 You now have a fully functional multi-track editor running.

---

## 🎯 Who is this for?

This is built for developers who want production-grade editing without spending months dealing with:

- Complex timeline math
- react-konva performance issues
- State synchronization bugs

Perfect for:

- **AI Video / SaaS Founders**: Add editing UI for generated videos, captions, or clips
- **Podcast & Audio Tools**: Build trimming + multi-track audio interfaces
- **Content Creation Apps**: Create Canva-like or Premiere-like web editors

---

## 🚀 What You Get

- **Multi-Track Timeline**
  Infinite tracks for video, audio, subtitles
- **Editing Tools**
  Drag, trim, split, move, cut, resize, zoom
- **Frame-Accurate Snapping**
  Magnetic alignment + collision handling
- **High-Performance Player**
  Synced HTML5 <video> / <audio> playback
- **Real-Time Effects**
  Chroma key (green screen) + visual filters + keyframes, transitions
- **Modern UI System**
  Tailwind-based design

---

## 🪝 Customization & API Hooks

The editor was heavily decoupled so you can customize exactly how it integrates with your backend, database, or rendering pipeline.

All state lives in Redux → giving you full control.

### Extracting Timeline Data (Exporting to FFmpeg)

When the user clicks "Export", you can grab the JSON state of the timeline and send it to your backend (or a WebAssembly pipeline) to be rendered.

```typescript
import { useSelector } from "react-redux";
import { RootState } from "./redux/store";

const ExportButton = () => {
   const { clips, tracks } = useSelector((state) => state.timeline);

  const handleExport = async () => {
    // Send your timeline state perfectly formatted to your backend
    await fetch("/api/render-video", {
      method: "POST",
      body: JSON.stringify({ clips, tracks })
    });
  }

  return <button onClick={handleExport}>Render Video</button>;
}
```

### Programmatic Control

Want to build custom buttons to jump around the timeline or add tracks? Just dispatch to the store:

```typescript
import { useDispatch } from "react-redux";
import { setCurrentTime, addTrack } from "./timeline/redux/timelineSlice";

// Jump to 10.5 seconds
dispatch(setCurrentTime(10.5));

// Add a new subtitle track programmatically
dispatch(addTrack({ type: "subtitle" }));
```

---

## 🏗️ Architecture Overview

For developers who want to dig into how the engine works, the system is separated into decoupled modules:

### 1. [Konva Timeline Canvas](./components/timeline/README.md)

The ultra-responsive editing surface. Handles drag-and-drop orchestration using specialized local-state bypasses to maintain 60FPS during drags, only committing data to Redux on `onDragEnd`.

### 2. [High-Performance Player](./components/player/README.md)

The preview orchestration engine. It efficiently determines which clips should be visible at the current timestamp (`currentTime`) and manages background HTML5 media elements.

### 3. [Media & Library Hub](./components/mediahub/README.md)

Handles local file ingestion via Object URLs (`blob:`). This avoids the need to upload files to a server just to preview them. Note: _Media is not persisted across page refreshes by default—database sync logic is yours to implement based on your backend!_

---

## 🧪 Demo

**▶️ Watch it in action**
A short demo showing the full editing flow:

- importing media
- dragging clips across tracks
- trimming and splitting
- real-time playback sync
- exporting timeline data
  🎬 [Demo Video](https://media.klipflow.com/file/klipflow/showcase.mp4)
  🎬 [Plug and Play Showcase Video](https://media.klipflow.com/file/klipflow/plug+and+play.mp4)

**🚀 Live Editor**
Try it instantly in the browser:

- [Barebones Editor](https://abdet-tools.vercel.app) → what you get
- [Full SaaS Example](https://www.klipflow.com/timeline) → what you can build

---

## ⚠️ Important Notes

- Runs entirely in the browser (local-first)
- Uses blob: URLs for preview
- Media is not persisted by default (you control backend)
- Designed for extension, not limitation

## 📜 License

See [LICENSE](./LICENSE) file for usage terms.

---

Created by Abde-T @ 2026
