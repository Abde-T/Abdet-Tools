# Timeline Canvas & Orchestration

The Timeline Canvas is the core interactive component of the editor. It manages the visual representation of tracks and clips, orchestrates complex drag-and-drop operations, and handles time-based navigation.

## Core Components

### [TimelineCanvas.tsx](./components/TimelineCanvas.tsx)
The main container for the `react-konva` Stage. It manages:
- **Virtualization**: Efficiently renders only the visible portion of the timeline to maintain 60fps performance even with hundreds of clips.
- **Scaling & Panning**: Handles zoom levels and horizontal/vertical scrolling.
- **Insertion Logic**: Detects gaps between tracks and suggests new track creation during drag-and-drop.

### [Clip.tsx](./components/Clip.tsx)
The most complex component in the feature. It manages:
- **Media Previews**: Dynamically renders audio waveforms, video thumbnails, and GIF/Image previews based on clip type.
- **Snapping Engine**: Real-time snapping to the playhead and other clip boundaries.
- **Overlap Prevention**: Visual feedback and collision detection to prevent invalid clip placements.
- **Keyframe Editing**: (Coming soon/Partial) Hooks for animating clip properties.

### [Track.tsx](./components/Track.tsx)
Renders the background lanes for video, audio, and subtitles. Includes track-specific management logic (deletion, type-restricted dropping).

### [TimeRuler.tsx](./components/TimeRuler.tsx)
High-precision ruler that provides temporal context and allows for quick seeking via double-click.

## State Orchestration

The timeline relies on a specific Redux structure defined in [timelineSlice.ts](../../redux/timelineSlice.ts).

### Performance Optimization
To ensure a buttery-smooth editing experience, the system uses **Live Duration Overrides**. When a user resizes or drags a clip, the intermediate state is kept in a lightweight Redux field or component-local state to avoid triggering a full project re-calculation until the interaction is complete (`onDragEnd`).

## Integration Hooks

- `useTimelineLayout`: Custom hook to manage the responsive split-view layouts.
- `useResizeObserver`: Ensures the Konva stage adapts perfectly to container resizing.
