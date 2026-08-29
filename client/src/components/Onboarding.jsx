import { useState } from 'react';
import { completeOnboarding } from '../api/index.js';

// Fully literal per-accent class strings — Tailwind's JIT scanner only picks
// up classes it can see as-written in source, so `bg-${accent}-500` would be
// silently purged from the production build. A lookup table keeps every
// class name static and visible to the scanner.
// Flat per-slide accent (UPDATED_design.md §7 step 4: keep the accent color
// as a slide differentiator, but express it as a flat chip, not a gradient —
// gradients are reserved for the logo mark + primary CTA only, see §3.4).
const ACCENTS = {
  indigo: {
    solid: 'bg-brand-500',
    ring: 'ring-brand-400/30',
    text: 'text-brand-400',
    dot: 'bg-brand-400',
    tipBorder: 'border-l-brand-400',
  },
  fuchsia: {
    solid: 'bg-fuchsia-500',
    ring: 'ring-fuchsia-400/30',
    text: 'text-fuchsia-400',
    dot: 'bg-fuchsia-400',
    tipBorder: 'border-l-fuchsia-400',
  },
  sky: {
    solid: 'bg-sky-500',
    ring: 'ring-sky-400/30',
    text: 'text-sky-400',
    dot: 'bg-sky-400',
    tipBorder: 'border-l-sky-400',
  },
  amber: {
    solid: 'bg-amber-500',
    ring: 'ring-amber-400/30',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
    tipBorder: 'border-l-amber-400',
  },
};

const SLIDES = [
  {
    accent: 'indigo',
    emoji: '⚡',
    headline: 'Welcome to Cascade',
    body: 'Describe any goal in plain English and 15 AI agents instantly break it into a step-by-step plan — milestones, subtasks, time estimates, and calendar schedule — all in under a minute. Prefer to skip the AI entirely? Build a project by hand instead with "Add manually →", and enhance it with AI later whenever you are ready.',
    visual: 'hero',
  },
  {
    accent: 'fuchsia',
    emoji: '🤖',
    headline: 'How the AI works',
    body: '15 specialised agents collaborate: extracting intent, acquiring knowledge, planning milestones, estimating time, scheduling around your calendar, and continuously tracking risk as you progress. The more projects you complete, the better it gets — time estimates learn your real pace per task category.',
    visual: 'pipeline',
  },
  {
    accent: 'sky',
    emoji: '📅',
    headline: 'Calendar & scheduling, your way',
    body: 'Connect Google Calendar once and every subtask is automatically scheduled around your existing events — day, night, or flexible hours, with a weekend mode and daily-capacity control in Settings. Toggle sync on or off per project anytime using the calendar pill on each project card.',
    visual: 'calendar',
  },
  {
    accent: 'amber',
    emoji: '💡',
    headline: 'Tips to get started',
    body: null,
    visual: 'tips',
    tips: [
      { icon: '🌙', title: 'Scheduling Preferences', desc: 'Set day/night/flexible hours, a weekend mode, and your daily capacity in Settings.' },
      { icon: '🗂️', title: 'Task Workspace', desc: 'Drag tasks to reorder them, add markdown notes, and use the Focus Mode timer to track real working time.' },
      { icon: '⚡', title: 'Resource Mode', desc: '"Info-only" mode skips URL verification — plans faster when you are in a hurry.' },
      { icon: '⏸️', title: 'API Quota?', desc: 'If the pipeline is interrupted, a Resume banner appears — pick up right where you left off.' },
    ],
  },
];

const PIPELINE_STEPS = [
  { icon: '🎯', label: 'Intent' },
  { icon: '🧠', label: 'Knowledge' },
  { icon: '🗺️', label: 'Plan' },
  { icon: '⏱️', label: 'Estimate' },
  { icon: '📅', label: 'Schedule' },
];

const CALENDAR_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function IconBadge({ accent, emoji }) {
  const a = ACCENTS[accent];
  return (
    <div className="w-16 h-16 mx-auto mb-1 shrink-0">
      <div className={`w-16 h-16 rounded-full ${a.solid} ring-4 ${a.ring} flex items-center justify-center`}>
        <span className="text-3xl leading-none">{emoji}</span>
      </div>
    </div>
  );
}

function PipelineVisual({ accent }) {
  const a = ACCENTS[accent];
  return (
    <div className="flex items-center justify-center gap-0 py-1">
      {PIPELINE_STEPS.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <div className={`w-9 h-9 rounded-xl bg-surface-hover border border-border flex items-center justify-center text-base ${i === 0 ? `ring-2 ${a.ring}` : ''}`}>
              {step.icon}
            </div>
            <span className="text-[9px] text-muted whitespace-nowrap">{step.label}</span>
          </div>
          {i < PIPELINE_STEPS.length - 1 && (
            <div className={`w-4 sm:w-6 h-px ${a.solid} opacity-40 mb-4`} />
          )}
        </div>
      ))}
    </div>
  );
}

function CalendarVisual({ accent }) {
  const a = ACCENTS[accent];
  return (
    <div className="flex flex-col items-center gap-2 py-1">
      <div className="flex gap-1.5">
        {CALENDAR_DAYS.map((d, i) => {
          const isSynced = i === 3;
          return (
            <div
              key={i}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-semibold border transition-colors ${isSynced
                  ? `${a.solid} border-transparent text-white ${a.ring} ring-2`
                  : 'bg-surface-hover border-border text-muted'
                }`}
            >
              {isSynced ? '✓' : d}
            </div>
          );
        })}
      </div>
      <span className={`text-[10px] font-medium ${a.text}`}>✓ auto-scheduled around your day</span>
    </div>
  );
}

function TipsVisual({ accent, tips }) {
  const a = ACCENTS[accent];
  return (
    <div className="flex flex-col gap-2 mt-1">
      {tips.map((t) => (
        <div
          key={t.title}
          className={`flex gap-3 items-start text-xs rounded-xl border border-border bg-surface px-3 py-2.5 border-l-4 ${a.tipBorder}`}
        >
          <span className="text-lg leading-none mt-0.5">{t.icon}</span>
          <div>
            <p className="font-semibold text-primary">{t.title}</p>
            <p className="text-muted mt-0.5 leading-relaxed">{t.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Onboarding — 4-slide first-run tour shown once to new users with zero
 * projects. Each slide carries its own accent color and a small illustrative
 * visual (icon glow, pipeline diagram, calendar mockup, tip cards) rather
 * than plain text, and transitions slide directionally (right on Next, left
 * on Back) so it reads as a real tour instead of a static dialog.
 */
export default function Onboarding({ onDone }) {
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState('right');
  const [dismissing, setDismissing] = useState(false);

  const total = SLIDES.length;
  const isLast = slide === total - 1;
  const current = SLIDES[slide];
  const a = ACCENTS[current.accent];

  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try { await completeOnboarding(); } catch { /* non-fatal */ }
    onDone?.();
  };

  const next = () => {
    if (isLast) { dismiss(); return; }
    setDirection('right');
    setSlide((s) => s + 1);
  };
  const prev = () => {
    if (slide === 0) return;
    setDirection('left');
    setSlide((s) => s - 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-elevated shadow-elevated overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 w-full bg-border">
          <div
            className={`h-full ${a.solid} transition-all duration-500 ease-out`}
            style={{ width: `${((slide + 1) / total) * 100}%` }}
          />
        </div>

        {/* Close */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-3 w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-secondary hover:bg-surface-hover transition-colors z-10"
          title="Skip tour"
        >
          ✕
        </button>

        {/* Content */}
        <div key={slide} className={`px-7 pt-7 pb-4 min-h-[19rem] ${direction === 'right' ? 'animate-slide-in-right' : 'animate-slide-in-left'}`}>
          <IconBadge accent={current.accent} emoji={current.emoji} />

          <h2 className="text-lg font-semibold text-primary text-center mb-3">{current.headline}</h2>

          {current.body && (
            <p className="text-sm text-secondary leading-relaxed text-center max-w-sm mx-auto">{current.body}</p>
          )}

          {current.visual === 'pipeline' && (
            <div className="mt-4">
              <PipelineVisual accent={current.accent} />
            </div>
          )}

          {current.visual === 'calendar' && (
            <div className="mt-4">
              <CalendarVisual accent={current.accent} />
            </div>
          )}

          {current.visual === 'tips' && <TipsVisual accent={current.accent} tips={current.tips} />}
        </div>

        {/* Slide indicator */}
        <div className="flex justify-center gap-1.5 py-3">
          {SLIDES.map((s, i) => (
            <button
              key={i}
              onClick={() => { setDirection(i > slide ? 'right' : 'left'); setSlide(i); }}
              className={`rounded-full transition-all duration-300 ${i === slide ? `w-5 h-1.5 ${ACCENTS[s.accent].dot}` : 'w-1.5 h-1.5 bg-border-strong hover:bg-muted'}`}
            />
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between px-7 pb-6 pt-1">
          <button onClick={dismiss} className="text-xs text-muted hover:text-secondary transition-colors">
            Skip tour
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted font-mono tabular-nums">{slide + 1} / {total}</span>
            {slide > 0 && (
              <button
                onClick={prev}
                className="px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-primary hover:bg-surface-hover border border-border transition-colors"
              >
                ← Back
              </button>
            )}
            <button
              onClick={next}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${a.solid} hover:brightness-110 text-white transition-colors`}
            >
              {isLast ? 'Get Started →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
