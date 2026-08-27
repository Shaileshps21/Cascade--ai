import { useState } from 'react';
import { completeOnboarding } from '../api/index.js';

const SLIDES = [
  {
    icon: 'lightning',
    emoji: '⚡',
    headline: 'Welcome to Cascade',
    body: 'Describe any goal in plain English and 15 AI agents instantly break it into a step-by-step plan — milestones, subtasks, time estimates, and calendar schedule — all in under a minute.',
    visual: null,
  },
  {
    icon: 'robot',
    emoji: '🤖',
    headline: 'How the AI works',
    body: '15 specialised agents collaborate: extracting intent, acquiring knowledge, planning milestones, estimating time, scheduling around your calendar, and continuously tracking risk as you progress.',
    visual: null,
  },
  {
    icon: 'calendar',
    emoji: '📅',
    headline: 'Google Calendar sync',
    body: 'Connect your Google Calendar once and every subtask is automatically scheduled around your existing events. Toggle sync on or off per project using the calendar pill on each project card.',
    visual: null,
  },
  {
    icon: 'bulb',
    emoji: '💡',
    headline: 'Three tips to get started',
    body: null,
    tips: [
      { icon: '🌙', title: 'Work Style', desc: 'Set "day", "night", or "flexible" to schedule tasks in your preferred hours.' },
      { icon: '⚡', title: 'Resource Mode', desc: '"Info-only" mode skips URL verification — plans faster when you are in a hurry.' },
      { icon: '⏸️', title: 'API Quota?', desc: 'If the pipeline is interrupted, a Resume banner appears — pick up right where you left off.' },
    ],
  },
];

export default function Onboarding({ onDone }) {
  const [slide, setSlide] = useState(0);
  const [dismissing, setDismissing] = useState(false);

  const total = SLIDES.length;
  const isLast = slide === total - 1;
  const current = SLIDES[slide];

  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try { await completeOnboarding(); } catch { /* non-fatal */ }
    onDone?.();
  };

  const next = () => { if (isLast) { dismiss(); } else { setSlide((s) => s + 1); } };
  const prev = () => { if (slide > 0) setSlide((s) => s - 1); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1117] shadow-2xl overflow-hidden">

        {/* Close */}
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors z-10"
          title="Skip tour"
        >
          ✕
        </button>

        {/* Content */}
        <div className="px-7 pt-8 pb-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">{current.emoji}</span>
            <h2 className="text-lg font-semibold text-white">{current.headline}</h2>
          </div>

          {current.body && (
            <p className="text-sm text-white/60 leading-relaxed">{current.body}</p>
          )}

          {current.tips && (
            <div className="flex flex-col gap-3 mt-2">
              {current.tips.map((t) => (
                <div key={t.title} className="flex gap-3 items-start text-xs">
                  <span className="text-lg leading-none">{t.icon}</span>
                  <div>
                    <p className="font-semibold text-white/80">{t.title}</p>
                    <p className="text-white/40 mt-0.5">{t.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Slide indicator */}
        <div className="flex justify-center gap-1.5 py-3">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className={`rounded-full transition-all duration-300 ${i === slide ? 'w-5 h-1.5 bg-brand-400' : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/40'}`}
            />
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between px-7 pb-6 pt-1">
          <button onClick={dismiss} className="text-xs text-white/25 hover:text-white/50 transition-colors">
            Skip tour
          </button>
          <div className="flex gap-2">
            {slide > 0 && (
              <button
                onClick={prev}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/5 border border-white/10 transition-all"
              >
                ← Back
              </button>
            )}
            <button
              onClick={next}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-400 text-white transition-all"
            >
              {isLast ? 'Get Started →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
