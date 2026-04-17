/**
 * timelineSlice.ts
 *
 * The primary state management slice for the Timeline Editor.
 *
 * This slice manages:
 * - **Core Data**: Tracks, Clips, and Media Items.
 * - **Player State**: `currentTime`, `isPlaying`, `aspectRatio`.
 * - **Editor UI State**: `zoom`, `selectedClipId`, `history` (Undo/Redo), `liveDurationOverrides`.
 * - **Assets**: Manages async fetching of video thumbnails via thunks.
 */
import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import {
  extractVideoFrames,
  calculateFrameInterval,
  videoFrameCache,
  checkVideoHasAudio,
} from "../components/timeline/utils/videoUtils";
import { SubtitleAnimationPreset } from "../components/mediahub/components/SubtitleStylingPanel";

export interface VideoFrame {
  timestamp: number; // time in seconds
  dataUrl: string; // base64 data URL
}

export interface Keyframe {
  at: number; // seconds since clip start
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  rotate?: number;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  blur?: number;
  grayscale?: number;
  sepia?: number;
  invert?: number;
  sharpen?: number;
  roundedCorners?: number;
  easing?: "linear" | "jump-cut";
}

export interface Clip {
  id: string;
  type:
    | "video"
    | "audio"
    | "image"
    | "gif"
    | "subtitle"
    | "text"
    | "transition"
    | "fade"
    | "xfade";
  start: number; // in seconds
  duration: number; // in seconds
  // Start time within the source media (for cuts simulation)
  sourceStart?: number;
  trackId: string;
  name: string;
  color: string;
  url?: string; // Direct URL to media asset (for preview and export)
  mediaId?: string; // Reference to media item ID
  zIndex?: number; // layer order in player
  volume?: number; // 0.0 - 1.0 (video/audio only)
  thumbnails?: VideoFrame[]; // video frames for video clips
  thumbnailInterval?: number; // interval used for thumbnail extraction
  subtitleGroupId?: string; // group ID for subtitle clips from same SRT file
  position?: {
    x: number;
    y: number;
  };
  size?: {
    width: number;
    height: number;
  };
  styling?: {
    // Text styling
    fontSize?: number;
    fontName?: string;
    primaryColor?: string;
    outlineColor?: string;
    outlineWidth?: number;
    shadowColor?: string;
    shadowDepth?: number;
    position?: string;
    enableKaraoke?: boolean;
    karaokeHighlightedColor?: string;
    karaokeNormalColor?: string;
    animationPreset?: SubtitleAnimationPreset;

    // Visual Filters & Transforms
    brightness?: number;
    contrast?: number;
    saturation?: number;
    hue?: number;
    blur?: number;
    sharpen?: number;
    grayscale?: number;
    sepia?: number;
    invert?: number;
    flipH?: boolean;
    flipV?: boolean;
    rotate?: number;
    roundedCorners?: number;

    // Chroma Key
    greenScreenEnabled?: boolean;
    greenScreenColor?: string;
    greenScreenSimilarity?: number;
    greenScreenBlend?: number;

    // Audio
    audioSpeed?: number;
    audioPitch?: number;
    audioBassBoost?: number;
    audioTrebleBoost?: number;
    audioEcho?: number;
    audioReverb?: number;
  };
  isEffect?: boolean; // indicates if this is an effect clip
  effectType?: string; // the actual effect type for export (e.g., "fade", "fadein", "fadeout", "fadeblack", "fadewhite")
  isAnimated?: boolean;
  hasAudio?: boolean;
  fadeInDuration?: number; // duration in seconds
  fadeOutDuration?: number; // duration in seconds
  keyframes?: Keyframe[]; // animation keyframes for visual media (video, image, gif, text)
}

export interface Track {
  id: string;
  type: "video" | "audio" | "subtitle";
  clips: string[]; // array of clip ids
  name: string;
  height: number;
}

export interface MediaItem {
  id: string;
  type: "video" | "audio" | "image" | "gif" | "text" | "subtitle";
  name: string;
  url: string;
  duration?: number; // for video/audio
  thumbnail?: string;
  textContent?: string; // for text items
  isUploading?: boolean; // for upload status
  subtitles?: { start: number; end: number; text: string }[]; // for subtitle collections
  publicId?: string; // Cloudinary public ID for deletion
  subtitleGroupId?: string; // group ID for subtitle files (SRT/VTT)
  isAnimated?: boolean;
  hasAudio?: boolean;
}

export interface TimelineState {
  tracks: Track[];
  clips: Record<string, Clip>;
  mediaItems: MediaItem[];
  currentTime: number;
  zoom: number; // pixels per second
  timelineWidth: number;
  timelineHeight: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  draggingType: null | "video" | "audio" | "subtitle";
  resizeGuidelines: {
    clipId: string | null;
    isVisible: boolean;
    snapX?: number | null;
    snapY?: number | null;
  };
  globalSubtitleStyling: {
    fontSize?: number;
    fontName?: string;
    primaryColor?: string;
    outlineColor?: string;
    outlineWidth?: number;
    shadowColor?: string;
    shadowDepth?: number;
    position?: string;
    enableKaraoke?: boolean;
    karaokeHighlightedColor?: string;
    karaokeNormalColor?: string;
    animationPreset?: SubtitleAnimationPreset;
  };
  aspectRatio: string;
  // Live, transient duration overrides while resizing (seconds)
  liveDurationOverrides?: Record<string, number>;
  // Undo/Redo history
  history: {
    clips: Record<string, Clip>;
    tracks: Track[];
  }[];
  historyIndex: number; // Current position in history (-1 means no history)
  insertionIndicator: {
    y: number;
    type: "video" | "audio" | "subtitle";
    isVisible: boolean;
  } | null;
  showPlayerScrubber: boolean;
  lastActionType?: string;
}

// Async thunk for adding video clips with thumbnail extraction
export const addVideoClipWithThumbnails = createAsyncThunk(
  "timeline/addVideoClipWithThumbnails",
  async (
    payload: {
      trackId: string;
      clip: Omit<Clip, "id" | "thumbnails" | "thumbnailInterval">;
      videoUrl: string;
      zoom: number;
    },
    { rejectWithValue },
  ) => {
    const { trackId, clip, videoUrl, zoom } = payload;
    let frames: VideoFrame[] = [];
    let interval = 1;

    try {
      // Check cache first
      if (videoFrameCache.has(videoUrl)) {
        frames = videoFrameCache.get(videoUrl)!;
        interval =
          frames.length > 0
            ? frames[1]?.timestamp - frames[0]?.timestamp || 1
            : 1;
      } else {
        // Calculate optimal frame interval based on zoom and duration
        interval = calculateFrameInterval(zoom, clip.duration);

        // Extract frames
        frames = await extractVideoFrames(videoUrl, {
          interval,
          maxFrames: 50,
          quality: 0.8,
          width: 160,
          height: 90,
        });

        // Cache the frames
        videoFrameCache.set(videoUrl, frames);
      }
    } catch (error) {
      console.warn(
        `Failed to extract video frames for ${videoUrl}. Adding clip without thumbnails.`,
        error,
      );
      // Continue without frames - do not reject, so the clip is still added
    }

    const clipId = `clip-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Use provided hasAudio if available, otherwise check
    const hasAudio =
      clip.hasAudio !== undefined
        ? clip.hasAudio
        : await checkVideoHasAudio(videoUrl);

    const newClip: Clip = {
      ...clip,
      id: clipId,
      zIndex:
        clip.type === "text" || clip.type === "subtitle" ? 10000 : undefined,
      thumbnails: frames,
      thumbnailInterval: interval,
      hasAudio,
    };

    return { trackId, clip: newClip };
  },
);

// Async thunk for updating video clip thumbnails when zoom changes
export const updateVideoClipThumbnails = createAsyncThunk(
  "timeline/updateVideoClipThumbnails",
  async (
    payload: {
      clipId: string;
      videoUrl: string;
      zoom: number;
      duration: number;
    },
    { rejectWithValue },
  ) => {
    try {
      const { clipId, videoUrl, zoom, duration } = payload;

      // Calculate new interval based on current zoom
      const newInterval = calculateFrameInterval(zoom, duration);

      // Check if we need to regenerate frames
      const cachedFrames = videoFrameCache.get(videoUrl);
      if (cachedFrames && cachedFrames.length > 0) {
        const currentInterval =
          cachedFrames[1]?.timestamp - cachedFrames[0]?.timestamp || 1;
        // Only regenerate if the interval difference is significant (>20%)
        if (Math.abs(newInterval - currentInterval) / currentInterval < 0.2) {
          return {
            clipId,
            thumbnails: cachedFrames,
            thumbnailInterval: currentInterval,
          };
        }
      }

      // Extract new frames
      const frames = await extractVideoFrames(videoUrl, {
        interval: newInterval,
        maxFrames: 50,
        quality: 0.8,
        width: 160,
        height: 90,
      });

      // Update cache
      videoFrameCache.set(videoUrl, frames);

      return { clipId, thumbnails: frames, thumbnailInterval: newInterval };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error
          ? error.message
          : "Failed to update video thumbnails",
      );
    }
  },
);

const initialState: TimelineState = {
  tracks: [
    {
      id: "track-3",
      type: "subtitle",
      clips: [],
      name: "Subtitle Track",
      height: 40,
    },
    {
      id: "track-1",
      type: "video",
      clips: [],
      name: "Video Track",
      height: 70,
    },
    {
      id: "track-2",
      type: "audio",
      clips: [],
      name: "Audio Track",
      height: 40,
    },
  ],
  clips: {},
  mediaItems: [],
  currentTime: 0,
  zoom: 50, // 50 pixels per second
  timelineWidth: 1200,
  timelineHeight: 300,
  isPlaying: false,
  selectedClipId: null,
  draggingType: null,
  resizeGuidelines: {
    clipId: null,
    isVisible: false,
    snapX: null,
    snapY: null,
  },
  globalSubtitleStyling: {
    fontSize: 24,
    fontName: "Arial",
    primaryColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 0,
    shadowColor: "#000000",
    shadowDepth: 1,
    position: "bottom",
    enableKaraoke: false,
    karaokeHighlightedColor: "#FFD700",
    karaokeNormalColor: "#FFFFFF",
    animationPreset: "none",
  },
  aspectRatio: "16:9",
  liveDurationOverrides: {},
  history: [],
  historyIndex: -1,
  insertionIndicator: null,
  showPlayerScrubber: true,
  lastActionType: "",
};

const timelineSlice = createSlice({
  name: "timeline",
  initialState,
  reducers: {
    addTrack: (
      state,
      action: PayloadAction<{
        type: "video" | "audio" | "subtitle";
        insertAfterTrackId?: string;
      }>,
    ) => {
      const { type, insertAfterTrackId } = action.payload;
      const baseName =
        type === "video"
          ? "Video Track"
          : type === "audio"
            ? "Audio Track"
            : "Subtitle Track";
      const countSameType = state.tracks.filter((t) => t.type === type).length;
      const height = type === "video" ? 70 : 40;
      const newTrack: Track = {
        id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type,
        clips: [],
        name: baseName,
        height,
      };
      if (insertAfterTrackId) {
        const idx = state.tracks.findIndex((t) => t.id === insertAfterTrackId);
        if (idx >= 0) {
          state.tracks.splice(idx + 1, 0, newTrack);
          return;
        }
      }
      const lastSameIdx = [...state.tracks]
        .map((t, i) => ({ t, i }))
        .filter((x) => x.t.type === type)
        .map((x) => x.i)
        .pop();
      if (lastSameIdx !== undefined)
        state.tracks.splice(lastSameIdx + 1, 0, newTrack);
      else state.tracks.push(newTrack);
    },
    setCurrentTime: (state, action: PayloadAction<number>) => {
      state.currentTime = action.payload;
    },
    setZoom: (state, action: PayloadAction<number>) => {
      state.zoom = Math.max(0.1, Math.min(5000, action.payload));
    },
    setTimelineSize: (
      state,
      action: PayloadAction<{ width: number; height: number }>,
    ) => {
      state.timelineWidth = action.payload.width;
      state.timelineHeight = action.payload.height;
    },
    addClip: (
      state,
      action: PayloadAction<{ trackId: string; clip: Omit<Clip, "id"> }>,
    ) => {
      const { trackId, clip } = action.payload;
      const clipId = `clip-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      // Compute zIndex rank: 1 = top, 2 = middle, 3 = background
      const trackIndex = state.tracks.findIndex((t) => t.id === trackId);
      const videoTrackOrder = state.tracks
        .map((t, idx) => ({ t, idx }))
        .filter((x) => x.t.type === "video")
        .map((x) => x.idx)
        .sort((a, b) => a - b);
      const rank =
        clip.type === "text" || clip.type === "subtitle"
          ? 1
          : videoTrackOrder.indexOf(trackIndex) >= 0
            ? videoTrackOrder.indexOf(trackIndex) + 1
            : 3;
      const newClip: Clip = {
        ...clip,
        id: clipId,
        zIndex: clip.zIndex ?? rank,
      };
      // Default volume for audio/video
      if (
        (newClip.type === "audio" || newClip.type === "video") &&
        (newClip.volume === undefined || newClip.volume === null)
      ) {
        newClip.volume = 1;
      }

      // Initialize position and size for visual media (video, image, gif, text)
      if (
        ["video", "image", "gif", "text"].includes(newClip.type) &&
        !newClip.position
      ) {
        newClip.position = { x: 50, y: 50 };
      }
      if (
        ["video", "image", "gif", "text"].includes(newClip.type) &&
        !newClip.size
      ) {
        newClip.size = { width: 100, height: 100 };
      }

      state.clips[clipId] = newClip;
      state.tracks.find((track) => track.id === trackId)?.clips.push(clipId);
    },
    batchAddClips: (
      state,
      action: PayloadAction<{
        trackId: string;
        clips: (Omit<Clip, "id"> & { id?: string })[];
      }>,
    ) => {
      const { trackId, clips } = action.payload;
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return;

      const videoTrackOrder = state.tracks
        .map((t, idx) => ({ t, idx }))
        .filter((x) => x.t.type === "video")
        .map((x) => x.idx)
        .sort((a, b) => a - b);
      const trackIndex = state.tracks.indexOf(track);

      clips.forEach((clip) => {
        const clipId =
          clip.id ||
          `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const rank =
          clip.type === "text" || clip.type === "subtitle"
            ? 1
            : videoTrackOrder.indexOf(trackIndex) >= 0
              ? videoTrackOrder.indexOf(trackIndex) + 1
              : 3;

        const newClip: Clip = {
          ...clip,
          id: clipId,
          zIndex: clip.zIndex ?? rank,
        };

        if (
          (newClip.type === "audio" || newClip.type === "video") &&
          (newClip.volume === undefined || newClip.volume === null)
        ) {
          newClip.volume = 1;
        }

        if (
          ["video", "image", "gif", "text"].includes(newClip.type) &&
          !newClip.position
        ) {
          newClip.position = { x: 50, y: 50 };
        }
        if (
          ["video", "image", "gif", "text"].includes(newClip.type) &&
          !newClip.size
        ) {
          newClip.size = { width: 100, height: 100 };
        }

        state.clips[clipId] = newClip;
        track.clips.push(clipId);
      });
    },
    updateClip: (
      state,
      action: PayloadAction<{ clipId: string; updates: Partial<Clip> }>,
    ) => {
      const { clipId, updates } = action.payload;
      if (state.clips[clipId]) {
        state.clips[clipId] = { ...state.clips[clipId], ...updates };
      }
    },
    updateClips: (
      state,
      action: PayloadAction<{ clipIds: string[]; updates: Partial<Clip> }>,
    ) => {
      const { clipIds, updates } = action.payload;
      clipIds.forEach((clipId) => {
        if (state.clips[clipId]) {
          state.clips[clipId] = { ...state.clips[clipId], ...updates };
        }
      });
    },
    updateClipsByGroup: (
      state,
      action: PayloadAction<{ groupId: string; updates: Partial<Clip> }>,
    ) => {
      const { groupId, updates } = action.payload;
      Object.keys(state.clips).forEach((clipId) => {
        const clip = state.clips[clipId];
        if (clip.subtitleGroupId === groupId) {
          state.clips[clipId] = { ...clip, ...updates };
        }
      });
    },
    shiftClips: (
      state,
      action: PayloadAction<{ clipIds: string[]; delta: number }>,
    ) => {
      const { clipIds, delta } = action.payload;
      clipIds.forEach((clipId) => {
        const clip = state.clips[clipId];
        if (clip) {
          const proposed = Math.max(0, clip.start + delta);
          clip.start = Math.round(proposed * 10) / 10;
        }
      });
    },
    removeClip: (state, action: PayloadAction<string>) => {
      const clipId = action.payload;
      const clip = state.clips[clipId];
      if (clip) {
        delete state.clips[clipId];
        const track = state.tracks.find((t) => t.id === clip.trackId);
        if (track) {
          track.clips = track.clips.filter((id) => id !== clipId);
        }
      }
    },
    moveClip: (
      state,
      action: PayloadAction<{
        clipId: string;
        newTrackId: string;
        newStart: number;
      }>,
    ) => {
      const { clipId, newTrackId, newStart } = action.payload;
      const clip = state.clips[clipId];
      if (clip) {
        // Remove from old track
        const oldTrack = state.tracks.find((t) => t.id === clip.trackId);
        if (oldTrack) {
          oldTrack.clips = oldTrack.clips.filter((id) => id !== clipId);
        }

        // Add to new track
        const newTrack = state.tracks.find((t) => t.id === newTrackId);
        if (newTrack) {
          newTrack.clips.push(clipId);
        }

        // Update clip
        clip.trackId = newTrackId;
        clip.start = newStart;
        const newTrackIndex = state.tracks.findIndex(
          (t) => t.id === newTrackId,
        );
        const videoTrackOrderMove = state.tracks
          .map((t, idx) => ({ t, idx }))
          .filter((x) => x.t.type === "video")
          .map((x) => x.idx)
          .sort((a, b) => a - b);
        clip.zIndex =
          clip.type === "text" || clip.type === "subtitle"
            ? 1
            : videoTrackOrderMove.indexOf(newTrackIndex) >= 0
              ? videoTrackOrderMove.indexOf(newTrackIndex) + 1
              : 3;
      }
    },
    addMediaItem: (state, action: PayloadAction<MediaItem>) => {
      // Check if item already exists by ID
      const existingItem = state.mediaItems.find(
        (item) => item.id === action.payload.id,
      );
      if (!existingItem) {
        state.mediaItems.push(action.payload);
      }
    },
    clearMediaItems: (state) => {
      state.mediaItems = [];
    },
    clearTimeline: (state) => {
      // Reset to defaults
      state.tracks = initialState.tracks;
      state.clips = {};
      state.currentTime = 0;
      state.zoom = 50;
      state.selectedClipId = null;
      state.history = [];
      state.historyIndex = -1;
    },
    removeMediaItem: (state, action: PayloadAction<string>) => {
      state.mediaItems = state.mediaItems.filter(
        (item) => item.id !== action.payload,
      );
    },
    updateMediaItem: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<MediaItem> }>,
    ) => {
      const item = state.mediaItems.find(
        (item) => item.id === action.payload.id,
      );
      if (item) {
        Object.assign(item, action.payload.updates);
      }
    },
    removeTrack: (state, action: PayloadAction<string>) => {
      const trackId = action.payload;
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return;

      // Remove all clips from this track
      track.clips.forEach((clipId) => {
        delete state.clips[clipId];
      });

      // Remove the track
      state.tracks = state.tracks.filter((t) => t.id !== trackId);
    },
    setSelectedClip: (state, action: PayloadAction<string | null>) => {
      state.selectedClipId = action.payload;
    },
    togglePlayback: (state) => {
      state.isPlaying = !state.isPlaying;
    },
    setDraggingType: (
      state,
      action: PayloadAction<null | "video" | "audio" | "subtitle">,
    ) => {
      state.draggingType = action.payload;
    },
    showResizeGuidelines: (
      state,
      action: PayloadAction<{
        clipId: string;
        snapX?: number | null;
        snapY?: number | null;
      }>,
    ) => {
      state.resizeGuidelines.clipId = action.payload.clipId;
      state.resizeGuidelines.isVisible = true;
      state.resizeGuidelines.snapX = action.payload.snapX;
      state.resizeGuidelines.snapY = action.payload.snapY;
    },
    hideResizeGuidelines: (state) => {
      state.resizeGuidelines.clipId = null;
      state.resizeGuidelines.isVisible = false;
    },
    setLiveDurationOverride: (
      state,
      action: PayloadAction<{ clipId: string; duration: number }>,
    ) => {
      if (!state.liveDurationOverrides) state.liveDurationOverrides = {};
      state.liveDurationOverrides[action.payload.clipId] =
        action.payload.duration;
    },
    clearLiveDurationOverride: (
      state,
      action: PayloadAction<{ clipId: string }>,
    ) => {
      if (state.liveDurationOverrides)
        delete state.liveDurationOverrides[action.payload.clipId];
    },
    clearAllLiveDurationOverrides: (state) => {
      state.liveDurationOverrides = {};
    },
    updateGlobalSubtitleStyling: (
      state,
      action: PayloadAction<Partial<TimelineState["globalSubtitleStyling"]>>,
    ) => {
      state.globalSubtitleStyling = {
        ...state.globalSubtitleStyling,
        ...action.payload,
      };
    },
    setAspectRatio: (state, action: PayloadAction<string>) => {
      state.aspectRatio = action.payload;
    },
    removeClipsByMediaItem: (
      state,
      action: PayloadAction<{ name: string; type: string; mediaId?: string }>,
    ) => {
      const { name, type, mediaId } = action.payload;
      const clipsToRemove: string[] = [];

      // Find all clips that reference this media item
      Object.entries(state.clips).forEach(([clipId, clip]) => {
        // First priority: Match by mediaId if available
        if (mediaId && clip.mediaId === mediaId) {
          clipsToRemove.push(clipId);
        }
        // Fallback or legacy matching: name and type
        else if (clip.name === name && clip.type === type) {
          clipsToRemove.push(clipId);
        }
        // Special case for subtitle files
        else if (type === "text" && clip.type === "subtitle") {
          // Find the media item to check its subtitles
          const mediaItem = state.mediaItems.find(
            (m) =>
              (mediaId && m.id === mediaId) ||
              (m.name === name && m.type === type),
          );
          if (mediaItem && mediaItem.subtitles) {
            const isFromThisSubtitleFile = mediaItem.subtitles.some(
              (cue) => cue.text === clip.name,
            );
            if (isFromThisSubtitleFile) {
              clipsToRemove.push(clipId);
            }
          }
        }
      });

      // Remove clips from tracks and delete them
      clipsToRemove.forEach((clipId) => {
        const clip = state.clips[clipId];
        if (clip) {
          // Remove from track
          const track = state.tracks.find((t) => t.id === clip.trackId);
          if (track) {
            track.clips = track.clips.filter((id) => id !== clipId);
          }
          // Delete the clip
          delete state.clips[clipId];
        }
      });
    },
    saveToHistory: (state) => {
      // Deep clone clips and tracks for history
      const clipsSnapshot: Record<string, Clip> = {};
      Object.entries(state.clips).forEach(([id, clip]) => {
        clipsSnapshot[id] = { ...clip };
      });
      const tracksSnapshot: Track[] = state.tracks.map((track) => ({
        ...track,
        clips: [...track.clips],
      }));

      // Remove any future history if we're not at the end
      if (state.historyIndex < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyIndex + 1);
      }

      // Add new state to history (state BEFORE the action that will be applied)
      state.history.push({
        clips: clipsSnapshot,
        tracks: tracksSnapshot,
      });

      // Limit history size to 50 entries to prevent memory issues
      if (state.history.length > 50) {
        state.history.shift();
        // Adjust historyIndex if we removed the first entry
        if (state.historyIndex >= 0) {
          state.historyIndex -= 1;
        }
      } else {
        state.historyIndex = state.history.length - 1;
      }
    },
    togglePlayerScrubber: (state) => {
      state.showPlayerScrubber = !state.showPlayerScrubber;
    },
    // Undo: restore previous state from history
    undo: (state) => {
      if (state.historyIndex >= 0) {
        // Restore the state saved at historyIndex (the state before the last action)
        const historyEntry = state.history[state.historyIndex];
        state.clips = { ...historyEntry.clips };
        state.tracks = historyEntry.tracks.map((track) => ({
          ...track,
          clips: [...track.clips],
        }));
        // Move back in history
        state.historyIndex -= 1;
      }
    },
    // Redo: restore next state from history
    redo: (state) => {
      if (state.historyIndex < state.history.length - 1) {
        // Move forward in history
        state.historyIndex += 1;
        // Restore the state saved at the new historyIndex (the state before the next action)
        const historyEntry = state.history[state.historyIndex];
        state.clips = { ...historyEntry.clips };
        state.tracks = historyEntry.tracks.map((track) => ({
          ...track,
          clips: [...track.clips],
        }));
      }
    },
    loadProject: (
      state,
      action: PayloadAction<{
        tracks: Track[];
        clips: Record<string, Clip>;
        mediaItems: MediaItem[];
        aspectRatio?: string;
        globalSubtitleStyling?: Partial<TimelineState["globalSubtitleStyling"]>;
      }>,
    ) => {
      const { tracks, clips, mediaItems, aspectRatio, globalSubtitleStyling } =
        action.payload;
      state.tracks = tracks;
      state.clips = clips;
      state.mediaItems = mediaItems;
      if (aspectRatio) state.aspectRatio = aspectRatio;
      if (globalSubtitleStyling) {
        state.globalSubtitleStyling = {
          ...state.globalSubtitleStyling,
          ...globalSubtitleStyling,
        };
      }
      state.currentTime = 0;
      state.selectedClipId = null;
      state.history = [];
      state.historyIndex = -1;
    },
    setInsertionIndicator: (
      state,
      action: PayloadAction<{
        y: number;
        type: "video" | "audio" | "subtitle";
        isVisible: boolean;
      } | null>,
    ) => {
      state.insertionIndicator = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Handle addVideoClipWithThumbnails
      .addCase(addVideoClipWithThumbnails.pending, (state) => {
        // Could add loading state here if needed
      })
      .addCase(addVideoClipWithThumbnails.fulfilled, (state, action) => {
        const { trackId, clip } = action.payload;
        // Use the id provided in the clip (from batchAddClips optimization) or fallback
        const clipId = clip.id;
        state.clips[clipId] = clip as Clip;
        const track = state.tracks.find((t) => t.id === trackId);
        if (track) {
          track.clips.push(clipId);
        }
      })
      .addCase(addVideoClipWithThumbnails.rejected, (state, action) => {
        console.error(
          "Failed to add video clip with thumbnails:",
          action.payload,
        );
        // Could add error state here if needed
      })
      // Handle updateVideoClipThumbnails
      .addCase(updateVideoClipThumbnails.pending, (state) => {
        // Could add loading state here if needed
      })
      .addCase(updateVideoClipThumbnails.fulfilled, (state, action) => {
        const { clipId, thumbnails, thumbnailInterval } = action.payload;
        if (state.clips[clipId]) {
          state.clips[clipId].thumbnails = thumbnails;
          state.clips[clipId].thumbnailInterval = thumbnailInterval;
        }
      })
      .addCase(updateVideoClipThumbnails.rejected, (state, action) => {
        console.error(
          "Failed to update video clip thumbnails:",
          action.payload,
        );
        // Could add error state here if needed
      })
      // Match all timeline actions to update lastActionType
      .addMatcher(
        (action) => action.type.startsWith("timeline/"),
        (state, action) => {
          state.lastActionType = action.type;
        },
      );
  },
});

export const {
  addTrack,
  setCurrentTime,
  setZoom,
  setTimelineSize,
  addClip,
  batchAddClips,
  updateClip,
  updateClips,
  updateClipsByGroup,
  shiftClips,
  removeClip,
  moveClip,
  addMediaItem,
  clearMediaItems,
  clearTimeline,
  removeMediaItem,
  updateMediaItem,
  removeTrack,
  setSelectedClip,
  togglePlayback,
  setDraggingType,
  showResizeGuidelines,
  hideResizeGuidelines,
  setLiveDurationOverride,
  clearLiveDurationOverride,
  clearAllLiveDurationOverrides,
  updateGlobalSubtitleStyling,
  setAspectRatio,
  removeClipsByMediaItem,
  saveToHistory,
  undo,
  redo,
  loadProject,
  setInsertionIndicator,
  togglePlayerScrubber,
} = timelineSlice.actions;

export default timelineSlice.reducer;
