/**
 * FFMPEG MODEL — Plain TypeScript types for the video export pipeline
 * ====================================================================
 * No GraphQL, no NestJS, no decorators — just interfaces you can use
 * directly from any backend, REST controller, CLI script, etc.
 *
 * These types describe the shape of the input you pass to:
 *   FfmpegService.exportVideo(input, onProgress?)
 */

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface PositionInput {
  /** Horizontal position as a percentage of the canvas width (0–100) */
  x: number;
  /** Vertical position as a percentage of the canvas height (0–100) */
  y: number;
}

export interface SizeInput {
  /** Width as a percentage of the canvas width (0–100) */
  width: number;
  /** Height as a percentage of the canvas height (0–100) */
  height: number;
}

/** A keyframe that overrides clip properties at a specific timestamp within the cut */
export interface FfmpegKeyframeInput {
  /** Time offset in seconds from the start of the cut */
  at: number;
  position?: PositionInput;
  size?: SizeInput;
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
  /** 'linear' | 'ease' | etc. */
  easing?: string;
}

/** A single cut (segment) of a source media file placed on the timeline */
export interface CutItemInput {
  /** Unique identifier for this cut */
  id: string;
  /** In-source start time in seconds */
  start: number;
  /** In-source end time in seconds */
  end: number;
  /** Timeline position where this cut starts (seconds from the beginning of the composition) */
  timelineStart: number;

  position: PositionInput;
  size: SizeInput;

  /** Audio volume multiplier — 0.0 (silent) to 1.0 (full) */
  volume?: number;
  zIndex?: number;

  // --- Visual effects ---
  /** 0–200, default 100 */  brightness?: number;
  /** 0–200, default 100 */  contrast?: number;
  /** 0–200, default 100 */  saturation?: number;
  /** 0–360 degrees */        hue?: number;
  /** 0–20 px */              blur?: number;
  /** 0–100 */                sharpen?: number;
  flipH?: boolean;
  flipV?: boolean;
  /** -180..180 degrees */    rotate?: number;
  /** 0–100 */                grayscale?: number;
  /** 0–100 */                sepia?: number;
  /** 0–100 */                invert?: number;
  /** 0–50 px */              roundedCorners?: number;
  opacity?: number;

  // --- Fade ---
  fadeInDuration?: number;
  fadeOutDuration?: number;

  // --- Chroma key (green screen) ---
  greenScreenEnabled?: boolean;
  greenScreenColor?: string;
  greenScreenSimilarity?: number;
  greenScreenBlend?: number;

  // --- Audio effects ---
  audioSpeed?: number;
  audioPitch?: number;
  audioBassBoost?: number;
  audioTrebleBoost?: number;
  audioEcho?: number;
  audioReverb?: number;

  /** Per-cut SRT subtitle string */
  srt?: string;
  subtitlesStyling?: FfmpegSubtitleOptionsInput;

  /** Optional keyframes for animating properties within this cut */
  keyframes?: FfmpegKeyframeInput[];
}

/** A single media item (image, video, audio, gif, or text layer) */
export interface FfmpegMediaItem {
  /** URL (http/https) or absolute local file path to the media file */
  url?: string;
  /** 'image' | 'video' | 'audio' | 'gif' | 'text' */
  type: string;
  /** How long this item appears on the timeline (seconds) */
  duration: number;
  /** When it starts on the timeline (seconds) */
  startTime: number;
  /** When it ends on the timeline (seconds) */
  endTime: number;
  /** For GIFs and videos: true (prevents -loop 1 input option) */
  isAnimated?: boolean;
  /** Set to true/false to skip ffprobe audio detection probing */
  hasAudio?: boolean;

  position?: PositionInput;
  size?: SizeInput;

  /** Text content — only used when type === 'text' */
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  fontWeight?: string;
  textAlign?: string;
  zIndex?: number;

  /** One or more timeline segments cut from this source file */
  cuts?: CutItemInput[];
}

/** Organises media items by type (mirrors the frontend timeline structure) */
export interface MediaInput {
  images: FfmpegMediaItem[];
  videos: FfmpegMediaItem[];
  audio: FfmpegMediaItem[];
  gif: FfmpegMediaItem[];
  text: FfmpegMediaItem[];
}

/** A cross-fade/wipe/dissolve transition between two consecutive clips */
export interface TransitionInput {
  /** One of the supported xfade transition names — e.g. 'fade', 'wipeleft', etc. */
  type: string;
  /** Timeline start time of the transition in seconds */
  start: number;
  /** Duration of the transition in seconds */
  duration: number;
  /** ID of the outgoing clip */
  fromId?: string;
  /** ID of the incoming clip */
  toId?: string;
  zIndex?: number;
}

/** Controls output video dimensions and quality */
export interface OutputOptionsInput {
  /** '720p' | '1080p' | '1440p' | '4k' */
  resolution?: string;
  /** 'mp4' | 'webm' | etc. */
  format?: string;
  /** 'low' | 'medium' | 'high' | 'ultra' */
  quality?: string;
  /** '16/9' | '9/16' | '1/1' | '4/3' */
  aspectRatio?: string;
}

/** Subtitle styling options — maps to ASS/SRT drawtext options */
export interface FfmpegSubtitleOptionsInput {
  fontSize?: number;
  fontName?: string;
  /** CSS-style color string, e.g. 'white', '#ffffff' */
  primaryColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
  shadowDepth?: number;
  /** 'top' | 'bottom' | 'center' */
  position?: string;
  defaultStyle?: string;
  highlightColor?: string;
  karaokeHighlightedColor?: string;
  enableKaraoke?: boolean;
  /** 'none' | 'word-highlight' | 'pop-in' | 'word-pop' | 'typewriter' */
  animationPreset?: string;
}

/** A subtitle track — pass an SRT string plus optional styling */
export interface FfmpegSubtitleInput {
  /** Raw SRT content */
  srt: string;
  styling?: FfmpegSubtitleOptionsInput;
  zIndex?: number;
}

// ---------------------------------------------------------------------------
// Main input type — pass this to FfmpegService.exportVideo()
// ---------------------------------------------------------------------------

/**
 * The complete input descriptor for one video export.
 *
 * @example
 * const input: GenerateVideoInput = {
 *   media: {
 *     videos: [{ url: 'https://…/clip.mp4', type: 'video', startTime: 0, endTime: 5, duration: 5, hasAudio: true }],
 *     images: [], audio: [], gif: [], text: [],
 *   },
 *   transitions: [{ type: 'fade', start: 4.5, duration: 1 }],
 *   output: { resolution: '1080p', format: 'mp4', quality: 'high', aspectRatio: '16/9' },
 * };
 *
 * const { outputPath } = await ffmpegService.exportVideo(input, (p) => {
 *   console.log(p.percent, p.message);
 * });
 */
export interface GenerateVideoInput {
  /** All media tracks organised by type */
  media?: MediaInput;
  /** Optional subtitle tracks */
  subtitles?: FfmpegSubtitleInput[];
  /** Legacy single-subtitle shorthand — prefer `subtitles` array above */
  srt?: string;
  subtitleOptions?: FfmpegSubtitleOptionsInput;
  /** Timeline transitions between clips */
  transitions?: TransitionInput[];
  /** Output format, resolution, and quality */
  output?: OutputOptionsInput;
  /** Enable AI auto-cropping (requires additional AI integration — see FfmpegService) */
  aiCropping?: boolean;
  /** Enable subtitle burning into the video */
  subtitlesEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface VideoGenerationResponse {
  url: string;
}
