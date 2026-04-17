import React, { useEffect, useRef, useState, useMemo, memo } from "react";
import { Rect, Group } from "react-konva";

/**
 * AudioWaveform.tsx
 *
 * Renders an audio clip's waveform by decoding its bytes via the Web Audio API,
 * extracting the PCM buffer channel data, and bucketing it into discrete peak
 * amplitude bars.
 */
interface AudioWaveformProps {
  audio: string | File | Blob; // URL, File, or Blob
  width: number;
  height: number;
  x?: number;
  y?: number;
  color?: string;
  progressColor?: string;
}

/**
 * Downsamples raw PCM audio samples into a fixed number of amplitude bars
 * suitable for rendering as a waveform strip inside a clip.
 *
 * @param samples  - Float32Array of raw PCM samples from the audio channel
 * @param pixelWidth - Width of the clip in pixels (determines bar count)
 * @param maxBars  - Hard cap on the number of bars (default 500)
 */
function processWaveformData(
  samples: Float32Array,
  pixelWidth: number,
  maxBars = 500,
): number[] {
  if (!pixelWidth || pixelWidth <= 0) return [];

  // One bar per pixel, capped at maxBars to avoid too many DOM nodes
  const barCount = Math.min(maxBars, Math.max(1, Math.floor(pixelWidth)));
  const samplesPerBar = Math.floor(samples.length / barCount) || 1;
  const bars: number[] = [];

  for (let i = 0; i < barCount; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, samples.length);
    let peak = 0;
    for (let j = start; j < end; j++) {
      peak = Math.max(peak, Math.abs(samples[j]));
    }
    bars.push(peak);
  }

  return bars;
}

interface AudioWaveformProps {
  audio: string | File | Blob; // URL, File, or Blob
  width: number;
  height: number;
  x?: number;
  y?: number;
  color?: string;
  progressColor?: string;
}

const AudioWaveform: React.FC<AudioWaveformProps> = memo(
  ({
    audio,
    width,
    height,
    x = 0,
    y = 0,
    color = "#9c27b0",
    progressColor = "#6a1b9a",
  }) => {
    const decodeAbortRef = useRef<AbortController | null>(null);
    const [waveformData, setWaveformData] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);

    // Convert File/Blob → object URL if needed
    useEffect(() => {
      if (!audio) {
        setAudioUrl(null);
        return;
      }

      if (typeof audio === "string") {
        setAudioUrl(audio);
        return;
      }

      const objectUrl = URL.createObjectURL(audio);
      setAudioUrl(objectUrl);

      return () => {
        URL.revokeObjectURL(objectUrl); // cleanup
      };

    }, [audio]);

    // Decode audio via Web Audio API and compute bars whenever URL or width changes
    useEffect(() => {
      if (!audioUrl || !width || !height) return;

      setIsLoading(true);
      setWaveformData([]);

      const controller = new AbortController();
      decodeAbortRef.current?.abort();
      decodeAbortRef.current = controller;

      const decode = async () => {
        try {
          // Fetch audio bytes (works for http(s), blob:, and data: in modern browsers)
          const res = await fetch(audioUrl, {
            signal: controller.signal,
          } as RequestInit);
          const buf = await res.arrayBuffer();
          // Decode using AudioContext
          const AudioCtx =
            (window as any).AudioContext || (window as any).webkitAudioContext;
          const audioCtx: AudioContext = new AudioCtx();
          const audioBuffer: AudioBuffer = await audioCtx.decodeAudioData(buf);
          const samples = audioBuffer.getChannelData(0);
          const bars = processWaveformData(samples, width, 500);
          if (!controller.signal.aborted) {
            setWaveformData(bars);
          }
          // Close context to free resources
          try {
            (audioCtx as any).close?.();
          } catch {}
        } catch (err) {
          if (!(err as any)?.name?.includes?.("Abort")) {
            console.warn("Audio decode failed:", err);
          }
        } finally {
          if (!controller.signal.aborted) setIsLoading(false);
        }
      };

      decode();

      return () => {
        controller.abort();
      };
    }, [audioUrl, width, height]);

    // Render waveform bars
    const renderWaveform = useMemo(() => {
      if (waveformData.length === 0 || isLoading) return null;

      const stepX = waveformData.length > 0 ? width / waveformData.length : 1;
      const barPixelWidth = Math.max(0.5, stepX * 0.5);
      return waveformData.map((amplitude, index) => {
        const barHeight = Math.max(1, amplitude * height * 0.8);
        const barY = y + (height - barHeight) / 2;
        const barX = x + (index / waveformData.length) * width;

        if (barX >= x + width) return null;

        return (
          <Rect
            key={index}
            x={barX + 5}
            y={barY + 3}
            width={barPixelWidth}
            height={barHeight - 5}
            fill={progressColor || color}
            opacity={0.8}
          />
        );
      });
    }, [waveformData, height, y, x, width, color, isLoading]);

    // Loading placeholder
    const renderLoadingState = isLoading ? (
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={progressColor || color}
        opacity={0.3}
      />
    ) : null;

    // Fallback (flat line if no waveform)
    const renderFallback =
      !isLoading && waveformData.length === 0 ? (
        <Rect
          x={x}
          y={y + height / 2 - 1}
          width={width}
          height={2}
          fill={progressColor || color}
          opacity={0.5}
        />
      ) : null;

    return (
      <Group>
        {renderLoadingState}
        {renderWaveform}
        {renderFallback}
      </Group>
    );
  }
);

AudioWaveform.displayName = "AudioWaveform";
export default AudioWaveform;
