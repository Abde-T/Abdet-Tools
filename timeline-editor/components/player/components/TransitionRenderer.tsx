import React from "react";
import { Clip, Track } from "../../../redux/timelineSlice";
import { UniversalClipRenderer } from "./ClipRenderer";

/**
 * TransitionRenderer.tsx
 *
 * Provides CSS-based transition effect components for the browser preview.
 * Each component takes a `transition` object (from Player.tsx's `activeTransitions`
 * array) and renders both the outgoing (`fromClip`) and incoming (`toClip`) clips
 * simultaneously, manipulating their opacity, brightness, or CSS clip-path to
 * produce the visual transition effect.
 *
 * ## Progress model
 *
 * All transitions share the same normalised progress variable:
 *
 *   progress = clamp((currentTime - transition.startTime) / transition.duration, 0, 1)
 *
 * At `progress = 0` the fromClip is fully visible; at `progress = 1` the toClip
 * is fully visible.
 *
 * ## `ignoreBounds` flag
 *
 * Both clips are rendered with `ignoreBounds={true}` so they remain mounted
 * even when `currentTime` is technically outside their normal clip window.
 * The transition component controls visibility instead of the clip's own timer.
 *
 * ## `localTimeOverride` for the toClip
 *
 * The incoming clip starts from `transition.duration / 2` seconds into its own
 * content.  This ensures both clips are showing their midpoints simultaneously
 * during a symmetrical transition rather than the toClip starting from zero.
 *
 * ## Available Transitions
 *
 * | Component              | Effect                              | CSS technique           |
 * |------------------------|-------------------------------------|-------------------------|
 * | FadeTransition         | Crossfade via opacity               | `opacity`               |
 * | FadeBlackTransition    | Fade to black then fade in          | `brightnessOverride`    |
 * | FadeWhiteTransition    | Fade to white (over-exposed) + in   | `brightnessOverride`    |
 * | WipeTransition         | Directional wipe (L/R/T/B)          | `clip-path: inset()`    |
 * | SlideTransition        | Push slide (L/R/T/B)                | `translateX/Y`          |
 * | CircularTransition     | Circle reveal from center           | `clip-path: circle()`   |
 * | RectCropTransition     | Shrink-in-box rectangle crop        | `scale()`               |
 * | CircleCloseTransition  | Circle shrink close                 | `scale() + clip-path`   |
 *
 * > **Note:** These are browser approximations.  The final render uses FFmpeg's
 * > `xfade` filter and may differ in timing and blending.
 */

/**
 * FadeTransition
 * Simple alpha crossfade: fromClip fades out (opacity 1→0) while toClip fades in (opacity 0→1).
 */
export const FadeTransition: React.FC<{
  transition: any;
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, allClips } = props;

  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );

  const fromOpacity = 1 - progress;
  const toOpacity = progress;

  const toClipLocalTime =
    transition.toClip && allClips[transition.toClip]
      ? currentTime -
        allClips[transition.toClip].start +
        transition.duration / 2
      : undefined;

  return (
    <React.Fragment>
      {transition.fromClip && (
        <UniversalClipRenderer
          {...props}
          clipId={transition.fromClip}
          opacityOverride={fromOpacity}
          ignoreBounds={true}
        />
      )}
      {transition.toClip && (
        <UniversalClipRenderer
          {...props}
          clipId={transition.toClip}
          opacityOverride={toOpacity}
          ignoreBounds={true}
          localTimeOverride={toClipLocalTime}
        />
      )}
    </React.Fragment>
  );
};

/**
 * FadeBlackTransition
 * First half: fromClip dims to black (brightness 1→0).
 * Second half: toClip brightens from black (brightness 0→1).
 */
export const FadeBlackTransition: React.FC<{
  transition: any;
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, allClips } = props;
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );

  const fromBrightness = progress < 0.5 ? 1 - progress * 2 : 0;
  const toBrightness = progress >= 0.5 ? (progress - 0.5) * 2 : 0;

  const toClipLocalTime =
    transition.toClip && allClips[transition.toClip]
      ? currentTime -
        allClips[transition.toClip].start +
        transition.duration / 2
      : undefined;

  return (
    <React.Fragment>
      {transition.fromClip && (
        <UniversalClipRenderer
          {...props}
          clipId={transition.fromClip}
          brightnessOverride={fromBrightness}
          ignoreBounds={true}
        />
      )}
      {transition.toClip && (
        <UniversalClipRenderer
          {...props}
          clipId={transition.toClip}
          brightnessOverride={toBrightness}
          ignoreBounds={true}
          localTimeOverride={toClipLocalTime}
        />
      )}
    </React.Fragment>
  );
};

/**
 * FadeWhiteTransition
 * Simulates an over-exposed film flash:
 * First half: fromClip blows out to white (brightness 1→9).
 * Second half: toClip fades in from white (brightness 9→1).
 */
export const FadeWhiteTransition: React.FC<{
  transition: any;
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, allClips } = props;
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );

  const fromBrightness = progress < 0.5 ? 1 + progress * 8 : 1;
  const toBrightness = progress >= 0.5 ? 1 + (1 - progress) * 8 : 1;

  const toClipLocalTime =
    transition.toClip && allClips[transition.toClip]
      ? currentTime -
        allClips[transition.toClip].start +
        transition.duration / 2
      : undefined;

  return (
    <React.Fragment>
      {transition.fromClip && (
        <UniversalClipRenderer
          {...props}
          clipId={transition.fromClip}
          brightnessOverride={fromBrightness}
          ignoreBounds={true}
        />
      )}
      {transition.toClip && (
        <UniversalClipRenderer
          {...props}
          clipId={transition.toClip}
          brightnessOverride={toBrightness}
          ignoreBounds={true}
          localTimeOverride={toClipLocalTime}
        />
      )}
    </React.Fragment>
  );
};

/**
 * WipeTransition
 * Reveals the toClip by progressively expanding a rectangular clip-path in the
 * given direction, simultaneously sliding both clips in the same direction.
 * The effect is similar to a venetian blind sliding open.
 *
 * @param direction - which edge the wipe originates from
 */
export const WipeTransition: React.FC<{
  transition: any;
  direction: "left" | "right" | "top" | "bottom";
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, direction, allClips } = props;
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );
  const p = progress * 100;

  let fromClipPath = "";
  let toClipPath = "";

  if (direction === "left") {
    fromClipPath = `inset(0 ${p}% 0 0)`;
    toClipPath = `inset(0 0 0 ${100 - p}%)`;
  } else if (direction === "right") {
    fromClipPath = `inset(0 0 0 ${p}%)`;
    toClipPath = `inset(0 ${100 - p}% 0 0)`;
  } else if (direction === "top") {
    fromClipPath = `inset(${p}% 0 0 0)`;
    toClipPath = `inset(0 0 ${100 - p}% 0)`;
  } else if (direction === "bottom") {
    fromClipPath = `inset(0 0 ${p}% 0)`;
    toClipPath = `inset(${100 - p}% 0 0 0)`;
  }

  const toClipLocalTime =
    transition.toClip && allClips[transition.toClip]
      ? currentTime -
        allClips[transition.toClip].start +
        transition.duration / 2
      : undefined;

  let fromTransform = "";
  let toTransform = "";

  if (direction === "left") {
    fromTransform = `translateX(-${p}%)`;
    toTransform = `translateX(${100 - p}%)`;
  } else if (direction === "right") {
    fromTransform = `translateX(${p}%)`;
    toTransform = `translateX(-${100 - p}%)`;
  } else if (direction === "top") {
    fromTransform = `translateY(-${p}%)`;
    toTransform = `translateY(${100 - p}%)`;
  } else if (direction === "bottom") {
    fromTransform = `translateY(${p}%)`;
    toTransform = `translateY(-${100 - p}%)`;
  }

  return (
    <React.Fragment>
      {transition.fromClip && (
        <div
          style={{
            clipPath: fromClipPath,
            transform: fromTransform,
            position: "absolute",
            inset: 0,
          }}
        >
          <UniversalClipRenderer
            {...props}
            clipId={transition.fromClip}
            ignoreBounds={true}
          />
        </div>
      )}
      {transition.toClip && (
        <div
          style={{
            clipPath: toClipPath,
            transform: toTransform,
            position: "absolute",
            inset: 0,
          }}
        >
          <UniversalClipRenderer
            {...props}
            clipId={transition.toClip}
            ignoreBounds={true}
            localTimeOverride={toClipLocalTime}
          />
        </div>
      )}
    </React.Fragment>
  );
};

/**
 * SlideTransition
 * Both clips translate in the same direction (push transition):
 * fromClip slides off-screen while toClip slides in from the opposite edge.
 *
 * @param direction - the direction the content moves
 */
export const SlideTransition: React.FC<{
  transition: any;
  direction: "left" | "right" | "top" | "bottom";
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, direction, allClips } = props;
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );
  const p = progress * 100;

  let fromTransform = "";
  let toTransform = "";

  if (direction === "left") {
    fromTransform = `translateX(-${p}%)`;
    toTransform = `translateX(${100 - p}%)`;
  } else if (direction === "right") {
    fromTransform = `translateX(${p}%)`;
    toTransform = `translateX(-${100 - p}%)`;
  } else if (direction === "top") {
    fromTransform = `translateY(-${p}%)`;
    toTransform = `translateY(${100 - p}%)`;
  } else if (direction === "bottom") {
    fromTransform = `translateY(${p}%)`;
    toTransform = `translateY(-${100 - p}%)`;
  }

  const toClipLocalTime =
    transition.toClip && allClips[transition.toClip]
      ? currentTime -
        allClips[transition.toClip].start +
        transition.duration / 2
      : undefined;

  return (
    <React.Fragment>
      {transition.fromClip && (
        <div
          style={{ transform: fromTransform, position: "absolute", inset: 0 }}
        >
          <UniversalClipRenderer
            {...props}
            clipId={transition.fromClip}
            ignoreBounds={true}
          />
        </div>
      )}
      {transition.toClip && (
        <div style={{ transform: toTransform, position: "absolute", inset: 0 }}>
          <UniversalClipRenderer
            {...props}
            clipId={transition.toClip}
            ignoreBounds={true}
            localTimeOverride={toClipLocalTime}
          />
        </div>
      )}
    </React.Fragment>
  );
};

/**
 * CircularTransition (circleopen)
 * The toClip is revealed by an expanding circle centered in the frame.
 * The fromClip stays static underneath; the circle grows from 0% to 150% radius.
 */
export const CircularTransition: React.FC<{
  transition: any;
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, allClips } = props;
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );

  const radius = progress * 150;
  const clipPath = `circle(${radius}% at 50% 50%)`;

  const toClipLocalTime = transition.toClip
    ? currentTime - allClips[transition.toClip].start + transition.duration / 2
    : undefined;

  return (
    <React.Fragment>
      {transition.fromClip && (
        <div style={{ position: "absolute", inset: 0 }}>
          <UniversalClipRenderer
            {...props}
            clipId={transition.fromClip}
            ignoreBounds={true}
          />
        </div>
      )}
      {transition.toClip && (
        <div style={{ clipPath, position: "absolute", inset: 0 }}>
          <UniversalClipRenderer
            {...props}
            clipId={transition.toClip}
            ignoreBounds={true}
            localTimeOverride={toClipLocalTime}
          />
        </div>
      )}
    </React.Fragment>
  );
};

/**
 * RectCropTransition (rectcrop)
 * The fromClip shrinks (scales) down to nothing while the toClip is visible behind it.
 * Gives a "zooming into the next scene" feel.
 */
export const RectCropTransition: React.FC<{
  transition: any;
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, allClips } = props;
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );

  const scale = 1 - progress;

  const fromClipLocalTime =
    transition.fromClip && allClips[transition.fromClip]
      ? currentTime - allClips[transition.fromClip].start
      : undefined;

  const toClipLocalTime =
    transition.toClip && allClips[transition.toClip]
      ? currentTime -
        allClips[transition.toClip].start +
        transition.duration / 2
      : undefined;

  return (
    <React.Fragment>
      {transition.toClip && (
        <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          <UniversalClipRenderer
            {...props}
            clipId={transition.toClip}
            ignoreBounds={true}
            localTimeOverride={toClipLocalTime}
          />
        </div>
      )}
      {transition.fromClip && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            overflow: "hidden",
          }}
        >
          <UniversalClipRenderer
            {...props}
            clipId={transition.fromClip}
            ignoreBounds={true}
            localTimeOverride={fromClipLocalTime}
          />
        </div>
      )}
    </React.Fragment>
  );
};

/**
 * CircleCloseTransition (circleclose)
 * The fromClip is masked to a circle and that circle shrinks (scales down),
 * revealing the toClip behind it.  The inverse of CircularTransition.
 */
export const CircleCloseTransition: React.FC<{
  transition: any;
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
}> = (props) => {
  const { transition, currentTime, allClips } = props;
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - transition.startTime) / transition.duration),
  );

  const scale = 1 - progress;

  const fromClipLocalTime =
    transition.fromClip && allClips[transition.fromClip]
      ? currentTime - allClips[transition.fromClip].start
      : undefined;

  const clipPath = `circle(50% at 50% 50%)`;

  const toClipLocalTime =
    transition.toClip && allClips[transition.toClip]
      ? currentTime -
        allClips[transition.toClip].start +
        transition.duration / 2
      : undefined;

  return (
    <React.Fragment>
      {transition.toClip && (
        <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          <UniversalClipRenderer
            {...props}
            clipId={transition.toClip}
            ignoreBounds={true}
            localTimeOverride={toClipLocalTime}
          />
        </div>
      )}
      {transition.fromClip && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            clipPath: clipPath,
            WebkitClipPath: clipPath,
            overflow: "hidden",
          }}
        >
          <UniversalClipRenderer
            {...props}
            clipId={transition.fromClip}
            ignoreBounds={true}
            localTimeOverride={fromClipLocalTime}
          />
        </div>
      )}
    </React.Fragment>
  );
};
