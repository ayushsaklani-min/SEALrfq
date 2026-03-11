'use client';

import { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ExternalLink, MapPin, Lock } from 'lucide-react';
import { footerConfig } from '@/config';

gsap.registerPlugin(ScrollTrigger);

interface FooterProps {
  onConnect?: () => void | Promise<void>;
  connecting?: boolean;
}

const Footer = ({ onConnect, connecting = false }: FooterProps) => {
  // Null check: if config is empty, do not render
  if (!footerConfig.brandName && !footerConfig.heroTitle && footerConfig.socialLinks.length === 0) {
    return null;
  }

  const sectionRef = useRef<HTMLDivElement>(null);
  const portraitRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const scrollTriggerRefs = useRef<ScrollTrigger[]>([]);

  useEffect(() => {
    if (!sectionRef.current) return;

    const ctx = gsap.context(() => {
      // Parallax title effect
      if (titleRef.current && portraitRef.current) {
        const st = ScrollTrigger.create({
          trigger: sectionRef.current,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1,
          onUpdate: (self) => {
            if (titleRef.current) {
              // Title moves faster than portrait
              gsap.set(titleRef.current, {
                y: -self.progress * 100,
              });
            }
          },
        });
        scrollTriggerRefs.current.push(st);
      }
    }, sectionRef);

    return () => {
      ctx.revert();
      scrollTriggerRefs.current.forEach(st => st.kill());
      scrollTriggerRefs.current = [];
    };
  }, []);

  return (
    <section
      id="contact"
      ref={sectionRef}
      className="relative w-full bg-[#07070B] overflow-hidden"
    >
      {/* CTA section with background */}
      <div className="relative h-screen flex items-center justify-center overflow-hidden">
        {/* Background image */}
        <div
          ref={portraitRef}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="relative w-full h-full">
            <img
              src={footerConfig.portraitImage}
              alt={footerConfig.portraitAlt}
              className="w-full h-full object-cover opacity-30"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07070B] via-[#07070B]/50 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-b from-[#07070B] via-transparent to-transparent opacity-50" />
          </div>
        </div>

        {/* Parallax title overlay */}
        <div
          ref={titleRef}
          className="relative z-10 text-center will-change-transform px-4"
        >
          <h2 className="font-display text-[10vw] md:text-[8vw] text-[#F4F6FA] leading-none tracking-tight max-w-[90vw]">
            {footerConfig.heroTitle}
          </h2>
          
          {/* CTA Button */}
          <div className="flex justify-center mt-12">
            <button
              onClick={() => {
                if (onConnect) {
                  void onConnect();
                }
              }}
              disabled={connecting}
              className="px-10 py-4 bg-[#39F2AE] text-[#07070B] font-display text-sm uppercase tracking-wider rounded-full hover:bg-[#39F2AE]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>
        </div>

        {/* Brand label */}
        <div className="absolute bottom-20 left-12 z-20">
          <p className="font-mono-custom text-xs text-[#A7ACB8]/40 uppercase tracking-wider mb-2">
            {footerConfig.artistLabel}
          </p>
          <h3 className="font-display text-4xl text-[#F4F6FA]">{footerConfig.artistName}</h3>
          <p className="font-mono-custom text-sm text-[#39F2AE]/60">{footerConfig.artistSubtitle}</p>
        </div>
      </div>

      {/* Footer content */}
      <div className="relative bg-[#07070B] py-20 px-6 md:px-12">
        {/* Top divider */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="max-w-7xl mx-auto">
          {/* Footer grid - Main content */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 mb-20">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-[#39F2AE]/20 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-[#39F2AE]" />
                </div>
                <span className="font-display text-2xl text-[#F4F6FA]">{footerConfig.brandName}</span>
              </div>
              <p className="text-sm text-[#A7ACB8]/60 leading-relaxed mb-6">
                {footerConfig.brandDescription}
              </p>
            </div>

            {/* Quick Links */}
            <div>
              <h4 className="font-display text-sm uppercase tracking-wider text-[#F4F6FA] mb-6">
                {footerConfig.quickLinksTitle}
              </h4>
              <ul className="space-y-3">
                {footerConfig.quickLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[#A7ACB8]/50 hover:text-[#39F2AE] transition-colors flex items-center gap-2 group"
                    >
                      <span>{link.label}</span>
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="font-display text-sm uppercase tracking-wider text-[#F4F6FA] mb-6">
                {footerConfig.contactTitle}
              </h4>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <ExternalLink className="w-4 h-4 text-[#39F2AE]/60 mt-0.5" />
                  <div>
                    <p className="text-sm text-[#A7ACB8]/50">{footerConfig.phoneLabel}</p>
                    <span className="text-sm text-[#F4F6FA]">{footerConfig.phone}</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-[#39F2AE]/60 mt-0.5" />
                  <div>
                    <p className="text-sm text-[#A7ACB8]/50">{footerConfig.addressLabel}</p>
                    <span className="text-sm text-[#F4F6FA]">{footerConfig.address}</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>


          {/* Bottom bar */}
          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-white/30 font-mono-custom">
              {footerConfig.copyrightText}
            </p>
            <div className="flex gap-6">
              {footerConfig.bottomLinks.map((link) => (
                <a key={link} href="#" className="text-xs text-white/30 hover:text-white/60 transition-colors">
                  {link}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Footer;
