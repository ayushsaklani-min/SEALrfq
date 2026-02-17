"use client";

import React from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

interface CardProps extends Omit<HTMLMotionProps<"div">, "children"> {
    gradientBorder?: boolean;
    children?: React.ReactNode;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, children, gradientBorder, ...props }, ref) => {
        return (
            <motion.div
                ref={ref}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className={cn(
                    "relative overflow-hidden rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6 shadow-glass",
                    gradientBorder && "p-[1px] bg-gradient-to-br from-white/10 via-white/5 to-transparent",
                    className
                )}
                {...props}
            >
                {gradientBorder ? (
                    <div className="h-full w-full rounded-2xl bg-black/40 backdrop-blur-xl p-6">
                        {children}
                    </div>
                ) : (
                    children
                )}
            </motion.div>
        );
    }
);

Card.displayName = "Card";

export { Card };
