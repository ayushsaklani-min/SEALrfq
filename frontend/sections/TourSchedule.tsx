'use client';

import { useState, useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Lock, Unlock, CheckCircle, ExternalLink, FileText, Shield } from 'lucide-react';
import { tourScheduleConfig } from '@/config';

gsap.registerPlugin(ScrollTrigger);

const TourSchedule = () => {
  // Null check: if config is empty, do not render
  if (tourScheduleConfig.tourDates.length === 0 && !tourScheduleConfig.sectionTitle) {
    return null;
  }

  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activePhase, setActivePhase] = useState<number>(0);
  const [isVisible, setIsVisible] = useState(false);
  const scrollTriggerRef = useRef<ScrollTrigger | null>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const st = ScrollTrigger.create({
      trigger: sectionRef.current,
      start: 'top 80%',
      onEnter: () => setIsVisible(true),
    });

    scrollTriggerRef.current = st;

    return () => {
      st.kill();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !contentRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        contentRef.current?.querySelectorAll('.tour-item') || [],
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.1,
          ease: 'power3.out',
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, [isVisible]);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'on-sale':
        return { text: tourScheduleConfig.statusLabels.onSale, color: 'text-[#39F2AE] bg-[#39F2AE]/10 border-[#39F2AE]/30' };
      case 'sold-out':
        return { text: tourScheduleConfig.statusLabels.soldOut, color: 'text-[#F4F6FA] bg-white/10 border-white/20' };
      case 'coming-soon':
        return { text: tourScheduleConfig.statusLabels.comingSoon, color: 'text-[#A7ACB8] bg-[#A7ACB8]/10 border-[#A7ACB8]/30' };
      default:
        return { text: tourScheduleConfig.statusLabels.default, color: 'text-[#A7ACB8] bg-[#A7ACB8]/10' };
    }
  };

  const getPhaseIcon = (index: number) => {
    switch (index) {
      case 0:
        return <Lock className="w-5 h-5" />;
      case 1:
        return <Unlock className="w-5 h-5" />;
      case 2:
        return <CheckCircle className="w-5 h-5" />;
      default:
        return <Shield className="w-5 h-5" />;
    }
  };

  const PHASES = tourScheduleConfig.tourDates;

  return (
    <section
      id="tour"
      ref={sectionRef}
      className="relative w-full min-h-screen bg-[#0F0F14] py-20 overflow-hidden"
    >
      {/* Content container */}
      <div ref={contentRef} className="relative z-20 max-w-7xl mx-auto px-6 md:px-12">
        {/* Section header */}
        <div className="mb-16">
          <p className="font-mono-custom text-xs text-[#A7ACB8]/60 uppercase tracking-wider mb-2">
            {tourScheduleConfig.sectionLabel}
          </p>
          <h2 className="font-display text-5xl md:text-7xl text-[#F4F6FA]">
            {tourScheduleConfig.sectionTitle}
          </h2>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left: Phase preview */}
          {PHASES.length > 0 && (
            <div className="hidden lg:flex lg:items-center">
              <div className="sticky top-32 w-full aspect-[4/3] rounded-2xl overflow-hidden bg-[#07070B] border border-white/10">
                <img
                  src={PHASES[activePhase]?.image}
                  alt={PHASES[activePhase]?.venue}
                  className="w-full h-full object-cover transition-opacity duration-500"
                />

                {/* Phase info overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#07070B] to-transparent">
                  <p className="font-mono-custom text-sm text-[#39F2AE] uppercase tracking-wider mb-2">
                    {PHASES[activePhase]?.date}
                  </p>
                  <p className="font-display text-2xl text-[#F4F6FA]">
                    {PHASES[activePhase]?.city}
                  </p>
                  <p className="font-mono-custom text-sm text-[#A7ACB8]/70">
                    {PHASES[activePhase]?.time}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Right: Phase list */}
          <div className="space-y-4">
            {PHASES.map((phase, index) => {
              const status = getStatusLabel(phase.status);

              return (
                <div
                  key={phase.id}
                  className="tour-item group relative p-6 rounded-xl bg-[#07070B]/60 backdrop-blur-sm border border-white/10 hover:bg-[#07070B]/80 hover:border-[#39F2AE]/30 transition-all duration-300 cursor-pointer"
                  onMouseEnter={() => setActivePhase(index)}
                  onMouseLeave={() => setActivePhase(0)}
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    {/* Phase number */}
                    <div className="flex-shrink-0 w-16 h-16 rounded-full bg-[#39F2AE]/10 border border-[#39F2AE]/30 flex items-center justify-center">
                      {getPhaseIcon(index)}
                    </div>

                    {/* Phase info */}
                    <div className="flex-grow">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono-custom text-xs text-[#39F2AE] uppercase tracking-wider">
                          {phase.date}
                        </span>
                      </div>
                      <p className="font-display text-xl text-[#F4F6FA] mb-1">
                        {phase.city}
                      </p>
                      <p className="text-sm text-[#A7ACB8]/60">
                        {phase.venue}
                      </p>
                    </div>
                  </div>

                  {/* Hover indicator */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-0 bg-[#39F2AE] rounded-full group-hover:h-12 transition-all duration-300" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#39F2AE]/20 to-transparent" />
    </section>
  );
};

export default TourSchedule;
