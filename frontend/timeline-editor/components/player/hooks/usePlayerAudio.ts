import React, { useRef, useEffect } from "react";
import { MediaElement } from "../components/ClipRenderer";

/**
 * usePlayerAudio
 *
 * Manages the Web Audio API processing graph for all active audio clips.
 *
 * For each audio clip that is currently within its playback window, this hook:
 *  1. Creates (or reuses) a MediaElementAudioSourceNode connected to the clip's
 *     <audio> element
 *  2. Wires a signal chain: source → bass EQ → treble EQ → gain → destination
 *     with parallel echo (delay) and reverb (convolver) wet paths:
 *
 *       src ─► bass ─► treble ─► gain ─► destination
 *                         │
 *                         ├──► delay ──► delayGain ──► gain
 *                         │
 *                         └──► convolver ──► reverbGain ──► gain
 *
 *  3. Applies the clip's audio settings (speed, bass boost, treble boost,
 *     echo mix, reverb mix, volume) to the graph nodes on every render.
 *  4. Disconnects and removes nodes for clips that have left their active window,
 *     freeing AudioContext resources.
 *
 * The AudioContext is lazily created on first use and resumed when playback
 * starts (browsers require a user interaction before audio can play).
 *
 * @param allMediaElements       - all active MediaElements from ClipRenderer
 * @param audioRefs              - map of clipId → <audio> DOM element
 * @param currentTime            - current playhead position in seconds
 * @param liveDurationOverrides  - optional per-clip duration overrides (e.g. from speed changes)
 * @param isPlaying              - whether the player is currently playing
 */
export const usePlayerAudio = ({
  allMediaElements,
  audioRefs,
  currentTime,
  liveDurationOverrides,
  isPlaying,
}: {
  allMediaElements: MediaElement[];
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  currentTime: number;
  liveDurationOverrides: Record<string, number> | undefined;
  isPlaying: boolean;
}) => {
  // Shared AudioContext — one per player instance, lazily initialised
  const audioContextRef = useRef<AudioContext | null>(null);

  // Tracks which clips already have a connected MediaElementAudioSourceNode
  // (a source node can only be created once per audio element)
  const mediaSourceMapRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());

  // Stores the full signal-chain graph for each active audio clip
  const nodeGraphMapRef = useRef<
    Map<
      string,
      {
        gain: GainNode;           // master volume
        bass: BiquadFilterNode;   // low-shelf EQ
        treble: BiquadFilterNode; // high-shelf EQ
        delay: DelayNode;         // echo delay line (fixed at 0.25 s)
        delayGain: GainNode;      // echo wet mix
        convolver: ConvolverNode; // reverb impulse response unit
        reverbGain: GainNode;     // reverb wet mix
      }
    >
  >(new Map());

  // ── Main effect: build / update / tear down audio graphs ──────────────────
  useEffect(() => {
    // Lazily create the AudioContext on first use
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current!;

    // Track which clip IDs are within their playback window this frame
    const activeAudioIds = new Set<string>();

    allMediaElements.forEach(({ clip }) => {
      if (clip.type !== "audio") return;

      const duration = liveDurationOverrides?.[clip.id] ?? clip.duration;
      const isActive = currentTime >= clip.start && currentTime <= clip.start + duration;
      if (!isActive) return;

      activeAudioIds.add(clip.id);
      const el = audioRefs.current.get(clip.id);
      if (!el) return;

      // Ensure the element itself isn't muted at the DOM level
      try {
        if (el.muted) el.muted = false;
        if (el.volume !== 1) el.volume = 1;
      } catch {}

      // Create a MediaElementAudioSourceNode if one doesn't exist yet.
      // The Web Audio spec only allows one source node per HTMLMediaElement.
      let src = mediaSourceMapRef.current.get(clip.id);
      if (!src) {
        try {
          if (!mediaSourceMapRef.current.has(clip.id)) {
            src = ctx.createMediaElementSource(el);
            mediaSourceMapRef.current.set(clip.id, src);
          }
        } catch {
          src = mediaSourceMapRef.current.get(clip.id) as any;
        }
      }

      // Build the signal chain for this clip if it hasn't been created yet
      let graph = nodeGraphMapRef.current.get(clip.id);
      if (!graph && src) {
        const gain       = ctx.createGain();
        const bass       = ctx.createBiquadFilter();
        bass.type        = "lowshelf";
        bass.frequency.value = 200; // boost/cut below 200 Hz

        const treble     = ctx.createBiquadFilter();
        treble.type      = "highshelf";
        treble.frequency.value = 4000; // boost/cut above 4 kHz

        const delay      = ctx.createDelay(1.0);
        delay.delayTime.value = 0.25; // 250 ms slapback echo

        const delayGain  = ctx.createGain();   // echo wet level
        const convolver  = ctx.createConvolver();
        const reverbGain = ctx.createGain();   // reverb wet level

        try {
          // Main path: src → bass → treble → gain → output
          src.connect(bass);
          bass.connect(treble);
          treble.connect(gain);
          gain.connect(ctx.destination);

          // Echo path: treble → delay → delayGain → gain
          treble.connect(delay);
          delay.connect(delayGain);
          delayGain.connect(gain);

          // Reverb path: treble → convolver → reverbGain → gain
          treble.connect(convolver);
          convolver.connect(reverbGain);
          reverbGain.connect(gain);
        } catch {}

        nodeGraphMapRef.current.set(clip.id, {
          gain, bass, treble, delay, delayGain, convolver, reverbGain,
        });
        graph = nodeGraphMapRef.current.get(clip.id)!;
      }

      // Apply the clip's current audio settings to the graph nodes
      if (graph) {
        const s: any = clip.styling || {};

        // Playback speed: 0.5× – 2× (clamped to browser limits)
        try {
          el.playbackRate = Math.max(0.5, Math.min(2, s.audioSpeed ?? 1));
        } catch {}

        graph.gain.gain.value        = Math.max(0, Math.min(1,  clip.volume ?? 1));
        graph.bass.gain.value        = Math.max(0, Math.min(20, s.audioBassBoost   ?? 0));
        graph.treble.gain.value      = Math.max(0, Math.min(20, s.audioTrebleBoost ?? 0));
        graph.delayGain.gain.value   = Math.max(0, Math.min(1,  s.audioEcho        ?? 0));

        // Lazily generate a simple synthetic impulse response for the convolver.
        // A real IR file (e.g. from a .wav) would sound more authentic but this
        // exponentially-decaying noise burst is sufficient for preview purposes.
        if (!graph.convolver.buffer) {
          const mkImpulse = (durationSec = 1.0, decay = 2.5) => {
            const rate     = ctx.sampleRate;
            const len      = Math.floor(rate * durationSec);
            const impulse  = ctx.createBuffer(2, len, rate);
            for (let ch = 0; ch < 2; ch++) {
              const data = impulse.getChannelData(ch);
              for (let i = 0; i < len; i++) {
                // White noise multiplied by an exponential decay envelope
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
              }
            }
            return impulse;
          };
          graph.convolver.buffer = mkImpulse();
        }

        graph.reverbGain.gain.value  = Math.max(0, Math.min(1, s.audioReverb ?? 0));
      }
    });

    // ── Cleanup: disconnect graphs for clips no longer in their playback window ──
    nodeGraphMapRef.current.forEach((graph, clipId) => {
      if (!activeAudioIds.has(clipId)) {
        Object.values(graph).forEach((node: any) => {
          if (node.disconnect) {
            try { node.disconnect(); } catch {}
          }
        });
        nodeGraphMapRef.current.delete(clipId);
      }
    });

    // Also remove orphaned source nodes
    mediaSourceMapRef.current.forEach((src, clipId) => {
      if (!activeAudioIds.has(clipId)) {
        try { src.disconnect(); } catch {}
        mediaSourceMapRef.current.delete(clipId);
      }
    });
  }, [allMediaElements, currentTime, liveDurationOverrides]);

  // ── Resume AudioContext when playback starts ───────────────────────────────
  // Browsers suspend the AudioContext until a user interaction occurs.
  // Resume it as soon as we know the player is playing.
  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state !== "running") {
      audioContextRef.current.resume().catch(() => {});
    }
  }, [isPlaying]);

  return { audioContextRef };
};
