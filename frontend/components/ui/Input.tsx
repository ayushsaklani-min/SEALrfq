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
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary-400 transition-colors">
                            {leftIcon}
                        </div>
                    )}
                    <input
                        type={type}
                        className={cn(
                            "flex h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-gray-500",
                            "focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/50",
                            "transition-all duration-300 backdrop-blur-sm",
                            "hover:bg-white/10",
                            leftIcon && "pl-10",
                            rightIcon && "pr-10",
                            error && "border-red-500/50 focus:ring-red-500/20 focus:border-red-500",
                            className
                        )}
                        ref={ref}
                        {...props}
                    />
                    {rightIcon && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary-400 transition-colors">
                            {rightIcon}
                        </div>
                    )}
                </div>
                {error && (
                    <p className="text-xs text-red-400 pl-1 animate-fade-in">{error}</p>
                )}
            </div>
        );
    }
);
Input.displayName = "Input";

export { Input };
