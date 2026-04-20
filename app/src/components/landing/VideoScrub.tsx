import { useEffect, useRef } from 'react';
import { scrollState } from './scrollState';

type Props = {
  src: string;
  poster?: string;
};

// Pinned full-screen video whose currentTime is driven by scroll progress.
// No playback — we seek on every animation frame, lerped toward the target
// time for the "premium" inertial feel.
//
// Notes:
//  - The MP4 must be muted + playsInline for mobile to allow seeking without
//    a user gesture.
//  - Seek smoothness depends on keyframe density in the source. For
//    production, re-encode with e.g. `-g 1 -keyint_min 1` so every frame is
//    a keyframe; stock clips typically have a keyframe every ~2s which shows
//    up as "steppy" scrubbing.
export default function VideoScrub({ src, poster }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentRef = useRef(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Kick the browser into decoding the first frame on iOS Safari.
    const nudge = () => {
      video.play().then(() => video.pause()).catch(() => {});
    };
    video.addEventListener('loadedmetadata', nudge, { once: true });

    const tick = () => {
      const duration = video.duration;
      if (duration && Number.isFinite(duration)) {
        const target = scrollState.progress * duration;
        // Exponential damping ≈ lerp toward target
        currentRef.current += (target - currentRef.current) * 0.12;
        // Avoid seeking if the diff is below one-frame noise floor.
        if (Math.abs(currentRef.current - video.currentTime) > 1 / 60) {
          video.currentTime = currentRef.current;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      video.removeEventListener('loadedmetadata', nudge);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      className="fixed inset-0 h-full w-full object-cover"
      // A gentle warm grade while we wait for the frame to load.
      style={{ background: '#2a1a12' }}
    />
  );
}
