"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
            "relative inline-flex items-center justify-center rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/0.3)] disabled:opacity-50 disabled:cursor-not-allowed";

        const variants = {
            primary:
                "bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.9)] text-[hsl(var(--primary-foreground))] shadow-sm",
            secondary:
                "bg-[hsl(var(--secondary))] hover:bg-[hsl(var(--secondary)/0.8)] text-white border border-[hsl(var(--border))]",
            ghost: "bg-transparent hover:bg-white/5 text-[hsl(var(--muted-foreground))] hover:text-white",
            danger:
                "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20",
        };

        const sizes = {
            sm: "h-8 px-3 text-sm gap-1.5",
            md: "h-10 px-4 text-sm gap-2",
            lg: "h-12 px-6 text-base gap-2",
        };

        return (
            <button
                ref={ref}
                className={cn(baseStyles, variants[variant], sizes[size], className)}
                disabled={isLoading || disabled}
                {...props}
            >
                {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    leftIcon
                )}
                {children}
                {!isLoading && rightIcon}
            </button>
        );
    }
);

Button.displayName = "Button";

export { Button };
