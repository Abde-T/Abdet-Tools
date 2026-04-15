import { Keyframe } from "../../../redux/timelineSlice";

/**
 * PlayerMath.ts
 *
 * Pure utility functions used by the player and clip renderer for
 * colour parsing and keyframe interpolation.  No React, no side-effects.
 */

// ─── Colour Utilities ─────────────────────────────────────────────────────────

/**
 * Parses a hex colour string (e.g. "#00FF00" or "0x00FF00") into its
 * individual RGB components.  Returns null for strings that cannot be parsed.
 *
 * Used by ChromaKeyCanvas to convert the user-chosen key colour into the
 * format needed for per-pixel distance calculations.
 */
export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const cleanHex = hex.replace(/^#/, "").replace(/^0x/i, "");
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return { r, g, b };
  }
  return null;
};

// ─── Interpolation ────────────────────────────────────────────────────────────

/**
 * Interpolates between two numeric values at a given `progress` (0 – 1).
 *
 * Supported easing modes:
 *  - "linear"    → smooth blend between value1 and value2
 *  - "jump-cut"  → holds value1 until progress reaches 1, then snaps to value2
 *                  (useful for simulating instant cuts between keyframes)
 */
export const interpolate = (
  value1: number,
  value2: number,
  progress: number, // 0 = start, 1 = end
  easing: "linear" | "jump-cut" = "linear",
): number => {
  if (easing === "jump-cut") {
    return progress < 1 ? value1 : value2;
  }
  return value1 + (value2 - value1) * progress;
};

// ─── Keyframe Interpolation ───────────────────────────────────────────────────

/**
 * getInterpolatedKeyframeValues
 *
 * Given a clip's keyframe array and the current playhead position within the
 * clip (`localTime`), returns an interpolated snapshot of all animatable
 * properties at that point in time.
 *
 * How it works:
 *  1. If localTime is before the first keyframe → clamp to first keyframe values
 *  2. If localTime is after the last keyframe  → clamp to last keyframe values
 *  3. Otherwise find the two surrounding keyframes (kf1, kf2) and interpolate
 *     each property using the easing mode defined on kf1.
 *
 * Properties interpolated:
 *  - position (x, y)          → canvas percentage coordinates
 *  - size (width, height)      → canvas percentage dimensions
 *  - rotate, opacity           → transform and visibility
 *  - brightness, contrast, saturation, hue → CSS filter values
 *  - blur, grayscale, sepia, invert, sharpen, roundedCorners → additional filters
 *
 * Falls back to `baseValues` (the clip's non-keyframed defaults) for any
 * property not explicitly set on a keyframe.
 *
 * @param keyframes  - sorted array of Keyframe objects (pre-sorted by `at`)
 * @param localTime  - seconds elapsed since the clip's own start (not the timeline origin)
 * @param baseValues - the clip's static position, size, and styling defaults
 * @returns          - a Partial<Keyframe> with interpolated values, or null if no keyframes
 */
export const getInterpolatedKeyframeValues = (
  keyframes: Keyframe[] | undefined,
  localTime: number,
  baseValues: {
    position: { x: number; y: number };
    size: { width: number; height: number };
    styling: any;
  },
): Partial<Keyframe> | null => {
  if (!keyframes || keyframes.length === 0) return null;

  // Keyframes must be sorted by `at` (MediaStylingPanel ensures this on insert)
  const sorted = keyframes;

  // Clamp: before first keyframe → use its values verbatim
  if (localTime <= sorted[0].at) {
    return sorted[0];
  }
  // Clamp: after last keyframe → use its values verbatim
  if (localTime >= sorted[sorted.length - 1].at) {
    return sorted[sorted.length - 1];
  }

  // Find the pair of keyframes that bracket localTime
  let kf1: Keyframe | null = null;
  let kf2: Keyframe | null = null;

  for (let i = 0; i < sorted.length - 1; i++) {
    if (localTime >= sorted[i].at && localTime <= sorted[i + 1].at) {
      kf1 = sorted[i];
      kf2 = sorted[i + 1];
      break;
    }
  }

  if (!kf1 || !kf2) return null;

  // Progress through the current keyframe segment (0 = kf1, 1 = kf2)
  const progress = (localTime - kf1.at) / (kf2.at - kf1.at);
  const easing = kf1.easing || "linear";

  const result: Partial<Keyframe> = {};

  // ── Geometry ──────────────────────────────────────────────────────────────
  result.position = {
    x: interpolate(
      kf1.position?.x ?? baseValues.position.x,
      kf2.position?.x ?? baseValues.position.x,
      progress,
      easing,
    ),
    y: interpolate(
      kf1.position?.y ?? baseValues.position.y,
      kf2.position?.y ?? baseValues.position.y,
      progress,
      easing,
    ),
  };

  result.size = {
    width: interpolate(
      kf1.size?.width ?? baseValues.size.width,
      kf2.size?.width ?? baseValues.size.width,
      progress,
      easing,
    ),
    height: interpolate(
      kf1.size?.height ?? baseValues.size.height,
      kf2.size?.height ?? baseValues.size.height,
      progress,
      easing,
    ),
  };

  // ── Scalar properties (filter values, rotation, etc.) ─────────────────────
  // Helper: interpolate a single scalar keyframe property, falling back to
  // the clip styling default, then to the supplied hardcoded default.
  const interpScalar = (
    key: keyof Keyframe,
    baseVal: number,
  ): number | undefined => {
    const v1 =
      (kf1![key] as number) ?? (baseValues.styling[key] as number) ?? baseVal;
    const v2 =
      (kf2![key] as number) ?? (baseValues.styling[key] as number) ?? baseVal;
    if (v1 === v2) return v1; // skip interpolation if equal
    return interpolate(v1, v2, progress, easing);
  };

  result.rotate         = interpScalar("rotate",         0);
  result.opacity        = interpScalar("opacity",        100);
  result.brightness     = interpScalar("brightness",     100);
  result.contrast       = interpScalar("contrast",       100);
  result.saturation     = interpScalar("saturation",     100);
  result.hue            = interpScalar("hue",            0);
  result.blur           = interpScalar("blur",           0);
  result.grayscale      = interpScalar("grayscale",      0);
  result.sepia          = interpScalar("sepia",          0);
  result.invert         = interpScalar("invert",         0);
  result.sharpen        = interpScalar("sharpen",        0);
  result.roundedCorners = interpScalar("roundedCorners", 0);

  return result;
};
