"use client";

/**
 * MediaStylingPanel.tsx
 *
 * A multi-tab properties panel shown when the user clicks a media clip
 * (video, image, GIF, or audio).  Controls are grouped into tabs:
 *
 * Visual clips (video / image / GIF):
 *   • Position & Size — x/y center and width/height as canvas percentages
 *   • Visual Filters  — brightness, contrast, saturation, hue, blur, etc.
 *   • Transform       — flip H/V, rotation, rounded corners, z-index, green screen
 *   • Keyframes       — time-based animation of position/size/opacity
 *   • Audio           — volume (video only)
 *
 * Audio clips:
 *   • Audio Controls  — speed, pitch, bass/treble boost, volume
 *   • Audio Effects   — echo and reverb mix
 *
 * All slider updates are batched via requestAnimationFrame and dispatched
 * to Redux in a single `updateClip` call to prevent excessive re-renders
 * during dragging.
 *
 * CSS filter values are converted from the panel’s 0-200 % range to the
 * values expected by both the browser canvas preview (CSS) and the final
 * FFmpeg render (eq filter parameters).  See `convertBrightnessForCSS` etc.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { AppDispatch, RootState } from "../../../redux/store";
import {
  updateClip,
  setCurrentTime,
  type Keyframe,
} from "../../../redux/timelineSlice";
import { Card, CardContent } from "../../ui/card";
import { Label } from "../../ui/label";
import { Slider } from "../../ui/slider";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  HelpCircle,
  Move,
  Palette,
  Volume2,
  Music,
  Type,
  Layers,
  FlipHorizontal,
  FlipVertical,
  Crop,
  KeySquare,
  Trash2,
  Plus,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";

/**
 * Inline Switch component — used in place of a shadcn Switch if it’s not present
 * in the local component library.  Renders a pill-shaped toggle button.
 */
const Switch: React.FC<{
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}> = React.memo(({ checked, onCheckedChange }) => (
  <button
    type="button"
    onClick={() => onCheckedChange(!checked)}
    className={`w-10 h-6 rounded-full relative transition-colors ${
      checked ? "bg-primary" : "bg-primary/10"
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background transition-transform ${
        checked ? "translate-x-4" : ""
      }`}
    />
  </button>
));

/** Small SVG counter-clockwise arrow used inside ResetButton */
const ResetIcon: React.FC<{ className?: string }> = React.memo(
  ({ className = "w-4 h-4" }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  ),
);

/**
 * Small icon button that resets a slider to its default value.
 * Disabled and visually faded when the current value already equals the default.
 */
const ResetButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}> = React.memo(
  ({ onClick, disabled = false, ariaLabel = "Reset to default" }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-all ${
        disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:scale-105 active:scale-95"
      }`}
    >
      <ResetIcon className="w-3.5 h-3.5" />
    </button>
  ),
);

type NumberOrUndefined = number | undefined;

/**
 * All styling properties a clip can carry.  Values are stored on the Redux
 * clip object and read back here to populate sliders.
 *
 * Geometry (x, y, width, height) lives on the clip’s `position` and `size`
 * fields rather than `styling` so the player can update it cheaply.
 *
 * Green screen fields map directly to FFmpeg’s chromakey filter parameters.
 */
export interface MediaStylingOptions {
  // geometry (percent-based center x/y and width/height)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // visual filters
  brightness?: number; // 0-200 (percent)
  contrast?: number; // 0-200 (percent)
  saturation?: number; // 0-200 (percent)
  hue?: number; // 0-360 (degrees)
  blur?: number; // 0-20 (px)
  sharpen?: number; // 0-100 (unitless, approximated)
  grayscale?: number; // 0-100
  sepia?: number; // 0-100
  invert?: number; // 0-100
  flipH?: boolean;
  flipV?: boolean;
  rotate?: number; // -180..180
  roundedCorners?: number; // 0-50 (pixels)
  // media
  volume?: number; // 0-1 (video only)
  // audio-specific (audio clips only)
  audioSpeed?: number; // 0.5-2.0
  audioPitch?: number; // -12..+12 semitones (preview only)
  audioBassBoost?: number; // 0-20 dB
  audioTrebleBoost?: number; // 0-20 dB
  audioEcho?: number; // 0-1 mix
  audioReverb?: number; // 0-1 mix
  // green screen (chroma key) - visual media only
  // Maps to ffmpeg chromakey filter: color, similarity, blend
  greenScreenEnabled?: boolean;
  greenScreenColor?: string; // hex color (maps to chromakey color parameter, converted to 0xRRGGBB)
  greenScreenSimilarity?: number; // 0-0.5 (maps to chromakey similarity parameter: color matching threshold)
  greenScreenBlend?: number; // 0-1 (maps to chromakey blend parameter: edge feathering amount)
}

const DEFAULTS: Required<MediaStylingOptions> = {
  x: 50,
  y: 50,
  width: 100,
  height: 100,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  blur: 0,
  sharpen: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  flipH: false,
  flipV: false,
  rotate: 0,
  roundedCorners: 0,
  volume: 1,
  audioSpeed: 1,
  audioPitch: 0,
  audioBassBoost: 0,
  audioTrebleBoost: 0,
  audioEcho: 0,
  audioReverb: 0,
  greenScreenEnabled: false,
  greenScreenColor: "#00ff00", // Default green for chroma key
  greenScreenSimilarity: 0.3, // Default similarity (0.0-0.5) for chromakey filter
  greenScreenBlend: 0.1, // Default blend (0.0-1.0) for chromakey filter
};

/**
 * Converts a 0-200 % brightness value from the UI into a CSS `brightness()`
 * percentage that visually matches FFmpeg’s `eq` filter output.
 *
 * Linear 0-100 % is kept 1:1.  Above 100 % a 3× multiplier is applied so
 * 200 % panel value ≈ 400 % CSS, which matches FFmpeg’s brightness=0.75
 * (near-white) appearance.
 */
export const convertBrightnessForCSS = (percent: number): number => {
  // FFmpeg: 0% → -0.75, 100% → 0.0, 200% → 0.75
  // CSS brightness needs to be more aggressive to match
  // Using a curve that makes 200% much brighter (closer to white)
  if (percent <= 100) {
    // 0-100%: map to 0-100% CSS (linear)
    return percent;
  } else {
    // 100-200%: map to 100-400% CSS (exponential to match FFmpeg's intensity)
    // At 200%, CSS should be ~400% to match FFmpeg's brightness=0.75 (almost white)
    const excess = percent - 100;
    return 100 + excess * 3; // 3x multiplier for the upper range
  }
};

/**
 * Same approach as brightness: keeps 0-100 % linear and amplifies the
 * upper range 3× to match FFmpeg’s `eq` contrast effect.
 */
export const convertContrastForCSS = (percent: number): number => {
  // FFmpeg: 0% → -1.5, 100% → 0.0, 200% → 1.5
  // CSS contrast needs to be more aggressive to match
  if (percent <= 100) {
    // 0-100%: map to 0-100% CSS (linear)
    return percent;
  } else {
    // 100-200%: map to 100-400% CSS (exponential to match FFmpeg's intensity)
    const excess = percent - 100;
    return 100 + excess * 3; // 3x multiplier for the upper range
  }
};

/**
 * Saturation is more linear than brightness/contrast but still amplified
 * 2.5× above 100 % to better match FFmpeg’s `eq` saturation output.
 */
export const convertSaturationForCSS = (percent: number): number => {
  // FFmpeg: 0% → 0.0, 100% → 1.0, 200% → 2.0
  // CSS saturation is closer to FFmpeg, but still needs adjustment
  // Saturation mapping is more linear, but we'll still boost the upper range
  if (percent <= 100) {
    return percent;
  } else {
    const excess = percent - 100;
    return 100 + excess * 2.5; // 2.5x multiplier for the upper range
  }
};

/** Clamps `val` to [min, max], returning `def` if val is not a finite number */
const clamp = (
  val: NumberOrUndefined,
  min: number,
  max: number,
  def: number,
) => {
  if (typeof val !== "number" || Number.isNaN(val)) return def;
  return Math.max(min, Math.min(max, val));
};

/**
 * SliderRow
 *
 * A memoised slider control row: label, optional help tooltip, current value
 * display, a reset button and the actual slider.  Memoised so that moving
 * one slider doesn't re-render every other row in the panel.
 */
const SliderRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  defaultValue: number;
  help?: string; // short help shown in tooltip
  description?: string; // optional inline helper text below the slider
}> = React.memo(
  ({
    label,
    value,
    min,
    max,
    step = 1,
    suffix = "",
    onChange,
    defaultValue,
    help,
    description,
  }) => (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium text-foreground">{label}</Label>
          {help && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`${label} info`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" className="max-w-[280px]">
                <div className="text-xs leading-relaxed">{help}</div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-medium text-foreground min-w-[3.5rem] text-right">
            {Math.round(value * (suffix === "%" ? 1 : 100)) /
              (suffix === "%" ? 1 : 100)}
            {suffix}
          </span>
          <ResetButton
            ariaLabel={`Reset ${label}`}
            onClick={() => onChange(defaultValue)}
            disabled={value === defaultValue}
          />
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      {description && (
        <div className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </div>
      )}
    </div>
  ),
);

const MediaStylingPanel: React.FC<{ clipId: string }> = ({ clipId }) => {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>(); // Access store directly for on-demand reads

  // Optimize selectors to avoid re-rendering on every timeline change
  const clip = useSelector((s: RootState) => s.timeline.clips[clipId]);

  const isVideo = clip?.type === "video";
  const isVisual =
    clip?.type === "video" || clip?.type === "gif" || clip?.type === "image";
  const isAudio = clip?.type === "audio";

  // Optimize maxVisualZIndex: calculate inside useSelector.
  // useSelector compares the return value (number) using strict equality (===).
  // This prevents re-renders when 'clips' changes but 'maxVisualZIndex' remains the same.
  const maxVisualZIndex = useSelector((state: RootState) => {
    const visualClips = Object.values(state.timeline.clips || {}).filter(
      (c: any) =>
        c &&
        (c.type === "video" ||
          c.type === "gif" ||
          c.type === "image" ||
          c.type === "text"),
    ) as any[];
    if (visualClips.length === 0) return 1;
    const zs = visualClips
      .map((c: any) => (typeof c.zIndex === "number" ? c.zIndex : 1))
      .filter((z: number) => Number.isFinite(z) && z > 0);
    return zs.length > 0 ? Math.max(...zs) : 1;
  });

  const currentZIndex = useMemo(
    () => (typeof clip?.zIndex === "number" ? (clip?.zIndex as number) : 1),
    [clip?.zIndex],
  );
  // Show Rounded Corners only if this clip is not the top-most visual layer

  // Tab and sidebar state
  const [activeTab, setActiveTab] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Get current timeline time for keyframe positioning
  const currentTime = useSelector((s: RootState) => s.timeline.currentTime);
  const liveDurationOverrides = useSelector(
    (s: RootState) => s.timeline.liveDurationOverrides,
  );

  /**
   * Derive a fully-resolved styling snapshot from the clip data.
   * Falls back to DEFAULTS for any missing or non-finite values.
   * This is the single source of truth for slider initial values.
   */
  const current: Required<MediaStylingOptions> = useMemo(() => {
    const s = clip?.styling || ({} as any);
    return {
      x: clamp(clip?.position?.x, 0, 100, DEFAULTS.x),
      y: clamp(clip?.position?.y, 0, 100, DEFAULTS.y),
      width: clamp(clip?.size?.width, 1, 200, DEFAULTS.width),
      height: clamp(clip?.size?.height, 1, 200, DEFAULTS.height),
      brightness: clamp(s.brightness, 0, 200, DEFAULTS.brightness),
      contrast: clamp(s.contrast, 0, 200, DEFAULTS.contrast),
      saturation: clamp(s.saturation, 0, 200, DEFAULTS.saturation),
      hue: clamp(s.hue, 0, 360, DEFAULTS.hue),
      blur: clamp(s.blur, 0, 20, DEFAULTS.blur),
      sharpen: clamp(s.sharpen, 0, 100, DEFAULTS.sharpen),
      grayscale: clamp(s.grayscale, 0, 100, DEFAULTS.grayscale),
      sepia: clamp(s.sepia, 0, 100, DEFAULTS.sepia),
      invert: clamp(s.invert, 0, 100, DEFAULTS.invert),
      flipH: !!s.flipH,
      flipV: !!s.flipV,
      rotate: clamp(s.rotate, -180, 180, DEFAULTS.rotate),
      roundedCorners: clamp(s.roundedCorners, 0, 50, DEFAULTS.roundedCorners),
      volume: clamp(clip?.volume, 0, 1, DEFAULTS.volume),
      audioSpeed: clamp(s.audioSpeed, 0.5, 2, DEFAULTS.audioSpeed),
      audioPitch: clamp(s.audioPitch, -12, 12, DEFAULTS.audioPitch),
      audioBassBoost: clamp(s.audioBassBoost, 0, 20, DEFAULTS.audioBassBoost),
      audioTrebleBoost: clamp(
        s.audioTrebleBoost,
        0,
        20,
        DEFAULTS.audioTrebleBoost,
      ),
      audioEcho: clamp(s.audioEcho, 0, 1, DEFAULTS.audioEcho),
      audioReverb: clamp(s.audioReverb, 0, 1, DEFAULTS.audioReverb),
      greenScreenEnabled: !!s.greenScreenEnabled,
      greenScreenColor:
        typeof s.greenScreenColor === "string"
          ? s.greenScreenColor
          : DEFAULTS.greenScreenColor,
      greenScreenSimilarity: clamp(
        s.greenScreenSimilarity,
        0,
        0.5, // ffmpeg chromakey similarity range: 0.0-0.5 (clamped in backend)
        DEFAULTS.greenScreenSimilarity,
      ),
      greenScreenBlend: clamp(
        s.greenScreenBlend,
        0,
        1,
        DEFAULTS.greenScreenBlend,
      ),
    };
  }, [clip]);

  /**
   * Local `options` state mirrors `current` but is updated optimistically
   * on every slider interaction so the slider doesn’t lag behind the finger.
   * A guard ref `isUpdatingRef` prevents the Redux round-trip from overwriting
   * the local state while a drag is still in progress.
   */
  const [options, setOptions] =
    useState<Required<MediaStylingOptions>>(current);

  // Track if we're updating from user interaction to prevent state overwrites
  const isUpdatingRef = React.useRef(false);

  // Keep a ref to the current clip so we can access it in callbacks without re-creating them
  const clipRef = React.useRef(clip);
  useEffect(() => {
    clipRef.current = clip;
  }, [clip]);

  // Only sync options when clip changes (not on every current update)
  // to prevent slider jumping during user interaction
  useEffect(() => {
    if (!isUpdatingRef.current) {
      setOptions(current);
    }
  }, [current]);

  // rAF-batched dispatch for smoother slider updates
  const rafRef = React.useRef<number | null>(null);
  const pendingGeometryRef = React.useRef<Required<MediaStylingOptions> | null>(
    null,
  );
  const pendingStyleRef = React.useRef<Required<MediaStylingOptions> | null>(
    null,
  );

  /**
   * flushUpdates
   *
   * Reads the pending geometry and/or style refs, builds a single Redux
   * `updateClip` payload, and dispatches it.  Geometry and style are
   * batched separately so that frequent position drags don’t re-serialize
   * the entire styling object on every frame.
   *
   * For clips that belong to a subtitle group (e.g. all cues from one .srt
   * import), the update is broadcast to every clip in the group.
   */
  const flushUpdates = useCallback(() => {
    const geom = pendingGeometryRef.current;
    const style = pendingStyleRef.current;
    if (!geom && !style) return;

    const currentClip = clipRef.current;
    if (!currentClip) return;

    const updates: any = {};
    if (geom) {
      updates.position = { x: geom.x, y: geom.y };
      updates.size = { width: geom.width, height: geom.height };
      pendingGeometryRef.current = null;
    }
    if (style) {
      const { x, y, width, height, volume, ...styling } = style;
      updates.styling = { ...(currentClip.styling || {}), ...styling };

      // Handle Audio Speed Change -> Update Duration
      if (typeof style.audioSpeed === "number") {
        const oldSpeed = currentClip.styling?.audioSpeed || 1;
        const newSpeed = style.audioSpeed;
        // Only update duration if speed explicitly changed to avoid drift
        if (oldSpeed !== newSpeed && newSpeed > 0) {
          const currentDuration = currentClip.duration || 0;
          // Duration is inversely proportional to speed
          // New Duration = Current Duration * (Old Speed / New Speed)
          updates.duration = currentDuration * (oldSpeed / newSpeed);
        }
      }

      // Use currentClip.type to check if volume applies
      const isVideoOrAudio =
        currentClip.type === "video" || currentClip.type === "audio";
      if (isVideoOrAudio && typeof style.volume === "number")
        updates.volume = style.volume;
      pendingStyleRef.current = null;
    }
    // If this clip has a subtitleGroupId, update all clips in the same group
    if (currentClip.subtitleGroupId && currentClip.type === "subtitle") {
      const state = store.getState();
      const groupId = currentClip.subtitleGroupId;

      Object.values(state.timeline.clips).forEach((clip: any) => {
        if (clip.subtitleGroupId === groupId) {
          dispatch(updateClip({ clipId: clip.id, updates }));
        }
      });
    } else {
      // Normal single clip update
      dispatch(updateClip({ clipId, updates }));
    }

    // Reset the updating flag after a short delay to allow the update to propagate
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 50);
  }, [clipId, dispatch, store]); // Added store dependency

  /**
   * Schedules a flushUpdates call on the next animation frame.
   * Calling it multiple times before the frame fires is a no-op (idempotent).
   */
  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushUpdates();
    });
  }, [flushUpdates]);

  /**
   * updateGeometry — queues a position/size change.
   * Only x, y, width, height are written into the geometry ref; other props
   * are left untouched to avoid clobbering concurrent style updates.
   */
  const updateGeometry = useCallback(
    (
      partial: Partial<
        Pick<MediaStylingOptions, "x" | "y" | "width" | "height">
      >,
    ) => {
      isUpdatingRef.current = true;
      setOptions((prev) => {
        const next = { ...prev, ...partial } as Required<MediaStylingOptions>;
        pendingGeometryRef.current = next;
        return next;
      });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  /**
   * updateStyling — queues a visual filter, transform, or audio change.
   * Geometry fields that happen to be in the partial are ignored by
   * flushUpdates (they’re destructured out before building the update payload).
   */
  const updateStyling = useCallback(
    (partial: Partial<MediaStylingOptions>) => {
      isUpdatingRef.current = true;
      setOptions((prev) => {
        const next = { ...prev, ...partial } as Required<MediaStylingOptions>;
        pendingStyleRef.current = next;
        return next;
      });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Stable onChange handlers so memoized rows don't re-render from changing function identities
  const onChangeX = useCallback(
    (v: number) => updateGeometry({ x: v }),
    [updateGeometry],
  );
  const onChangeY = useCallback(
    (v: number) => updateGeometry({ y: v }),
    [updateGeometry],
  );
  const onChangeWidth = useCallback(
    (v: number) => updateGeometry({ width: v }),
    [updateGeometry],
  );
  const onChangeHeight = useCallback(
    (v: number) => updateGeometry({ height: v }),
    [updateGeometry],
  );

  const onBrightness = useCallback(
    (v: number) => updateStyling({ brightness: v }),
    [updateStyling],
  );
  const onContrast = useCallback(
    (v: number) => updateStyling({ contrast: v }),
    [updateStyling],
  );
  const onSaturation = useCallback(
    (v: number) => updateStyling({ saturation: v }),
    [updateStyling],
  );
  const onHue = useCallback(
    (v: number) => updateStyling({ hue: v }),
    [updateStyling],
  );
  const onBlur = useCallback(
    (v: number) => updateStyling({ blur: v }),
    [updateStyling],
  );
  const onSharpen = useCallback(
    (v: number) => updateStyling({ sharpen: v }),
    [updateStyling],
  );
  const onGrayscale = useCallback(
    (v: number) => updateStyling({ grayscale: v }),
    [updateStyling],
  );
  const onSepia = useCallback(
    (v: number) => updateStyling({ sepia: v }),
    [updateStyling],
  );
  const onInvert = useCallback(
    (v: number) => updateStyling({ invert: v }),
    [updateStyling],
  );
  const onRotate = useCallback(
    (v: number) => updateStyling({ rotate: v }),
    [updateStyling],
  );

  const onVolume = useCallback(
    (v: number) => updateStyling({ volume: v }),
    [updateStyling],
  );

  const onAudioSpeed = useCallback(
    (v: number) => updateStyling({ audioSpeed: v }),
    [updateStyling],
  );
  const onAudioPitch = useCallback(
    (v: number) => updateStyling({ audioPitch: v }),
    [updateStyling],
  );
  const onAudioBass = useCallback(
    (v: number) => updateStyling({ audioBassBoost: v }),
    [updateStyling],
  );
  const onAudioTreble = useCallback(
    (v: number) => updateStyling({ audioTrebleBoost: v }),
    [updateStyling],
  );
  const onAudioEcho = useCallback(
    (v: number) => updateStyling({ audioEcho: v }),
    [updateStyling],
  );
  const onAudioReverb = useCallback(
    (v: number) => updateStyling({ audioReverb: v }),
    [updateStyling],
  );

  // Green screen controls
  const onGreenScreenEnabled = useCallback(
    (v: boolean) => updateStyling({ greenScreenEnabled: v }),
    [updateStyling],
  );
  const onGreenScreenColor = useCallback(
    (v: string) => updateStyling({ greenScreenColor: v }),
    [updateStyling],
  );
  const onGreenScreenSimilarity = useCallback(
    (v: number) => updateStyling({ greenScreenSimilarity: v }),
    [updateStyling],
  );
  const onGreenScreenBlend = useCallback(
    (v: number) => updateStyling({ greenScreenBlend: v }),
    [updateStyling],
  );

  // Determine which tabs to show based on media type
  const visualTabs = isVisual
    ? [
        { id: "position", label: "Position & Size", icon: Move },
        { id: "filters", label: "Visual Filters", icon: Palette },
        { id: "transform", label: "Transform", icon: Layers },
        ...(isVideo || clip?.type === "gif" || clip?.type === "image"
          ? [{ id: "keyframes", label: "Keyframes", icon: KeySquare }]
          : []),
        ...(isVideo
          ? [
              { id: "audio", label: "Audio", icon: Volume2 },
            ]
          : []),
      ]
    : [];

  const audioTabs = isAudio
    ? [
        { id: "audio-controls", label: "Audio Controls", icon: Volume2 },
        { id: "audio-effects", label: "Audio Effects", icon: Music },
      ]
    : [];

  const tabs = isVisual ? visualTabs : audioTabs;
  const defaultTab = tabs.length > 0 ? tabs[0].id : "";

  // Set default active tab
  useEffect(() => {
    if (defaultTab && !activeTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab, activeTab]);

  // Set sidebar state based on screen size
  useEffect(() => {
    const checkScreenSize = () => {
      if (window.innerWidth >= 550) {
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
      }
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <Card className="w-full -py-6 h-full border-0 shadow-none bg-transparent">
      <CardContent className="p-0 h-full flex flex-col">
        {tabs.length > 0 ? (
          <div className="flex-1 flex sm:flex-row overflow-hidden">
            {/* Sidebar with tab buttons */}
            {sidebarOpen && (
              <div className="w-[30%] sm:w-[38%] bg-muted/30 border rounded-bl-[15px] border-border flex flex-col">
                <div className="flex-1 sm:p-2 overflow-y-auto">
                  <div
                    className="flex flex-col"
                    style={{
                      scrollbarWidth: "thin",
                      scrollbarColor: "rgba(0,0,0,0.3) transparent",
                    }}
                  >
                    {tabs.map((tab, index) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`w-full whitespace-nowrap flex-shrink-0 flex items-center h-[47px] sm:h-[53px] border-x-1 space-x-3 px-4 text-sm font-medium transition-all duration-200 ${
                            index === 0
                              ? " border-t-1"
                              : index === tabs.length - 1
                                ? "rounded-bl-lg border-b-1"
                                : "rounded-none"
                          } ${
                            activeTab === tab.id
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Main content area */}
            <div className="flex-1 flex flex-col border border-border rounded-br-[15px] overflow-hidden">
              {/* Header with toggle button */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-border">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={toggleSidebar}
                    className="p-2 hidden md:block rounded-md hover:bg-muted transition-colors"
                    title={sidebarOpen ? "Hide tabs" : "Show tabs"}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                  </button>
                  <span className="text-sm font-medium text-muted-foreground">
                    {tabs.find((t) => t.id === activeTab)?.label || "Styling"}
                  </span>
                </div>
                {!sidebarOpen && (
                  <div className="flex space-x-1">
                    {tabs.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`p-2 rounded-md text-xs font-medium transition-colors ${
                            activeTab === tab.id
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                          title={tab.label}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tab Content */}
              <div className="h-full overflow-y-auto p-6">
                {/* Visual Media Tabs */}
                {isVisual && (
                  <>
                    {/* Position & Size Tab */}
                    {activeTab === "position" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 pl-1">
                          <SliderRow
                            label="X Position"
                            value={options.x}
                            min={0}
                            max={100}
                            suffix="%"
                            defaultValue={DEFAULTS.x}
                            onChange={onChangeX}
                            help="Horizontal position of the media center relative to the canvas."
                          />
                          <SliderRow
                            label="Y Position"
                            value={options.y}
                            min={0}
                            max={100}
                            suffix="%"
                            defaultValue={DEFAULTS.y}
                            onChange={onChangeY}
                            help="Vertical position of the media center relative to the canvas."
                          />
                          <SliderRow
                            label="Width"
                            value={options.width}
                            min={1}
                            max={200}
                            suffix="%"
                            defaultValue={DEFAULTS.width}
                            onChange={onChangeWidth}
                            help="Scale the width as a percentage of the canvas."
                          />
                          <SliderRow
                            label="Height"
                            value={options.height}
                            min={1}
                            max={200}
                            suffix="%"
                            defaultValue={DEFAULTS.height}
                            onChange={onChangeHeight}
                            help="Scale the height as a percentage of the canvas."
                          />
                        </div>
                      </div>
                    )}

                    {/* Visual Filters Tab */}
                    {activeTab === "filters" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 pl-1">
                          <SliderRow
                            label="Brightness"
                            value={options.brightness}
                            min={0}
                            max={200}
                            onChange={onBrightness}
                            defaultValue={DEFAULTS.brightness}
                            suffix="%"
                            help="Lighten or darken the image."
                          />
                          <SliderRow
                            label="Contrast"
                            value={options.contrast}
                            min={0}
                            max={200}
                            onChange={onContrast}
                            defaultValue={DEFAULTS.contrast}
                            suffix="%"
                            help="Increase difference between light and dark areas."
                          />
                          <SliderRow
                            label="Saturation"
                            value={options.saturation}
                            min={0}
                            max={200}
                            onChange={onSaturation}
                            defaultValue={DEFAULTS.saturation}
                            suffix="%"
                            help="Intensify or mute colors."
                          />
                          <SliderRow
                            label="Hue"
                            value={options.hue}
                            min={0}
                            max={360}
                            onChange={onHue}
                            defaultValue={DEFAULTS.hue}
                            suffix="°"
                            help="Shift overall color tint."
                          />
                          <SliderRow
                            label="Blur"
                            value={options.blur}
                            min={0}
                            max={20}
                            step={0.5}
                            onChange={onBlur}
                            defaultValue={DEFAULTS.blur}
                            suffix="px"
                            help="Soften details for a defocused look."
                          />
                          <SliderRow
                            label="Sharpen"
                            value={options.sharpen}
                            min={0}
                            max={100}
                            onChange={onSharpen}
                            defaultValue={DEFAULTS.sharpen}
                            help="Enhance edges to increase crispness."
                          />
                          <SliderRow
                            label="Grayscale"
                            value={options.grayscale}
                            min={0}
                            max={100}
                            onChange={onGrayscale}
                            defaultValue={DEFAULTS.grayscale}
                            suffix="%"
                            help="Fade colors toward black and white."
                          />
                          <SliderRow
                            label="Sepia"
                            value={options.sepia}
                            min={0}
                            max={100}
                            onChange={onSepia}
                            defaultValue={DEFAULTS.sepia}
                            suffix="%"
                            help="Warm vintage tone effect."
                          />
                          <SliderRow
                            label="Invert"
                            value={options.invert}
                            min={0}
                            max={100}
                            onChange={onInvert}
                            defaultValue={DEFAULTS.invert}
                            suffix="%"
                            help="Invert colors for a negative effect."
                          />
                          <SliderRow
                            label="Rotate"
                            value={options.rotate}
                            min={-180}
                            max={180}
                            onChange={onRotate}
                            defaultValue={DEFAULTS.rotate}
                            suffix="°"
                            help="Rotate the media around its center."
                          />
                          {/* {showRoundedCorners && (
                            <SliderRow
                              label="Rounded Corners"
                              value={options.roundedCorners}
                              min={0}
                              max={100}
                              onChange={onRoundedCorners}
                              defaultValue={DEFAULTS.roundedCorners}
                              suffix="px"
                              help="Add rounded corners to the media edges."
                            />
                          )} */}
                        </div>
                      </div>
                    )}

                    {/* Transform Tab */}
                    {activeTab === "transform" && (
                      <div className="space-y-4">
                        <div className="space-y-3 pl-1">
                          <div className="grid grid-cols-1 gap-4">
                            <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors">
                              <div className="flex items-center gap-2">
                                <FlipHorizontal className="h-4 w-4 text-muted-foreground" />
                                <Label className="text-sm font-medium">
                                  Flip Horizontal
                                </Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Flip Horizontal info"
                                      className="text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      <HelpCircle className="h-3.5 w-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="top"
                                    className="max-w-[280px]"
                                  >
                                    <div className="text-xs leading-relaxed">
                                      Mirror the media left-to-right.
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <Switch
                                checked={!!options.flipH}
                                onCheckedChange={(v: boolean) =>
                                  updateStyling({ flipH: v })
                                }
                              />
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors">
                              <div className="flex items-center gap-2">
                                <FlipVertical className="h-4 w-4 text-muted-foreground" />
                                <Label className="text-sm font-medium">
                                  Flip Vertical
                                </Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Flip Vertical info"
                                      className="text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      <HelpCircle className="h-3.5 w-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="top"
                                    className="max-w-[280px]"
                                  >
                                    <div className="text-xs leading-relaxed">
                                      Mirror the media top-to-bottom.
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <Switch
                                checked={!!options.flipV}
                                onCheckedChange={(v: boolean) =>
                                  updateStyling({ flipV: v })
                                }
                              />
                            </div>
                          </div>

                          {/* Green Screen Section */}
                          <div className="mt-6 pt-6 border-t border-border/50">
                            <div className="flex items-center gap-2 mb-4">
                              <Crop className="h-4 w-4 text-muted-foreground" />
                              <Label className="text-sm font-medium">
                                Green Screen (Chroma Key)
                              </Label>
                            </div>

                            <div className="space-y-4">
                              {/* Enable Green Screen */}
                              <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors">
                                <div className="flex items-center gap-2">
                                  <Label className="text-sm font-medium">
                                    Enable Green Screen
                                  </Label>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label="Enable Green Screen info"
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        <HelpCircle className="h-3.5 w-3.5" />
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      side="top"
                                      className="max-w-[280px]"
                                    >
                                      <div className="text-xs leading-relaxed">
                                        Remove the selected background color
                                        using ffmpeg's chromakey filter to
                                        create transparency.
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                </div>
                                <Switch
                                  checked={!!options.greenScreenEnabled}
                                  onCheckedChange={onGreenScreenEnabled}
                                />
                              </div>
                              <div className="text-xs text-muted-foreground leading-relaxed px-1">
                                The preview only works with supported browsers,
                                but you can still enable it and it will be
                                applied when you export.
                              </div>

                              {/* Green Screen Controls (shown when enabled) */}
                              {options.greenScreenEnabled && (
                                <div className="space-y-4 pl-1">
                                  {/* Color Picker */}
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-1.5">
                                      <Label className="text-sm font-medium text-foreground">
                                        Background Color
                                      </Label>
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button
                                            type="button"
                                            aria-label="Background Color info"
                                            className="text-muted-foreground hover:text-foreground transition-colors"
                                          >
                                            <HelpCircle className="h-3.5 w-3.5" />
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent
                                          side="top"
                                          className="max-w-[280px]"
                                        >
                                          <div className="text-xs leading-relaxed">
                                            Select the color to remove
                                            (chromakey color parameter). Default
                                            is green (#00ff00). Color is
                                            converted to 0xRRGGBB format for
                                            ffmpeg.
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="color"
                                        value={
                                          options.greenScreenColor || "#00ff00"
                                        }
                                        onChange={(e) =>
                                          onGreenScreenColor(e.target.value)
                                        }
                                        className="w-16 h-10 p-1 border rounded cursor-pointer"
                                      />
                                      <Input
                                        type="text"
                                        value={
                                          options.greenScreenColor || "#00ff00"
                                        }
                                        onChange={(e) =>
                                          onGreenScreenColor(e.target.value)
                                        }
                                        placeholder="#00ff00"
                                        className="flex-1 font-mono text-sm"
                                        pattern="^#[0-9A-Fa-f]{6}$"
                                      />
                                    </div>
                                  </div>

                                  {/* Similarity Slider */}
                                  <SliderRow
                                    label="Similarity"
                                    value={options.greenScreenSimilarity || 0.3}
                                    min={0}
                                    max={0.5}
                                    step={0.01}
                                    defaultValue={
                                      DEFAULTS.greenScreenSimilarity
                                    }
                                    onChange={onGreenScreenSimilarity}
                                    help="Color matching tolerance (chromakey similarity parameter). Lower values (0.01) match only the exact key color, higher values (up to 0.5) are more forgiving. Adjust if edges show artifacts or background isn't fully removed."
                                  />

                                  {/* Blend Slider */}
                                  <SliderRow
                                    label="Blend / Feathering"
                                    value={options.greenScreenBlend || 0.1}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={DEFAULTS.greenScreenBlend}
                                    onChange={onGreenScreenBlend}
                                    help="Edge feathering amount (chromakey blend parameter). 0.0 makes pixels either fully transparent or not transparent. Higher values (up to 1.0) create softer, more natural edges with semi-transparent pixels at the edges."
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Keyframes Tab */}
                    {activeTab === "keyframes" &&
                      (() => {
                        const keyframes = clip?.keyframes || [];
                        const clipStart = clip?.start || 0;
                        const effectiveDuration =
                          liveDurationOverrides?.[clipId || ""] ??
                          clip?.duration ??
                          0;
                        const clipEnd = clipStart + effectiveDuration;

                        // Check if currentTime is within this clip (with 0.05s buffer)
                        const isWithinClip =
                          currentTime >= clipStart - 0.05 &&
                          currentTime <= clipEnd + 0.05;
                        const relativeTime = currentTime - clipStart;

                        // Find if currentTime matches an existing keyframe (within 0.1s tolerance)
                        const currentKeyframe = keyframes.find(
                          (kf) => Math.abs(kf.at - relativeTime) < 0.1,
                        );
                        const currentKeyframeIndex = currentKeyframe
                          ? keyframes.findIndex(
                              (kf) => Math.abs(kf.at - relativeTime) < 0.1,
                            )
                          : -1;

                        const handleAddKeyframe = () => {
                          if (!isWithinClip) return;

                          // Check if keyframe already exists at this time
                          const exists = keyframes.some(
                            (kf) => Math.abs(kf.at - relativeTime) < 0.1,
                          );
                          if (exists) return;

                          // Create new keyframe with current clip values
                          const newKeyframe: Keyframe = {
                            at: Math.max(
                              0,
                              Math.min(
                                effectiveDuration,
                                Math.round(relativeTime * 100) / 100,
                              ),
                            ), // Round to 2 decimals and clamp
                            position: clip?.position
                              ? { ...clip.position }
                              : undefined,
                            size: clip?.size ? { ...clip.size } : undefined,
                            rotate: clip?.styling?.rotate,
                            opacity: (clip?.styling as any)?.opacity ?? 100,
                            brightness: clip?.styling?.brightness,
                            contrast: clip?.styling?.contrast,
                            saturation: clip?.styling?.saturation,
                            hue: clip?.styling?.hue,
                            blur: clip?.styling?.blur,
                            grayscale: clip?.styling?.grayscale,
                            sepia: clip?.styling?.sepia,
                            invert: clip?.styling?.invert,
                            sharpen: clip?.styling?.sharpen,
                            roundedCorners: clip?.styling?.roundedCorners,
                            easing: "linear",
                          };

                          const updatedKeyframes = [
                            ...keyframes,
                            newKeyframe,
                          ].sort((a, b) => a.at - b.at);
                          dispatch(
                            updateClip({
                              clipId,
                              updates: { keyframes: updatedKeyframes },
                            }),
                          );
                        };

                        const handleUpdateKeyframe = (
                          index: number,
                          updates: Partial<Keyframe>,
                        ) => {
                          const updatedKeyframes = [...keyframes];
                          updatedKeyframes[index] = {
                            ...updatedKeyframes[index],
                            ...updates,
                          };
                          dispatch(
                            updateClip({
                              clipId,
                              updates: { keyframes: updatedKeyframes },
                            }),
                          );
                        };

                        const handleDeleteKeyframe = (index: number) => {
                          const updatedKeyframes = keyframes.filter(
                            (_, i) => i !== index,
                          );
                          dispatch(
                            updateClip({
                              clipId,
                              updates: { keyframes: updatedKeyframes },
                            }),
                          );
                        };

                        return (
                          <div className="space-y-4">
                            {/* Keyframes List */}
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">
                                  Keyframes
                                </Label>
                                <Button
                                  size="sm"
                                  onClick={handleAddKeyframe}
                                  disabled={!isWithinClip || !!currentKeyframe}
                                  className="h-8"
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add Keyframe
                                </Button>
                              </div>

                              {!isWithinClip && (
                                <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border/50">
                                  Position the scrubber within this clip to add
                                  keyframes.
                                </div>
                              )}

                              {keyframes.length === 0 && isWithinClip && (
                                <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border/50">
                                  No keyframes yet. Click "Add Keyframe" to
                                  create your first animation point.
                                </div>
                              )}

                              {keyframes.length > 0 && (
                                <div className="gap-2 flex flex-wrap pb-2">
                                  {keyframes.map((kf, index) => (
                                    <div
                                      key={index}
                                      className={`pl-2 flex items-center rounded-lg border transition-all cursor-pointer ${
                                        currentKeyframeIndex === index
                                          ? "border-primary bg-primary/10"
                                          : "border-border/50 bg-muted/30 hover:bg-muted/50"
                                      }`}
                                      onClick={() => {
                                        dispatch(
                                          setCurrentTime(clipStart + kf.at),
                                        );
                                      }}
                                    >
                                      <div className="flex items-center gap-2 justify-between">
                                        <div className="flex items-center gap-2">
                                          <KeySquare className="h-4 w-4 text-muted-foreground" />
                                          <span className="text-sm font-medium">
                                            {kf.at.toFixed(2)}s
                                          </span>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() =>
                                            handleDeleteKeyframe(index)
                                          }
                                          className="h-7 w-7 p-0"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Keyframe Editing Fields - Only show when scrubber is on a keyframe */}
                            {currentKeyframe && currentKeyframeIndex >= 0 && (
                              <div className="space-y-4 mt-6 pt-6 border-t border-border/50">
                                <Label className="text-sm font-medium">
                                  Edit Keyframe at{" "}
                                  {currentKeyframe.at.toFixed(2)}s
                                </Label>

                                <div className="grid grid-cols-1 gap-4 pl-1">
                                  {/* Position */}
                                  <SliderRow
                                    label="Position X"
                                    value={currentKeyframe.position?.x ?? 50}
                                    min={0}
                                    max={100}
                                    suffix="%"
                                    defaultValue={50}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        {
                                          position: {
                                            x: v,
                                            y:
                                              currentKeyframe.position?.y ?? 50,
                                          },
                                        },
                                      )
                                    }
                                    help="Horizontal position"
                                  />
                                  <SliderRow
                                    label="Position Y"
                                    value={currentKeyframe.position?.y ?? 50}
                                    min={0}
                                    max={100}
                                    suffix="%"
                                    defaultValue={50}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        {
                                          position: {
                                            x:
                                              currentKeyframe.position?.x ?? 50,
                                            y: v,
                                          },
                                        },
                                      )
                                    }
                                    help="Vertical position"
                                  />

                                  {/* Size */}
                                  <SliderRow
                                    label="Width"
                                    value={currentKeyframe.size?.width ?? 100}
                                    min={1}
                                    max={200}
                                    suffix="%"
                                    defaultValue={100}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        {
                                          size: {
                                            width: v,
                                            height:
                                              currentKeyframe.size?.height ??
                                              100,
                                          },
                                        },
                                      )
                                    }
                                    help="Width scale"
                                  />
                                  <SliderRow
                                    label="Height"
                                    value={currentKeyframe.size?.height ?? 100}
                                    min={1}
                                    max={200}
                                    suffix="%"
                                    defaultValue={100}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        {
                                          size: {
                                            width:
                                              currentKeyframe.size?.width ??
                                              100,
                                            height: v,
                                          },
                                        },
                                      )
                                    }
                                    help="Height scale"
                                  />

                                  {/* Transform */}
                                  <SliderRow
                                    label="Rotation"
                                    value={currentKeyframe.rotate ?? 0}
                                    min={-180}
                                    max={180}
                                    suffix="°"
                                    defaultValue={0}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { rotate: v },
                                      )
                                    }
                                    help="Rotation angle"
                                  />
                                  <SliderRow
                                    label="Opacity"
                                    value={currentKeyframe.opacity ?? 100}
                                    min={0}
                                    max={100}
                                    suffix="%"
                                    defaultValue={100}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { opacity: v },
                                      )
                                    }
                                    help="Transparency level"
                                  />

                                  {/* Visual Filters */}
                                  <SliderRow
                                    label="Brightness"
                                    value={currentKeyframe.brightness ?? 100}
                                    min={0}
                                    max={200}
                                    suffix="%"
                                    defaultValue={100}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { brightness: v },
                                      )
                                    }
                                    help="Brightness level"
                                  />
                                  <SliderRow
                                    label="Contrast"
                                    value={currentKeyframe.contrast ?? 100}
                                    min={0}
                                    max={200}
                                    suffix="%"
                                    defaultValue={100}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { contrast: v },
                                      )
                                    }
                                    help="Contrast level"
                                  />
                                  <SliderRow
                                    label="Saturation"
                                    value={currentKeyframe.saturation ?? 100}
                                    min={0}
                                    max={200}
                                    suffix="%"
                                    defaultValue={100}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { saturation: v },
                                      )
                                    }
                                    help="Color saturation"
                                  />
                                  <SliderRow
                                    label="Blur"
                                    value={currentKeyframe.blur ?? 0}
                                    min={0}
                                    max={20}
                                    step={0.5}
                                    suffix="px"
                                    defaultValue={0}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { blur: v },
                                      )
                                    }
                                    help="Blur amount"
                                  />
                                  <SliderRow
                                    label="Hue Rotation"
                                    value={currentKeyframe.hue ?? 0}
                                    min={0}
                                    max={360}
                                    suffix="°"
                                    defaultValue={0}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { hue: v },
                                      )
                                    }
                                    help="Shift colors around the color wheel"
                                  />
                                  <SliderRow
                                    label="Grayscale"
                                    value={currentKeyframe.grayscale ?? 0}
                                    min={0}
                                    max={100}
                                    suffix="%"
                                    defaultValue={0}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { grayscale: v },
                                      )
                                    }
                                    help="Drain color from the media"
                                  />
                                  <SliderRow
                                    label="Sepia"
                                    value={currentKeyframe.sepia ?? 0}
                                    min={0}
                                    max={100}
                                    suffix="%"
                                    defaultValue={0}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { sepia: v },
                                      )
                                    }
                                    help="Apply a warm, antique tone"
                                  />
                                  <SliderRow
                                    label="Invert"
                                    value={currentKeyframe.invert ?? 0}
                                    min={0}
                                    max={100}
                                    suffix="%"
                                    defaultValue={0}
                                    onChange={(v) =>
                                      handleUpdateKeyframe(
                                        currentKeyframeIndex,
                                        { invert: v },
                                      )
                                    }
                                    help="Invert colors"
                                  />

                                  {/* Easing */}
                                  <div className="space-y-2.5">
                                    <Label className="text-sm font-medium text-foreground">
                                      Easing
                                    </Label>
                                    <select
                                      value={currentKeyframe.easing || "linear"}
                                      onChange={(e) =>
                                        handleUpdateKeyframe(
                                          currentKeyframeIndex,
                                          {
                                            easing: e.target
                                              .value as Keyframe["easing"],
                                          },
                                        )
                                      }
                                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                                    >
                                      <option value="linear">Linear</option>
                                      <option value="jump-cut">Jump Cut</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                    {/* Audio Controls Tab (Video only) */}
                    {isVideo && activeTab === "audio" && (
                      <div className="space-y-4">
                        <div className="space-y-3 pl-1">
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm font-medium text-foreground">
                                  Volume
                                </Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Volume info"
                                      className="text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      <HelpCircle className="h-3.5 w-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="top"
                                    className="max-w-[280px]"
                                  >
                                    <div className="text-xs leading-relaxed">
                                      Adjust playback loudness for this clip
                                      only.
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-medium text-foreground min-w-[3.5rem] text-right">
                                  {Math.round((options.volume || 0) * 100)}%
                                </span>
                                <ResetButton
                                  ariaLabel="Reset Volume"
                                  onClick={() => onVolume(DEFAULTS.volume)}
                                  disabled={
                                    (options.volume || 0) === DEFAULTS.volume
                                  }
                                />
                              </div>
                            </div>
                            <Slider
                              value={[options.volume]}
                              min={0}
                              max={1}
                              step={0.01}
                              onValueChange={([v]) => onVolume(v)}
                              className="w-full"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Audio Media Tabs */}
                {isAudio && (
                  <>
                    {/* Audio Controls Tab */}
                    {activeTab === "audio-controls" && (
                      <div className="space-y-4">
                        <div className="space-y-3 pl-1">
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm font-medium text-foreground">
                                  Volume
                                </Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Volume info"
                                      className="text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      <HelpCircle className="h-3.5 w-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="top"
                                    className="max-w-[280px]"
                                  >
                                    <div className="text-xs leading-relaxed">
                                      Adjust playback loudness for this clip
                                      only.
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-medium text-foreground min-w-[3.5rem] text-right">
                                  {Math.round((options.volume || 0) * 100)}%
                                </span>
                                <ResetButton
                                  ariaLabel="Reset Volume"
                                  onClick={() => onVolume(DEFAULTS.volume)}
                                  disabled={
                                    (options.volume || 0) === DEFAULTS.volume
                                  }
                                />
                              </div>
                            </div>
                            <Slider
                              value={[options.volume]}
                              min={0}
                              max={1}
                              step={0.01}
                              onValueChange={([v]) => onVolume(v)}
                              className="w-full"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Audio Effects Tab */}
                    {activeTab === "audio-effects" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 pl-1">
                          <SliderRow
                            label="Speed / Tempo"
                            value={options.audioSpeed}
                            min={0.5}
                            max={2}
                            step={0.01}
                            defaultValue={DEFAULTS.audioSpeed}
                            onChange={onAudioSpeed}
                            help="Playback speed. Keeps pitch stable when possible."
                          />
                          <SliderRow
                            label="Pitch Shift"
                            value={options.audioPitch}
                            min={-12}
                            max={12}
                            step={1}
                            defaultValue={DEFAULTS.audioPitch}
                            onChange={onAudioPitch}
                            help="Raise or lower pitch in semitones."
                          />
                          <SliderRow
                            label="Bass Boost"
                            value={options.audioBassBoost}
                            min={0}
                            max={20}
                            step={0.5}
                            defaultValue={DEFAULTS.audioBassBoost}
                            onChange={onAudioBass}
                            suffix=" dB"
                            help="Emphasize low frequencies."
                          />
                          <SliderRow
                            label="Treble Boost"
                            value={options.audioTrebleBoost}
                            min={0}
                            max={20}
                            step={0.5}
                            defaultValue={DEFAULTS.audioTrebleBoost}
                            onChange={onAudioTreble}
                            suffix=" dB"
                            help="Emphasize high frequencies for clarity."
                          />
                          <SliderRow
                            label="Echo"
                            value={options.audioEcho}
                            min={0}
                            max={1}
                            step={0.01}
                            defaultValue={DEFAULTS.audioEcho}
                            onChange={onAudioEcho}
                            help="Add repeating reflections."
                          />
                          <SliderRow
                            label="Reverb"
                            value={options.audioReverb}
                            min={0}
                            max={1}
                            step={0.01}
                            defaultValue={DEFAULTS.audioReverb}
                            onChange={onAudioReverb}
                            help="Add spacious ambience to the sound."
                          />
                        </div>
                        <div className="text-xs text-muted-foreground leading-relaxed bg-muted/30 p-3 rounded-lg border border-border/50">
                          <strong className="font-medium">Note:</strong> Audio
                          effects are previewed via WebAudio and may not
                          function properly.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8">
            No styling options available for this media type.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MediaStylingPanel;
