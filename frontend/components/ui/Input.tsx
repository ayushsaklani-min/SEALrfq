"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> {
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, leftIcon, rightIcon, error, ...props }, ref) => {
        return (
            <div className="space-y-1">
                <div className="relative group">
                    {leftIcon && (
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] group-focus-within:text-[hsl(var(--primary))] transition-colors">
                            {leftIcon}
                        </div>
                    )}
                    <input
                        type={type}
                        className={cn(
                            "flex h-11 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-2 text-sm text-white placeholder:text-[hsl(var(--muted-foreground))]",
                            "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/20 focus:border-[hsl(var(--primary))]/50",
                            "transition-all duration-200",
                            leftIcon && "pl-10",
                            rightIcon && "pr-10",
                            error && "border-red-500/50 focus:ring-red-500/20 focus:border-red-500",
                            className
                        )}
                        ref={ref}
                        {...props}
                    />
                    {rightIcon && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] group-focus-within:text-[hsl(var(--primary))] transition-colors">
                            {rightIcon}
                        </div>
                    )}
                </div>
                {error && (
                    <p className="text-xs text-red-400 pl-1">{error}</p>
                )}
            </div>
        );
    }
);
Input.displayName = "Input";

export { Input };
