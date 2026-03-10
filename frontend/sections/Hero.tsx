'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Play, Music, Disc, Calendar, Shield } from 'lucide-react';
import { heroConfig } from '@/config';

gsap.registerPlugin(ScrollTrigger);

const ICON_MAP = {
  disc: Disc,
  play: Play,
  calendar: Calendar,
  music: Music,
};

interface HeroProps {
  onConnect?: () => void | Promise<void>;
  connecting?: boolean;
}

const Hero = ({ onConnect, connecting = false }: HeroProps) => {
  // Null check: if config is empty, do not render
  if (!heroConfig.decodeText && !heroConfig.brandName && heroConfig.navItems.length === 0) {
    return null;
  }

  const heroRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const TARGET_TEXT = heroConfig.decodeText;
  const CHARS = heroConfig.decodeChars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  const [displayText, setDisplayText] = useState(' '.repeat(TARGET_TEXT.length));
  const [isDecoding, setIsDecoding] = useState(true);

  // Decode text effect
  useEffect(() => {
    let iteration = 0;
    const maxIterations = TARGET_TEXT.length * 8;

    const interval = setInterval(() => {
      setDisplayText(() => {
        return TARGET_TEXT.split('')
          .map((_, index) => {
            if (index < iteration / 8) {
              return TARGET_TEXT[index];
            }
            return CHARS[Math.floor(Math.random() * CHARS.length)];
          })
          .join('');
      });

      iteration += 1;

      if (iteration >= maxIterations) {
        clearInterval(interval);
        setDisplayText(TARGET_TEXT);
        setIsDecoding(false);
      }
    }, 40);

    return () => clearInterval(interval);
  }, []);

  // GSAP animations
  useEffect(() => {
    const ctx = gsap.context(() => {
      // Nav slide in
      gsap.fromTo(
        navRef.current,
        { y: -100, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', delay: 0.3 }
      );

      // Subtitle fade in
      gsap.fromTo(
        subtitleRef.current,
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', delay: 1.5 }
      );

      // Content fade in
      gsap.fromTo(
        contentRef.current,
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, ease: 'power3.out', delay: 0.8 }
      );

      // Scroll-driven exit animation
      const st = ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'top top',
        end: '+=130%',
        pin: true,
        scrub: 0.6,
        onUpdate: (self) => {
          const progress = self.progress;
          
          // EXIT phase (70% - 100%)
          if (progress > 0.7) {
            const exitProgress = (progress - 0.7) / 0.3;
            
            if (contentRef.current) {
              gsap.set(contentRef.current, {
                y: -exitProgress * 150,
                opacity: 1 - exitProgress * 0.8,
              });
            }
            
            if (navRef.current) {
              gsap.set(navRef.current, {
                y: -exitProgress * 80,
                opacity: 1 - exitProgress * 0.8,
              });
            }
            
            if (bgRef.current) {
              gsap.set(bgRef.current, {
                scale: 1 + exitProgress * 0.06,
                opacity: 0.55 - exitProgress * 0.2,
              });
            }
          }
        },
        onLeaveBack: () => {
          // Reset when scrolling back to top
          gsap.set(contentRef.current, { y: 0, opacity: 1 });
          gsap.set(navRef.current, { y: 0, opacity: 1 });
          gsap.set(bgRef.current, { scale: 1, opacity: 0.55 });
        }
      });

      return () => {
        st.kill();
      };
    }, heroRef);

    return () => ctx.revert();
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section
      ref={heroRef}
      id="hero"
      className="relative w-full h-screen overflow-hidden bg-[#07070B] z-10"
    >
      {/* Background image */}
      <div ref={bgRef} className="absolute inset-0 z-0">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroConfig.backgroundImage})` }}
        />
        {/* Vignette overlay */}
        <div className="absolute inset-0 vignette" />
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-[#07070B]/50" />
        {/* Animated gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#07070B]/30 to-[#07070B]" />
      </div>

      {/* Navigation pill */}
      <nav
        ref={navRef}
        className="fixed top-6 left-1/2 -translate-x-1/2 z-50 nav-pill rounded-full px-2 py-2"
      >
        <div className="flex items-center gap-1">
          {heroConfig.navItems.map((item) => {
            const IconComponent = ICON_MAP[item.icon];
            return (
              <button
                key={item.sectionId}
                onClick={() => scrollToSection(item.sectionId)}
                className="flex items-center gap-2 px-4 py-2 text-xs font-mono-custom uppercase tracking-wider text-white/80 hover:text-[#39F2AE] transition-colors rounded-full hover:bg-white/5"
              >
                <IconComponent className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Hero content */}
      <div 
        ref={contentRef}
        className="relative z-10 flex flex-col items-center justify-end h-full pb-20 px-4"
      >
        {/* Logo / Brand */}
        <div className="absolute top-8 left-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#39F2AE]/20 flex items-center justify-center">
              <Shield className="w-4 h-4 text-[#39F2AE]" />
            </div>
            <span className="font-display text-lg text-[#F4F6FA]">{heroConfig.brandName}</span>
          </div>
        </div>

        {/* Main title with decode effect */}
        <h1
          ref={titleRef}
          className="decode-text text-[10vw] md:text-[8vw] lg:text-[6vw] font-bold text-[#F4F6FA] leading-none tracking-tight mb-4 text-center max-w-[92vw]"
        >
          <span className={`${isDecoding ? 'text-glow-mint' : ''} transition-all duration-300`}>
            {displayText}
          </span>
        </h1>

        {/* Subtitle */}
        <p
          ref={subtitleRef}
          className="font-mono-custom text-sm md:text-base text-[#A7ACB8]/70 uppercase tracking-[0.3em] mb-8"
        >
          {heroConfig.subtitle}
        </p>

        {/* CTA Button */}
        <div className="flex justify-center">
          <button
            onClick={() => {
              if (onConnect) {
                void onConnect();
                return;
              }
              scrollToSection('contact');
            }}
            disabled={connecting}
            className="px-10 py-3 bg-[#39F2AE] text-[#07070B] font-display text-sm uppercase tracking-wider rounded-full hover:bg-[#39F2AE]/80 transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#39F2AE]/30 to-transparent" />

      {/* Corner accents */}
      <div className="absolute top-8 right-8 text-right hidden">
        <p className="font-mono-custom text-xs text-white/40 uppercase tracking-wider">{heroConfig.cornerLabel}</p>
        <p className="font-mono-custom text-xs text-[#39F2AE]/60">{heroConfig.cornerDetail}</p>
      </div>

      {/* Bottom labels */}
      <div className="absolute bottom-[4vh] left-[4vw] z-10">
        <span className="font-mono-custom text-xs text-[#A7ACB8]/60 uppercase tracking-wider">
          {heroConfig.cornerLabel}
        </span>
      </div>
      <div className="absolute bottom-[4vh] right-[4vw] z-10">
        <span className="font-mono-custom text-xs text-[#A7ACB8]/60 uppercase tracking-wider">
          Scroll to explore
        </span>
      </div>
    </section>
  );
};

export default Hero;
