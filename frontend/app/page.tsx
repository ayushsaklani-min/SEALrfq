'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useWallet } from '@/contexts/WalletContext';
import useLenis from '@/hooks/useLenis';
import { siteConfig, valuePropsConfig } from '@/config';
import Hero from '@/sections/Hero';
import ValueProp from '@/sections/ValueProp';
import AlbumCube from '@/sections/AlbumCube';
import ParallaxGallery from '@/sections/ParallaxGallery';
import TourSchedule from '@/sections/TourSchedule';
import Footer from '@/sections/Footer';

gsap.registerPlugin(ScrollTrigger);

export default function Home() {
    const router = useRouter();
    const { ready, walletAddress, role, connectWallet, connecting } = useWallet();

    useLenis(ready && !walletAddress);

    useEffect(() => {
        if (!ready) return;
        if (walletAddress) {
            // NEW_USER or no role → role selection; otherwise dashboard
            if (!role || role === 'NEW_USER') {
                router.replace('/select-role');
            } else {
                router.replace('/dashboard');
            }
        }
    }, [ready, router, walletAddress, role]);

    useEffect(() => {
        if (walletAddress) return;

        if (siteConfig.title) {
            document.title = siteConfig.title;
        }

        const metaViewport = document.querySelector('meta[name="viewport"]');
        if (metaViewport) {
            metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }

        const setupGlobalSnap = () => {
            const pinned = ScrollTrigger.getAll()
                .filter((st) => st.vars.pin)
                .sort((a, b) => a.start - b.start);

            const maxScroll = ScrollTrigger.maxScroll(window);
            if (!maxScroll || pinned.length === 0) return;

            const pinnedRanges = pinned.map((st) => ({
                start: st.start / maxScroll,
                end: (st.end ?? st.start) / maxScroll,
                center: (st.start + ((st.end ?? st.start) - st.start) * 0.5) / maxScroll,
            }));

            ScrollTrigger.create({
                snap: {
                    snapTo: (value: number) => {
                        const inPinned = pinnedRanges.some((r) => value >= r.start - 0.02 && value <= r.end + 0.02);
                        if (!inPinned) return value;

                        return pinnedRanges.reduce(
                            (closest, r) => (Math.abs(r.center - value) < Math.abs(closest - value) ? r.center : closest),
                            pinnedRanges[0]?.center ?? 0
                        );
                    },
                    duration: { min: 0.15, max: 0.35 },
                    delay: 0,
                    ease: 'power2.out',
                },
            });
        };

        const timer = window.setTimeout(setupGlobalSnap, 500);

        return () => {
            window.clearTimeout(timer);
            ScrollTrigger.getAll().forEach((st) => st.kill());
        };
    }, [walletAddress]);

    const handleConnect = async () => {
        const connected = await connectWallet();
        if (connected) {
            router.push('/select-role');
        }
    };

    if (ready && walletAddress) {
        return <div className="-mt-20 min-h-screen bg-[#07070B]" />;
    }

    return (
        <div className="-mt-20">
            <main className="relative min-h-screen w-full overflow-x-hidden bg-[#07070B]">
                <div className="grain" />
                <Hero onConnect={handleConnect} connecting={connecting} />
                {valuePropsConfig.map((props, index) => (
                    <ValueProp
                        key={props.sectionId}
                        {...props}
                        badge={index === 2 ? 'Zero-knowledge proofs + on-chain settlement' : undefined}
                    />
                ))}
                <div id="cube">
                    <AlbumCube />
                </div>
                <div id="gallery">
                    <ParallaxGallery />
                </div>
                <div id="tour">
                    <TourSchedule />
                </div>
                <div id="contact">
                    <Footer onConnect={handleConnect} connecting={connecting} />
                </div>
            </main>
        </div>
    );
}
