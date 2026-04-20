import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { scrollState } from './scrollState';
import HeroScrubStack from './HeroScrubStack';

gsap.registerPlugin(ScrollTrigger);

type Props = {
  children: React.ReactNode; // DOM overlay sections, one per scene
};

// 3D background + scroll-linked DOM sections. The 3D camera keyframes live in
// Scene3D; this component just drives a normalized [0..1] progress value via
// GSAP ScrollTrigger and lets the Canvas read it through scrollState.
export default function ScrollHero({ children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapRef.current || !sectionsRef.current) return;

    const ctx = gsap.context(() => {
      const st = ScrollTrigger.create({
        trigger: wrapRef.current,
        start: 'top top',
        end: 'bottom bottom',
        // scrub value is the "lag" in seconds — how long the animation takes
        // to catch up to the scrollbar. Higher = more liquid, more detached.
        scrub: 1.2,
        // Snap to the four story beats (0, 25%, 50%, 100% of the timeline).
        // Once the user stops flinging, the scroll gently eases into the
        // nearest beat so the frame always lands on a "hero" moment.
        snap: {
          snapTo: [0, 0.25, 0.5, 1],
          duration: { min: 0.25, max: 0.7 },
          delay: 0.12,
          ease: 'power2.inOut',
        },
        onUpdate: (self) => {
          scrollState.progress = self.progress;
        },
      });

      // Fade/lift each overlay section in sync with its slice of the scroll.
      const sections = gsap.utils.toArray<HTMLElement>('[data-scene]');
      sections.forEach((el, i) => {
        gsap.fromTo(
          el,
          { autoAlpha: 0, y: 40 },
          {
            autoAlpha: 1,
            y: 0,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: el,
              start: 'top 75%',
              end: 'top 25%',
              scrub: true,
            },
          }
        );
        // Gentle fade-out on the way up (except the last).
        if (i < sections.length - 1) {
          gsap.to(el, {
            autoAlpha: 0,
            y: -40,
            ease: 'power2.in',
            scrollTrigger: {
              trigger: el,
              start: 'bottom 60%',
              end: 'bottom 20%',
              scrub: true,
            },
          });
        }
      });

      return () => st.kill();
    }, wrapRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      {/* Sticky hero background — three-scene scrub (video -> portrait -> eye). */}
      <div className="pointer-events-none sticky top-0 h-screen w-full overflow-hidden bg-[#1a1612]">
        <HeroScrubStack />
        {/* Dark gradient wash so DOM copy stays legible over any frame. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.5) 100%), linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.6) 100%)',
          }}
        />
      </div>

      {/* Stacked DOM sections. Pulled up over the sticky canvas. */}
      <div
        ref={sectionsRef}
        className="relative -mt-[100vh]"
      >
        {children}
      </div>
    </div>
  );
}
