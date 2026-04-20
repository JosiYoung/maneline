import { useEffect, useRef } from 'react';
import { scrollState } from './scrollState';

// Three-scene scroll-scrub: video (scrubbed by scroll) crossfades into a
// portrait photo, then into an eye close-up, with a subtle Ken Burns zoom on
// each photo. Timeline + math ported from the horse-nutrition-hero prototype.
const FADE_VP: [number, number] = [0.30, 0.42]; // video -> portrait
const FADE_PE: [number, number] = [0.65, 0.77]; // portrait -> eye
const KB_START = 1.0;
const KB_END = 1.1;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const map01 = (x: number, a: number, b: number) => clamp((x - a) / (b - a), 0, 1);
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function HeroScrubStack() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const portraitRef = useRef<HTMLImageElement>(null);
  const eyeRef = useRef<HTMLImageElement>(null);
  const scene0Ref = useRef<HTMLDivElement>(null);
  const scene1Ref = useRef<HTMLDivElement>(null);
  const scene2Ref = useRef<HTMLDivElement>(null);

  const rafRef = useRef<number>();
  const lastSeekRef = useRef(-1);
  const currentSeekRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // iOS Safari won't decode the first frame without a play/pause nudge.
    const nudge = () => {
      video.play().then(() => video.pause()).catch(() => {});
    };
    video.addEventListener('loadedmetadata', nudge, { once: true });

    const tick = () => {
      const progress = scrollState.progress;

      // Video scrub — span the whole video across 0..FADE_VP[1] so it's done
      // scrubbing by the time the portrait is fully in.
      const duration = video.duration;
      if (duration && Number.isFinite(duration)) {
        const target = map01(progress, 0, FADE_VP[1]) * duration;
        // Inertial damping so scrubbing feels liquid, not jittery.
        currentSeekRef.current += (target - currentSeekRef.current) * 0.15;
        if (Math.abs(currentSeekRef.current - lastSeekRef.current) > 0.03) {
          try {
            video.currentTime = currentSeekRef.current;
            lastSeekRef.current = currentSeekRef.current;
          } catch {
            // Some browsers throw if seeking before ready; next frame retries.
          }
        }
      }

      // Crossfades
      const fadeVP = smooth(map01(progress, FADE_VP[0], FADE_VP[1]));
      const fadePE = smooth(map01(progress, FADE_PE[0], FADE_PE[1]));
      const op0 = 1 - fadeVP;
      const op1 = fadeVP * (1 - fadePE);
      const op2 = fadePE;
      if (scene0Ref.current) scene0Ref.current.style.opacity = op0.toFixed(3);
      if (scene1Ref.current) scene1Ref.current.style.opacity = op1.toFixed(3);
      if (scene2Ref.current) scene2Ref.current.style.opacity = op2.toFixed(3);

      // Ken Burns — each photo zooms across the window it is relevant.
      const kbP = map01(progress, FADE_VP[0], FADE_PE[1]);
      const kbE = map01(progress, FADE_PE[0], 1);
      if (portraitRef.current) {
        portraitRef.current.style.transform = `scale(${lerp(KB_START, KB_END, kbP).toFixed(4)})`;
      }
      if (eyeRef.current) {
        eyeRef.current.style.transform = `scale(${lerp(KB_START, KB_END, kbE).toFixed(4)})`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      video.removeEventListener('loadedmetadata', nudge);
    };
  }, []);

  const layerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    willChange: 'opacity',
  };
  const mediaStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    pointerEvents: 'none',
  };
  const kenburnsStyle: React.CSSProperties = {
    ...mediaStyle,
    willChange: 'transform',
    transformOrigin: '50% 50%',
  };

  return (
    <>
      <div ref={scene0Ref} style={{ ...layerStyle, opacity: 1 }}>
        <video
          ref={videoRef}
          src="/Landing/horse-pasture.mp4"
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          style={{ ...mediaStyle, background: '#2a1a12' }}
        />
      </div>
      <div ref={scene1Ref} style={{ ...layerStyle, opacity: 0 }}>
        <img
          ref={portraitRef}
          src="/Landing/horse-portrait.jpg"
          alt=""
          style={kenburnsStyle}
        />
      </div>
      <div ref={scene2Ref} style={{ ...layerStyle, opacity: 0 }}>
        <img
          ref={eyeRef}
          src="/Landing/horse-eye.jpg"
          alt=""
          style={kenburnsStyle}
        />
      </div>
    </>
  );
}
