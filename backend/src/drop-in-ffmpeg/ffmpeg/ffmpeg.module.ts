/**
 * ffmpeg.module.ts — NestJS Integration (Optional)
 * ==================================================
 * Only include this file if you are using NestJS.
 * If you're on Express, Fastify, or plain Node.js — delete this file and
 * instantiate FfmpegService directly in your controller/handler:
 *
 *   import { FfmpegService } from './ffmpeg.service';
 *   const svc = new FfmpegService();
 *   const { outputPath } = await svc.exportVideo(input, onProgress);
 *
 * ─── NestJS setup ────────────────────────────────────────────────────────────
 * 1. Add FfmpegModule to your AppModule imports array.
 * 2. Inject FfmpegService wherever you need it.
 *
 * REQUIRED packages for NestJS:
 *   npm install @nestjs/common @nestjs/core
 *
 * OPTIONAL: if you keep the GraphQL resolver, also install:
 *   npm install @nestjs/graphql graphql
 */

// Uncomment the block below if you are using NestJS:
//
// import { Module } from '@nestjs/common';
// import { FfmpegService } from './ffmpeg.service';
//
// @Module({
//   providers: [FfmpegService],
//   exports: [FfmpegService],
// })
// export class FfmpegModule {}
