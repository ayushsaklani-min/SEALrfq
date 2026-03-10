'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface ValuePropProps {
  sectionId: string;
  backgroundImage: string;
  microLabel: string;
  headline: string;
  bottomLeft: string;
  bottomRight: string;
  badge?: string;
}

const ValueProp = ({ 
  sectionId, 
  backgroundImage, 
  microLabel, 
  headline, 
  bottomLeft, 
  bottomRight,
  badge 
}: ValuePropProps) => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const microRef = useRef<HTMLDivElement>(null);
  const hairlineRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const content = contentRef.current;
    const headlineEl = headlineRef.current;
    const microEl = microRef.current;
    const hairline = hairlineRef.current;
    const bg = bgRef.current;

    if (!section || !content || !headlineEl || !microEl || !hairline || !bg) return;

    const ctx = gsap.context(() => {
      // Create scroll-triggered animation timeline
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "+=130%",
          pin: true,
          scrub: 0.6,
          onLeaveBack: () => {
            // Reset all elements when scrolling back to top
            gsap.set([headlineEl, microEl, hairline, bg], { 
              opacity: 1, 
              y: 0,
              scale: 1,
              scaleX: 1
            });
          }
        }
      });

      // ENTRANCE (0% - 30%)
      // Background scales in
      tl.fromTo(bg, 
        { scale: 1.08, opacity: 0.35 },
        { scale: 1.0, opacity: 0.5, ease: "none" },
        0
      );

      // Hairline draws in
      tl.fromTo(hairline,
        { scaleX: 0 },
        { scaleX: 1, ease: "none" },
        0
      );

      // Micro label slides in
      tl.fromTo(microEl,
        { y: -10, opacity: 0 },
        { y: 0, opacity: 1, ease: "none" },
        0.05
      );

      // Headline reveals with word stagger effect
      tl.fromTo(headlineEl,
        { y: 40, opacity: 0, rotateX: 22 },
        { y: 0, opacity: 1, rotateX: 0, ease: "none" },
        0.1
      );

      // SETTLE (30% - 70%) - Hold position

      // EXIT (70% - 100%)
      tl.to(headlineEl,
        { y: -100, opacity: 0, ease: "power2.in" },
        0.7
      );

      tl.to(microEl,
        { opacity: 0, ease: "power2.in" },
        0.75
      );

      tl.to(hairline,
        { scaleX: 0, ease: "power2.in" },
        0.8
      );

      tl.to(bg,
        { scale: 1.05, opacity: 0.3, ease: "power2.in" },
        0.7
      );

    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id={sectionId}
      className="relative w-full h-screen overflow-hidden bg-[#07070B] z-10"
    >
      {/* Background image */}
      <div 
        ref={bgRef}
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Vignette overlay */}
        <div className="absolute inset-0 vignette" />
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-[#07070B]/50" />
      </div>

      {/* Hairline rule */}
      <div 
        ref={hairlineRef}
        className="absolute top-[10vh] left-[4vw] right-[4vw] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent origin-center"
      />

      {/* Content */}
      <div 
        ref={contentRef}
        className="relative z-10 flex flex-col items-center justify-center h-full px-4"
      >
        {/* Micro label */}
        <div 
          ref={microRef}
          className="absolute top-[7vh] left-1/2 -translate-x-1/2"
        >
          <span className="font-mono-custom text-xs text-[#A7ACB8] uppercase tracking-[0.12em]">
            {microLabel}
          </span>
        </div>

        {/* Main headline */}
        <h2 
          ref={headlineRef}
          className="font-display text-[8vw] md:text-[6vw] lg:text-[5vw] text-[#F4F6FA] text-center leading-tight max-w-[92vw]"
          style={{ perspective: '1000px' }}
        >
          {headline}
        </h2>

        {/* Optional badge */}
        {badge && (
          <div className="mt-8 px-6 py-3 rounded-full border border-[#39F2AE]/30 bg-[#39F2AE]/10">
            <span className="font-mono-custom text-sm text-[#39F2AE]">{badge}</span>
          </div>
        )}
      </div>

      {/* Bottom labels */}
      <div className="absolute bottom-[4vh] left-[4vw] z-10">
        <span className="font-mono-custom text-xs text-[#A7ACB8]/60 uppercase tracking-wider">
          {bottomLeft}
        </span>
      </div>
      <div className="absolute bottom-[4vh] right-[4vw] z-10">
        <span className="font-mono-custom text-xs text-[#A7ACB8]/60 uppercase tracking-wider">
          {bottomRight}
        </span>
      </div>
    </section>
  );
};

export default ValueProp;
