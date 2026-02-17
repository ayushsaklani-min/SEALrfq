"use client";

import React from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    children?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className,
            variant = "primary",
            size = "md",
            isLoading,
            leftIcon,
            rightIcon,
            children,
            disabled,
            ...props
        },
        ref
    ) => {
        const baseStyles =
            "relative inline-flex items-center justify-center rounded-xl font-medium transition-all duration-300 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

        const variants = {
            primary:
                "bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-500/20 border border-transparent hover:shadow-primary-500/40",
            secondary:
                "bg-white/5 hover:bg-white/10 text-white border border-white/10 backdrop-blur-md",
            ghost: "bg-transparent hover:bg-white/5 text-gray-300 hover:text-white",
            danger:
                "bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20",
        };

        const sizes = {
            sm: "h-9 px-4 text-sm",
            md: "h-11 px-6 text-base",
            lg: "h-14 px-8 text-lg",
        };

        return (
            <motion.button
                ref={ref}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(baseStyles, variants[variant], sizes[size], className)}
                disabled={isLoading || disabled}
                {...props}
            >
                <div className="flex items-center gap-2 relative z-10">
                    {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        leftIcon
                    )}
                    {children}
                    {!isLoading && rightIcon}
                </div>
            </motion.button>
        );
    }
);

Button.displayName = "Button";

export { Button };
