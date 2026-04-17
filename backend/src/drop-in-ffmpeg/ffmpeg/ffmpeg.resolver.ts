/**
 * ffmpeg.resolver.ts — GraphQL / REST integration examples
 * ==========================================================
 * This file is NOT required. It shows how to wire FfmpegService into
 * different controller styles. Pick the one that matches your stack.
 *
 * ─── 1. Plain async function (CLI / scripts) ─────────────────────────────────
 *
 *   import { FfmpegService } from './ffmpeg.service';
 *   import { GenerateVideoInput } from './ffmpeg.model';
 *
 *   const svc = new FfmpegService();
 *   const input: GenerateVideoInput = { ... };
 *
 *   const { outputPath } = await svc.exportVideo(input, ({ percent, message }) => {
 *     console.log(`${percent.toFixed(1)}% — ${message}`);
 *   });
 *
 *   console.log('Video ready at:', outputPath);
 *   // Now upload outputPath to S3 / Backblaze / Cloudflare R2 / etc.
 *
 *
 * ─── 2. Express REST endpoint ────────────────────────────────────────────────
 *
 *   import express from 'express';
 *   import { FfmpegService } from './ffmpeg.service';
 *
 *   const app = express();
 *   const svc = new FfmpegService();
 *   app.use(express.json());
 *
 *   app.post('/export', async (req, res) => {
 *     try {
 *       const { outputPath } = await svc.exportVideo(req.body, ({ percent, message }) => {
 *         // Tip: stream progress via SSE or WebSockets from here
 *         console.log(percent, message);
 *       });
 *       res.json({ outputPath });
 *     } catch (err) {
 *       res.status(500).json({ error: err.message });
 *     }
 *   });
 *
 *
 * ─── 3. NestJS REST controller ───────────────────────────────────────────────
 *
 *   import { Controller, Post, Body } from '@nestjs/common';
 *   import { FfmpegService } from './ffmpeg.service';
 *   import { GenerateVideoInput } from './ffmpeg.model';
 *
 *   @Controller('ffmpeg')
 *   export class FfmpegController {
 *     constructor(private readonly ffmpegService: FfmpegService) {}
 *
 *     @Post('export')
 *     async exportVideo(@Body() input: GenerateVideoInput) {
 *       return this.ffmpegService.exportVideo(input, ({ percent, message }) => {
 *         // emit to your socket gateway here
 *       });
 *     }
 *   }
 *
 *
 * ─── 4. NestJS GraphQL resolver (if you still want GQL) ─────────────────────
 *
 *   import { Resolver, Mutation, Args } from '@nestjs/graphql';
 *   import { FfmpegService } from './ffmpeg.service';
 *
 *   @Resolver()
 *   export class FfmpegResolver {
 *     constructor(private readonly ffmpegService: FfmpegService) {}
 *
 *     @Mutation(() => String)
 *     async exportVideo(@Args('input') input: any) {
 *       const { outputPath } = await this.ffmpegService.exportVideo(input);
 *       return outputPath;
 *     }
 *   }
 */
