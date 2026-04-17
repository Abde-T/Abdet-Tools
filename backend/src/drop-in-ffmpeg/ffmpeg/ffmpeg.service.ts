/**
 * FFMPEG SERVICE — High-Level Video Orchestration Engine
 * =========================================================
 * This service acts as the primary entry point for video exports. It is 
 * designed to be "Drop-in" and framework-agnostic.
 * 
 * CORE RESPONSIBILITIES:
 * 1. Binary Resolution: Locates ffmpeg and ffprobe on the system or uses bundled ones.
 * 2. Media Pre-processing: Resolves remote URLs and local Base64 blobs into temporary local files.
 * 3. Timeline Flattening: Expands complex "cuts" and track-based clips into a flat list for FFmpeg.
 * 4. Orchestration: Controls the FFmpeg rendering lifecycle via FfmpegHelpers.
 * 5. Progress Tracking: Provides a standardized callback for UI updates.
 * 
 * DEPENDENCIES:
 *   - fluent-ffmpeg: Command builder
 *   - ffmpeg-static: Fallback binaries
 *   - fs / path: File system operations
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ffmpegStatic = require('ffmpeg-static') as string;
import { randomUUID } from 'crypto';
import type { GenerateVideoInput } from './ffmpeg.model.js';
import { FfmpegHelpers } from './ffmpeg.helpers.js';

// ---------------------------------------------------------------------------
// FFmpeg binary resolution
// Priority: FFMPEG_PATH env var → system binary → ffmpeg-static package
// ---------------------------------------------------------------------------
let ffmpegPath: string;
let ffprobePath: string;
let hasXfadeSupport = false;

/**
 * Logic to find valid FFmpeg binaries on the host machine.
 * Priority: 1. Environment Variables -> 2. Bundled Package -> 3. Error
 */
function resolveFFmpegBinaries() {
  // 1. Prefer explicit env-var paths (production Docker / CI)
  const envFfmpeg = process.env.FFMPEG_PATH;
  const envFfprobe = process.env.FFPROBE_PATH;

  if (envFfmpeg && fs.existsSync(envFfmpeg) && envFfprobe && fs.existsSync(envFfprobe)) {
    ffmpegPath = envFfmpeg;
    ffprobePath = envFfprobe;
  } else if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    // 2. Fall back to ffmpeg-static (bundled binary)
    ffmpegPath = ffmpegStatic;
    ffprobePath = require('@ffprobe-installer/ffprobe').path;
  } else {
    throw new Error(
      'FFmpeg binary not found. Set FFMPEG_PATH / FFPROBE_PATH env vars or install ffmpeg-static.',
    );
  }

  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);

  // Detect xfade support from version string
  try {
    const { execSync } = require('child_process');
    const version = execSync(`"${ffmpegPath}" -version`, { encoding: 'utf8' });
    const m = version.match(/ffmpeg version (\d+)\.(\d+)/);
    if (m) {
      hasXfadeSupport = parseInt(m[1]) > 4 || (parseInt(m[1]) === 4 && parseInt(m[2]) >= 0);
    }
  } catch {
    hasXfadeSupport = false;
  }

  console.log(`[FfmpegService] Using FFmpeg: ${ffmpegPath} (xfade: ${hasXfadeSupport})`);
}

resolveFFmpegBinaries();

// ---------------------------------------------------------------------------
// Font name → file mapping (place .ttf / .otf files in src/fonts/)
// Add or remove entries here to match the fonts you have on disk.
// ---------------------------------------------------------------------------
const FONT_MAPPING: Record<string, string> = {
  Montserrat: 'Montserrat-VariableFont_wght.ttf',
  Bungee: 'Bungee-Regular.ttf',
  'Luckiest Guy': 'LuckiestGuy-Regular.ttf',
  'Komika Axis': 'KOMIKAX_.ttf',
  'Bebas Neue': 'BebasNeue-Regular.ttf',
  'The Bold Font': 'THEBOLDFONT-FREEVERSION.ttf',
  Fredoka: 'Fredoka-Bold.ttf',
};

// ---------------------------------------------------------------------------
// Progress callback type
// ---------------------------------------------------------------------------
export interface ExportProgress {
  /** 0–100 */
  percent: number;
  /** Human-readable status message */
  message: string;
}

/** Optional callback invoked throughout the render. Wire it to sockets, SSE, logs — anything. */
export type ProgressCallback = (progress: ExportProgress) => void;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------
export interface ExportVideoResult {
  /** Absolute path of the rendered video file on disk. Upload it wherever you need. */
  outputPath: string;
}

// ---------------------------------------------------------------------------
// FfmpegService
// ---------------------------------------------------------------------------
/**
 * The FfmpegService class encapsulates the video rendering logic.
 * It uses FfmpegHelpers for the heavy lifting of filter graph construction.
 */
export class FfmpegService {
  /** Directory where final rendered videos are saved. */
  private readonly outputDir: string;

  /** Directory for temporary media downloads and intermediate scripts. */
  private readonly tmpDir: string;

  /** FFmpeg preset for H.264 encoding speed/quality tradeoff. */
  private readonly ffmpegPreset: string;

  /** Path to the folder containing .ttf font files. */
  private readonly fontsDir: string;

  /** Core logic helper for FFmpeg command building. */
  private readonly helpers: FfmpegHelpers;

  /** State tracking for progress logging to prevent console flooding. */
  private lastLoggedProgress = -1;

  constructor(opts?: {
    outputDir?: string;
    tmpDir?: string;
    fontsDir?: string;
    /** FFmpeg preset — see https://trac.ffmpeg.org/wiki/Encode/H.264#Preset */
    preset?: string;
  }) {
    this.outputDir = opts?.outputDir ?? path.join(process.cwd(), 'generated');
    this.tmpDir = opts?.tmpDir ?? path.join(process.cwd(), 'tmp_media');
    this.fontsDir =
      opts?.fontsDir ??
      path.resolve(process.cwd(), 'src', 'drop-in-ffmpeg', 'fonts');
    this.ffmpegPreset = opts?.preset ?? 'ultrafast';

    // Ensure working directories exist
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.mkdirSync(this.tmpDir, { recursive: true });

    if (!fs.existsSync(this.fontsDir)) {
      console.warn(
        `[FfmpegService] Fonts directory not found at: ${this.fontsDir}`,
      );
    }

    this.helpers = new FfmpegHelpers(
      // FfmpegHelpers expects a logger-like object with .debug / .warn / .error / .log
      // We provide a thin console adapter so buyers can swap it for their own logger.
      {
        debug: (msg: string) => console.debug(`[FfmpegHelpers] ${msg}`),
        log: (msg: string) => console.log(`[FfmpegHelpers] ${msg}`),
        warn: (msg: string) => console.warn(`[FfmpegHelpers] ${msg}`),
        error: (msg: string) => console.error(`[FfmpegHelpers] ${msg}`),
      } as any,
      this.tmpDir,
      hasXfadeSupport,
      { fontsDir: this.fontsDir },
    );
  }

  // -------------------------------------------------------------------------
  // exportVideo
  // -------------------------------------------------------------------------

  /**
   * Renders a video from the supplied timeline input and returns the local
   * file path of the output MP4 (or whatever format you configured).
   *
   * @param input       Timeline data — see GenerateVideoInput in ffmpeg.model.ts
   * @param onProgress  Optional callback invoked with progress updates (0–100 + message).
   *                    Connect it to your socket / SSE / HTTP long-poll / logger.
   *
   * @returns           { outputPath } — absolute path to the rendered file on disk.
   *
   * @example
   *   const svc = new FfmpegService();
   *   const { outputPath } = await svc.exportVideo(myTimelineInput, (p) => {
   *     io.to(roomId).emit('progress', p);          // socket.io
   *     res.write(`data: ${JSON.stringify(p)}\n\n`); // SSE
   *     console.log(p.message);                      // just log it
   *   });
   *   // Now upload outputPath to S3 / Backblaze / Cloudflare R2 yourself:
   *   const url = await uploadToS3(outputPath);
   */
  /**
   * Main entry point to render a video.
   * 
   * @param input - The timeline definition, including media items, cuts, and transitions.
   * @param onProgress - Optional callback for real-time progress updates (0-100).
   * @returns An object containing the absolute outputPath of the generated MP4.
   * @throws Error if media resolution or rendering fails.
   */
  async exportVideo(
    input: GenerateVideoInput,
    onProgress?: ProgressCallback,
  ): Promise<ExportVideoResult> {
    if (!input.media) throw new Error('input.media is required');

    const emit = (percent: number, message: string) =>
      onProgress?.({ percent, message });

    emit(0, 'Getting everything ready...');

    const localMedia: Array<{ localPath: string; meta: any }> = [];
    let preRenderPath: string | null = null;

    emit(5, 'Loading your images and videos...');

    // ------------------------------------------------------------------
    // 1. Flatten all media items from the organised structure
    // ------------------------------------------------------------------
    const allMediaItems = [
      ...(input.media.images || []).map((m) => ({ ...m, type: 'image' })),
      ...(input.media.videos || []).map((m) => ({ ...m, type: 'video' })),
      ...(input.media.audio || []).map((m) => ({ ...m, type: 'audio' })),
      ...(input.media.gif || []).map((m) => ({ ...m, type: 'gif' })),
      ...(input.media.text || []).map((m) => ({ ...m, type: 'text' })),
    ];

    // ------------------------------------------------------------------
    // 2. Expand cuts into individual timeline segments for input seeking
    // ------------------------------------------------------------------
    const mediaItemsToProcess: any[] = [];
    for (const item of allMediaItems) {
      if (item.cuts && Array.isArray(item.cuts) && item.cuts.length > 0 && item.type !== 'text') {
        for (let i = 0; i < item.cuts.length; i++) {
          const cut = item.cuts[i];
          const timelineStart = Number(cut.timelineStart ?? item.startTime) || 0;
          const cutStart = Number(cut.start) || 0;
          const cutEnd = Number(cut.end) || 0;
          const duration = Math.max(0, cutEnd - cutStart);
          mediaItemsToProcess.push({
            ...item,
            ...cut,
            startTime: timelineStart,
            endTime: timelineStart + duration,
            duration,
            _sourceStart: cutStart,
            _sourceDuration: duration,
            _cutInfo: { cutIndex: i, originalMeta: item },
            cuts: undefined,
          });
        }
      } else {
        mediaItemsToProcess.push(item);
      }
    }

    // ------------------------------------------------------------------
    // 3. Download / resolve media files (parallel, concurrency-limited)
    // ------------------------------------------------------------------
    try {
      // Track which URLs are used more than once — they need a local copy to
      // avoid throttling issues with remote storage (e.g. Backblaze B2).
      const urlFrequency = new Map<string, number>();
      for (const item of mediaItemsToProcess) {
        if (!item.url || item.type === 'text') continue;
        urlFrequency.set(item.url, (urlFrequency.get(item.url) || 0) + 1);
      }

      const forcedDownloadCache = new Map<string, Promise<string>>();
      const concurrencyLimit = 10;

      const processMediaItem = async (m: any): Promise<{ localPath: string; meta: any } | null> => {
        if (!m.type) throw new Error('Each media item must have a type');
        if (m.type === 'text') return { localPath: '', meta: m };
        if (!m.url) throw new Error(`Media item of type '${m.type}' is missing a url`);

        const urlUsedMultipleTimes = (urlFrequency.get(m.url) || 1) > 1;

        let localPath: string;
        if (urlUsedMultipleTimes) {
          if (!forcedDownloadCache.has(m.url)) {
            forcedDownloadCache.set(m.url, this.helpers.downloadToTemp(m.url, true));
          }
          localPath = await forcedDownloadCache.get(m.url)!;
        } else if (!/^https?:\/\//i.test(m.url) && !m.url.startsWith('data:')) {
          // Local file path — use directly
          localPath = m.url;
        } else {
          const useCache = m.type === 'image';
          localPath = await this.helpers.downloadToTemp(m.url, useCache);
        }

        // Detect audio presence for video items if not already provided
        if (m.type === 'video' && typeof m.hasAudio !== 'boolean') {
          m.hasAudio = await this.helpers.hasAudioStream(localPath);
        }

        return { localPath, meta: m };
      };

      const results: Array<{ localPath: string; meta: any } | null> = [];
      const executing = new Set<Promise<void>>();

      for (let i = 0; i < mediaItemsToProcess.length; i++) {
        const item = mediaItemsToProcess[i];
        const idx = i;
        const p = processMediaItem(item)
          .then((result) => {
            if (result) {
              (result as any)._originalIndex = idx;
              results.push(result);
            }
          })
          .finally(() => executing.delete(p));
        executing.add(p);
        if (executing.size >= concurrencyLimit) await Promise.race(executing);
      }
      await Promise.all(Array.from(executing));

      results.sort((a, b) => ((a as any)._originalIndex ?? 0) - ((b as any)._originalIndex ?? 0));
      results.forEach((r) => { if (r) delete (r as any)._originalIndex; });
      localMedia.push(...results.filter((r): r is { localPath: string; meta: any } => r !== null));

      console.log(`[FfmpegService] Resolved ${localMedia.length} media items`);
    } catch (error) {
      // Clean up any already-downloaded temp files before re-throwing
      for (const lm of localMedia) {
        try {
          if (lm.localPath.includes(this.tmpDir)) fs.unlinkSync(lm.localPath);
        } catch {}
      }
      throw new Error(`Failed to resolve media files: ${error.message}`);
    }

    emit(15, 'All files loaded successfully');
    emit(20, 'Building your video...');

    // ------------------------------------------------------------------
    // 4. Temporary file cleanup helper
    // ------------------------------------------------------------------
    const subtitlesList: Array<{ path: string; zIndex?: number; options?: any }> = [];
    let baseCanvasPath: string | null = null;

    const cleanupTempFiles = async () => {
      for (const lm of localMedia) {
        try {
          if (lm.localPath.includes(this.tmpDir)) fs.unlinkSync(lm.localPath);
        } catch {}
      }
      for (const sub of subtitlesList) {
        try { if (sub.path) fs.unlinkSync(sub.path); } catch {}
      }
      if (baseCanvasPath) { try { fs.unlinkSync(baseCanvasPath); } catch {} }
      if (preRenderPath && fs.existsSync(preRenderPath)) {
        try { fs.unlinkSync(preRenderPath); } catch {}
      }
    };

    // ------------------------------------------------------------------
    // 5. Build subtitle files
    // ------------------------------------------------------------------
    if (input.subtitles && Array.isArray(input.subtitles)) {
      for (const sub of input.subtitles) {
        if (!sub.srt?.trim()) continue;
        const subtitlePath = await this.helpers.createAdvancedSubtitleFile(sub.srt, {
          ...sub.styling,
          aspectRatio: input.output?.aspectRatio,
        });
        subtitlesList.push({ path: subtitlePath, zIndex: sub.zIndex, options: sub.styling });
      }
    }

    // ------------------------------------------------------------------
    // 6. Canvas dimensions and output path
    // ------------------------------------------------------------------
    const fps = 30;
    const { width: canvasW, height: canvasH } = this.helpers.calculateCanvasDimensions(input.output);

    let totalDuration = 0;
    for (const { meta } of localMedia) {
      const e = (meta.endTime ?? (meta.startTime ?? 0) + (meta.duration || 3));
      if (e > totalDuration) totalDuration = e;
    }
    if (totalDuration === 0) totalDuration = localMedia.length * 3 || 3;

    const outputPath = path.join(
      this.outputDir,
      `video-${Date.now()}-${randomUUID().slice(0, 6)}.${input.output?.format || 'mp4'}`,
    );

    // ------------------------------------------------------------------
    // 7. Setup FFmpeg command
    // ------------------------------------------------------------------
    const command = ffmpeg();

    // Black canvas base layer (tiny PNG looped for totalDuration)
    const tinyBlackPng = await this.helpers.createTinyBlackPng();
    baseCanvasPath = tinyBlackPng;
    command
      .input(tinyBlackPng)
      .inputOptions([
        '-probesize', '32k',
        '-analyzeduration', '0',
        '-loop', '1',
        '-t', totalDuration.toString(),
        '-framerate', fps.toString(),
      ]);

    this.helpers.processMediaInputs(localMedia, command, fps);

    // ------------------------------------------------------------------
    // 8. Build filter_complex
    // ------------------------------------------------------------------
    let filterComplex: string,
      finalVideoLabel: string,
      finalAudioLabel: string,
      totalVisualSegments: number;

    const buildFilters = (w: number, h: number) =>
      this.helpers.buildFilterComplex(input, localMedia, allMediaItems, input.transitions || [], w, h, fps, subtitlesList);

    try {
      ({ filterComplex, finalVideoLabel, finalAudioLabel, totalVisualSegments } = buildFilters(canvasW, canvasH));
    } catch (error) {
      await cleanupTempFiles();
      throw new Error(`Filter complex construction failed: ${error.message}`);
    }

    // ------------------------------------------------------------------
    // 9. Upscaling — render at 1080p first, then upscale (saves VRAM/time)
    // ------------------------------------------------------------------
    const targetResolution = input.output?.resolution;
    const isUpscalingNeeded = targetResolution === '1440p' || targetResolution === '4k';
    let finalWidth = canvasW;
    let finalHeight = canvasH;
    let renderWidth = canvasW;
    let renderHeight = canvasH;
    let videoBitrate = '2000k';
    let audioBitrate = '128k';

    switch (input.output?.quality) {
      case 'low':   videoBitrate = '1000k'; audioBitrate = '96k';  break;
      case 'medium': videoBitrate = '2000k'; audioBitrate = '128k'; break;
      case 'high':  videoBitrate = '3000k'; audioBitrate = '192k'; break;
      case 'ultra': videoBitrate = '5000k'; audioBitrate = '256k'; break;
    }

    if (isUpscalingNeeded) {
      const temp1080 = this.helpers.calculateCanvasDimensions({ resolution: '1080p', aspectRatio: input.output?.aspectRatio });
      renderWidth = temp1080.width;
      renderHeight = temp1080.height;
      preRenderPath = path.join(this.outputDir, `pre-render-${Date.now()}.mp4`);
      try {
        ({ filterComplex, finalVideoLabel, finalAudioLabel, totalVisualSegments } = buildFilters(renderWidth, renderHeight));
      } catch (error) {
        await cleanupTempFiles();
        throw new Error(`Filter complex (1080p pass) failed: ${error.message}`);
      }
    }

    // ------------------------------------------------------------------
    // 10. Apply the filter graph (use script file for large graphs)
    // ------------------------------------------------------------------
    const filterComplexPath = path.join(this.tmpDir, `filter-${Date.now()}-${randomUUID().slice(0, 8)}.fs`);
    const useFilterScript = filterComplex.length > 5000;

    if (useFilterScript) {
      try {
        fs.writeFileSync(filterComplexPath, filterComplex);
        command.inputOptions(['-filter_complex_script', filterComplexPath]);
      } catch {
        command.complexFilter(filterComplex);
      }
    } else {
      command.complexFilter(filterComplex);
    }

    command.outputOptions(['-map', finalVideoLabel]);
    if (finalAudioLabel) command.outputOptions(['-map', finalAudioLabel]);

    command.outputOptions([
      '-pix_fmt', 'yuv420p',
      '-crf', '24',
      '-vcodec', 'libx264',
      '-preset', this.ffmpegPreset,
      '-movflags', 'frag_keyframe+empty_moov',
      '-threads', '1',
      '-filter_threads', '1',
      '-filter_complex_threads', '1',
      '-tune', 'fastdecode',
    ]);

    command.videoBitrate(videoBitrate).audioBitrate(audioBitrate);

    // ------------------------------------------------------------------
    // 11. Run FFmpeg render
    // ------------------------------------------------------------------
    emit(25, 'Fine-tuning your video...');

    const startTime = Date.now();
    const actualOutputPath = isUpscalingNeeded ? preRenderPath! : outputPath;

    await new Promise<void>((resolve, reject) => {
      let lastProgressPct = 0;
      let lastEmitTime = Date.now();
      let lastParsedTime = 0;
      let stderrLines: string[] = [];

      // Dynamic timeout: base 2 min + 5s per media + 1s per output second + 2s per segment
      const dynamicTimeoutMs = Math.max(
        120_000,
        localMedia.length * 5000 + totalDuration * 1000 + (totalVisualSegments || 0) * 2000,
      );

      let progressTimeout: NodeJS.Timeout;

      const onTimeout = async () => {
        console.error('[FfmpegService] FFmpeg appears stuck — killing process');
        try { command.kill('SIGKILL'); } catch {}
        await cleanupTempFiles();
        reject(new Error('FFmpeg timed out (no progress)'));
      };
      progressTimeout = setTimeout(onTimeout, dynamicTimeoutMs);

      const sendProgress = (elapsedSec: number) => {
        if (totalDuration <= 0) return;
        const pct = Math.min(100, Math.max(0, (elapsedSec / totalDuration) * 100));
        const adjustedPct = isUpscalingNeeded
          ? 30 + pct * 0.55   // Pass 1: 30 → 85%
          : 30 + pct * 0.60;  // Single pass: 30 → 90%
        const clamped = Math.min(isUpscalingNeeded ? 85 : 90, adjustedPct);
        const now = Date.now();
        if (Math.abs(clamped - lastProgressPct) >= 0.5 || now - lastEmitTime >= 1000) {
          lastProgressPct = clamped;
          lastEmitTime = now;
          this.logProgressBar(pct);
          emit(clamped, 'Creating your video...');
        }
      };

      const parseTime = (line: string): number | null => {
        const m = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
        return null;
      };

      command
        .on('start', (cmd) => {
          console.log(`[FfmpegService] Starting render — ${totalDuration.toFixed(1)}s @ ${renderWidth}x${renderHeight}`);
          console.debug(`[FfmpegService] Command: ${cmd}`);
          emit(30, 'Creating your video...');
        })
        .on('stderr', (line: string) => {
          stderrLines.push(line);
          if (stderrLines.length > 200) stderrLines.shift();
          const t = parseTime(line);
          if (t !== null && t >= lastParsedTime) {
            lastParsedTime = t;
            sendProgress(t);
            clearTimeout(progressTimeout);
            progressTimeout = setTimeout(onTimeout, dynamicTimeoutMs);
          }
        })
        .on('progress', (p: any) => {
          if (p.percent > 0 && Date.now() - lastEmitTime >= 1000) {
            sendProgress((p.percent / 100) * totalDuration);
            clearTimeout(progressTimeout);
            progressTimeout = setTimeout(onTimeout, dynamicTimeoutMs);
          }
        })
        .on('end', () => {
          clearTimeout(progressTimeout);
          console.log(`[FfmpegService] ✅ Rendered in ${((Date.now() - startTime) / 60000).toFixed(2)}min → ${actualOutputPath}`);
          resolve();
        })
        .on('error', async (err: Error) => {
          clearTimeout(progressTimeout);
          console.error(`[FfmpegService] ❌ Render failed: ${err.message}`);
          if (stderrLines.length > 0) {
            console.error('[FfmpegService] === FFmpeg stderr ===');
            stderrLines.forEach((l) => console.error(l));
          }
          await cleanupTempFiles();
          reject(err);
        })
        .save(actualOutputPath);
    });

    // ------------------------------------------------------------------
    // 12. Optional upscaling pass
    // ------------------------------------------------------------------
    if (isUpscalingNeeded) {
      emit(85, 'Enhancing video quality...');
      await new Promise<void>((resolve, reject) => {
        ffmpeg(preRenderPath!)
          .videoFilters([
            { filter: 'scale', options: `${finalWidth}:${finalHeight}` },
            { filter: 'setsar', options: '1/1' },
          ])
          .outputOptions([
            '-sws_flags', 'fast_bilinear',
            '-pix_fmt', 'yuv420p',
            '-crf', '24',
            '-vcodec', 'libx264',
            '-preset', this.ffmpegPreset,
            '-c:a', 'copy',
            '-threads', '1',
            '-tune', 'fastdecode',
          ])
          .videoBitrate(videoBitrate)
          .on('progress', (p: any) => {
            if (p.percent) emit(85 + p.percent * 0.05, 'Enhancing video quality...');
          })
          .on('end', () => resolve())
          .on('error', async (err: Error) => {
            await cleanupTempFiles();
            reject(err);
          })
          .save(outputPath);
      });

      try { if (fs.existsSync(preRenderPath!)) fs.unlinkSync(preRenderPath!); } catch {}
    }

    // ------------------------------------------------------------------
    // 13. Cleanup and return
    // ------------------------------------------------------------------
    await cleanupTempFiles();

    if (useFilterScript && fs.existsSync(filterComplexPath)) {
      try { fs.unlinkSync(filterComplexPath); } catch {}
    }

    if (!fs.existsSync(outputPath)) throw new Error('FFmpeg did not create the output file');

    emit(100, 'Done! Your video is ready.');

    return { outputPath };
  }

  // -------------------------------------------------------------------------
  // Utility — console progress bar
  // -------------------------------------------------------------------------
  private logProgressBar(percent: number, width = 40): void {
    const rounded = Math.floor(percent);
    if (rounded === this.lastLoggedProgress) return;
    this.lastLoggedProgress = rounded;
    const done = Math.round((percent / 100) * width);
    const bar = '█'.repeat(done) + '░'.repeat(width - done);
    console.debug(`[Render] ${bar} ${percent.toFixed(1).padStart(6)}%`);
  }
}

export const ffmpegService = new FfmpegService();
export default ffmpegService;

