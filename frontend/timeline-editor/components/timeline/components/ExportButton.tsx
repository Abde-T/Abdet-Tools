/**
 * ExportButton.tsx
 * 
 * A self-contained "Plug and Play" component for the Timeline Editor.
 * This component handles the entire video export workflow:
 * 1. Collects timeline state from Redux.
 * 2. Adapts and prepares the data for the FFmpeg background engine.
 * 3. Resolves local browser blobs to Base64 (for testing/local purposes).
 * 4. Communicates with the backend REST API to trigger rendering.
 * 5. Provides UI feedback for progress and final result.
 */
import React, { useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { 
  Download, Loader2, Sparkles, CheckCircle2, Clock, 
  Zap, AlertCircle
} from 'lucide-react';
import { motion } from 'framer-motion';
import { RootState } from '../../../redux/store';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';

// --- TIMELINE EXPORT DATA ADAPTERS ---
// These are the helper methods to convert frontend timeline state to FFmpeg backend payload.

const stripTypename = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(stripTypename);
  } else if (obj !== null && typeof obj === 'object') {
    const newObj: any = {};
    Object.keys(obj).forEach((key) => {
      if (key !== '__typename') {
        newObj[key] = stripTypename(obj[key]);
      }
    });
    return newObj;
  }
  return obj;
};

const getZIndexFromTrack = (clip: any, tracks: any[]) => {
  const trackIndex = tracks.findIndex((t) => t.id === clip.trackId);
  return trackIndex !== -1 ? trackIndex + 1 : 1;
};

/**
 * Validates if the URL is eligible for export.
 * NOTE: For local testing, we allow browser-specific blob: and data: URLs.
 */
const isUrlValidForExport = (url: string | undefined | null): boolean => {
  if (!url) return false;
  
  /**
   * PRODUCTION TODO:
   * In a production environment, you should only allow public or signed URLs 
   * (e.g., https://your-bucket.s3.amazonaws.com/...) here. 
   * Sending manual blobs/base64 strings is a bottleneck for performance.
   */
  return true;
};

const formatSRTTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
};

const generateSRTContent = (data: { clips: any; mediaItems: any[]; liveDurationOverrides?: any }, specificClips?: any[]) => {
  const { clips, mediaItems, liveDurationOverrides } = data;
  const subtitleClips = specificClips || Object.values(clips).filter((clip: any) => clip.type === 'subtitle').sort((a: any, b: any) => a.start - b.start);

  if (subtitleClips.length > 0) {
    let srtContent = '';
    subtitleClips.forEach((clip: any, index: number) => {
      const mediaItem = mediaItems.find((m: any) => (clip.mediaId && m.id === clip.mediaId) || (clip.url && m.url === clip.url) || (m.name === clip.name && m.type === clip.type));
      const text = mediaItem?.textContent || clip.name || '';
      const actualDuration = liveDurationOverrides?.[clip.id] ?? clip.duration;
      const startTime = clip.start;
      const endTime = startTime + actualDuration;
      srtContent += `${index + 1}\n${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n${text}\n\n`;
    });
    return srtContent;
  }
  return '';
};

const convertClipsToOrganizedMedia = (data: { clips: any; tracks: any[]; mediaItems: any[]; liveDurationOverrides?: any }) => {
  const { clips, tracks, mediaItems, liveDurationOverrides } = data;
  const allClips = Object.values(clips);

  const media = { images: [] as any[], videos: [] as any[], audio: [] as any[], gif: [] as any[], text: [] as any[] };
  const groups = new Map<string, any>();
  const invalids: any[] = [];

  allClips.forEach((clip: any) => {
    let sourceUrl = clip.url || '';
    let textContent = '';
    const mediaItem = mediaItems.find((m: any) => (clip.mediaId && m.id === clip.mediaId) || (clip.url && m.url === clip.url) || (m.name === clip.name && m.type === clip.type));

    if (sourceUrl && !isUrlValidForExport(sourceUrl) && mediaItem?.url && isUrlValidForExport(mediaItem.url)) {
      sourceUrl = mediaItem.url;
    }
    if (!sourceUrl) {
      sourceUrl = mediaItem?.url || '';
      textContent = mediaItem?.textContent || '';
    }

    const actualDuration = liveDurationOverrides?.[clip.id] ?? clip.duration;
    const zIndex = getZIndexFromTrack(clip, tracks);
    const s: any = clip.styling || {};

    if (clip.type !== 'text' && sourceUrl && !isUrlValidForExport(sourceUrl)) {
      invalids.push({ name: clip.name, type: clip.type, url: sourceUrl });
    }

    const baseCut: any = {
      id: clip.id, timelineStart: clip.start, zIndex,
      position: { x: clip.position?.x ?? 50, y: clip.position?.y ?? 50 },
      size: { width: clip.size?.width ?? 100, height: clip.size?.height ?? 100 },
    };

    if (clip.type === 'video' || clip.type === 'audio') {
      const start = Math.max(0, clip.sourceStart || 0);
      const cut: any = { ...baseCut, start, end: start + actualDuration, volume: clip.volume ?? 1, ...s, keyframes: clip.keyframes };
      const key = `${sourceUrl}|${clip.type}`;
      if (!groups.has(key)) groups.set(key, { url: sourceUrl, type: clip.type, cuts: [], isAnimated: clip.isAnimated ?? mediaItem?.isAnimated, hasAudio: clip.hasAudio ?? mediaItem?.hasAudio });
      groups.get(key)!.cuts.push(cut);
    } else if (clip.type === 'image' || clip.type === 'gif') {
      const cut: any = { ...baseCut, start: 0, end: actualDuration, ...s, keyframes: clip.keyframes };
      const key = `${sourceUrl}|${clip.type}`;
      if (!groups.has(key)) groups.set(key, { url: sourceUrl, type: clip.type === 'gif' ? 'gif' : 'image', cuts: [], isAnimated: clip.isAnimated ?? mediaItem?.isAnimated, hasAudio: clip.hasAudio ?? mediaItem?.hasAudio });
      groups.get(key)!.cuts.push(cut);
    } else if (clip.type === 'text') {
      media.text.push({
        url: textContent, type: 'text', text: textContent, duration: actualDuration, startTime: clip.start, endTime: clip.start + actualDuration, zIndex,
        position: { x: clip.position?.x ?? 50, y: clip.position?.y ?? 50 }, size: { width: clip.size?.width ?? 100, height: clip.size?.height ?? 100 },
        fontSize: s.fontSize || 24, fontFamily: s.fontName || 'Arial', color: s.primaryColor || '#FFFFFF',
      });
    }
  });

  groups.forEach((g) => {
    const sortedCuts = g.cuts.slice().sort((a: any, b: any) => a.timelineStart - b.timelineStart);
    const firstStart = sortedCuts.length ? sortedCuts[0].timelineStart : 0;
    const totalDuration = sortedCuts.reduce((sum: number, c: any) => sum + Math.max(0, (c.end ?? 0) - (c.start ?? 0)), 0);
    const item: any = { url: g.url, type: g.type, startTime: firstStart, duration: totalDuration, endTime: firstStart + totalDuration, cuts: sortedCuts.length ? sortedCuts : [{ start: 0, end: 0, timelineStart: 0 }], isAnimated: g.isAnimated, hasAudio: g.hasAudio };
    if (g.type === 'video') media.videos.push(item);
    else if (g.type === 'audio') media.audio.push(item);
    else if (g.type === 'image') media.images.push(item);
    else if (g.type === 'gif') media.gif.push(item);
  });

  if (invalids.length > 0) throw new Error(`Invalid media URLs detected for export (e.g., local blobs). Please check ${invalids[0].name}.`);
  return media;
};

const normalizeMediaForExport = (media: any, mediaItems: any[]) => {
  const normalize = (items: any[]) => (items || []).map((m: any) => {
    let finalUrl = m.url;
    if (!isUrlValidForExport(finalUrl)) {
      const mediaId = m.mediaId || m.id;
      const mItem = mediaItems.find((mi) => (mediaId && mi.id === mediaId) || (mi.name === m.name && mi.type === m.type));
      if (mItem && isUrlValidForExport(mItem.url)) finalUrl = mItem.url;
    }
    return {
      ...m,
      url: finalUrl,
      isAnimated: m.type === 'video' || m.type === 'gif' ? m.isAnimated !== false : m.isAnimated === true,
      hasAudio: m.type === 'video' || m.type === 'audio' ? m.hasAudio !== false : m.hasAudio === true,
    };
  });

  return { ...media, images: normalize(media.images), videos: normalize(media.videos), audio: normalize(media.audio), gif: normalize(media.gif) };
};

const collectTransitionClips = (data: { clips: any; tracks: any[]; liveDurationOverrides?: any }) => {
  const { clips, tracks, liveDurationOverrides } = data;
  const transitionClips = Object.values(clips).filter((clip: any) => clip.isEffect);

  return transitionClips.map((clip: any) => {
    const effectType = clip.effectType || clip.name.toLowerCase().replace(/\s+/g, '') || 'fade';
    const actualDuration = liveDurationOverrides?.[clip.id] ?? clip.duration;
    const track = tracks.find((t) => t.id === clip.trackId);
    
    if (!track) return { type: effectType, start: clip.start, duration: actualDuration };

    const trackClips = track.clips
      .map((clipId: string) => clips[clipId])
      .filter((c: any) => c && !c.isEffect && !['transition', 'fade', 'xfade'].includes(c.type))
      .map((c: any) => ({ ...c, duration: liveDurationOverrides?.[c.id] ?? c.duration }))
      .sort((a: any, b: any) => a.start - b.start);

    let fromId: string | undefined;
    const transitionStart = clip.start;
    for (let i = trackClips.length - 1; i >= 0; i--) {
      const trackClipEnd = trackClips[i].start + trackClips[i].duration;
      if (trackClipEnd <= transitionStart + 0.5) {
        fromId = trackClips[i].id; break;
      }
    }

    let toId: string | undefined;
    for (let i = 0; i < trackClips.length; i++) {
      if (trackClips[i].start >= transitionStart - 0.5) {
        toId = trackClips[i].id; break;
      }
    }

    return {
      type: effectType,
      start: clip.start,
      duration: actualDuration,
      fromId,
      toId,
      zIndex: getZIndexFromTrack(clip, tracks),
    };
  });
};

/**
 * The core adapter that transforms the frontend Redux state into a 
 * schema that the FFmpeg backend service expects.
 */
const buildExportPayload = (data: { clips: any; tracks: any[]; mediaItems: any[]; aspectRatio: string; liveDurationOverrides?: any }, exportOptions: any) => {
  const media = convertClipsToOrganizedMedia(data);
  const normalizedMedia = normalizeMediaForExport(media, data.mediaItems);

  const subtitleTracksMap = new Map<string, any[]>();
  Object.values(data.clips).filter((c: any) => c.type === 'subtitle').forEach((clip: any) => {
    const tId = clip.trackId || 'default-subtitle-track';
    if (!subtitleTracksMap.has(tId)) subtitleTracksMap.set(tId, []);
    subtitleTracksMap.get(tId)!.push(clip);
  });

  const subtitles = Array.from(subtitleTracksMap.values()).map((trackClips) => {
    const sortedClips = trackClips.sort((a, b) => a.start - b.start);
    const zIndex = getZIndexFromTrack(sortedClips[0], data.tracks);
    const styling = { ...(sortedClips[0]?.styling || {}) };
    return stripTypename({ srt: generateSRTContent(data, sortedClips), styling, zIndex });
  });

  return {
    subtitles,
    media: stripTypename(normalizedMedia),
    transitions: stripTypename(collectTransitionClips(data)),
    output: {
      resolution: exportOptions.resolution,
      format: exportOptions.format,
      quality: exportOptions.quality,
      aspectRatio: (data.aspectRatio || '16:9').replace(':', '/'),
    },
  };
};

/**
 * Resolves all browser-only 'blob:' URLs into 'data:base64' URIs.
 * 
 * CRITICAL PERFORMANCE NOTE:
 * This is intended for LOCAL TESTING and MVP purposes. For large-scale 
 * production use, implementing an "Upload Service" is required.
 * 
 * PRODUCTION WORKFLOW:
 * 1. User uploads file to S3/Cloudinary/R2 -> slice converts to Blob for instant preview.
 * 2. The local Blob URL is swapped for the permanent Cloud URL.
 * 3. This 'resolveBlobsToBase64' step becomes unnecessary and the payload 
 *    stays lightweight regardless of video size.
 */
const resolveBlobsToBase64 = async (payload: any): Promise<any> => {
  const deepResolve = async (obj: any): Promise<any> => {
    if (typeof obj !== 'object' || obj === null) return obj;

    if (Array.isArray(obj)) {
      return Promise.all(obj.map(item => deepResolve(item)));
    }

    const newObj: any = { ...obj };
    for (const key in newObj) {
      if (key === 'url' && typeof newObj[key] === 'string' && newObj[key].startsWith('blob:')) {
        const response = await fetch(newObj[key]);
        const blob = await response.blob();
        newObj[key] = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } else {
        newObj[key] = await deepResolve(newObj[key]);
      }
    }
    return newObj;
  };

  return deepResolve(payload);
};


// --- MAIN COMPONENT ---

const ExportButton: React.FC = () => {
  const { clips, mediaItems, tracks, aspectRatio, liveDurationOverrides } = useSelector((state: RootState) => state.timeline);
  
  const [showModal, setShowModal] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [options, setOptions] = useState({
    resolution: "1080p" as "720p" | "1080p" | "1440p" | "4k",
    format: "mp4",
    quality: "high" as "low" | "medium" | "high" | "ultra",
  });

  const handleExport = async () => {
    setIsExporting(true);
    setProgress(10);
    setStatusMessage("Preparing timeline data...");
    setError(null);

    try {
      let payload = buildExportPayload({ clips, tracks, mediaItems, aspectRatio, liveDurationOverrides }, options);
      
      setProgress(20);
      setStatusMessage("Resolving local media assets...");
      
      // Resolve any blob: URLs to data: URIs (base64)
      payload = await resolveBlobsToBase64(payload);

      setProgress(30);
      setStatusMessage("Connecting to render engine...");
      
      const response = await fetch('http://localhost:5001/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || errData.error || "Render failed");
      }

      const result = await response.json();
      
      setProgress(100);
      setStatusMessage("Export complete!");
      setResultUrl(result.outputPath); // Note: server returns absolute local path, might need a file server to preview
      
      setTimeout(() => {
        setIsExporting(false);
        setShowModal(false);
        setShowResult(true);
      }, 500);

    } catch (err: any) {
      console.error("Export error:", err);
      setError(err.message);
      setIsExporting(false);
      setProgress(0);
    }
  };

  return (
    <>
      <Button
        onClick={() => setShowModal(true)}
        className="h-9 px-4 rounded-xl font-bold uppercase tracking-tight text-xs bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg transition-transform hover:scale-105 gap-2"
      >
        <Download className="w-4 h-4" />
        Export
      </Button>

      <Dialog open={showModal} onOpenChange={(open) => !isExporting && setShowModal(open)}>
        <DialogContent className="sm:max-w-md w-full p-0 overflow-hidden border-2 border-border shadow-2xl rounded-[24px]">
          <div className="p-6 pb-2 border-b border-border/50">
            <DialogTitle className="text-xl font-black italic tracking-tighter flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-primary" />
              EXPORT OPTIONS
            </DialogTitle>
          </div>

          <div className="p-6 space-y-6">
            {!isExporting ? (
              <>
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Resolution</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {["720p", "1080p", "1440p", "4k"].map((res) => (
                      <button
                        key={res}
                        onClick={() => setOptions(prev => ({ ...prev, resolution: res as any }))}
                        className={`py-2 text-[10px] font-black uppercase rounded-lg border-2 transition-all ${options.resolution === res ? "bg-white border-black text-black" : "bg-muted/50 border-2 border-border text-muted-foreground hover:border-primary/30"}`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Quality</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {["low", "medium", "high", "ultra"].map((q) => (
                      <button
                        key={q}
                        onClick={() => setOptions(prev => ({ ...prev, quality: q as any }))}
                        className={`py-2 text-[10px] font-black uppercase rounded-lg border-2 transition-all ${options.quality === q ? "bg-white border-black text-black" : "bg-muted/50 border-2 border-border text-muted-foreground hover:border-primary/30"}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl flex gap-3 text-destructive">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">{error}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="py-8 space-y-6 flex flex-col items-center">
                <div className="relative w-32 h-32 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="60" className="stroke-muted/10 fill-none" strokeWidth="4" />
                    <circle 
                      cx="64" cy="64" r="60" className="stroke-primary fill-none" 
                      strokeWidth="6" strokeDasharray="377" strokeDashoffset={377 - (377 * progress) / 100}
                      style={{ transition: 'stroke-dashoffset 0.5s ease-out' }} strokeLinecap="round" 
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black italic">{Math.round(progress)}%</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs font-black uppercase tracking-widest text-primary animate-pulse">{statusMessage}</p>
                </div>
              </div>
            )}
          </div>

          {!isExporting && (
            <div className="p-4 bg-muted/30 border-t border-border flex gap-3">
              <Button variant="outline" onClick={() => setShowModal(false)} className="flex-1 rounded-xl font-bold uppercase text-xs">Cancel</Button>
              <Button onClick={handleExport} className="flex-[2] rounded-xl font-bold uppercase text-xs bg-primary text-primary-foreground">Start Export</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showResult} onOpenChange={setShowResult}>
        <DialogContent className=" sm:max-w-[400px] p-8 text-center space-y-6 border-2 border-border shadow-2xl rounded-[32px]">
          <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-500">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black italic tracking-tighter uppercase">Success!</h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-relaxed">
              Your video has been rendered and saved on the server.
            </p>
          </div>
          <div className="p-4 bg-muted/50 rounded-2xl border border-border">
            <p className="text-[10px] font-mono text-muted-foreground break-all">{resultUrl}</p>
          </div>
          <Button onClick={() => setShowResult(false)} className="w-full h-12 rounded-xl font-black uppercase tracking-widest text-xs">Close</Button>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ExportButton;
