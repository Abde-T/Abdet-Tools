import express from 'express';
import { ffmpegService } from '../drop-in-ffmpeg/ffmpeg/ffmpeg.service.js';

const router = express.Router();

// POST /api/export - Generate a video from timeline data
router.post('/export', async (req, res) => {
  try {
    const timelineData = req.body;
    
    if (!timelineData || !timelineData.media) {
      return res.status(400).json({ error: 'Missing timeline media data' });
    }

    console.log('[API] Starting video export...');
    
    // We start the export. In a real production app, you might want to 
    // run this in a worker and return a job ID.
    // For "plug and play" simplicity, we'll return the path when done.
    const result = await ffmpegService.exportVideo(timelineData, (progress) => {
      // Progress updates could be sent via WebSockets or logged
      // console.log(`[Export] ${progress.percent}% - ${progress.message}`);
    });

    res.json({
      success: true,
      message: 'Video rendered successfully',
      outputPath: result.outputPath
    });
  } catch (error) {
    console.error('[API] Export failed:', error);
    res.status(500).json({ 
      error: 'Export failed', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

export default router;
