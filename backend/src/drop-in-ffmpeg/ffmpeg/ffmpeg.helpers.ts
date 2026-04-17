/**
 * FFMPEG HELPERS — The Brain of the Export Engine
 * =========================================================
 * This class handles the low-level heavy lifting of FFmpeg command 
 * construction, filter graph building, and media resolution.
 * 
 * CORE RESPONSIBILITIES:
 * 1. Filter Graph Construction: Generates the complex strings for overlays, transitions, and audio mixing.
 * 2. Media Probing: Detects stream info and audio presence using ffprobe.
 * 3. Asset Resolution: Downloads remote media or decodes Base64 into temporary files.
 * 4. Advanced Subtitles: Converts SRT/Text into ASS subtitle files with custom styling.
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { randomUUID, createHash } from 'crypto';
import type { GenerateVideoInput } from './ffmpeg.model.js';

/**
 * Minimal logger interface so FfmpegHelpers works in any framework.
 * Pass console, a Winston instance, a NestJS Logger, Pino — anything with these four methods.
 */
export interface FfmpegLogger {
  debug(msg: string): void;
  log(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

interface Transition {
  start: number | string;
  duration: number | string;
  type?: string;
  [key: string]: any;
}

interface TransitionCandidate {
  transition: Transition;
  index: number;
  quality: number;
}

/**
 * FfmpegHelpers provides utility methods for FfmpegService to construct
 * complex FFmpeg command chains. 
 */
export class FfmpegHelpers {
  private readonly logger: FfmpegLogger;
  private readonly tmpDir: string;
  private readonly fontsDir: string;
  private readonly hasXfadeSupport: boolean;
  private readonly metadataCache = new Map<string, any>();
  private readonly pendingProbes = new Map<string, Promise<boolean>>();
  private readonly pendingDownloads = new Map<string, Promise<string>>();

  // Configurable transition alignment parameters
  // These values control how flexible the system is when matching transitions to media boundaries
  private TRANSITION_BOUNDARY_TOLERANCE = 0.5; // seconds - tolerance for transition alignment in alignTransitionsBetweenMedia
  private TRANSITION_ALIGNMENT_TOLERANCE = 1.0; // seconds - tolerance for transition finding in main processing loop

  // Additional fault tolerance configuration
  private MAX_TRANSITION_DURATION = 10; // seconds - maximum allowed transition duration
  private MIN_TRANSITION_DURATION = 0.1; // seconds - minimum allowed transition duration
  private ADAPTIVE_TOLERANCE_FACTOR = 0.1; // factor for adaptive tolerance calculation
  private MAX_ADAPTIVE_TOLERANCE = 2.0; // seconds - maximum adaptive tolerance
  private ENABLE_FALLBACK_PROCESSING = true; // enable fallback to individual media processing
  private ENABLE_TRANSITION_SANITIZATION = true; // enable transition data sanitization

  private readonly SUPPORTED_TRANSITIONS = new Set<string>([
    'fade',
    'dissolve',
    'wipeleft',
    'wiperight',
    'wipeup',
    'wipedown',
    'slideleft',
    'slideright',
    'slideup',
    'slidedown',
    'circleopen',
    'circleclose',
    'rectcrop',
    'distance',
    'fadeblack',
    'fadewhite',
  ]);

  /**
   * Creates a new FfmpegHelpers instance with configurable transition alignment parameters
   * @param logger - Logger instance for debugging
   * @param tmpDir - Temporary directory for file operations
   * @param hasXfadeSupport - Whether FFmpeg supports xfade filter
   * @param config - Optional configuration for transition alignment tolerances and fault tolerance
   * @param config.transitionBoundaryTolerance - Tolerance for transition alignment in alignTransitionsBetweenMedia (default: 0.5s)
   * @param config.transitionAlignmentTolerance - Tolerance for transition finding in main processing loop (default: 1.0s)
   * @param config.maxTransitionDuration - Maximum allowed transition duration (default: 10s)
   * @param config.minTransitionDuration - Minimum allowed transition duration (default: 0.1s)
   * @param config.adaptiveToleranceFactor - Factor for adaptive tolerance calculation (default: 0.1)
   * @param config.maxAdaptiveTolerance - Maximum adaptive tolerance (default: 2.0s)
   * @param config.enableFallbackProcessing - Enable fallback to individual media processing (default: true)
   * @param config.enableTransitionSanitization - Enable transition data sanitization (default: true)
   */
  constructor(
    logger: FfmpegLogger,
    tmpDir: string,
    hasXfadeSupport: boolean,
    config?: {
      fontsDir?: string;
      transitionBoundaryTolerance?: number;
      transitionAlignmentTolerance?: number;
      maxTransitionDuration?: number;
      minTransitionDuration?: number;
      adaptiveToleranceFactor?: number;
      maxAdaptiveTolerance?: number;
      enableFallbackProcessing?: boolean;
      enableTransitionSanitization?: boolean;
    },
  ) {
    this.logger = logger;
    this.tmpDir = tmpDir;
    this.fontsDir =
      config?.fontsDir ?? path.join(process.cwd(), 'src', 'fonts');
    this.hasXfadeSupport = hasXfadeSupport;

    // Apply custom configuration if provided
    if (config) {
      if (config.transitionBoundaryTolerance !== undefined) {
        this.TRANSITION_BOUNDARY_TOLERANCE = config.transitionBoundaryTolerance;
      }
      if (config.transitionAlignmentTolerance !== undefined) {
        this.TRANSITION_ALIGNMENT_TOLERANCE =
          config.transitionAlignmentTolerance;
      }
      if (config.maxTransitionDuration !== undefined) {
        this.MAX_TRANSITION_DURATION = config.maxTransitionDuration;
      }
      if (config.minTransitionDuration !== undefined) {
        this.MIN_TRANSITION_DURATION = config.minTransitionDuration;
      }
      if (config.adaptiveToleranceFactor !== undefined) {
        this.ADAPTIVE_TOLERANCE_FACTOR = config.adaptiveToleranceFactor;
      }
      if (config.maxAdaptiveTolerance !== undefined) {
        this.MAX_ADAPTIVE_TOLERANCE = config.maxAdaptiveTolerance;
      }
      if (config.enableFallbackProcessing !== undefined) {
        this.ENABLE_FALLBACK_PROCESSING = config.enableFallbackProcessing;
      }
      if (config.enableTransitionSanitization !== undefined) {
        this.ENABLE_TRANSITION_SANITIZATION =
          config.enableTransitionSanitization;
      }
    }
  }

  sanitizeExpression(expr: string): string {
    if (!expr || typeof expr !== 'string') {
      return "''";
    }
    let sanitized = expr
      .replace(/\s*\+\s*/g, '+')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s*\*\s*/g, '*')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s+/g, '') // Remove all remaining whitespace
      .trim();
    sanitized = sanitized
      .replace(/between\(/g, 'between(')
      .replace(/,/g, ',')
      .replace(/\)/g, ')')
      .replace(/if\(/g, 'if(');
    return `'${sanitized}'`;
  }

  /**
   * Generates a linear interpolation expression for FFmpeg
   */
  private generateInterpolationExpression(
    startVal: number,
    endVal: number,
    startTime: number,
    endTime: number,
    varName = 't',
  ): string {
    const duration = endTime - startTime;
    if (duration <= 0) return String(startVal.toFixed(3));

    // Expression: startVal + (endVal - startVal) * (t - startTime) / duration
    const range = endVal - startVal;
    if (Math.abs(range) < 0.001) return String(startVal.toFixed(3));

    // Output without spaces: a+(b)*(t-c)/d
    return `${startVal.toFixed(3)}+(${range.toFixed(3)})*(${varName}-${startTime.toFixed(3)})/${duration.toFixed(3)}`;
  }

  private getMediaTiming(media: any, cut: any = null) {
    try {
      if (cut) {
        const start = this.safeParseTime(cut.timelineStart, 0);
        const end =
          start +
          this.safeParseTime(
            (cut.end || 0) - (cut.start || 0),
            media.duration || 0,
          );

        if (end > start) return { start, end };
        return null;
      }

      const start = this.safeParseTime(media.startTime, 0);
      const dur = this.safeParseTime(media.duration, 3);
      const end = this.safeParseTime(media.endTime, start + dur);

      if (end > start) return { start, end };
      return null;
    } catch {
      return null;
    }
  }

  alignTransitionsBetweenMedia(mediaItems: any[], transitions: any[]): any[] {
    try {
      if (!Array.isArray(transitions) || transitions.length === 0) {
        this.logger.debug('No transitions provided');
        return [];
      }

      if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
        this.logger.warn('No media items provided');
        return [];
      }

      // Normalize + validate media
      const sortedMedia = mediaItems
        .map((item, index) => {
          try {
            const base = item.meta ? item.meta : item;
            return { ...base, _originalIndex: index };
          } catch (e) {
            throw new Error(
              `Failed to normalize media item at index ${index}: ${e.message}`,
            );
          }
        })
        .filter((m) => {
          if (!m) return false;
          if (m.type === 'text') return false;

          const valid =
            (typeof m.startTime === 'number' && !isNaN(m.startTime)) ||
            (typeof m.duration === 'number' && m.duration > 0);

          if (!valid) {
            this.logger.warn(
              `Media item at ${m._originalIndex} has invalid timing`,
            );
            return false;
          }
          return true;
        })
        .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

      if (sortedMedia.length < 2) {
        this.logger.warn('Not enough media items for transitions');
        return [];
      }

      const alignedTransitions: any[] = [];
      const usedTransitions = new Set<number>();

      /** Utility: locate media by cutId, handling multi-segment cuts */
      const findMediaWithCutId = (
        clipId: string,
        preferred: 'first' | 'last' = 'first',
      ) => {
        const matches = sortedMedia.filter(
          (m) => m.id === clipId || m._cutInfo?.cutId === clipId,
        );

        if (matches.length === 0) return null;

        // If multiple segments exist for the same cutId, pick the first or last one
        const match =
          preferred === 'first' ? matches[0] : matches[matches.length - 1];

        // If it's a segment, it already represents the timing we want if we pick first/last correctly
        return { media: match, cut: null };
      };

      /* --------------------------
       * 1) ID-based matching pass
       * ------------------------- */
      for (let i = 0; i < transitions.length; i++) {
        const tr = transitions[i];
        if (!tr.fromId || !tr.toId || usedTransitions.has(i)) continue;

        const from = findMediaWithCutId(tr.fromId, 'last');
        const to = findMediaWithCutId(tr.toId, 'first');
        if (!from || !to) continue;

        const fromTimes = this.getMediaTiming(from.media, from.cut);
        const toTimes = this.getMediaTiming(to.media, to.cut);

        if (!fromTimes || !toTimes) continue;

        const params = this.calculateTransitionParameters(
          tr,
          fromTimes.start,
          fromTimes.end,
          toTimes.start,
          toTimes.end,
          sortedMedia.indexOf(from.media),
        );

        if (params) {
          alignedTransitions.push(params);
          usedTransitions.add(i);
          this.logger.debug(
            `[Align] Aligned transition via IDs: ${tr.fromId} (${tr.type}) → ${tr.toId}`,
          );
        } else {
          this.logger.debug(
            `[Align] Found matching IDs but params failed for: ${tr.fromId} → ${tr.toId}`,
          );
        }
      }

      /* ------------------------------
       * 2) Timing-based fallback pass (Per-Track)
       * ----------------------------- */
      // Group media by zIndex (tracks)
      const tracks = new Map<number, any[]>();
      sortedMedia.forEach((m) => {
        const z = typeof m.zIndex === 'number' ? m.zIndex : 9999;
        if (!tracks.has(z)) tracks.set(z, []);
        tracks.get(z)!.push(m);
      });

      for (const [z, trackMedia] of tracks.entries()) {
        // Track media is already sorted by startTime because sortedMedia was
        for (let i = 0; i < trackMedia.length - 1; i++) {
          try {
            const m1 = trackMedia[i];
            const m2 = trackMedia[i + 1];

            const t1 = this.getMediaTiming(m1);
            const t2 = this.getMediaTiming(m2);

            if (!t1 || !t2) {
              // this.logger.debug(`Track ${z}: Skipping transition alignment: Invalid timing for media ${i} or ${i + 1}`);
              continue;
            }

            // this.logger.debug(`Track ${z}: Attempting to align transition between media ${i} (${t1.end}) and ${i + 1} (${t2.start})`);

            const tr = this.findBestTransitionMatch(
              transitions,
              t1.start,
              t1.end,
              t2.start,
              t2.end,
              usedTransitions,
            );

            if (!tr) continue;

            const index = transitions.indexOf(tr);
            usedTransitions.add(index);

            const params = this.calculateTransitionParameters(
              tr,
              t1.start,
              t1.end,
              t2.start,
              t2.end,
              sortedMedia.indexOf(m1), // Use global index for reference
            );

            if (params) {
              alignedTransitions.push(params);
              this.logger.debug(
                `Track ${z}: Aligned transition via timing between ${i} → ${i + 1}`,
              );
            }
          } catch (e) {
            this.logger.error(
              `Track ${z}: Error processing transition between media ${i} and ${i + 1}: ${e.message}`,
            );
          }
        }
      }

      this.logger.debug(
        `Aligned ${alignedTransitions.length} / ${transitions.length} transitions`,
      );
      return alignedTransitions;
    } catch (e) {
      this.logger.error(`Fatal transition error: ${e.message}`);
      return [];
    }
  }

  /**
   * Safely parses time values with fallback to default
   */
  private safeParseTime(timeValue: any, defaultValue: number): number {
    try {
      if (timeValue === null || timeValue === undefined) {
        return defaultValue;
      }

      if (typeof timeValue === 'number') {
        return isNaN(timeValue) ? defaultValue : Math.max(0, timeValue);
      }

      if (typeof timeValue === 'string') {
        const parsed = this.parseTimeToSeconds(timeValue);
        return parsed !== null ? Math.max(0, parsed) : defaultValue;
      }

      return defaultValue;
    } catch (error) {
      this.logger.warn(
        `Error parsing time value ${timeValue}: ${error.message}, using default ${defaultValue}`,
      );
      return defaultValue;
    }
  }

  /**
   * Finds the best matching transition for a media pair with improved tolerance
   */
  private findBestTransitionMatch(
    transitions: Transition[],
    currentStart: number,
    currentEnd: number,
    nextStart: number,
    nextEnd: number,
    used: Set<number>,
  ): Transition | null {
    try {
      const currentDuration = currentEnd - currentStart;
      const nextDuration = nextEnd - nextStart;
      const gap = Math.abs(nextStart - currentEnd);

      const avg = (currentDuration + nextDuration) / 2;

      const tolerance = Math.max(
        this.TRANSITION_BOUNDARY_TOLERANCE,
        Math.min(
          avg * this.ADAPTIVE_TOLERANCE_FACTOR,
          this.MAX_ADAPTIVE_TOLERANCE,
        ),
      );

      const minBoundary = Math.min(currentEnd, nextStart) - tolerance;
      const maxBoundary = Math.max(currentEnd, nextStart) + tolerance;

      const candidates: TransitionCandidate[] = [];

      transitions.forEach((tr, index) => {
        if (used.has(index)) return;

        try {
          const trStart = this.safeParseTime(tr.start, 0);
          const trDuration = this.safeParseTime(tr.duration, 1);

          if (trDuration <= 0) {
            // this.logger.debug(`Transition ${index} skipped: invalid duration`);
            return;
          }

          const trEnd = trStart + trDuration;

          // Relax boundary check: transition should start near junction OR end near junction
          // OR the junction should be inside the transition period [trStart, trEnd]
          const cutPoint = (currentEnd + nextStart) / 2;
          const junctionInTransition =
            cutPoint >= trStart - tolerance && cutPoint <= trEnd + tolerance;
          const fitsBoundary =
            junctionInTransition ||
            (trStart >= minBoundary && trStart <= maxBoundary);

          const available = Math.min(
            currentDuration,
            nextDuration,
            gap + Math.min(currentDuration, nextDuration),
          );
          const durationFits = trDuration <= available;

          if (!fitsBoundary) {
            // this.logger.debug(`Transition ${index} skipped: boundary mismatch (Start: ${trStart}, End: ${trEnd}, Junction: ${cutPoint})`);
            return;
          }
          if (!durationFits) {
            // this.logger.debug(`Transition ${index} skipped: duration too long`);
            return;
          }

          const boundaryDistance = Math.abs(
            trStart - (currentEnd + nextStart) / 2,
          );
          const durationFitScore =
            1 - Math.abs(trDuration - available) / available;

          const quality =
            (1 - boundaryDistance / tolerance) * 0.6 + durationFitScore * 0.4;

          // this.logger.debug(`Transition ${index} candidate: Quality ${quality}`);

          candidates.push({ transition: tr, index, quality });
        } catch {}
      });

      if (candidates.length === 0) return null;

      candidates.sort((a, b) => b.quality - a.quality);
      return candidates[0].transition;
    } catch {
      return null;
    }
  }

  /**
   * Calculates transition parameters with comprehensive validation
   */
  private calculateTransitionParameters(
    tr: Transition,
    currentStart: number,
    currentEnd: number,
    nextStart: number,
    nextEnd: number,
    mediaIndex: number,
  ): Transition | null {
    try {
      const duration = this.safeParseTime(tr.duration, 1);
      const type = (tr.type || 'fade').toLowerCase();

      if (!this.isSupportedTransition(type)) return null;

      const idealStart = Math.max(currentStart, currentEnd - duration);
      const start = Math.max(currentStart, idealStart);

      const currentAvailable = currentEnd - start;
      const nextAvailable = nextEnd - nextStart;

      const maxDuration = Math.min(currentAvailable, nextAvailable, duration);
      const finalDuration = Math.max(0.1, maxDuration);

      if (finalDuration <= 0 || start < currentStart) return null;

      return {
        ...tr,
        start,
        duration: finalDuration,
        offset: Math.max(0, start - currentStart),
        fromClip: { startTime: currentStart, endTime: currentEnd },
        toClip: { startTime: nextStart, endTime: nextEnd },
        _mediaIndex: mediaIndex,
        _qualityScore: 1.0,
      };
    } catch {
      return null;
    }
  }

  async createTinyBlackPng(): Promise<string> {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2iNQ8AAAAASUVORK5CYII=';
    const filePath = path.join(this.tmpDir, `black-${Date.now()}.png`);
    fs.writeFileSync(filePath, Buffer.from(pngBase64, 'base64'));
    return filePath;
  }

  /**
   * Resolves a media URL (Remote HTTP, Local Path, or Data URI) 
   * to a local file path that FFmpeg can read.
   * 
   * @param url - The media source.
   * @param useCache - If true, reuses previously downloaded/converted versions of the same URL.
   * @returns The absolute path to the local media file.
   */
  async downloadToTemp(
    url: string,
    useCache: boolean = false,
  ): Promise<string> {
    if (url.startsWith('data:')) {
      this.logger.debug(`[Base64] Detected data URI, saving to temp file...`);
      const matches = url.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 data URI');
      }

      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      let ext = '.bin';
      if (mimeType.includes('image/png')) ext = '.png';
      else if (mimeType.includes('image/jpeg')) ext = '.jpg';
      else if (mimeType.includes('image/gif')) ext = '.gif';
      else if (mimeType.includes('image/webp')) ext = '.webp';
      else if (mimeType.includes('video/mp4')) ext = '.mp4';
      else if (mimeType.includes('video/webm')) ext = '.webm';
      else if (mimeType.includes('audio/mpeg')) ext = '.mp3';
      else if (mimeType.includes('audio/wav')) ext = '.wav';

      const filename = `base64-${Date.now()}-${randomUUID()}${ext}`;
      const dest = path.join(this.tmpDir, filename);
      fs.writeFileSync(dest, buffer);
      
      this.logger.debug(`[Base64] Saved base64 media to: ${dest}`);
      return dest;
    }

    if (useCache) {
      const hash = createHash('md5').update(url).digest('hex');
      let ext = path.extname(url).split('?')[0];
      const filename = `cache-${hash}${ext || '.bin'}`;
      const dest = path.join(this.tmpDir, filename);

      if (fs.existsSync(dest)) {
        this.logger.debug(
          `[CACHE] Serving media from cache: ${url} -> ${dest}`,
        );
        return dest;
      }

      if (this.pendingDownloads.has(url)) {
        this.logger.debug(`[CACHE] Awaiting pending download for: ${url}`);
        return this.pendingDownloads.get(url)!;
      }

      const downloadPromise = (async () => {
        try {
          return await this.performDownload(url, dest);
        } finally {
          this.pendingDownloads.delete(url);
        }
      })();

      this.pendingDownloads.set(url, downloadPromise);
      return downloadPromise;
    }

    const filename = `${Date.now()}-${randomUUID()}${path.extname(url).split('?')[0] || '.bin'}`;
    const dest = path.join(this.tmpDir, filename);
    return this.performDownload(url, dest);
  }

  private async performDownload(url: string, dest: string): Promise<string> {
    // Bypass Cloudflare for internal processing by using the direct Backblaze endpoint
    let downloadUrl = url;
    if (url.includes('media.klipflow.com')) {
      downloadUrl = url.replace('media.klipflow.com', 'f005.backblazeb2.com');
    }

    this.logger.debug(
      `Downloading remote media to: url=${downloadUrl} dest=${dest}`,
    );
    const resp = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      },
    });

    let ext = path.extname(url).split('?')[0];
    if (!ext || ext === '') {
      const contentType = resp.headers['content-type'] || '';
      if (contentType.includes('image/jpeg')) ext = '.jpg';
      else if (contentType.includes('image/png')) ext = '.png';
      else if (contentType.includes('image/webp')) ext = '.webp';
      else if (contentType.includes('image/gif')) ext = '.gif';
      else if (contentType.includes('video/mp4')) ext = '.mp4';
      else if (contentType.includes('video/webm')) ext = '.webm';
      else ext = '.bin';
    }

    // If we're performing a cached download but the extension was wrong, we might want to rename,
    // but for simplicity we'll just trust the initial extension or .bin for now.
    // However, if the destination already exists (due to race condition that passed fs.existsSync), we return it.
    if (fs.existsSync(dest)) return dest;

    const writer = fs.createWriteStream(dest);
    await new Promise<void>((res, rej) => {
      resp.data.pipe(writer);
      writer.on('error', (err) => {
        this.logger.error(`Error writing file: ${err.message}`);
        rej(err);
      });
      writer.on('close', () => {
        if (!fs.existsSync(dest)) {
          rej(new Error('Downloaded file does not exist'));
          return;
        }
        const stats = fs.statSync(dest);
        if (stats.size === 0) {
          rej(new Error('Downloaded file is empty'));
          return;
        }
        this.logger.debug(`Download complete: ${dest} (${stats.size} bytes)`);
        res();
      });
    });
    return dest;
  }

  async hasAudioStream(localPath: string): Promise<boolean> {
    const cacheKey = `hasAudio:${localPath}`;
    if (this.metadataCache.has(cacheKey))
      return this.metadataCache.get(cacheKey);

    // Concurrency control for same path
    if (this.pendingProbes.has(localPath))
      return this.pendingProbes.get(localPath)!;

    const probePromise = new Promise<boolean>((resolve) => {
      // Use execFile for lightweight probing avoiding full JSON parsing overhead
      // Flags:
      // -v error: suppress logs
      // -select_streams a: only look for audio streams
      // -show_entries: only show codec_type to confirm existence
      // -of default=noprint_wrappers=1:nokey=1: minimal output format
      const { execFile } = require('child_process');

      // Determine ffprobe path (trying to match service detection logic or use system default)
      // Since we don't have easy access to the service's detected path here without injection,
      // we'll rely on what fluent-ffmpeg uses or system 'ffprobe'.
      // A safer bet is to use the same logic or just assume 'ffprobe' is in PATH if standard,
      // but let's try to grab it from fluent-ffmpeg if possible, or fallback.
      // Actually, simplest is to use fluent-ffmpeg's set path if available, but accessing it is hard.
      // We will loop back to fluent-ffmpeg BUT use .ffprobe with custom arguments if possible?
      // No, fluent-ffmpeg .ffprobe() is a wrapper.

      // OPTIMIZATION: Just run a targeted ffprobe command.
      // We'll assume 'ffprobe' is available or use the env var if we could pass it.
      // For now, let's keep using ffmpeg() but trust the frontend metadata more (handled in service).
      // AND optimize the probe options here even further.

      ffmpeg(localPath)
        .inputOptions([
          '-probesize',
          '10M',
          '-analyzeduration',
          '10M',
          '-v',
          'error',
          '-select_streams',
          'a',
          '-show_entries',
          'stream=codec_type',
        ])
        .ffprobe((err, data) => {
          // If we get any stream info back, it means there's audio because we selected '-select_streams a'
          // However, fluent-ffmpeg's ffprobe might ignore some inputOptions or parse differently.
          // Let's stick to the previous robust method but keep the optimized flags.
          if (err || !data || !data.streams || data.streams.length === 0) {
            resolve(false);
          } else {
            const hasAudio = data.streams.some((s) => s.codec_type === 'audio');
            resolve(hasAudio);
          }
        });
    });

    this.pendingProbes.set(localPath, probePromise);
    try {
      const result = await probePromise;
      this.metadataCache.set(cacheKey, result);
      return result;
    } finally {
      this.pendingProbes.delete(localPath);
    }
  }

  async createSubtitleFile(srtContent: string, options?: any): Promise<string> {
    const filename = `subtitles-${Date.now()}-${randomUUID()}.srt`;
    const subtitlePath = path.join(this.tmpDir, filename);
    fs.writeFileSync(subtitlePath, srtContent, 'utf8');
    this.logger.debug(`Created subtitle file: ${subtitlePath}`);
    return subtitlePath;
  }

  async createAdvancedSubtitleFile(
    srtContent: string,
    options: any,
  ): Promise<string> {
    const filename = `subtitles-${Date.now()}-${randomUUID()}.ass`;
    const subtitlePath = path.join(this.tmpDir, filename);

    // Handle both \r\n\r\n and \n\n separators
    const blocks = srtContent.trim().split(/\r?\n\r?\n/);

    const normalizeAspectRatio = (ratio?: string): string => {
      if (!ratio) return '16/9';
      return ratio.replace(':', '/');
    };

    const aspectRatio = normalizeAspectRatio(options?.aspectRatio);

    const hexToAss = (hex?: string, forceOpaque = false): string | null => {
      if (!hex || hex === 'none') return null;
      let clean = hex.startsWith('#') ? hex.slice(1) : hex;

      // Expand shorthand #FFF -> #FFFFFF
      if (clean.length === 3) {
        clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
      }

      let a = '00';
      let r = 'FF';
      let g = 'FF';
      let b = 'FF';

      if (clean.length === 8) {
        // RRGGBBAA (standard web)
        r = clean.slice(0, 2);
        g = clean.slice(2, 4);
        b = clean.slice(4, 6);
        const alphaHex = clean.slice(6, 8);
        const alphaInt = parseInt(alphaHex, 16);
        const assAlpha = 255 - alphaInt;
        a = assAlpha.toString(16).padStart(2, '0').toUpperCase();
      } else if (clean.length === 6) {
        r = clean.slice(0, 2);
        g = clean.slice(2, 4);
        b = clean.slice(4, 6);
      } else {
        return null;
      }

      if (forceOpaque) a = '00';
      return `&H${a}${b}${g}${r}&`;
    };

    const alignment = (pos?: string): number => {
      const map: Record<string, number> = {
        top: 8,
        'top-left': 7,
        'top-right': 9,
        center: 5,
        bottom: 2,
        'bottom-left': 1,
        'bottom-right': 3,
      };
      return map[pos ?? ''] ?? 2;
    };

    const styleName = 'Default';
    const font = options?.fontName ?? 'Arial';
    const size = options?.fontSize ?? 24;

    const colors = {
      primary: hexToAss(options?.primaryColor) || '&H00FFFFFF&',
      secondary: hexToAss(options?.secondaryColor) || '&H00AAAAAA&',
      outline: hexToAss(options?.outlineColor) || '&H00000000&',
      shadow: hexToAss(options?.shadowColor) || '&H64000000&', // Default 40% black shadow
      highlight:
        hexToAss(options?.karaokeHighlightedColor || options?.highlightColor) ||
        '&H0000FFFF&',
    };

    const outline = options?.outlineWidth ?? 0;
    const shadow = options?.shadowDepth ?? 1;
    const align = alignment(options?.position);
    const marginV = options?.marginV ?? 10;

    const borderStyle = 1;
    const backColor = hexToAss(options?.shadowColor) || '&H64000000&';
    const boxOutlineColor = colors.outline;

    const buildHeader = () => `[Script Info]
Title: Advanced Subtitles
ScriptType: v4.00+
WrapStyle: 1
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${styleName},${font},${size},${colors.primary},${colors.secondary},${boxOutlineColor},${backColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${align},10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const maxChars =
      aspectRatio === '9/16' ? 22 : aspectRatio === '1/1' ? 35 : 60;

    let globalWordIndex = 0;
    const globalWords = options?.words || [];

    const convertLineToDialogue = (block: string): string => {
      const lines = block.trim().split(/\r?\n/);
      if (lines.length < 3) return '';

      const timeline = lines[1];
      const rawText = lines.slice(2).join(' ').trim();

      const match = timeline.match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/,
      );
      if (!match) return '';

      const totalStart = this.srtTimeToAssTime(match.slice(1, 5));
      const totalEnd = this.srtTimeToAssTime(match.slice(5, 9));

      // 🔹 DYNAMIC SEGMENTATION 🔹
      const wordsArray = rawText.split(/\s+/);
      const segments: {
        text: string;
        start: number;
        end: number;
        exactWords?: any[];
      }[] = [];
      let currentWords: string[] = [];
      let currentExactWords: any[] = [];
      let currentLength = 0;

      wordsArray.forEach((word) => {
        let matchedTiming = null;
        if (globalWords.length > 0 && globalWordIndex < globalWords.length) {
          const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          for (
            let k = 0;
            k < Math.min(5, globalWords.length - globalWordIndex);
            k++
          ) {
            const gw = globalWords[globalWordIndex + k];
            if (!gw?.text) continue;
            const cleanGlobal = gw.text
              .replace(/[^a-zA-Z0-9]/g, '')
              .toLowerCase();
            if (
              cleanWord === cleanGlobal ||
              cleanGlobal.includes(cleanWord) ||
              cleanWord.includes(cleanGlobal)
            ) {
              matchedTiming = { ...gw, text: word };
              globalWordIndex += k + 1;
              break;
            }
          }
        }

        const wordLen = word.length + (currentWords.length > 0 ? 1 : 0);
        if (currentLength + wordLen > maxChars && currentWords.length > 0) {
          segments.push({
            text: currentWords.join(' '),
            start: 0,
            end: 0,
            exactWords:
              currentExactWords.length > 0 ? [...currentExactWords] : undefined,
          });
          currentWords = [word];
          currentExactWords = matchedTiming ? [matchedTiming] : [];
          currentLength = word.length;
        } else {
          currentWords.push(word);
          if (matchedTiming) currentExactWords.push(matchedTiming);
          currentLength += wordLen;
        }
      });
      if (currentWords.length > 0) {
        segments.push({
          text: currentWords.join(' '),
          start: 0,
          end: 0,
          exactWords:
            currentExactWords.length > 0 ? [...currentExactWords] : undefined,
        });
      }

      // Distribute time
      const totalChars = segments.reduce((acc, s) => acc + s.text.length, 0);
      const totalDuration = totalEnd - totalStart;
      let runningStart = totalStart;

      segments.forEach((seg, i) => {
        if (seg.exactWords && seg.exactWords.length > 0) {
          seg.start = seg.exactWords[0].start;
          seg.end = seg.exactWords[seg.exactWords.length - 1].end;
          // Fallback bounds if off by rounding
          if (seg.start < totalStart) seg.start = totalStart;
          if (seg.end > totalEnd) seg.end = totalEnd;
        } else {
          seg.start = runningStart;
          if (i === segments.length - 1) {
            seg.end = totalEnd;
          } else {
            const ratio = seg.text.length / totalChars;
            seg.end = runningStart + totalDuration * ratio;
          }
        }
        runningStart = seg.end;
      });

      let dialogues = '';
      const preset = options?.animationPreset;

      segments.forEach((seg) => {
        const { text, start, end, exactWords } = seg;

        if (preset === 'word-highlight') {
          dialogues += this.buildWordHighlightDialogue(
            start,
            end,
            text,
            colors,
            styleName,
            exactWords,
          );
        } else if (preset === 'pop-in') {
          dialogues += this.buildPopInDialogue(
            start,
            end,
            text,
            colors,
            styleName,
            exactWords,
          );
        } else if (preset === 'word-pop') {
          dialogues += this.buildWordPopDialogue(
            start,
            end,
            text,
            colors,
            styleName,
            exactWords,
          );
        } else if (preset === 'typewriter') {
          dialogues += this.buildTypewriterDialogue(
            start,
            end,
            text,
            styleName,
          );
        } else if (options?.enableKaraoke) {
          dialogues += this.buildWordHighlightDialogue(
            start,
            end,
            text,
            colors,
            styleName,
            exactWords,
          );
        } else {
          dialogues += `Dialogue: 0,${this.assTimeToString(start)},${this.assTimeToString(end)},${styleName},,0,0,0,,${text}\n`;
        }
      });

      return dialogues;
    };

    // Combine everything
    let assFile = buildHeader();
    blocks.forEach((block) => (assFile += convertLineToDialogue(block)));

    fs.writeFileSync(subtitlePath, assFile, 'utf8');
    this.logger.debug(`Created advanced subtitle file: ${subtitlePath}`);

    return subtitlePath;
  }

  buildWordHighlightDialogue(
    start: number,
    end: number,
    text: string,
    colors: any,
    styleName: string,
    exactWords?: any[],
  ): string {
    const words = text.split(/\s+/);
    const avgDuration = (end - start) / words.length;

    let result = '';

    words.forEach((word, i) => {
      let dur = Math.round(avgDuration * 100);
      if (exactWords && exactWords.length > i && i < exactWords.length - 1) {
        dur = Math.round((exactWords[i + 1].start - exactWords[i].start) * 100);
      } else if (
        exactWords &&
        exactWords.length > i &&
        i === exactWords.length - 1
      ) {
        dur = Math.round((end - exactWords[i].start) * 100);
      }

      dur = Math.max(1, dur); // Ensure positive duration

      result += `{\\2c${colors.primary}\\1c${colors.highlight}\\kf${dur}}${word}{\\1c${colors.primary}\\2c${colors.primary}}`;
      if (i < words.length - 1) result += ' ';
    });

    return `Dialogue: 0,${this.assTimeToString(start)},${this.assTimeToString(end)},${styleName},,0,0,0,,${result}\n`;
  }

  buildPopInDialogue(
    start: number,
    end: number,
    text: string,
    colors: any,
    styleName: string,
    exactWords?: any[],
  ): string {
    const words = text.split(/\s+/);
    const totalDuration = end - start;
    const avgDuration = totalDuration / words.length;

    let assText = '';
    let currentTimeMs = 0; // Relative to `start` by default

    words.forEach((word, i) => {
      let wordStartMs = currentTimeMs;

      if (exactWords && exactWords.length > i) {
        wordStartMs = (exactWords[i].start - start) * 1000;
      }

      wordStartMs = Math.max(0, wordStartMs);
      const wordEndMs = wordStartMs + 250; // 250ms pop animation

      const highlight = colors.highlight ? `\\1c${colors.highlight}` : '';
      const reset = `\\1c${colors.primary}`;

      assText += `{\\alpha&HFF&${highlight}\\t(${Math.round(wordStartMs)},${Math.round(wordEndMs)},\\alpha&H00&\\fscy130)\\t(${Math.round(wordEndMs)},${Math.round(wordEndMs + 120)},\\fscy100)${reset}}${word} `;

      if (!exactWords) {
        currentTimeMs += avgDuration * 1000;
      }
    });

    return `Dialogue: 0,${this.assTimeToString(start)},${this.assTimeToString(end)},${styleName},,0,0,0,,${assText.trim()}\n`;
  }

  buildWordPopDialogue(
    start: number,
    end: number,
    text: string,
    colors: any,
    styleName: string,
    exactWords?: any[],
  ): string {
    const words = text.split(/\s+/);
    const avgDuration = (end - start) / words.length;

    let dialogues = '';
    let currentStart = start;

    words.forEach((word, i) => {
      let wStart = currentStart;
      let wEnd = currentStart + avgDuration;

      if (exactWords && exactWords.length > i) {
        wStart = exactWords[i].start;
        wEnd = i < exactWords.length - 1 ? exactWords[i + 1].start : end;
      }

      wEnd = Math.max(wStart + 0.1, wEnd);

      const effect = `{\\fscx80\\fscy80\\t(0,200,\\fscx100\\fscy100)}`;
      dialogues += `Dialogue: 0,${this.assTimeToString(wStart)},${this.assTimeToString(wEnd)},${styleName},,0,0,0,,${effect}${word}\n`;

      if (!exactWords) {
        currentStart = wEnd;
      }
    });

    return dialogues;
  }

  buildTypewriterDialogue(
    start: number,
    end: number,
    text: string,
    styleName: string,
  ): string {
    const chars = text.split('');
    const charDuration = (end - start) / chars.length;

    let result = '';
    let currentOffset = 0;

    chars.forEach((char) => {
      const startMs = Math.round(currentOffset * 1000);
      result += `{\\alpha&HFF&\\t(${startMs},${startMs + 50},\\alpha&H00&)}${char}`;
      currentOffset += charDuration;
    });

    return `Dialogue: 0,${this.assTimeToString(start)},${this.assTimeToString(end)},${styleName},,0,0,0,,${result}\n`;
  }

  srtTimeToAssTime(timeParts: string[]): number {
    const [hours, minutes, seconds, milliseconds] = timeParts.map(Number);
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  assTimeToString(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centiseconds = Math.floor((seconds % 1) * 100);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }

  parseTimeToSeconds(
    timeLike: string | number | undefined | null,
  ): number | null {
    if (timeLike === undefined || timeLike === null) return null;
    if (typeof timeLike === 'number' && isFinite(timeLike)) return timeLike;
    const s = String(timeLike).trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[\.,](\d{1,3}))?$/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3], 10);
    const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
    return hh * 3600 + mm * 60 + ss + ms / 1000;
  }

  // Removed unused buildTransition method. Cross-clip transitions are handled by
  // createCrossfadeTransition and createCrossfadeTransitionWithPositioning.

  isSupportedTransition(name: string): boolean {
    return this.SUPPORTED_TRANSITIONS.has(name.toLowerCase());
  }

  /**
   * Gets the current transition alignment tolerance value
   * @returns The alignment tolerance in seconds
   */
  getTransitionAlignmentTolerance(): number {
    return this.TRANSITION_ALIGNMENT_TOLERANCE;
  }

  extractDetailedError(
    stderrOutput: string[],
    originalError: Error,
  ): { message: string; isRetryable: boolean } {
    // Collect all lines that look like actual errors
    const errorLines: string[] = [];
    const filterTagRegex = /\[([^@]+) @ [a-zA-Z0-9]+\]/;

    // Detailed patterns for retryable network errors
    const retryablePatterns = [
      'will reconnect',
      'end of file',
      'connection reset',
      'http error',
      'timeout',
      'tls error',
      'socket error',
    ];

    let isRetryable = false;

    for (const line of stderrOutput) {
      const lowerLine = line.toLowerCase();
      const isError =
        lowerLine.includes('error') ||
        lowerLine.includes('invalid') ||
        lowerLine.includes('failed') ||
        lowerLine.includes('unable to') ||
        lowerLine.includes('not found') ||
        retryablePatterns.some((p) => lowerLine.includes(p));

      if (isError && line.trim().length > 0) {
        errorLines.push(line.trim());
        if (retryablePatterns.some((p) => lowerLine.includes(p))) {
          isRetryable = true;
        }
      }
    }

    // If we found specific error lines, try to return the most relevant one
    if (errorLines.length > 0) {
      // Prioritize the last error line as it's often the most specific
      // but also prioritize lines that have a filter tag
      const taggedErrors = errorLines.filter((l) => filterTagRegex.test(l));
      const message =
        taggedErrors.length > 0
          ? taggedErrors[taggedErrors.length - 1]
          : errorLines[errorLines.length - 1];

      return { message: `FFmpeg Error: ${message}`, isRetryable };
    }

    // Fallback: search for filter headers even if they don't explicitly say "error"
    // (Sometimes FFmpeg just stops after printing the filter tag)
    for (let i = stderrOutput.length - 1; i >= 0; i--) {
      const line = stderrOutput[i];
      if (line.includes('Parsed_ass_') || line.includes('Parsed_subtitles_')) {
        // Look 2 lines ahead for a message
        const context = stderrOutput
          .slice(i, i + 3)
          .join(' ')
          .trim();
        return { message: `FFmpeg Subtitle Error: ${context}`, isRetryable };
      }
    }

    // Generic meaningful line extraction
    const meaningfulLines = stderrOutput.filter(
      (line) =>
        line.trim().length > 0 &&
        !line.includes('frame=') &&
        !line.includes('fps=') &&
        !line.includes('bitrate=') &&
        !line.includes('time=') &&
        !line.includes('speed=') &&
        !line.includes('size='),
    );

    if (meaningfulLines.length > 0) {
      // Return the last two lines joined for context
      const lastFew = meaningfulLines.slice(-2).join(' | ').trim();
      return { message: `FFmpeg Error: ${lastFew}`, isRetryable };
    }

    return {
      message: originalError?.message || 'An unknown FFmpeg error occurred.',
      isRetryable: false,
    };
  }

  buildSubtitleStyle(options: any = {}): string {
    const defaults = {
      fontName: 'Arial',
      fontSize: 24,
      primaryColor: '&HFFFFFF&',
      outlineColor: '&H000000&',
      outlineWidth: 0,
      shadowColor: '&H000000&',
      shadowDepth: 1,
      alignment: 2, // bottom-center
    };

    const hexToAssColor = (hex?: string): string => {
      if (!hex || !hex.startsWith('#')) return hex ?? '';
      const clean = hex.replace('#', '');
      if (clean.length !== 6) return hex;

      const r = clean.slice(0, 2);
      const g = clean.slice(2, 4);
      const b = clean.slice(4, 6);
      return `&H${b}${g}${r}&`;
    };

    const getAlignment = (pos?: string): number => {
      const map: Record<string, number> = {
        top: 8,
        'top-left': 7,
        'top-right': 9,
        center: 5,
        bottom: 2,
        'bottom-left': 1,
        'bottom-right': 3,
      };
      return map[pos ?? ''] ?? defaults.alignment;
    };

    // Merge user options with defaults
    const merged = {
      ...defaults,
      ...options,
      primaryColor:
        hexToAssColor(options.primaryColor) || defaults.primaryColor,
      outlineColor:
        hexToAssColor(options.outlineColor) || defaults.outlineColor,
      shadowColor: hexToAssColor(options.shadowColor) || defaults.shadowColor,
      alignment: getAlignment(options.position),
    };

    return [
      `FontName=${merged.fontName}`,
      `FontSize=${merged.fontSize}`,
      `PrimaryColour=${merged.primaryColor}`,
      `OutlineColour=${merged.outlineColor}`,
      `OutlineWidth=${merged.outlineWidth}`,
      `ShadowColour=${merged.shadowColor}`,
      `ShadowDepth=${merged.shadowDepth}`,
      `Alignment=${merged.alignment}`,
    ].join(',');
  }

  // Build visual effects chain for a video stream (applied after scale)
  buildVisualEffects(meta: any): string {
    if (!meta) return '';

    const fx: string[] = [];
    const interp = meta._interpolation;
    const isLinear = interp?.type === 'linear';

    // Helpers
    const getNum = (v: any, fallback = NaN) =>
      v === undefined || v === null ? fallback : Number(v);

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));

    // Extract values
    const brightness = getNum(meta.brightness);
    const contrast = getNum(meta.contrast);
    const saturation = getNum(meta.saturation);
    const hue = getNum(meta.hue);
    const blur = getNum(meta.blur);
    const sharpen = getNum(meta.sharpen);
    const rotate = getNum(meta.rotate);
    const grayscale = getNum(meta.grayscale);
    const sepia = getNum(meta.sepia);
    const invert = getNum(meta.invert);

    const flipH = !!meta?.flipH;
    const flipV = !!meta?.flipV;

    // -----------------------------------------
    // 🔹 SATURATION + GRAYSCALE handling
    // -----------------------------------------

    let finalSaturation = 1.0;
    const hasSaturation = !Number.isNaN(saturation) && saturation !== 100;
    const hasGrayscale = !Number.isNaN(grayscale) && grayscale > 0;

    if (hasSaturation || hasGrayscale) {
      const grayFactor = hasGrayscale ? clamp(grayscale, 0, 100) / 100 : 0;
      const baseSat = hasSaturation ? saturation / 100 : 1.0;
      finalSaturation = baseSat * (1 - grayFactor);
    }

    // -----------------------------------------
    // 🔹 EQ FILTER: brightness, contrast, saturation
    // -----------------------------------------

    const eq: string[] = [];

    if (isLinear) {
      // Interpolated EQ parameters
      const nextBrightness = getNum(interp.nextValues.brightness, brightness);
      const nextContrast = getNum(interp.nextValues.contrast, contrast);
      const nextSaturation = getNum(interp.nextValues.saturation, saturation);
      const nextGrayscale = getNum(interp.nextValues.grayscale, grayscale);

      if (
        !Number.isNaN(brightness) &&
        (!Number.isNaN(nextBrightness) || brightness !== 100)
      ) {
        const bStart = clamp((brightness - 100) / 100, -1.0, 1.0);
        const bEnd = clamp((nextBrightness - 100) / 100, -1.0, 1.0);
        const bInterp = this.generateInterpolationExpression(
          bStart,
          bEnd,
          interp.segStart,
          interp.segEnd,
        );
        eq.push(`brightness=${bInterp}`);
      }

      if (
        !Number.isNaN(contrast) &&
        (!Number.isNaN(nextContrast) || contrast !== 100)
      ) {
        const cStart = clamp(contrast / 100, 0.0, 2.0);
        const cEnd = clamp(nextContrast / 100, 0.0, 2.0);
        const cInterp = this.generateInterpolationExpression(
          cStart,
          cEnd,
          interp.segStart,
          interp.segEnd,
        );
        eq.push(`contrast=${cInterp}`);
      }

      // Saturation needs to account for grayscale in interpolation too
      const sStartVal = hasSaturation ? saturation : 100;
      const sEndVal = !Number.isNaN(nextSaturation)
        ? nextSaturation
        : sStartVal;

      const gStartVal = hasGrayscale ? grayscale : 0;
      const gEndVal = !Number.isNaN(nextGrayscale) ? nextGrayscale : gStartVal;

      const satStart = (sStartVal / 100) * (1 - clamp(gStartVal, 0, 100) / 100);
      const satEnd = (sEndVal / 100) * (1 - clamp(gEndVal, 0, 100) / 100);

      if (Math.abs(satStart - 1.0) > 0.001 || Math.abs(satEnd - 1.0) > 0.001) {
        const sInterp = this.generateInterpolationExpression(
          satStart,
          satEnd,
          interp.segStart,
          interp.segEnd,
        );
        eq.push(`saturation=${sInterp}`);
      }
    } else {
      if (!Number.isNaN(brightness) && brightness !== 100) {
        eq.push(
          `brightness=${clamp((brightness - 100) / 100, -1.0, 1.0).toFixed(2)}`,
        );
      }

      if (!Number.isNaN(contrast) && contrast !== 100) {
        eq.push(`contrast=${clamp(contrast / 100, 0.0, 2.0).toFixed(2)}`);
      }

      if (Math.abs(finalSaturation - 1.0) > 0.001) {
        eq.push(`saturation=${clamp(finalSaturation, 0.0, 2.0).toFixed(2)}`);
      }
    }

    if (eq.length) fx.push(`eq=${eq.join(':')}`);

    // -----------------------------------------
    // 🔹 HUE, FLIP, ROTATE, BLUR, SHARPEN
    // -----------------------------------------

    if (isLinear) {
      const nextHue = getNum(interp.nextValues.hue, hue);
      if (!Number.isNaN(hue) && (!Number.isNaN(nextHue) || hue !== 0)) {
        const hInterp = this.generateInterpolationExpression(
          hue,
          nextHue,
          interp.segStart,
          interp.segEnd,
        );
        fx.push(`hue=h=${hInterp}`);
      }
    } else {
      if (!Number.isNaN(hue) && hue !== 0) fx.push(`hue=h=${hue}`);
    }

    if (flipH) fx.push('hflip');
    if (flipV) fx.push('vflip');

    if (isLinear) {
      const nextRotate = getNum(interp.nextValues.rotate, rotate);

      // Check if rotation is actually non-zero
      // If start and end are 0, we should SKIP this filter to avoid locking resolution
      if (
        !Number.isNaN(rotate) &&
        !Number.isNaN(nextRotate) &&
        (Math.abs(rotate) > 0.01 || Math.abs(nextRotate) > 0.01)
      ) {
        const radStart = (rotate * Math.PI) / 180;
        const radEnd = (nextRotate * Math.PI) / 180;
        const rInterp = this.generateInterpolationExpression(
          radStart,
          radEnd,
          interp.segStart,
          interp.segEnd,
        );
        // Note: rotate filter OW/OH parameters usually don't support 't' easily if they affect buffer size,
        // but here we are using fixed OW/OH based on the start point for now or we might need a better strategy.
        // Actually, FFmpeg rotate OW/OH *can* use expressions but if they change every frame it's weird.
        // We'll use the maximum required size for the segment.
        const maxRad = Math.max(Math.abs(radStart), Math.abs(radEnd));
        fx.push(
          `rotate=${rInterp}:c=none:ow='rotw(${maxRad.toFixed(3)})':oh='roth(${maxRad.toFixed(3)})'`,
        );
      }
    } else if (!Number.isNaN(rotate) && Math.abs(rotate) > 0.01) {
      // Convert degrees to radians for FFmpeg rotate filter
      const radians = (rotate * Math.PI) / 180;
      // Use fillcolor for transparency and don't expand output size
      // Reduced precision from 4 to 3 decimals
      fx.push(
        `rotate=${radians.toFixed(3)}:c=none:ow='rotw(${radians.toFixed(3)})':oh='roth(${radians.toFixed(3)})'`,
      );
    }

    if (!Number.isNaN(blur) && blur > 0) {
      // Fast blur: downscale to 1/4 resolution, apply boxblur, upscale back.
      // boxblur at low-res is ~8x faster than full-res gblur with no perceptible quality difference
      // since the output is blurred anyway. sigma maps to boxblur radius (1 sigma ≈ 1px radius).
      const blurRadius = Math.round(clamp(blur, 1, 20));
      fx.push(
        `scale=iw/4:ih/4:flags=fast_bilinear,boxblur=${blurRadius}:${blurRadius},scale=4*iw:4*ih:flags=fast_bilinear`,
      );
    }

    if (!Number.isNaN(sharpen) && sharpen > 0) {
      const amount = ((clamp(sharpen, 0, 100) / 100) * 2).toFixed(2);
      // 5x5 kernel is 2x faster than 7x7 with no perceptible difference at normal sharpening amounts
      fx.push(`unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${amount}`);
    }

    // -----------------------------------------
    // 🔹 SEPIA
    // -----------------------------------------

    if (!Number.isNaN(sepia) && sepia > 0) {
      const t = clamp(sepia, 0, 100) / 100;

      // Standard sepia tone matrix (matches CSS sepia filter)
      // These are the standard sepia coefficients
      const rr = 0.393 + (1 - 0.393) * (1 - t);
      const rg = 0.769 - 0.769 * (1 - t);
      const rb = 0.189 - 0.189 * (1 - t);

      const gr = 0.349 - 0.349 * (1 - t);
      const gg = 0.686 + (1 - 0.686) * (1 - t);
      const gb = 0.168 - 0.168 * (1 - t);

      const br = 0.272 - 0.272 * (1 - t);
      const bg = 0.534 - 0.534 * (1 - t);
      const bb = 0.131 + (1 - 0.131) * (1 - t);

      // Reduced precision from 3 to 2 decimals
      fx.push(
        `colorchannelmixer=${rr.toFixed(2)}:${rg.toFixed(2)}:${rb.toFixed(2)}:${gr.toFixed(2)}:${gg.toFixed(2)}:${gb.toFixed(2)}:${br.toFixed(2)}:${bg.toFixed(2)}:${bb.toFixed(2)}`,
      );
    }

    // -----------------------------------------
    // 🔹 INVERT
    // -----------------------------------------

    if (!Number.isNaN(invert) && invert > 0) {
      const t = clamp(invert, 0, 100) / 100;

      if (t === 1) {
        // Full invert: negate is the fastest possible path
        fx.push('negate');
      } else {
        // Partial invert: use lut (lookup table) instead of geq.
        // lut builds a 256-entry table ONCE at startup then does O(1) per pixel.
        // geq runs a script interpreter per-pixel per-frame (~50x slower).
        // Formula: val*(1-t) + (255-val)*t  =  val - 2*val*t + 255*t
        const tFixed = t.toFixed(4);
        fx.push(
          `lut=r='val*(1-${tFixed})+(255-val)*${tFixed}':g='val*(1-${tFixed})+(255-val)*${tFixed}':b='val*(1-${tFixed})+(255-val)*${tFixed}'`,
        );
      }
    }

    const filterString = fx.join(',');

    return filterString;
  }

  /**
   * Builds chroma key (green screen) filter using FFmpeg's colorkey filter.
   * Should be applied after scaling but before rounded corners and padding.
   * @param inputLabel - Input stream label (e.g., "[scaled0]")
   * @param outputLabel - Output stream label (e.g., "[chroma0]")
   * @param meta - Media metadata containing chromaKey configuration
   * @returns FFmpeg filter string or null if chroma key is not enabled
   */
  buildChromaKeyFilter(
    inputLabel: string,
    outputLabel: string,
    meta: any,
  ): string | null {
    // Check if chroma key is enabled - support both greenScreenEnabled and chromaKeyEnabled
    const chromaKeyEnabled =
      meta?.greenScreenEnabled ||
      meta?.chromaKeyEnabled ||
      meta?.chromaKey?.enabled;
    if (!chromaKeyEnabled) {
      return null;
    }

    // Parse color - support hex string (e.g., "#00FF00", "0x00FF00", "00FF00") or RGB object
    // Check greenScreenColor first (actual property name), then chromaKey.color
    let colorHex = '0x00FF00'; // Default green
    const colorValue =
      meta?.greenScreenColor || meta?.chromaKey?.color || meta?.chromaKeyColor;

    if (colorValue) {
      if (typeof colorValue === 'string') {
        // Remove # if present, add 0x prefix if not present
        colorHex = colorValue.replace(/^#/, '').replace(/^0x/i, '');
        if (!colorHex.startsWith('0x')) {
          colorHex = `0x${colorHex}`;
        }
      } else if (typeof colorValue === 'object' && colorValue.r !== undefined) {
        // RGB object {r, g, b} - convert to hex
        const r = Math.max(0, Math.min(255, Math.round(colorValue.r)))
          .toString(16)
          .padStart(2, '0');
        const g = Math.max(0, Math.min(255, Math.round(colorValue.g)))
          .toString(16)
          .padStart(2, '0');
        const b = Math.max(0, Math.min(255, Math.round(colorValue.b)))
          .toString(16)
          .padStart(2, '0');
        colorHex = `0x${r}${g}${b}`;
      }
    }

    // Similarity (tolerance) - default 0.3, range 0.0 to 1.0
    // Check greenScreenSimilarity first (actual property name)
    const similarity = Math.max(
      0.0,
      Math.min(
        1.0,
        Number(
          meta?.greenScreenSimilarity ??
            meta?.chromaKey?.similarity ??
            meta?.chromaKeySimilarity ??
            0.3,
        ),
      ),
    );

    // Blend (opacity control) - default 0.2, range 0.0 to 1.0
    // Lower values = harder edge, higher values = softer edge
    // Check greenScreenBlend first (actual property name)
    const blend = Math.max(
      0.0,
      Math.min(
        1.0,
        Number(
          meta?.greenScreenBlend ??
            meta?.chromaKey?.blend ??
            meta?.chromaKeyBlend ??
            0.2,
        ),
      ),
    );

    // Clean input label - remove brackets if present, then add them back
    const cleanInputLabel = inputLabel.replace(/[\[\]]/g, '');
    const filterString = `[${cleanInputLabel}]colorkey=${colorHex}:${similarity.toFixed(3)}:${blend.toFixed(3)}[${outputLabel}]`;

    this.logger.debug(
      `Chroma key filter: enabled=${chromaKeyEnabled}, color=${colorHex}, similarity=${similarity}, blend=${blend}`,
    );

    return filterString;
  }

  /**
   * Builds rounded corners filter using a mask-based approach.
   * Should be applied after visual effects but before padding.
   * @param inputLabel - Input stream label (e.g., "[scaled0]")
   * @param outputLabel - Output stream label (e.g., "[rounded0]")
   * @param meta - Media metadata containing roundedCorners value
   * @param width - Width of the media (after scaling)
   * @param height - Height of the media (after scaling)
   * @returns FFmpeg filter string or null if roundedCorners is 0
   */
  buildRoundedCornersFilter(
    inputLabel: string,
    outputLabel: string,
    meta: any,
    width: number | string,
    height: number | string,
  ): string | null {
    const interp = meta._interpolation;
    const isLinear = interp?.type === 'linear';
    const roundedCorners = Number(meta?.roundedCorners) || 0;

    if (!isLinear && roundedCorners <= 0) {
      return null;
    }

    // If width/height are dynamic (strings), we can't easily clamp maxRadius in JS.
    // For safety, we cap at 50px absolute, but ignore the W/H limit if they are dynamic.
    const isDynamicSize =
      typeof width === 'string' || typeof height === 'string';
    const staticW = typeof width === 'number' ? width : 9999;
    const staticH = typeof height === 'number' ? height : 9999;

    // Safety clamp (use 9999 effectively as "no limit" if dynamic)
    const maxRadius = Math.min(50, Math.min(staticW, staticH) / 2);
    let rExpr: string;

    if (isLinear) {
      const nextR = Number(
        meta._interpolation.nextValues.roundedCorners ?? roundedCorners,
      );
      const rStart = Math.max(0, Math.min(roundedCorners, maxRadius));
      const rEnd = Math.max(0, Math.min(nextR, maxRadius));

      rExpr = `(${this.generateInterpolationExpression(
        rStart,
        rEnd,
        interp.segStart,
        interp.segEnd,
      )})`;
    } else {
      const r = Math.max(0, Math.min(roundedCorners, maxRadius));
      rExpr = String(r);
    }

    const cleanInputLabel = inputLabel.replace(/[\[\]]/g, '');

    const alphaExpr = `if(gt(abs(W/2-X),W/2-${rExpr})*gt(abs(H/2-Y),H/2-${rExpr}),if(lte(hypot(${rExpr}-(W/2-abs(W/2-X)),${rExpr}-(H/2-abs(H/2-Y))),${rExpr}),a(X,Y),0),a(X,Y))`;

    // geq requires at least one RGB/luminance expression, so we pass through original values
    const geqExpr = `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alphaExpr}'`;

    const filterString = cleanInputLabel
      ? `[${cleanInputLabel}]${geqExpr}[${outputLabel}]`
      : geqExpr;
    return filterString;
  }

  // Build audio effects chain for an audio stream
  buildAudioEffects(meta: any): string {
    const fx: string[] = [];
    const tempo = Number(meta?.audioSpeed);
    const pitchSemi = Number(meta?.audioPitch);
    const bassDb = Number(meta?.audioBassBoost);
    const trebDb = Number(meta?.audioTrebleBoost);
    const echoMix = Number(meta?.audioEcho);
    const reverbMix = Number(meta?.audioReverb);

    if (!Number.isNaN(pitchSemi) && pitchSemi !== 0) {
      const factor = Math.pow(2, pitchSemi / 12);
      const base = 48000;
      fx.push(`asetrate=${Math.round(base * factor)}`, `aresample=${base}`);
    }
    if (!Number.isNaN(tempo) && tempo > 0 && tempo !== 1) {
      const t = Math.max(0.5, Math.min(2, tempo));
      fx.push(`atempo=${t.toFixed(3)}`);
    }
    if (!Number.isNaN(bassDb) && bassDb > 0)
      fx.push(`bass=g=${Math.min(20, bassDb).toFixed(2)}`);
    if (!Number.isNaN(trebDb) && trebDb > 0)
      fx.push(`treble=g=${Math.min(20, trebDb).toFixed(2)}`);
    if (!Number.isNaN(echoMix) && echoMix > 0) {
      const mix = Math.max(0, Math.min(1, echoMix));
      const d1 = mix * 0.6 + 0.1;
      const d2 = Math.max(0.05, d1 * 0.75);
      fx.push(`aecho=0.8:0.9:120|200:${d1.toFixed(2)}|${d2.toFixed(2)}`);
    }
    if (!Number.isNaN(reverbMix) && reverbMix > 0) {
      const mix = Math.max(0, Math.min(1, reverbMix));
      const b1 = mix * 0.5 + 0.1;
      const b2 = Math.max(0.05, b1 * 0.8);
      const b3 = Math.max(0.03, b2 * 0.8);
      const b4 = Math.max(0.02, b3 * 0.8);
      fx.push(
        `aecho=0.7:0.7:60|100|140|180:${b1.toFixed(2)}|${b2.toFixed(2)}|${b3.toFixed(2)}|${b4.toFixed(2)}`,
      );
    }
    return fx.join(',');
  }

  /**
   * Calculates canvas dimensions based on resolution and aspect ratio settings
   */
  calculateCanvasDimensions(output?: {
    resolution?: string;
    aspectRatio?: string;
  }): { width: number; height: number } {
    let canvasW = 1280,
      canvasH = 720;

    if (output?.resolution) {
      const resolutions: Record<string, [number, number]> = {
        '720p': [1280, 720],
        '1080p': [1920, 1080],
        '1440p': [2560, 1440],
        '4k': [3840, 2160],
      };
      [canvasW, canvasH] = resolutions[output.resolution] ?? [canvasW, canvasH];
    }

    if (output?.aspectRatio) {
      const normalizedRatio = output.aspectRatio.replace(':', '/');
      const [wRatio, hRatio] = normalizedRatio.split('/').map(Number);
      if (wRatio && hRatio) {
        const targetRatio = wRatio / hRatio;
        const currentRatio = canvasW / canvasH;
        if (targetRatio > currentRatio)
          canvasH = Math.round(canvasW / targetRatio);
        else canvasW = Math.round(canvasH * targetRatio);
        canvasW -= canvasW % 2;
        canvasH -= canvasH % 2;
      }
    }

    return { width: canvasW, height: canvasH };
  }

  /**
   * Validates and processes media files, assigning input indices
   */
  processMediaInputs(
    localMedia: Array<{ localPath: string; meta: any }>,
    command: any,
    fps: number,
  ): void {
    let nextInputIndex = 1; // canvas is input 0, media start from 1

    for (let i = 0; i < localMedia.length; i++) {
      const lm = localMedia[i];
      // Use explicit type passed from service
      const type = lm.meta.type;

      const isImg = type === 'image';
      const isGif = type === 'gif';
      const isAudio = type === 'audio';
      const isVideo = type === 'video';

      const start = lm.meta.startTime ?? 0;
      const end = lm.meta.endTime ?? start + (lm.meta.duration || 3);
      const duration = Number((end - start).toFixed(3));

      this.logger.debug(
        `Media input ${i}: ${lm.meta.url}, type: ${type}, duration: ${duration}s`,
      );

      const inputPath = (lm.localPath || '').trim();
      const isRemote = /^https?:\/\//i.test(inputPath);

      // Validate local files
      if (!isRemote && inputPath && !fs.existsSync(inputPath)) {
        this.logger.error(`File does not exist: ${inputPath}`);
        throw new Error(`Media file not found: ${inputPath}`);
      }

      const inputOptions: string[] = [];

      // Add probing optimization only for video inputs or complex formats where needed
      // For images and simple audio, it's often unnecessary overhead
      // Use reasonable values for probing. The previous 32k/0 optimization was too aggressive
      // and caused failures on some streams (End of file / Invalid argument).
      // 10M is a safe default that allows enough data to be read to determine stream info.
      if (type === 'video' || isRemote) {
        inputOptions.push('-probesize', '10M', '-analyzeduration', '10M');
      }

      // Robustness for HTTP streaming
      if (isRemote) {
        inputOptions.push(
          '-reconnect',
          '1',
          '-reconnect_at_eof',
          '1',
          '-reconnect_streamed',
          '1',
          '-reconnect_delay_max',
          '5',
          '-rw_timeout',
          '30000000', // 30 seconds
          '-timeout',
          '30000000', // 30 seconds
          '-user_agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        );
      }

      // Animation/Dynamic flag: videos, gifs, and audio are treated as animated/dynamic
      const isAnimated =
        lm.meta.isAnimated === true ||
        type === 'video' ||
        type === 'gif' ||
        type === 'audio';

      const inputDuration = lm.meta._sourceDuration ?? duration;
      if (lm.meta._sourceStart !== undefined) {
        inputOptions.push('-ss', String(lm.meta._sourceStart));
      }

      if (!isAnimated && type === 'image') {
        // Static image content - use -loop and -framerate
        inputOptions.push(
          '-loop',
          '1',
          '-t',
          String(duration),
          '-framerate',
          String(fps),
        );
      } else {
        // Animated/Dynamic content
        inputOptions.push('-t', String(inputDuration));
      }

      if (type !== 'text') {
        this.logger.debug(
          `Adding ${type} input (animated=${isAnimated}): ${inputPath} with options: ${inputOptions.join(' ')}`,
        );
        command.input(inputPath).inputOptions(inputOptions);
        (lm.meta as any)._inputIndex = nextInputIndex++;
      }
    }
  }

  /**
   * Sorts media items by zIndex for proper layering
   */
  sortMediaByZIndex(
    localMedia: Array<{ localPath: string; meta: any }>,
  ): Array<{ localPath: string; meta: any }> {
    return [...localMedia]
      .map((m, idx) => ({ m, idx }))
      .sort((a, b) => {
        const za = a.m.meta.zIndex;
        const zb = b.m.meta.zIndex;
        const aHas = typeof za === 'number';
        const bHas = typeof zb === 'number';
        if (aHas && bHas) {
          if (zb !== za) return (zb as number) - (za as number); // larger first (background)
          return a.idx - b.idx; // stable for equal
        }
        // If one or both are missing, keep original order
        return a.idx - b.idx;
      })
      .map((x) => x.m);
  }

  /**
   * Calculates position and size expressions for media positioning
   */
  calculatePositionAndSize(
    meta: any,
    canvasW: number,
    canvasH: number,
  ): {
    xExpr: string;
    yExpr: string;
    width: number | string;
    height: number | string;
    pixelOffset: { x: number; y: number };
  } {
    const interp = meta._interpolation;
    const isLinear = interp?.type === 'linear';

    let posX = Number(meta.position?.x ?? 50);
    let posY = Number(meta.position?.y ?? 50);

    if (isLinear) {
      const nextX = Number(
        interp.nextValues.position?.x ?? interp.nextValues.x ?? posX,
      );
      const nextY = Number(
        interp.nextValues.position?.y ?? interp.nextValues.y ?? posY,
      );

      const xInterp = this.generateInterpolationExpression(
        posX,
        nextX,
        interp.segStart,
        interp.segEnd,
      );
      const yInterp = this.generateInterpolationExpression(
        posY,
        nextY,
        interp.segStart,
        interp.segEnd,
      );

      // Interpolate Size
      const curWRaw = Number(meta.size?.width ?? 100);
      const curHRaw = Number(meta.size?.height ?? 100);
      const nextWRaw = Number(
        interp.nextValues.size?.width ?? interp.nextValues.width ?? curWRaw,
      );
      const nextHRaw = Number(
        interp.nextValues.size?.height ?? interp.nextValues.height ?? curHRaw,
      );

      // Heuristic: If <= 200, assume percentage. If > 200, assume pixels.
      // This matches the static logic below.
      const getPixels = (val: number, dim: number) =>
        val <= 200 ? (dim * val) / 100 : val;

      const startW = getPixels(curWRaw, canvasW);
      const startH = getPixels(curHRaw, canvasH);
      const endW = getPixels(nextWRaw, canvasW);
      const endH = getPixels(nextHRaw, canvasH);

      let width: number | string = Math.round(startW);
      let height: number | string = Math.round(startH);

      if (Math.abs(startW - endW) > 1 || Math.abs(startH - endH) > 1) {
        width = this.generateInterpolationExpression(
          startW,
          endW,
          interp.segStart,
          interp.segEnd,
        );

        height = this.generateInterpolationExpression(
          startH,
          endH,
          interp.segStart,
          interp.segEnd,
        );
      }

      return {
        xExpr: posX <= 100 ? `W*(${xInterp})/100-w/2` : `(${xInterp})-w/2`,
        yExpr: posY <= 100 ? `H*(${yInterp})/100-h/2` : `(${yInterp})-h/2`,
        width,
        height,
        pixelOffset: { x: 0, y: 0 },
      };
    }

    const xExpr =
      posX <= 100
        ? `W*${Math.max(0, posX).toFixed(2)}/100-w/2`
        : `${posX.toFixed(2)}-w/2`;
    const yExpr =
      posY <= 100
        ? `H*${Math.max(0, posY).toFixed(2)}/100-h/2`
        : `${posY.toFixed(2)}-h/2`;

    const rawWidth = meta.size?.width ?? 100;
    const rawHeight = meta.size?.height ?? 100;
    let width = rawWidth;
    let height = rawHeight;

    if (
      typeof rawWidth === 'number' &&
      typeof rawHeight === 'number' &&
      rawWidth <= 200 &&
      rawHeight <= 200
    ) {
      width = Math.round((canvasW * Math.max(0, rawWidth)) / 100);
      height = Math.round((canvasH * Math.max(0, rawHeight)) / 100);
    }

    // Allow width/height to exceed canvas for zoom/crop effect (up to 200%)
    // Only enforce minimum size to prevent errors
    width = Math.max(10, width as number);
    height = Math.max(10, height as number);

    // Compute desired top-left so that the media's center is at the given position
    const desiredX =
      typeof posX === 'number' && posX <= 100
        ? Math.round(
            (canvasW * Math.max(0, posX)) / 100 - (width as number) / 2,
          )
        : parseInt(String(posX), 10);
    const desiredY =
      typeof posY === 'number' && posY <= 100
        ? Math.round(
            (canvasH * Math.max(0, posY)) / 100 - (height as number) / 2,
          )
        : parseInt(String(posY), 10);

    // Preserve raw offsets (allow negative or off‑canvas values) for FFmpeg overlay positioning
    const pixelOffset = {
      x: desiredX,
      y: desiredY,
    };

    return { xExpr, yExpr, width, height, pixelOffset };
  }

  /**
   * Creates text overlay filter
   */
  createTextFilter(
    meta: any,
    start: number,
    end: number,
    lastVideoLabel: string,
  ): { filter: string; newLabel: string } {
    const text = meta.text || '';
    const fontSize = meta.fontSize || 24;
    const color = meta.color || 'white';

    // Escape text for FFmpeg
    const escapedText = text.replace(/'/g, "\\'").replace(/:/g, '\\:');

    // Treat <=100 as percentages of canvas and center text on x,y
    const tPosX = meta.position?.x ?? 50;
    const tPosY = meta.position?.y ?? 50;
    const textXExpr =
      typeof tPosX === 'number' && tPosX <= 100
        ? `W*${Math.max(0, tPosX)}/100 - tw/2`
        : `${tPosX} - tw/2`;
    const textYExpr =
      typeof tPosY === 'number' && tPosY <= 100
        ? `H*${Math.max(0, tPosY)}/100 - th/2`
        : `${tPosY} - th/2`;

    const fontsDirEscaped = this.fontsDir
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:');
    const textFilter = `drawtext=text='${escapedText}':x=${this.sanitizeExpression(textXExpr)}:y=${this.sanitizeExpression(textYExpr)}:fontsize=${fontSize}:fontcolor=${color}:enable='between(t,${start},${end})':fontsdir='${fontsDirEscaped}':font='${meta.fontName || 'Arial'}'`;
    const newLabel = `[text${start}]`;

    return {
      filter: `${lastVideoLabel}${textFilter}${newLabel}`,
      newLabel,
    };
  }

  /**
   * Creates subtitle overlay filters
   */
  createSubtitleFilters(
    subtitlePath: string,
    lastVideoLabel: string,
    subtitleOptions?: any,
    index: number = 0,
  ): { filter: string; newLabel: string } {
    // Use relative path to avoid colon escaping issues on Windows
    const relativePath = path.relative(process.cwd(), subtitlePath);
    const safeSubs = relativePath.replace(/\\/g, '/');
    const isAssFile = subtitlePath.endsWith('.ass');
    const newLabel = `[subs_${index}]`;

    // Ensure we are in a clean pixel format before applying subtitles
    const formatReset = 'format=yuv420p,';

    const fontsDirEscaped = this.fontsDir
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:');

    if (isAssFile) {
      // For ASS files, use ass filter instead of subtitles filter
      return {
        filter: `${lastVideoLabel}${formatReset}ass=filename='${safeSubs}':fontsdir='${fontsDirEscaped}'${newLabel}`,
        newLabel,
      };
    } else {
      // For SRT files, use subtitles filter with styling
      const subtitleStyle = this.buildSubtitleStyle(subtitleOptions);
      // Escape commas in the style string
      const escapedStyle = subtitleStyle.replace(/,/g, '\\,');

      return {
        filter: `${lastVideoLabel}${formatReset}subtitles=filename='${safeSubs}':force_style='${escapedStyle}':fontsdir='${fontsDirEscaped}'${newLabel}`,
        newLabel,
      };
    }
  }

  /**
   * Creates audio mixing filters
   */
  createAudioFilters(
    audioInputs: Array<{
      inputIndex: number;
      startTime: number;
      endTime: number;
      volume?: number;
      meta?: any;
    }>,
  ): { filters: string[]; finalLabel: string } {
    if (audioInputs.length === 0) {
      return { filters: [], finalLabel: '' };
    }

    if (audioInputs.length === 1) {
      // Single audio input - just delay and trim
      const audio = audioInputs[0];
      const volume = Math.max(0, Math.min(2, audio.volume || 1.0)); // Clamp volume between 0 and 2
      const fx = this.buildAudioEffects(audio.meta || {});

      // Check if audio is pre-trimmed (from cuts)
      const audioLabel = audio.meta?._audioLabel;
      const audioSource = audioLabel || `[${audio.inputIndex}:a]`;
      const duration = audio.endTime - audio.startTime;

      const fadeInDur = Number(audio.meta?.fadeInDuration) || 0;
      const fadeOutDur = Number(audio.meta?.fadeOutDuration) || 0;
      let audioFX = fx && fx.length ? `${fx},` : '';

      if (fadeInDur > 0) {
        audioFX += `afade=t=in:st=0:d=${fadeInDur.toFixed(3)},`;
      }
      if (fadeOutDur > 0) {
        const fadeOutStart = Math.max(0, duration - fadeOutDur);
        audioFX += `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)},`;
      }

      // If using pre-trimmed label, don't apply atrim again, just delay
      const chain = audioLabel
        ? `${audioSource}adelay=${audio.startTime * 1000}|${audio.startTime * 1000},${audioFX}volume=${volume}[final_audio]`
        : `${audioSource}adelay=${audio.startTime * 1000}|${audio.startTime * 1000},atrim=duration=${duration},${audioFX}volume=${volume}[final_audio]`;

      return { filters: [chain], finalLabel: '[final_audio]' };
    } else {
      // Multiple audio inputs - mix them together
      const audioMixInputs = audioInputs.map((audio, index) => {
        const delay = audio.startTime * 1000;
        const duration = audio.endTime - audio.startTime;
        const volume = Math.max(0, Math.min(2, audio.volume || 1.0)); // Clamp volume between 0 and 2
        const fx = this.buildAudioEffects(audio.meta || {});

        // Check if audio is pre-trimmed (from cuts)
        const audioLabel = audio.meta?._audioLabel;
        const audioSource = audioLabel || `[${audio.inputIndex}:a]`;

        const fadeInDur = Number(audio.meta?.fadeInDuration) || 0;
        const fadeOutDur = Number(audio.meta?.fadeOutDuration) || 0;
        let audioFX = fx && fx.length ? `${fx},` : '';

        if (fadeInDur > 0) {
          audioFX += `afade=t=in:st=0:d=${fadeInDur.toFixed(3)},`;
        }
        if (fadeOutDur > 0) {
          const fadeOutStart = Math.max(0, duration - fadeOutDur);
          audioFX += `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)},`;
        }

        // If using pre-trimmed label, don't apply atrim again, just delay
        const chain = audioLabel
          ? `${audioSource}adelay=${delay}|${delay},${audioFX}volume=${volume}[audio${index}]`
          : `${audioSource}adelay=${delay}|${delay},atrim=duration=${duration},${audioFX}volume=${volume}[audio${index}]`;
        return chain;
      });

      // Mix all audio streams
      const mixInputs = audioInputs
        .map((_, index) => `[audio${index}]`)
        .join('');
      const mixFilter = `${mixInputs}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=0[final_audio]`;

      return {
        filters: [...audioMixInputs, mixFilter],
        finalLabel: '[final_audio]',
      };
    }
  }

  /**
   * Validates the generated filter complex for common issues
   */
  validateFilterComplex(filterComplex: string, parts: string[]): void {
    if (parts.length === 0) {
      this.logger.warn('No filter parts generated - this may cause issues');
    }

    // Check for common filter complex issues
    const nanPart = parts.find(
      (p) => p.includes('undefined') || p.includes('NaN'),
    );
    if (nanPart) {
      this.logger.error(
        `Filter complex contains undefined or NaN values: ${nanPart}`,
      );
      throw new Error(
        `Invalid filter complex generated. Found 'undefined' or 'NaN' in: "${nanPart}". Check media metadata or transition parameters.`,
      );
    }

    // Check for negative values in timing
    const negativePart = parts.find(
      (p) => p.includes(':-') || p.includes('st:-') || p.includes('d:-'),
    );
    if (negativePart) {
      this.logger.error(
        `Filter complex contains negative timing values: ${negativePart}`,
      );
      throw new Error(
        `Invalid timing values in filter complex. Found negative value in: "${negativePart}". This usually means a transition is longer than the clip duration, or start time is invalid.`,
      );
    }
  }

  /**
   * Performs a comprehensive integrity check on the FFmpeg command payload.
   * Compares the final processed state (localMedia, alignedTransitions) against the original input.
   * Ensures that no media items were lost, transitions were matched, and keyframe timings are valid.
   */
  validateCommandIntegrity(
    input: GenerateVideoInput,
    localMedia: Array<{ localPath: string; meta: any }>,
    alignedTransitions: any[],
  ): {
    isComplete: boolean;
    mediaSummary: string;
    transitionSummary: string;
    issues: string[];
  } {
    const issues: string[] = [];

    // --- 1. Media Integrity ---
    const inputCategories = [
      { type: 'image', items: input.media?.images || [] },
      { type: 'video', items: input.media?.videos || [] },
      { type: 'audio', items: input.media?.audio || [] },
      { type: 'gif', items: input.media?.gif || [] },
      { type: 'text', items: input.media?.text || [] },
    ];

    let totalInputCount = 0;
    inputCategories.forEach((cat) => {
      cat.items.forEach((item: any, idx) => {
        totalInputCount++;
        // Check if this item is represented in localMedia
        // Logic: an item is considered "present" if at least one localMedia item points to its URL (or text)
        const isPresent = localMedia.some((lm) => {
          if (cat.type === 'text') return lm.meta.text === item.text;
          // Robust URL matching (handle potential undefined/null)
          return (
            (lm.meta.url && item.url && lm.meta.url === item.url) ||
            (lm.meta.id && item.id && lm.meta.id === item.id)
          );
        });

        if (!isPresent) {
          issues.push(
            `Missing Media: Input ${cat.type} at index ${idx} (${item.url || item.text || 'unspecified'}) was not found in processed media.`,
          );
        }
      });
    });

    // --- 2. Transition Integrity ---
    const inputTransitionCount = input.transitions?.length || 0;
    const alignedCount = alignedTransitions.length;

    if (alignedCount < inputTransitionCount) {
      const missingCount = inputTransitionCount - alignedCount;
      issues.push(
        `Incomplete Transitions: Only ${alignedCount}/${inputTransitionCount} transitions were successfully aligned between media clips.`,
      );

      // Identify which transitions were lost
      input.transitions?.forEach((tr, i) => {
        const isAligned = alignedTransitions.some(
          (atr) =>
            (tr.fromId &&
              atr.fromId === tr.fromId &&
              tr.toId &&
              atr.toId === tr.toId) ||
            (atr.type === tr.type && Math.abs(atr.start - tr.start) < 0.1),
        );
        if (!isAligned) {
          const context =
            tr.fromId && tr.toId
              ? `${tr.fromId} -> ${tr.toId}`
              : `at ${tr.start}s`;
          issues.push(
            `Lost Transition: ${tr.type} transition ${context} could not be placed.`,
          );
        }
      });
    }

    // --- 3. Keyframe & Timing Integrity ---
    localMedia.forEach((lm, i) => {
      const { startTime, endTime, duration } = lm.meta;

      // Basic timing sanity
      if (duration <= 0) {
        issues.push(
          `Timeline Error: Media at index ${i} has zero or negative duration (${duration}s).`,
        );
      }

      // Keyframe checks
      if (lm.meta.keyframes && Array.isArray(lm.meta.keyframes)) {
        lm.meta.keyframes.forEach((kf: any, kidx: number) => {
          if (kf.at < 0 || kf.at > duration) {
            issues.push(
              `Keyframe Out of Bounds: Media ${i} has keyframe ${kidx} at ${kf.at}s, but clip duration is ${duration}s.`,
            );
          }
        });
      }
    });

    const isComplete = issues.length === 0;
    if (isComplete) {
      this.logger.debug(
        '✅ FFmpeg Command Integrity Verified: All items present',
      );
    } else {
      this.logger.warn(
        `⚠️ FFmpeg Command Integrity Issues Detected: ${issues.length} issues found.`,
      );
    }

    return {
      isComplete,
      mediaSummary: `Total Input: ${totalInputCount}, Local Segments: ${localMedia.length}`,
      transitionSummary: `Aligned: ${alignedCount}/${inputTransitionCount}`,
      issues,
    };
  }

  /**
   * Sanitizes and normalizes transition data to handle malformed input
   */
  private sanitizeTransitionData(transition: any): any {
    try {
      if (!transition || typeof transition !== 'object') {
        this.logger.warn(
          'Invalid transition object, creating default transition',
        );
        return {
          type: 'fade',
          start: 0,
          duration: 1,
        };
      }

      const sanitized = { ...transition };

      // Sanitize transition type
      if (!sanitized.type || typeof sanitized.type !== 'string') {
        sanitized.type = 'fade';
        this.logger.debug('Set default transition type: fade');
      } else {
        sanitized.type = sanitized.type.toLowerCase().trim();
        if (!this.isSupportedTransition(sanitized.type)) {
          this.logger.warn(
            `Unsupported transition type ${sanitized.type}, falling back to fade`,
          );
          sanitized.type = 'fade';
        }
      }

      // Sanitize start time
      const startTime = this.safeParseTime(sanitized.start, 0);
      sanitized.start = Math.max(0, startTime);

      // Sanitize duration
      const duration = this.safeParseTime(sanitized.duration, 1);
      sanitized.duration = Math.max(
        this.MIN_TRANSITION_DURATION,
        Math.min(duration, this.MAX_TRANSITION_DURATION),
      );

      // Remove any invalid properties
      const validProps = [
        'type',
        'start',
        'duration',
        'fromClip',
        'toClip',
        'fromId',
        'toId',
        'offset',
        '_mediaIndex',
        '_qualityScore',
      ];
      Object.keys(sanitized).forEach((key) => {
        if (!validProps.includes(key)) {
          delete sanitized[key];
        }
      });

      this.logger.debug(
        `Sanitized transition: type=${sanitized.type}, start=${sanitized.start}, duration=${sanitized.duration}`,
      );
      return sanitized;
    } catch (error) {
      this.logger.error(`Error sanitizing transition data: ${error.message}`);
      return {
        type: 'fade',
        start: 0,
        duration: 1,
      };
    }
  }

  /**
   * Validates and repairs media timing data
   */
  private validateAndRepairMediaTiming(media: any, index: number): any {
    try {
      const repaired = { ...media };

      // Repair start time
      const startTime = this.safeParseTime(repaired.startTime, 0);
      repaired.startTime = Math.max(0, startTime);

      // Repair duration
      const duration = this.safeParseTime(repaired.duration, 3);
      repaired.duration = Math.max(0.1, duration);

      // Repair end time
      const endTime = this.safeParseTime(
        repaired.endTime,
        repaired.startTime + repaired.duration,
      );
      if (endTime <= repaired.startTime) {
        repaired.endTime = repaired.startTime + repaired.duration;
        this.logger.debug(
          `Repaired end time for media ${index}: ${repaired.endTime}`,
        );
      } else {
        repaired.endTime = endTime;
      }

      // Ensure duration matches end - start
      const calculatedDuration = repaired.endTime - repaired.startTime;
      if (Math.abs(calculatedDuration - repaired.duration) > 0.1) {
        repaired.duration = calculatedDuration;
        this.logger.debug(
          `Adjusted duration for media ${index} to match timing: ${repaired.duration}`,
        );
      }

      return repaired;
    } catch (error) {
      this.logger.error(
        `Error validating media timing for index ${index}: ${error.message}`,
      );
      return media; // Return original if repair fails
    }
  }
  /**
   * Central filter complex builder - orchestrates the entire filter building process
   */
  /**
   * Generates the massive filter_complex string used by FFmpeg to 
   * layer clips, apply transitions, and mix audio.
   * 
   * @returns An object containing the filter string and the labels for the final streams.
   */
  buildFilterComplex(
    input: GenerateVideoInput,
    localMedia: Array<{ localPath: string; meta: any }>,
    allMediaItems: any[],
    transitions: any[],
    canvasW: number,
    canvasH: number,
    fps: number,
    subtitles?: Array<{
      path: string;
      zIndex?: number;
      options?: any;
    }>,
  ): {
    filterComplex: string;
    finalVideoLabel: string;
    finalAudioLabel: string;
    audioInputs: Array<{
      inputIndex: number;
      startTime: number;
      endTime: number;
      volume?: number;
      meta?: any;
    }>;
    integrityReport?: any;
    totalVisualSegments: number;
  } {
    const parts: string[] = [];
    const audioInputs: any[] = [];
    const fpsForNormalization = fps;
    let lastVideoLabel = '';

    let expandedMedia: Array<{
      localPath: string;
      meta: any;
      isCut: boolean;
      originalIndex: number;
    }> = [];
    let overlayMedia: Array<{
      localPath: string;
      meta: any;
      _expandedInfo?: any;
    }> = [];

    let totalVisualSegments = 0;

    if (!localMedia || localMedia.length === 0) {
      return {
        filterComplex: '',
        finalVideoLabel: '',
        finalAudioLabel: '',
        audioInputs: [],
        totalVisualSegments: 0,
      };
    }

    try {
      // --- Step 0: Normalize media and expand cuts into separate media items ---
      localMedia.forEach((m, i) => {
        const repaired = this.validateAndRepairMediaTiming(m.meta, i);
        // If media has cuts, expand each cut as a separate media item
        if (
          repaired.cuts &&
          Array.isArray(repaired.cuts) &&
          repaired.cuts.length > 0
        ) {
          repaired.cuts.forEach((cut: any, cutIdx: number) => {
            const baseStart = repaired.startTime ?? 0;
            const cutStart = Number(cut.start) || 0;
            const cutEnd = Number(cut.end) || 0;
            const timelineStart = Number(cut.timelineStart ?? baseStart) || 0;
            const duration = Math.max(0, cutEnd - cutStart);

            // Handle keyframes within the cut
            if (
              cut.keyframes &&
              Array.isArray(cut.keyframes) &&
              cut.keyframes.length > 0
            ) {
              const sortedKfs = [...cut.keyframes].sort((a, b) => a.at - b.at);

              const keyPoints: Array<{ at: number; values: any }> = [];
              if (sortedKfs[0].at > 0) {
                // Initial segment uses cut's base properties
                keyPoints.push({ at: 0, values: cut });
              }
              sortedKfs.forEach((kf) =>
                keyPoints.push({ at: kf.at, values: kf }),
              );

              for (let k = 0; k < keyPoints.length; k++) {
                const kp = keyPoints[k];
                const nextKp = keyPoints[k + 1];
                const kpAt = Number(kp.at) || 0;
                const nextAt = Number(nextKp?.at ?? duration);

                if (nextAt <= kpAt) {
                  continue;
                }

                const segDuration = nextAt - kpAt;
                const useLinear = nextKp?.values?.easing === 'linear';

                // Construct authoritative metadata with strict precedence: Keyframe > Cut > Media
                const segmentMeta = {
                  ...repaired,
                  ...cut,
                  ...kp.values,
                  // Linear Interpolation Data
                  _interpolation: useLinear
                    ? {
                        type: 'linear',
                        nextValues: nextKp.values,
                        segStart: timelineStart + kpAt,
                        segEnd: timelineStart + nextAt,
                      }
                    : undefined,
                  // Explicit Deep Merging
                  position: {
                    x:
                      kp.values.position?.x ??
                      kp.values.x ??
                      cut.position?.x ??
                      repaired.position?.x ??
                      50,
                    y:
                      kp.values.position?.y ??
                      kp.values.y ??
                      cut.position?.y ??
                      repaired.position?.y ??
                      50,
                  },
                  size: {
                    width:
                      kp.values.size?.width ??
                      kp.values.width ??
                      cut.size?.width ??
                      repaired.size?.width ??
                      100,
                    height:
                      kp.values.size?.height ??
                      kp.values.height ??
                      cut.size?.height ??
                      repaired.size?.height ??
                      100,
                  },
                  rotate:
                    kp.values.rotate ??
                    (kp.values.rotate === 0
                      ? 0
                      : (cut.rotate ??
                        (cut.rotate === 0 ? 0 : (repaired.rotate ?? 0)))),
                  opacity:
                    kp.values.opacity ??
                    (kp.values.opacity === 0
                      ? 0
                      : (cut.opacity ??
                        (cut.opacity === 0 ? 0 : (repaired.opacity ?? 100)))),
                  brightness:
                    kp.values.brightness ??
                    (kp.values.brightness === 0
                      ? 0
                      : (cut.brightness ??
                        (cut.brightness === 0
                          ? 0
                          : (repaired.brightness ?? 100)))),
                  contrast:
                    kp.values.contrast ??
                    (kp.values.contrast === 0
                      ? 0
                      : (cut.contrast ??
                        (cut.contrast === 0 ? 0 : (repaired.contrast ?? 100)))),
                  saturation:
                    kp.values.saturation ??
                    (kp.values.saturation === 0
                      ? 0
                      : (cut.saturation ??
                        (cut.saturation === 0
                          ? 0
                          : (repaired.saturation ?? 100)))),
                  hue:
                    kp.values.hue ??
                    (kp.values.hue === 0
                      ? 0
                      : (cut.hue ?? (cut.hue === 0 ? 0 : (repaired.hue ?? 0)))),
                  blur:
                    kp.values.blur ??
                    (kp.values.blur === 0
                      ? 0
                      : (cut.blur ??
                        (cut.blur === 0 ? 0 : (repaired.blur ?? 0)))),
                  grayscale:
                    kp.values.grayscale ??
                    (kp.values.grayscale === 0
                      ? 0
                      : (cut.grayscale ??
                        (cut.grayscale === 0 ? 0 : (repaired.grayscale ?? 0)))),
                  sepia:
                    kp.values.sepia ??
                    (kp.values.sepia === 0
                      ? 0
                      : (cut.sepia ??
                        (cut.sepia === 0 ? 0 : (repaired.sepia ?? 0)))),
                  invert:
                    kp.values.invert ??
                    (kp.values.invert === 0
                      ? 0
                      : (cut.invert ??
                        (cut.invert === 0 ? 0 : (repaired.invert ?? 0)))),
                  sharpen:
                    kp.values.sharpen ??
                    (kp.values.sharpen === 0
                      ? 0
                      : (cut.sharpen ??
                        (cut.sharpen === 0 ? 0 : (repaired.sharpen ?? 0)))),
                  roundedCorners:
                    kp.values.roundedCorners ??
                    (kp.values.roundedCorners === 0
                      ? 0
                      : (cut.roundedCorners ??
                        (cut.roundedCorners === 0
                          ? 0
                          : (repaired.roundedCorners ?? 0)))),
                  zIndex: kp.values.zIndex ?? cut.zIndex ?? repaired.zIndex,

                  // Accurate Timing and Source Referencing
                  startTime: timelineStart + kpAt,
                  endTime: timelineStart + nextAt,
                  duration: segDuration,
                  start: cutStart + kpAt,
                  end: cutStart + nextAt,

                  _cutInfo: {
                    cutId: cut.id,
                    cutIndex: cutIdx,
                    originalMeta: repaired,
                    segmentIndex: k,
                    isKeyframeSegment: true,
                    isFirstSegment: k === 0,
                    isLastSegment: k === keyPoints.length - 1,
                  },
                  cuts: undefined,
                  keyframes: undefined,
                };

                expandedMedia.push({
                  localPath: m.localPath,
                  meta: segmentMeta,
                  isCut: true,
                  originalIndex: i,
                });
              }
            } else {
              // Standard single cut expansion
              const cutMeta = {
                ...repaired,
                ...cut,
                startTime: timelineStart,
                endTime: timelineStart + duration,
                duration: duration,
                start: cutStart,
                end: cutEnd,
                _cutInfo: {
                  cutId: cut.id,
                  cutIndex: cutIdx,
                  originalMeta: repaired,
                },
                cuts: undefined,
              };

              expandedMedia.push({
                localPath: m.localPath,
                meta: cutMeta,
                isCut: true,
                originalIndex: i,
              });
            }
          });
        } else if (
          repaired.keyframes &&
          Array.isArray(repaired.keyframes) &&
          repaired.keyframes.length > 0
        ) {
          // Handle media item that HAS keyframes at the top level (e.g. pre-expanded cut from service)
          const kfs = repaired.keyframes;
          const duration = repaired.duration || 3;
          const sortedKfs = [...kfs].sort((a, b) => a.at - b.at);

          const keyPoints: Array<{ at: number; values: any }> = [];
          if (sortedKfs[0].at > 0) {
            keyPoints.push({ at: 0, values: repaired });
          }
          sortedKfs.forEach((kf) => keyPoints.push({ at: kf.at, values: kf }));

          for (let k = 0; k < keyPoints.length; k++) {
            const kp = keyPoints[k];
            const nextKp = keyPoints[k + 1];
            const kpAt = Number(kp.at) || 0;
            const nextAt = Number(nextKp?.at ?? duration);
            if (nextAt <= kpAt) continue;

            const segDuration = nextAt - kpAt;
            const useLinear =
              !!nextKp && (kp?.values?.easing || 'linear') === 'linear';

            // Inheritance: Keyframe > Media (which already has cut values merged by service)
            const segmentMeta = {
              ...repaired,
              ...kp.values,
              // Linear Interpolation Data
              _interpolation: useLinear
                ? {
                    type: 'linear',
                    nextValues: nextKp.values,
                    segStart: (repaired.startTime ?? 0) + kpAt,
                    segEnd: (repaired.startTime ?? 0) + nextAt,
                  }
                : undefined,
              // Explicit Deep Merging
              position: {
                x:
                  kp.values.position?.x ??
                  kp.values.x ??
                  repaired.position?.x ??
                  50,
                y:
                  kp.values.position?.y ??
                  kp.values.y ??
                  repaired.position?.y ??
                  50,
              },
              size: {
                width:
                  kp.values.size?.width ??
                  kp.values.width ??
                  repaired.size?.width ??
                  100,
                height:
                  kp.values.size?.height ??
                  kp.values.height ??
                  repaired.size?.height ??
                  100,
              },
              rotate:
                kp.values.rotate ??
                (kp.values.rotate === 0 ? 0 : (repaired.rotate ?? 0)),
              opacity:
                kp.values.opacity ??
                (kp.values.opacity === 0 ? 0 : (repaired.opacity ?? 100)),
              brightness:
                kp.values.brightness ??
                (kp.values.brightness === 0 ? 0 : (repaired.brightness ?? 100)),
              contrast:
                kp.values.contrast ??
                (kp.values.contrast === 0 ? 0 : (repaired.contrast ?? 100)),
              saturation:
                kp.values.saturation ??
                (kp.values.saturation === 0 ? 0 : (repaired.saturation ?? 100)),
              hue:
                kp.values.hue ??
                (kp.values.hue === 0 ? 0 : (repaired.hue ?? 0)),
              blur:
                kp.values.blur ??
                (kp.values.blur === 0 ? 0 : (repaired.blur ?? 0)),
              grayscale:
                kp.values.grayscale ??
                (kp.values.grayscale === 0 ? 0 : (repaired.grayscale ?? 0)),
              sepia:
                kp.values.sepia ??
                (kp.values.sepia === 0 ? 0 : (repaired.sepia ?? 0)),
              invert:
                kp.values.invert ??
                (kp.values.invert === 0 ? 0 : (repaired.invert ?? 0)),
              sharpen:
                kp.values.sharpen ??
                (kp.values.sharpen === 0 ? 0 : (repaired.sharpen ?? 0)),
              roundedCorners:
                kp.values.roundedCorners ??
                (kp.values.roundedCorners === 0
                  ? 0
                  : (repaired.roundedCorners ?? 0)),
              zIndex: kp.values.zIndex ?? repaired.zIndex,

              startTime: (repaired.startTime ?? 0) + kpAt,
              endTime: (repaired.startTime ?? 0) + nextAt,
              duration: segDuration,
              start: (repaired.start ?? 0) + kpAt,
              end: (repaired.start ?? 0) + nextAt,

              _cutInfo: {
                ...repaired._cutInfo,
                cutId: repaired._cutInfo?.cutId ?? repaired.id,
                segmentIndex: k,
                isKeyframeSegment: true,
                isFirstSegment: k === 0,
                isLastSegment: k === keyPoints.length - 1,
              },
              keyframes: undefined,
              cuts: undefined,
            };

            expandedMedia.push({
              localPath: m.localPath,
              meta: segmentMeta,
              isCut: true,
              originalIndex: i,
            });
          }
        } else {
          // Regular media item without cuts or keyframes
          expandedMedia.push({
            localPath: m.localPath,
            meta: repaired,
            isCut: false,
            originalIndex: i,
          });
        }
      });

      // Sort by zIndex after expansion
      overlayMedia = this.sortMediaByZIndex(
        expandedMedia.map(({ localPath, meta }) => ({ localPath, meta })),
      ).map((m, i) => {
        const expanded = expandedMedia.find(
          (em) => em.localPath === m.localPath && em.meta === m.meta,
        );
        return {
          localPath: m.localPath,
          meta: m.meta,
          _expandedInfo: expanded,
        };
      });

      // Count total visual segments for timeout estimation
      totalVisualSegments = overlayMedia.filter(
        (m) => m.meta.type !== 'audio' && m.meta.type !== 'text',
      ).length;
    } catch (error) {
      throw new Error(`Error expanding/normalizing media: ${error.message}`);
    }

    // --- Step 0b: Calculate input usage and prepare split filters ---
    const inputUsage = new Map<number, number>();
    overlayMedia.forEach((media) => {
      // Only Visual Media needs splitting to prevent frame drops in overlay filters
      if (media.meta.type === 'audio' || media.meta.type === 'text') return;
      const inIdx = media.meta._inputIndex;
      if (typeof inIdx === 'number') {
        inputUsage.set(inIdx, (inputUsage.get(inIdx) || 0) + 1);
      }
    });

    const inputLabels = new Map<number, string[]>();
    inputUsage.forEach((count, inIdx) => {
      if (count > 1) {
        const labels = Array.from(
          { length: count },
          (_, i) => `v${inIdx}_s${i}`,
        );
        parts.push(
          `[${inIdx}:v]split=${count}${labels.map((l) => `[${l}]`).join('')}`,
        );
        inputLabels.set(inIdx, labels);
      }
    });

    const padLabels: (string | null)[] = [];
    const inputUseCount = new Map<number, number>();

    try {
      // --- Step 1: Decode, normalize & scale all visual media ---
      overlayMedia.forEach((media, mediaIndex) => {
        const meta = media.meta;

        if (meta.type === 'text' || meta.type === 'audio') {
          padLabels.push(null);
          return;
        }

        const start = Math.max(0, meta.startTime ?? 0);
        const end = Math.max(
          start + 0.1,
          meta.endTime ?? start + (meta.duration || 3),
        );

        const globalStart = start;

        // Calculate even canvas dimensions once for this clip
        const cwEven = Math.max(2, Math.floor(canvasW / 2) * 2);
        const chEven = Math.max(2, Math.floor(canvasH / 2) * 2);

        const { xExpr, yExpr, width, height, pixelOffset } =
          this.calculatePositionAndSize(meta, canvasW, canvasH);
        const isDynamicSize =
          typeof width === 'string' || typeof height === 'string';

        (meta as any)._xExpr = xExpr;
        (meta as any)._yExpr = yExpr;

        const inIdx = meta._inputIndex;
        if (inIdx === undefined) {
          this.logger.warn(`Missing _inputIndex for media ${mediaIndex}`);
          padLabels.push(null);
          return;
        }

        // Use split label if available
        let sourceLabel = `[${inIdx}:v]`;
        if (inputLabels.has(inIdx)) {
          const used = inputUseCount.get(inIdx) || 0;
          sourceLabel = `[${inputLabels.get(inIdx)![used]}]`;
          inputUseCount.set(inIdx, used + 1);
        }

        // Force alpha if we might need transparency in padding or overlay
        const needsAlpha = true;

        const format = needsAlpha ? 'yuva420p' : 'yuv420p';
        const fpsNorm = Math.max(1, Math.floor(fpsForNormalization || 30));

        // Build consolidated filter chain for this clip
        const filterChain: string[] = [];

        // 1. Initial trim and setpts
        // Optimization: Remove redundant setpts=PTS-STARTPTS if no trim is applied
        const cutInfo = meta._cutInfo;
        if (cutInfo) {
          const sStart = Number(meta._sourceStart) || 0;
          const relStart = (Number(meta.start) || 0) - sStart;
          const relEnd = (Number(meta.end) || 0) - sStart;
          const hasInputSeeking = meta._sourceStart !== undefined;

          // If seeking is already perfectly aligned and we don't need further trimming, we can skip trim filter
          if (
            hasInputSeeking &&
            Math.abs(relStart) < 0.001 &&
            (meta._sourceDuration === undefined ||
              Math.abs(relEnd - meta._sourceDuration) < 0.001)
          ) {
            // No trim needed. If it's an image or guaranteed start-at-0, we might skip setpts too.
            // But usually safer to keep for video segments to ensure 0-based PTS relative to segment.
            // For static images (type 'image'), they are looped and generated, so they start at 0.
            if (meta.type !== 'image') {
              filterChain.push('setpts=PTS-STARTPTS');
            }
          } else {
            filterChain.push(
              `trim=start=${Math.max(0, relStart).toFixed(3)}:end=${Math.max(0, relEnd).toFixed(3)},setpts=PTS-STARTPTS`,
            );
          }
        } else {
          // No cut info.
          // For images, they are loops starting at 0.
          if (meta.type !== 'image') {
            filterChain.push('setpts=PTS-STARTPTS');
          }
        }

        // 2. Normalization - Shift PTS to match startTime for global timeline synchronization
        const partsOpt: string[] = [];
        // Only enforce FPS for video/gifs to save CPU on images (which are generated at target FPS)
        // HOWEVER, for dynamic resolution clips, we MUST force FPS for stable evaluation of 't'
        if (meta.type === 'video' || meta.type === 'gif' || isDynamicSize) {
          partsOpt.push(`fps=${fpsNorm}`);
        }
        partsOpt.push(
          `format=${format}`,
          'setsar=1',
          `setpts=(N/FRAME_RATE+${start.toFixed(3)})/TB`,
        );

        filterChain.push(partsOpt.join(','));

        // 3. Scale
        let scaleFilter = '';
        let wEven: number | string = width;
        let hEven: number | string = height;

        if (isDynamicSize) {
          const wExpr = typeof width === 'string' ? width : width.toString();
          const hExpr = typeof height === 'string' ? height : height.toString();
          // Enforce even dimensions, minimum size 2px, and clamp to canvas to avoid crop
          const wClamp = `2*max(1,min(trunc((${wExpr})/2),${cwEven / 2}))`;
          const hClamp = `2*max(1,min(trunc((${hExpr})/2),${chEven / 2}))`;

          scaleFilter = `scale=w=${this.sanitizeExpression(wClamp)}:h=${this.sanitizeExpression(hClamp)}:eval=frame`;
          filterChain.push(scaleFilter);

          // Force format re-evaluation after dynamic scale to prevent linesize assertion failures
          filterChain.push('format=yuva420p');

          // Normalization: Pad to exact canvas size
          const padExpr = `pad=w=${cwEven}:h=${chEven}:x='(ow-iw)/2':y='(oh-ih)/2':color=0x00000000:eval=frame`;
          filterChain.push(padExpr);

          // 4. Rounded Corners - REMOVED FOR PERFORMANCE
          // Rounded corners using geq are extremely slow at 4K resolution
          // const roundedCornersFilter = this.buildRoundedCornersFilter(
          //   '',
          //   '',
          //   meta,
          //   cwEven,
          //   chEven,
          // );
          // if (roundedCornersFilter) {
          //   const match = roundedCornersFilter.match(/\]([^\[\]]+)\[/);
          //   if (match) filterChain.push(match[1]);
          // }

          // Update meta properties so subsequent steps treat this as a full-canvas clip.
          (meta as any)._finalW = cwEven;
          (meta as any)._finalH = chEven;
          (meta as any)._finalX = 0;
          (meta as any)._finalY = 0;

          wEven = cwEven;
          hEven = chEven;
        } else {
          // Static scaling
          const wNum = Math.floor(width as number);
          const hNum = Math.floor(height as number);
          const wFinal = Math.max(2, Math.floor(wNum / 2) * 2);
          const hFinal = Math.max(2, Math.floor(hNum / 2) * 2);

          wEven = wFinal;
          hEven = hFinal;
          scaleFilter = `scale=${wEven}:${hEven}`;
          filterChain.push(scaleFilter);

          // 4. Rounded Corners - REMOVED FOR PERFORMANCE
          // Rounded corners using geq are extremely slow at 4K resolution
          // const roundedCornersFilter = this.buildRoundedCornersFilter(
          //   '',
          //   '',
          //   meta,
          //   wEven,
          //   hEven,
          // );
          // if (roundedCornersFilter) {
          //   const match = roundedCornersFilter.match(/\]([^\[\]]+)\[/);
          //   if (match) filterChain.push(match[1]);
          // }
        }

        // 5. Visual Effects (including Rotate with expansion)
        const vfx = this.buildVisualEffects(meta);
        if (vfx?.length) filterChain.push(vfx);

        // 6. Opacity (alpha scaling)
        const interp = meta._interpolation;
        const isLinear = interp?.type === 'linear';
        const rawOpacity =
          meta.opacity !== undefined && meta.opacity !== null
            ? Number(meta.opacity)
            : 100;
        const opacityVal = isNaN(rawOpacity) ? 100 : rawOpacity;
        const alpha = Math.max(0, Math.min(1, opacityVal / 100));

        // OPTIMIZATION: Only apply geq/lutyuv if opacity is not 100% or if interpolating
        // This avoids expensive per-pixel processing for most clips at 4K
        const needsOpacityFilter = isLinear || opacityVal !== 100;

        if (needsOpacityFilter) {
          if (isLinear) {
            const rawNextOpacity =
              interp.nextValues.opacity !== undefined &&
              interp.nextValues.opacity !== null
                ? Number(interp.nextValues.opacity)
                : opacityVal;
            const nextOpacity = isNaN(rawNextOpacity)
              ? opacityVal
              : rawNextOpacity;
            const nextAlpha = Math.max(0, Math.min(1, nextOpacity / 100));
            const aInterp = this.generateInterpolationExpression(
              alpha,
              nextAlpha,
              interp.segStart,
              interp.segEnd,
              'T', // Use uppercase T for geq filter
            );
            // Use geq for linear interpolation because lutyuv doesn't support the 't' constant.
            // geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='p(X,Y)*(expression)'
            // We use p(X,Y) for Y,U,V to maintain original color values.
            // Note: In geq, time is 'T' (uppercase) while p(X,Y) is lowercase.
            const aExpr = `p(X,Y)*(${aInterp})`;
            filterChain.push(
              `format=yuva420p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='${aExpr}'`,
            );
          } else {
            // Static opacity (not 100%) - use lutyuv which is faster than geq
            // Use val*alpha to preserve existing transparency in PNGs
            filterChain.push(
              `format=yuva420p,lutyuv=a='val*${alpha.toFixed(3)}'`,
            );
          }
        } else {
          // Opacity is 100% and not interpolating - just ensure alpha channel exists
          filterChain.push('format=yuva420p');
        }

        // 8. Fade In/Out (Using global timestamps because PTS was already shifted to match startTime)
        const fadeInDur = Number(meta.fadeInDuration) || 0;
        const fadeOutDur = Number(meta.fadeOutDuration) || 0;
        const clipDuration = end - start;

        if (fadeInDur > 0) {
          filterChain.push(
            `fade=t=in:st=${globalStart.toFixed(3)}:d=${fadeInDur.toFixed(3)}:alpha=1`,
          );
        }
        if (fadeOutDur > 0) {
          const fadeOutStart = Math.max(0, clipDuration - fadeOutDur);
          const globalFadeOutStart = globalStart + fadeOutStart;
          filterChain.push(
            `fade=t=out:st=${globalFadeOutStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)}:alpha=1`,
          );
        }

        // 7. Chroma Key
        const chromaKeyFilter = this.buildChromaKeyFilter('', '', meta);
        if (chromaKeyFilter) {
          const match = chromaKeyFilter.match(/\]([^\[\]]+)\[/);
          if (match) filterChain.push(match[1]);
        }

        // Store the final clip stream label and its position info
        const finalClipLabel = `clip${mediaIndex}`;
        parts.push(`${sourceLabel}${filterChain.join(',')}[${finalClipLabel}]`);

        // Account for rotation expansion in positioning (_finalX/_finalY should be center-based)
        // Since we expand the bounding box, the top-left corner shifts.
        // We use Math.floor(pixelOffset.x) for the desired final center, then adjust.
        // But FFmpeg overlay uses top-left.
        // If we expand, the new width is rotw(rad). We need to shift x by (rotw - iw)/2
        const rotateVal = Number(meta.rotate) || 0;
        const rad = Math.abs((rotateVal * Math.PI) / 180);

        let expW = 0;
        let expH = 0;
        let shiftX = 0;
        let shiftY = 0;

        // If dimensions are dynamic, we technically can't pre-calculate the exact static bounding box shift in JS.
        // However, we can approximate using the current static 'width'/'height' if available, or just 0 if fully dynamic.
        // If fully dynamic with rotation, the user relies on xExpr/yExpr dealing with center positioning (w/2).
        // Since xExpr/yExpr logic subtracts w/2, it centers the *content*.
        // Rotation expansion adds padding, so 'w' becomes 'rotw'.
        // If we want to center the ROTATED box, we should use rotw/2 in the expression.
        // But xExpr/yExpr currently uses 'w/2' (which is the filter output width).
        // If rotate filter is used, 'w' IS 'rotw'. So xExpr/yExpr remains correct (centering the bounding box).
        // The issue is _finalX/_finalY are used for static overlays (no keyframes).
        // If we have dynamic size, we likely have xExpr/yExpr anyway.
        // So we only need robust fallback here for static usage.

        if (typeof wEven === 'number' && typeof hEven === 'number') {
          expW =
            Math.abs(wEven * Math.cos(rad)) + Math.abs(hEven * Math.sin(rad));
          expH =
            Math.abs(wEven * Math.sin(rad)) + Math.abs(hEven * Math.cos(rad));
          shiftX = (expW - wEven) / 2;
          shiftY = (expH - hEven) / 2;
        } else {
          // Dynamic size - we can't calculate static shifts.
          // Assumes xExpr/yExpr will handle centering.
          expW = 0;
          expH = 0;
        }

        if (!isDynamicSize) {
          (meta as any)._finalX = Math.floor((pixelOffset.x - shiftX) / 2) * 2;
          (meta as any)._finalY = Math.floor((pixelOffset.y - shiftY) / 2) * 2;
          (meta as any)._finalW = Math.floor(expW / 2) * 2;
          (meta as any)._finalH = Math.floor(expH / 2) * 2;
        }

        padLabels.push(`[${finalClipLabel}]`);

        // Track audio
        const shouldProcessAudio =
          (meta.type === 'video' || meta.type === 'audio') &&
          meta.hasAudio === true;

        if (shouldProcessAudio) {
          const inIdx = meta._inputIndex;
          const aLabel = `a${inIdx}_m${mediaIndex}`;

          if (cutInfo) {
            const sStart = Number(meta._sourceStart) || 0;
            const relStart = (Number(meta.start) || 0) - sStart;
            const relEnd = (Number(meta.end) || 0) - sStart;
            const hasInputSeeking = meta._sourceStart !== undefined;

            if (
              hasInputSeeking &&
              Math.abs(relStart) < 0.001 &&
              (meta._sourceDuration === undefined ||
                Math.abs(relEnd - meta._sourceDuration) < 0.001)
            ) {
              parts.push(`[${inIdx}:a]asetpts=PTS-STARTPTS[${aLabel}]`);
            } else {
              parts.push(
                `[${inIdx}:a]atrim=start=${Math.max(0, relStart).toFixed(3)}:end=${Math.max(0, relEnd).toFixed(3)},asetpts=PTS-STARTPTS[${aLabel}]`,
              );
            }

            const cutStartTime = meta.startTime ?? start;
            const cutEndTime = meta.endTime ?? end;
            audioInputs.push({
              inputIndex: inIdx,
              startTime: cutStartTime,
              endTime: cutEndTime,
              volume: meta.volume ?? 1.0,
              meta: { ...meta, _audioLabel: `[${aLabel}]` },
            });
          } else {
            audioInputs.push({
              inputIndex: inIdx,
              startTime: start,
              endTime: end,
              volume: meta.volume ?? 1.0,
              meta,
            });
          }
        }
      });

      // --- Step 1b: Track audio-only media ---
      overlayMedia.forEach((media, mediaIndex) => {
        const meta = media.meta;

        // Only process audio-only media types (skipped from video processing)
        if (meta.type !== 'audio') {
          return;
        }

        const inIdx = meta._inputIndex;
        if (inIdx === undefined) {
          this.logger.warn(`Missing _inputIndex for audio media ${mediaIndex}`);
          return;
        }

        const start = Math.max(0, meta.startTime ?? 0);
        const end = Math.max(
          start + 0.1,
          meta.endTime ?? start + (meta.duration || 3),
        );

        // Check if this audio media has cuts
        const cutInfo = meta._cutInfo;
        if (cutInfo) {
          // Process cuts for audio-only media
          const aLabel = `a${inIdx}_cut${cutInfo.cutIndex}_m${mediaIndex}`;

          // Trim audio segment for this cut
          const sStart = Number(meta._sourceStart) || 0;
          const relStart = (Number(meta.start) || 0) - sStart;
          const relEnd = (Number(meta.end) || 0) - sStart;

          // If using optimized input-level seeking (-ss/-t), skip atrim filter if perfectly aligned
          const hasInputSeeking = meta._sourceStart !== undefined;
          if (
            hasInputSeeking &&
            Math.abs(relStart) < 0.001 &&
            (meta._sourceDuration === undefined ||
              Math.abs(relEnd - meta._sourceDuration) < 0.001)
          ) {
            parts.push(`[${inIdx}:a]asetpts=PTS-STARTPTS[${aLabel}]`);
          } else {
            parts.push(
              `[${inIdx}:a]atrim=start=${Math.max(0, relStart).toFixed(3)}:end=${Math.max(0, relEnd).toFixed(3)},asetpts=PTS-STARTPTS[${aLabel}]`,
            );
          }

          const cutStartTime = meta.startTime ?? start;
          const cutEndTime = meta.endTime ?? end;
          audioInputs.push({
            inputIndex: inIdx,
            startTime: cutStartTime,
            endTime: cutEndTime,
            volume: meta.volume ?? 1.0,
            meta: {
              ...meta,
              _audioLabel: `[${aLabel}]`,
            },
          });
        } else {
          // No cuts - track the full audio file
          audioInputs.push({
            inputIndex: inIdx,
            startTime: start,
            endTime: end,
            volume: meta.volume ?? 1.0,
            meta,
          });
        }
      });
    } catch (error) {
      throw new Error(
        `Error during visual/audio filter generation for media: ${error.message}`,
      );
    }

    let alignedTransitions: any[] = [];
    try {
      // --- Step 2: Sanitize transitions ---
      const sanitizedTransitions = this.ENABLE_TRANSITION_SANITIZATION
        ? transitions.map((tr, idx) => {
            try {
              const s = this.sanitizeTransitionData(tr);
              this.logger.debug(
                `Sanitized transition ${idx}: ${JSON.stringify(s)}`,
              );
              return s;
            } catch (err) {
              this.logger.error(
                `Error sanitizing transition ${idx}: ${err?.message}`,
              );
              return this.sanitizeTransitionData(null);
            }
          })
        : transitions.map((tr) => ({
            type: tr.type,
            start: this.parseTimeToSeconds(tr.start) ?? 0,
            duration: Number(tr.duration) || 0,
          }));

      alignedTransitions = this.alignTransitionsBetweenMedia(
        overlayMedia,
        sanitizedTransitions,
      );
    } catch (error) {
      throw new Error(`Error aligning transitions: ${error.message}`);
    }

    try {
      // --- Step 3: Build per-layer streams with xfade, then overlay by zIndex ---
      const visualIndexes: number[] = [];
      padLabels.forEach((label, idx) => {
        if (label) visualIndexes.push(idx);
      });

      const zToIndexes = new Map<number, number[]>();
      for (const idx of visualIndexes) {
        const z =
          typeof overlayMedia[idx].meta?.zIndex === 'number'
            ? overlayMedia[idx].meta.zIndex
            : 9999;
        if (!zToIndexes.has(z)) zToIndexes.set(z, []);
        zToIndexes.get(z)!.push(idx);
      }

      const layerLabels: Array<{
        z: number;
        label: string;
        x: number;
        y: number;
      }> = [];
      const sortedZ = Array.from(zToIndexes.keys()).sort((a, b) => b - a);
      let globalXfadeCounter = 0;

      const cwEven = Math.max(2, Math.floor(canvasW / 2) * 2);
      const chEven = Math.max(2, Math.floor(canvasH / 2) * 2);

      // --- Step 3: Layering ---
      // Start with the base black canvas [0:v] scaled to canvas size
      // Start with the base black canvas [0:v] scaled to canvas size with alpha support
      parts.push(`[0:v]scale=${cwEven}:${chEven},format=yuva420p,setsar=1[bg]`);
      let overlayChainLabel = '[bg]';

      for (const z of sortedZ) {
        const indexes = zToIndexes.get(z)!;
        if (!indexes || indexes.length === 0) continue;

        // Sort clips within the same z-index by their start time
        indexes.sort(
          (a, b) =>
            (overlayMedia[a].meta.startTime ?? 0) -
            (overlayMedia[b].meta.startTime ?? 0),
        );

        // Helper to prepare a clip for layering (crop/pad to canvas)
        const getPaddedLabel = (idx: number): string => {
          const meta = overlayMedia[idx].meta;
          const px = meta._finalX ?? 0;
          const py = meta._finalY ?? 0;
          const imgW = meta._finalW ?? cwEven;
          const imgH = meta._finalH ?? chEven;
          const lIn = padLabels[idx]!;
          const lOut = `l${z}_p${idx}`;

          // Calculate intersection rectangle on canvas space
          const ix = Math.max(0, px);
          const iy = Math.max(0, py);
          const iRight = Math.min(cwEven, px + imgW);
          const iBottom = Math.min(chEven, py + imgH);
          const iw = Math.max(0, iRight - ix);
          const ih = Math.max(0, iBottom - iy);

          if (iw <= 0 || ih <= 0) {
            parts.push(
              `${lIn}crop=2:2:0:0,pad=${cwEven}:${chEven}:0:0:color=0x00000000[${lOut}]`,
            );
          } else {
            const cropX = ix - px;
            const cropY = iy - py;
            if (cropX === 0 && cropY === 0 && iw === imgW && ih === imgH) {
              parts.push(
                `${lIn}pad=${cwEven}:${chEven}:${px}:${py}:color=0x00000000[${lOut}]`,
              );
            } else {
              const cropCmd = `crop=${iw}:${ih}:${cropX}:${cropY}`;
              const padCmd = `pad=${cwEven}:${chEven}:${ix}:${iy}:color=0x00000000`;
              parts.push(`${lIn}${cropCmd},${padCmd}[${lOut}]`);
            }
          }
          return `[${lOut}]`;
        };

        // Group clips into chains based on valid EXPLICIT transitions
        const chains: number[][] = [];
        let currentChain: number[] = [indexes[0]];

        for (let k = 0; k < indexes.length - 1; k++) {
          const i = indexes[k];
          const j = indexes[k + 1];
          const clipA = overlayMedia[i].meta;
          const clipB = overlayMedia[j].meta;

          const durA =
            Number(clipA.duration ?? (clipA.endTime - clipA.startTime || 0)) ||
            0;
          const clipAEndTime = (clipA.startTime ?? 0) + durA;
          const tolerance = this.getTransitionAlignmentTolerance();

          const clipAId =
            clipA.id ||
            clipA._cutInfo?.cutId ||
            clipA._cutInfo?.originalMeta?.id;
          const clipBId =
            clipB.id ||
            clipB._cutInfo?.cutId ||
            clipB._cutInfo?.originalMeta?.id;

          // Check for aligned explicit transition
          const tr = alignedTransitions.find((t) => {
            // 1. Explicit ID-based match (highest priority/certainty)
            if (t.fromId && t.toId && clipAId && clipBId) {
              if (t.fromId === clipAId && t.toId === clipBId) return true;
            }

            const st = Number(t.start ?? 0);
            const dur = Number(t.duration ?? 0);
            // Transition ends at (start + duration), which should align with clip A's end time
            // because the transition 'eats' into the end of clip A
            const match = Math.abs(st + dur - clipAEndTime) <= tolerance;

            if (!match && Math.abs(st + dur - clipAEndTime) < 2.0) {
              // this.logger.debug(`Transition mismatch at ${i}->${j}: ClipEnd=${clipAEndTime.toFixed(3)}, TrEnd=${(st+dur).toFixed(3)}, Diff=${(st+dur-clipAEndTime).toFixed(3)}`);
            }

            return match;
          });

          if (tr) {
            this.logger.debug(
              `[Layering] Found transition for clip ${i} (${clipAId}) -> ${j} (${clipBId}): ${tr.type}`,
            );
          } else {
            this.logger.debug(
              `[Layering] No transition found for clip ${i} (${clipAId}) -> ${j} (${clipBId})`,
            );
          }

          // Check if frames belong to the same original cut (keyframe segments)
          // We MUST use hard cuts (no xfade) for keyframe segments per user request
          const isSameMedia =
            overlayMedia[i]._expandedInfo?.originalIndex ===
            overlayMedia[j]._expandedInfo?.originalIndex;

          const isSameCut =
            isSameMedia &&
            clipA._cutInfo &&
            clipB._cutInfo &&
            clipA._cutInfo.cutId === clipB._cutInfo.cutId &&
            clipA._cutInfo.cutIndex === clipB._cutInfo.cutIndex;

          this.logger.debug(
            `[Layering] Pair (${i},${j}): isSameMedia=${isSameMedia}, isSameCut=${isSameCut}. ` +
              `ClipA(cutId=${clipA._cutInfo?.cutId}, idx=${clipA._cutInfo?.cutIndex}), ` +
              `ClipB(cutId=${clipB._cutInfo?.cutId}, idx=${clipB._cutInfo?.cutIndex})`,
          );

          if (tr && !isSameCut) {
            // Valid explicit transition between DIFFERENT cuts -> Chain them
            currentChain.push(j);
          } else {
            // Same cut (keyframe) OR no transition -> Break chain (Hard Cut)
            if (isSameCut) {
              this.logger.debug(
                `[Layering] Skipping xfade for (${i},${j}) - it is the SAME original cut (keyframe segment)`,
              );
            }
            chains.push(currentChain);
            currentChain = [j];
          }
        }
        chains.push(currentChain);

        // Process each chain and overlay onto background
        for (const chain of chains) {
          let layerLabel = '';
          let layerStart = 0;

          if (chain.length === 1) {
            // Single clip (hard cut segment) - Use DYNAMIC overlay
            const idx = chain[0];
            const meta = overlayMedia[idx].meta;
            layerStart = meta.startTime ?? 0;
            const overlayEnd =
              meta.endTime ?? layerStart + (Number(meta.duration) || 0);

            // Use the original source label (scaled but not padded to canvas)
            const sourceLabel = padLabels[idx]!;

            // Restore dynamic positioning logic
            // Use expressions if available (from keyframe interpolation), otherwise fall back to static final pos
            const xOverlay = meta._xExpr
              ? `(${meta._xExpr})`
              : (meta._finalX ?? 0);
            const yOverlay = meta._yExpr
              ? `(${meta._yExpr})`
              : (meta._finalY ?? 0);

            const nextOverlayLabel = `ov_${z}_${idx}`;
            parts.push(
              `${overlayChainLabel}${sourceLabel}overlay=shortest=0:eof_action=pass:x=${this.sanitizeExpression(String(xOverlay))}:y=${this.sanitizeExpression(String(yOverlay))}:eval=frame:enable='between(t,${layerStart.toFixed(3)},${overlayEnd.toFixed(3)})'[${nextOverlayLabel}]`,
            );
            overlayChainLabel = `[${nextOverlayLabel}]`;
            continue; // Skip the generic overlay step below
          } else {
            // Chain of transitions (Xfade sequence)
            const firstIdx = chain[0];
            layerStart = overlayMedia[firstIdx].meta.startTime ?? 0;
            let chainPrevLabel = getPaddedLabel(firstIdx);
            let currentOffset = 0;

            for (let k = 0; k < chain.length - 1; k++) {
              const idxA = chain[k];
              const idxB = chain[k + 1];
              const clipA = overlayMedia[idxA].meta;
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const clipB = overlayMedia[idxB].meta;

              let durA =
                Number(
                  clipA.duration ?? (clipA.endTime - clipA.startTime || 0),
                ) || 0;
              const clipAEndTime = (clipA.startTime ?? 0) + durA;

              // Find the transition again to get params
              const tolerance = this.getTransitionAlignmentTolerance();
              const tr = alignedTransitions.find((t) => {
                const clipAId =
                  clipA.id ||
                  clipA._cutInfo?.cutId ||
                  clipA._cutInfo?.originalMeta?.id;
                const clipBId =
                  clipB.id ||
                  clipB._cutInfo?.cutId ||
                  clipB._cutInfo?.originalMeta?.id;

                // 1. Explicit ID-based match
                if (t.fromId && t.toId && clipAId && clipBId) {
                  if (t.fromId === clipAId && t.toId === clipBId) return true;
                }

                // 2. Timing-based fallback
                const st = Number(t.start ?? 0);
                const dur = Number(t.duration ?? 0);
                return Math.abs(st + dur - clipAEndTime) <= tolerance;
              });

              // Default to fade if somehow missing (shouldn't happen due to logic above) but safe fallback
              const transType =
                tr && this.isSupportedTransition(tr.type) ? tr.type : 'fade';
              const transDur = this.safeParseTime(tr?.duration, 1);

              /**
               * FIX: Media Alignment
               * xfade 'eats' into the duration of preceding segments.
               * To keep the start time of idxB exactly at its intended timeline position:
               * 1. The offset MUST be exactly (clipB.startTime - firstClipInChain.startTime).
               * 2. The combined duration of everything before clipB must be at least (offset + transDur).
               * 3. If it's shorter, we use tpad to extend the preceding stream's end (freeze last frame).
               */
              const intendedStartTimeB = clipB.startTime ?? 0;
              const chainHeadStartTime =
                overlayMedia[firstIdx].meta.startTime ?? 0;
              const xfadeOffset = intendedStartTimeB - chainHeadStartTime;

              // Security check: if somehow xfadeOffset is negative (shouldn't happen with sorted clips), fallback
              const finalOffset = Math.max(0, xfadeOffset);

              // Check if chainPrevLabel currently has enough duration
              // currentOffset is the 'head' position of the current stream.
              // We need it to reach finalOffset + transDur.
              const requiredDuration = finalOffset + transDur;
              const currentStreamDuration = currentOffset + durA;

              if (currentStreamDuration < requiredDuration) {
                const padAmount = requiredDuration - currentStreamDuration;
                const paddedPrev = `xf_pad_${z}_${firstIdx}_${k}`;
                // Extend the previous chain by padAmount (freeze last frame)
                parts.push(
                  `${chainPrevLabel}tpad=stop_duration=${padAmount.toFixed(3)}:stop_mode=clone[${paddedPrev}]`,
                );
                chainPrevLabel = `[${paddedPrev}]`;
                // Technically the 'logical' duration of A in the chain context is now expanded
              }

              const rightLabel = getPaddedLabel(idxB);
              const xfOut = `xf_${z}_${firstIdx}_${k}`;

              parts.push(
                `${chainPrevLabel}${rightLabel}xfade=transition=${transType}:duration=${transDur.toFixed(3)}:offset=${finalOffset.toFixed(3)}[${xfOut}]`,
              );

              chainPrevLabel = `[${xfOut}]`;
              // Update the current logical head of the chain to the start of clip B
              // After xfade, the next clip in the chain will start at finalOffset relative to the new stream's 0.
              currentOffset = finalOffset;
              // Update durA to the duration of the clip we just added (clipB)
              const nextDurB =
                Number(
                  clipB.duration ?? (clipB.endTime - clipB.startTime || 0),
                ) || 0;
              durA = nextDurB;
            }
            layerLabel = chainPrevLabel;
          }

          // Overlay this chain result onto the accumulator
          const nextOverlayLabel = `ov_${z}_${chain[0]}`;

          // Note: In our system, Step 1 already shifts clips to their global startTime.
          // xfade correctly preserves the first input's timestamps.
          // Therefore, shiftedLabel and the additional setpts were adding the startTime twice.
          // We remove the shift here as it is redundant and incorrect.

          parts.push(
            `${overlayChainLabel}${layerLabel}overlay=shortest=0:eof_action=pass:x=0:y=0:eval=frame:enable='gte(t,${layerStart.toFixed(3)})'[${nextOverlayLabel}]`,
          );
          overlayChainLabel = `[${nextOverlayLabel}]`;
        }
      }

      lastVideoLabel = overlayChainLabel;
    } catch (error) {
      throw new Error(
        `Error during layering and transition application: ${error.message}`,
      );
    }

    let finalAudioLabel = '';

    try {
      // --- Step 4: Overlay text ---
      overlayMedia.forEach((media, mediaIndex) => {
        const meta = media.meta;
        if (meta.type === 'text') {
          const start = meta.startTime ?? 0;
          const end = meta.endTime ?? start + (meta.duration || 3);
          const { filter, newLabel } = this.createTextFilter(
            meta,
            start,
            end,
            lastVideoLabel,
          );
          parts.push(filter);
          lastVideoLabel = newLabel;
        }
      });

      // --- Step 5: Final scale/pad (DEPRECATED: Step 3 handles this) ---
      // Background is already sized to cwEven x chEven

      // --- Step 6: Subtitles ---
      if (subtitles && subtitles.length > 0) {
        // Sort subtitles by zIndex (ascending) so higher zIndex are applied later (on top)
        const sortedSubtitles = [...subtitles].sort(
          (a, b) => (b.zIndex || 0) - (a.zIndex || 0),
        );

        for (let i = 0; i < sortedSubtitles.length; i++) {
          const sub = sortedSubtitles[i];
          if (!sub.path) continue;

          const { filter, newLabel } = this.createSubtitleFilters(
            sub.path,
            lastVideoLabel,
            sub.options,
            i,
          );
          parts.push(filter);
          lastVideoLabel = newLabel;
        }
      }

      // --- Step 7: Audio ---
      const audioResult = this.createAudioFilters(audioInputs);
      finalAudioLabel = audioResult.finalLabel;
      parts.push(...audioResult.filters);
    } catch (error) {
      throw new Error(
        `Error during text/subtitle/audio overlay: ${error.message}`,
      );
    }

    const filterComplex = parts.join(';\n');
    this.validateFilterComplex(filterComplex, parts);

    // Perform integrity check before returning
    const integrityReport = this.validateCommandIntegrity(
      input,
      localMedia,
      alignedTransitions,
    );

    return {
      filterComplex,
      finalVideoLabel: lastVideoLabel,
      finalAudioLabel,
      audioInputs,
      integrityReport,
      totalVisualSegments,
    };
  }
}
