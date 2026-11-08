import { AlertTriangle, ArrowRight, Check, ShieldCheck, Sparkles } from "lucide-react";
import { appConfig } from "@/app.config";
import { cashPlan, DEFAULT_MONTHLY_BUDGET_CENTS } from "@/lib/wedding/cash";
import { cashFix } from "@/lib/wedding/cash-moves";
import { formatCents } from "@/lib/wedding/cents";
import { daysBetween, formatDay } from "@/lib/wedding/dates";
import { BAND_ANSWERS, SAMPLES, WEDDING_DAY } from "@/lib/wedding/samples";
import { HEADLINE, PAIN_POINTS } from "@/lib/wedding/story";
import type { ItemKind, TimelineItem } from "@/lib/wedding/types";
import { ButtonLink } from "../ui/button";
import { AppLogo } from "../shell/app-logo";

/**
 * Landing page sections. Content comes from appConfig.landing; reorder or replace freely.
 *   <SiteHeader /> <Hero /> <PainPoints /> <HowItWorks /> <Features /> <CtaBand /> <SiteFooter />
 */

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <AppLogo />
        <nav className="flex items-center gap-2">
          <a href="#why" className="hidden rounded-md px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 sm:block">
            Why it matters
          </a>
          <a href="#how" className="hidden rounded-md px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 sm:block">
            How it works
          </a>
          <ButtonLink href={appConfig.landing.primaryCta.href} size="sm">
            {appConfig.landing.primaryCta.label}
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

/** The five sample contracts as timeline items, so the landing shows the real cash check's own words. */
function sampleItems(today: string): TimelineItem[] {
  return SAMPLES.flatMap((s) => {
    const entry = (kind: ItemKind, cents: number, due: string): TimelineItem => ({ id: `${s.vendorRole}.${kind}`, contractId: s.vendorRole, kind, vendorName: s.vendorName, vendorRole: s.vendorRole, cents, due, daysUntil: daysBetween(today, due), status: due < today ? "overdue" : "upcoming", weddingDay: WEDDING_DAY });
    return [entry("deposit", s.depositCents, s.depositDue), entry("balance", s.balanceCents, s.balanceDue ?? BAND_ANSWERS.balanceDue)];
  });
}

/** The sample wedding's worst month, as the app's cash check says it, with the sums and code's plan. */
function CashPreview() {
  // A fixed day keeps the page static: the sample's first payment date. Nothing is overdue on it,
  // and the worst month and the plan are the same as the app shows on any day before May 2027.
  const today = SAMPLES.map((s) => s.depositDue).sort()[0];
  const items = sampleItems(today);
  const cash = cashPlan(items, today, DEFAULT_MONTHLY_BUDGET_CENTS);
  const worst = cash.warnings.filter((w) => w.kind === "over_month").sort((a, b) => b.totalCents - a.totalCents)[0];
  const fix = cashFix(items, today, DEFAULT_MONTHLY_BUDGET_CENTS);
  if (!worst) return null;
  return (
    <div className="relative rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-2xl shadow-brand-900/10 ring-1 ring-black/5 backdrop-blur" data-testid="landing-cash">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-900">The cash check, on the sample wedding</span>
        <span className="shrink-0 text-xs text-zinc-500">Fictional sample</span>
      </div>
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900">
        <p className="flex items-start gap-2 text-sm font-medium">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span data-testid="landing-cash-warning">{worst.message}</span>
        </p>
        <ul className="mt-3 space-y-1 pl-6 text-xs tabular-nums">
          {worst.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{p.label}, {formatDay(p.payDate)}</span>
              <span className="shrink-0">{formatCents(p.cents)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 border-t border-amber-900/20 pt-1 font-semibold">
            <span>Monthly budget</span>
            <span>{formatCents(cash.monthlyBudgetCents)}</span>
          </li>
        </ul>
      </div>
      {fix?.moves.length ? (
        <div className="mt-4" data-testid="landing-cash-plan">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cash plan, each move yours to approve</p>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
            {fix.moves.map((m) => (
              <li key={m.id} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-brand" /> {m.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-zinc-500">Worked out by the app&apos;s code from the five sample contracts and a $5,000 monthly budget.</p>
    </div>
  );
}

/** The researched headline figure, with its source named and linked. */
function HeadlineFigure() {
  return (
    <p className="mt-6 max-w-xl rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm text-zinc-600 shadow-sm" data-testid="landing-headline-figure">
      <span className="font-semibold text-zinc-900">{HEADLINE.figure} per couple.</span> {HEADLINE.line}{" "}
      <span className="text-zinc-500">
        Source:{" "}
        <a href={HEADLINE.source.url} className="underline underline-offset-2 hover:text-zinc-900" target="_blank" rel="noreferrer">
          {HEADLINE.source.label}
        </a>
        , {HEADLINE.method}.
      </span>
    </p>
  );
}

/** The pain points from the research, each with its sources and what the app does about it. */
export function PainPoints() {
  return (
    <section id="why" className="border-t border-zinc-200/70 bg-white py-20" data-testid="pain-points">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">Why this matters</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">What couples say about paying vendors</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PAIN_POINTS.map((p) => (
            <div key={p.title} className="flex flex-col rounded-2xl border border-zinc-200 bg-zinc-50/50 p-6" data-testid="pain-point">
              <h3 className="text-lg font-semibold text-zinc-900">{p.title}</h3>
              <ul className="mt-3 space-y-2.5 text-[15px] leading-relaxed text-zinc-700">
                {p.evidence.map((e) => (
                  <li key={e.text}>
                    {e.text}{" "}
                    <a href={e.source.url} className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-900" target="_blank" rel="noreferrer" data-testid="pain-source">
                      {e.source.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-4">
                <p className="border-t border-zinc-200 pt-3 text-sm text-zinc-600">
                  <span className="font-semibold text-zinc-900">What the app does: </span>
                  {p.answer}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-zinc-500">Forum posts are single couples&apos; words. They show a problem comes up, not how often it does.</p>
      </div>
    </section>
  );
}

export function Hero() {
  const l = appConfig.landing;
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
      <div className="absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-sm font-medium text-brand-700 shadow-sm">
            <Sparkles className="size-4" /> {l.eyebrow}
          </span>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-zinc-950 sm:text-5xl lg:text-[56px]">{l.headline}</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600">{l.subheadline}</p>
          <HeadlineFigure />
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={l.primaryCta.href} size="lg">
              {l.primaryCta.label} <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href={l.secondaryCta.href} size="lg" variant="secondary">
              {l.secondaryCta.label}
            </ButtonLink>
          </div>
          <p className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
            <ShieldCheck className="size-4 text-emerald-600" /> No money moves until you approve it.
          </p>
        </div>
        <CashPreview />
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-zinc-200/70 bg-white py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">How it works</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Contracts in, one timeline out</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {appConfig.landing.steps.map((s, i) => (
            <div key={s.title} className="relative rounded-2xl border border-zinc-200 bg-zinc-50/50 p-6">
              <span className="flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">{i + 1}</span>
              <h3 className="mt-4 text-lg font-semibold text-zinc-900">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="py-20">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-3">
        {appConfig.landing.features.map((f) => (
          <div key={f.title} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <Check className="size-5 text-brand" />
            <h3 className="mt-3 font-semibold text-zinc-900">{f.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-zinc-600">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CtaBand() {
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 px-8 py-12 text-white shadow-xl md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{appConfig.tagline}</h2>
          <p className="mt-2 text-white/75">Try it with five fictional contracts. Payments run on the PayPal sandbox, so no real money moves.</p>
        </div>
        <ButtonLink href={appConfig.landing.primaryCta.href} size="lg" variant="secondary" className="border-transparent">
          {appConfig.landing.primaryCta.label} <ArrowRight className="size-4" />
        </ButtonLink>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>
          {appConfig.name} · PayPal sandbox only · MIT licensed
        </span>
        <span>Built with PayPal, Claude and Claude Code</span>
      </div>
    </footer>
  );
}
