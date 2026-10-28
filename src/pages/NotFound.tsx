import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div className="grid-fade pointer-events-none absolute inset-0 -z-10 opacity-50" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_45%_at_50%_20%,oklch(0.836_0.137_84/0.12),transparent_65%)]" />

      <BrandLockup />
      <p className="num mt-10 text-[11px] tracking-[0.3em] text-muted-foreground">
        404 · OFF BOOK
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        This page isn&apos;t on the tape.
      </h1>
      <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
        The route you asked for does not exist, or your account no longer has
        access to it.
      </p>
      <Button asChild className="mt-7 gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
        <Link to="/dashboard">
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </Button>
    </main>
  );
}
