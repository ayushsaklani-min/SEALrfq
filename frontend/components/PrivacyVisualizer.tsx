'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback, useEffect } from 'react';
import { Lock, Unlock, Eye, Shield, ChevronRight, ChevronLeft, Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
    id: string;
    title: string;
    description: string;
    privateData: string[];
    publicData: string[];
    icon: 'lock' | 'unlock' | 'eye' | 'shield';
}

const STEPS: Step[] = [
    {
        id: 'submission',
        title: 'Bid Submission',
        description: 'Vendor submits their bid with pricing and terms. All data is encrypted locally before transmission.',
        privateData: ['Bid Amount', 'Pricing Details', 'Terms & Conditions', 'Vendor Identity'],
        publicData: ['RFQ Reference ID', 'Submission Timestamp'],
        icon: 'lock',
    },
    {
        id: 'commitment',
        title: 'ZK Commitment',
        description: 'A zero-knowledge proof is generated, creating a cryptographic commitment without revealing the bid contents.',
        privateData: ['Bid Amount', 'Vendor Details', 'Pricing Breakdown'],
        publicData: ['Commitment Hash', 'Proof Validity', 'Timestamp'],
        icon: 'shield',
    },
    {
        id: 'storage',
        title: 'Encrypted Storage',
        description: 'The encrypted bid is stored on-chain. Only the commitment hash is visible; contents remain sealed.',
        privateData: ['Encrypted Bid Data', 'Vendor Signature', 'Detailed Terms'],
        publicData: ['Commitment Hash', 'Block Number', 'Transaction ID'],
        icon: 'lock',
    },
    {
        id: 'reveal',
        title: 'Reveal Phase',
        description: 'After deadline, vendors reveal their bids. The ZK proof verifies the revealed data matches the commitment.',
        privateData: ['Losing Bid Amounts (optional)'],
        publicData: ['Winning Bid Amount', 'Bid Rankings', 'Verification Status'],
        icon: 'eye',
    },
    {
        id: 'verification',
        title: 'Winner Verification',
        description: 'Smart contract verifies the winner selection was fair and matches the lowest valid bid commitment.',
        privateData: ['Internal Scoring Details'],
        publicData: ['Winner Address', 'Final Price', 'Verification Proof', 'Contract Award'],
        icon: 'unlock',
    },
];

const iconMap = {
    lock: Lock,
    unlock: Unlock,
    eye: Eye,
    shield: Shield,
};

const iconColors = {
    lock: 'text-amber-400',
    unlock: 'text-emerald-400',
    eye: 'text-blue-400',
    shield: 'text-purple-400',
};

const iconBgColors = {
    lock: 'bg-amber-400/10 border-amber-400/30',
    unlock: 'bg-emerald-400/10 border-emerald-400/30',
    eye: 'bg-blue-400/10 border-blue-400/30',
    shield: 'bg-purple-400/10 border-purple-400/30',
};

interface StepIndicatorProps {
    step: Step;
    index: number;
    isActive: boolean;
    isCompleted: boolean;
    onClick: () => void;
}

function StepIndicator({ step, index, isActive, isCompleted, onClick }: StepIndicatorProps) {
    const Icon = iconMap[step.icon];

    return (
        <button
            onClick={onClick}
            className={cn(
                'group relative flex flex-col items-center transition-all duration-300',
                isActive ? 'scale-110' : 'scale-100 hover:scale-105'
            )}
        >
            <motion.div
                className={cn(
                    'relative flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all duration-300 sm:h-14 sm:w-14',
                    isActive
                        ? iconBgColors[step.icon]
                        : isCompleted
                        ? 'border-emerald-400/50 bg-emerald-400/10'
                        : 'border-white/20 bg-white/5 hover:border-white/40'
                )}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                <Icon
                    className={cn(
                        'h-5 w-5 transition-colors duration-300 sm:h-6 sm:w-6',
                        isActive ? iconColors[step.icon] : isCompleted ? 'text-emerald-400' : 'text-white/60'
                    )}
                />
                {isActive && (
                    <motion.div
                        className={cn('absolute inset-0 rounded-full', iconBgColors[step.icon])}
                        initial={{ scale: 1, opacity: 0.5 }}
                        animate={{ scale: 1.3, opacity: 0 }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                    />
                )}
            </motion.div>
            <span
                className={cn(
                    'mt-2 text-center text-xs font-medium transition-colors duration-300 sm:text-sm',
                    isActive ? 'text-white' : 'text-white/60'
                )}
            >
                {index + 1}. {step.title.split(' ')[0]}
            </span>
        </button>
    );
}

interface DataBadgeProps {
    label: string;
    isPrivate: boolean;
    delay: number;
}

function DataBadge({ label, isPrivate, delay }: DataBadgeProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, delay }}
            className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:text-sm',
                isPrivate
                    ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
            )}
        >
            {isPrivate ? (
                <Lock className="h-3 w-3" />
            ) : (
                <Eye className="h-3 w-3" />
            )}
            {label}
        </motion.div>
    );
}

interface StepContentProps {
    step: Step;
    stepIndex: number;
}

function StepContent({ step, stepIndex }: StepContentProps) {
    const Icon = iconMap[step.icon];

    return (
        <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="w-full"
        >
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm sm:p-6 lg:p-8">
                {/* Header */}
                <div className="mb-6 flex items-start gap-4">
                    <div
                        className={cn(
                            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border sm:h-14 sm:w-14',
                            iconBgColors[step.icon]
                        )}
                    >
                        <Icon className={cn('h-6 w-6 sm:h-7 sm:w-7', iconColors[step.icon])} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/70">
                                Step {stepIndex + 1}
                            </span>
                        </div>
                        <h3 className="text-lg font-bold text-white sm:text-xl lg:text-2xl">
                            {step.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-white/70 sm:text-base">
                            {step.description}
                        </p>
                    </div>
                </div>

                {/* Data Sections */}
                <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
                    {/* Private Data */}
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                        <div className="mb-3 flex items-center gap-2">
                            <Lock className="h-4 w-4 text-amber-400" />
                            <span className="text-sm font-semibold text-amber-200">Private Data</span>
                            <span className="ml-auto rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-300">
                                Encrypted
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <AnimatePresence mode="popLayout">
                                {step.privateData.map((data, i) => (
                                    <DataBadge
                                        key={data}
                                        label={data}
                                        isPrivate={true}
                                        delay={i * 0.1}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Public Data */}
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                        <div className="mb-3 flex items-center gap-2">
                            <Eye className="h-4 w-4 text-emerald-400" />
                            <span className="text-sm font-semibold text-emerald-200">Public Data</span>
                            <span className="ml-auto rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300">
                                Visible
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <AnimatePresence mode="popLayout">
                                {step.publicData.map((data, i) => (
                                    <DataBadge
                                        key={data}
                                        label={data}
                                        isPrivate={false}
                                        delay={i * 0.1}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

interface ProgressConnectorProps {
    isCompleted: boolean;
    isActive: boolean;
}

function ProgressConnector({ isCompleted, isActive }: ProgressConnectorProps) {
    return (
        <div className="relative mx-1 hidden h-0.5 flex-1 overflow-hidden rounded-full bg-white/10 sm:mx-2 sm:block">
            <motion.div
                className={cn(
                    'absolute inset-y-0 left-0 rounded-full',
                    isCompleted ? 'bg-emerald-400' : isActive ? 'bg-gradient-to-r from-emerald-400 to-transparent' : ''
                )}
                initial={{ width: '0%' }}
                animate={{ width: isCompleted ? '100%' : isActive ? '50%' : '0%' }}
                transition={{ duration: 0.5 }}
            />
        </div>
    );
}

export function PrivacyVisualizer() {
    const [activeStep, setActiveStep] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);

    const goToStep = useCallback((index: number) => {
        setActiveStep(index);
    }, []);

    const goToNextStep = useCallback(() => {
        setActiveStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : 0));
    }, []);

    const goToPrevStep = useCallback(() => {
        setActiveStep((prev) => (prev > 0 ? prev - 1 : STEPS.length - 1));
    }, []);

    const toggleAutoPlay = useCallback(() => {
        setIsAutoPlaying((prev) => !prev);
    }, []);

    // Auto-play functionality
    useEffect(() => {
        if (!isAutoPlaying) return;

        const interval = setInterval(() => {
            goToNextStep();
        }, 4000);

        return () => clearInterval(interval);
    }, [isAutoPlaying, goToNextStep]);

    return (
        <div className="w-full">
            {/* Header */}
            <div className="mb-6 text-center sm:mb-8">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-2 inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-400/10 px-4 py-1.5"
                >
                    <Shield className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium text-purple-200">Zero-Knowledge Privacy</span>
                </motion.div>
                <motion.h2
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-xl font-bold text-white sm:text-2xl lg:text-3xl"
                >
                    How Your Bids Stay Private
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="mx-auto mt-2 max-w-2xl text-sm text-white/60 sm:text-base"
                >
                    Follow the journey of a bid through our ZK-powered procurement system
                </motion.p>
            </div>

            {/* Step Indicators */}
            <div className="mb-6 flex items-center justify-center px-2 sm:mb-8 sm:px-4">
                <div className="flex w-full max-w-4xl items-center justify-between">
                    {STEPS.map((step, index) => (
                        <div key={step.id} className="flex flex-1 items-center">
                            <StepIndicator
                                step={step}
                                index={index}
                                isActive={index === activeStep}
                                isCompleted={index < activeStep}
                                onClick={() => goToStep(index)}
                            />
                            {index < STEPS.length - 1 && (
                                <ProgressConnector
                                    isCompleted={index < activeStep}
                                    isActive={index === activeStep}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Step Content */}
            <div className="relative min-h-[320px] sm:min-h-[280px]">
                <AnimatePresence mode="wait">
                    <StepContent
                        key={STEPS[activeStep].id}
                        step={STEPS[activeStep]}
                        stepIndex={activeStep}
                    />
                </AnimatePresence>
            </div>

            {/* Navigation Controls */}
            <div className="mt-6 flex items-center justify-center gap-3 sm:gap-4">
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={goToPrevStep}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/70 transition-colors hover:border-white/40 hover:text-white sm:h-12 sm:w-12"
                    aria-label="Previous step"
                >
                    <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
                </motion.button>

                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleAutoPlay}
                    className={cn(
                        'flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors sm:h-12 sm:px-6',
                        isAutoPlaying
                            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                            : 'border-white/20 bg-white/5 text-white/70 hover:border-white/40 hover:text-white'
                    )}
                >
                    {isAutoPlaying ? (
                        <>
                            <Pause className="h-4 w-4" />
                            <span className="hidden sm:inline">Pause</span>
                        </>
                    ) : (
                        <>
                            <Play className="h-4 w-4" />
                            <span className="hidden sm:inline">Auto Play</span>
                        </>
                    )}
                </motion.button>

                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={goToNextStep}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/70 transition-colors hover:border-white/40 hover:text-white sm:h-12 sm:w-12"
                    aria-label="Next step"
                >
                    <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
                </motion.button>
            </div>

            {/* Step Counter */}
            <div className="mt-4 text-center">
                <span className="text-sm text-white/50">
                    Step {activeStep + 1} of {STEPS.length}
                </span>
            </div>
        </div>
    );
}

export default PrivacyVisualizer;
