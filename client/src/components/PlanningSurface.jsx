import { useState } from 'react';
import { SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import TaskInput from './TaskInput.jsx';
import SchedulePreferences from './SchedulePreferences.jsx';
import ResourceModeToggle from './ResourceModeToggle.jsx';

/**
 * PlanningSurface — the single "Create Plan" surface (UPDATED_design.md
 * §9.5/§9.6). Composes TaskInput, SchedulePreferences and ResourceModeToggle
 * as sections of one card instead of three separate floating cards. Each
 * child keeps its own state/effects/API calls untouched — this component
 * only supplies the shared card chrome and section dividers.
 *
 * Planning Parameters collapses/expands like the Dashboard's System Status
 * section — collapsed by default, click the header to expand, set the
 * parameters, click again to collapse.
 */
export default function PlanningSurface({ onProcessStart }) {
  const [paramsOpen, setParamsOpen] = useState(false);

  return (
    <div className="card p-5 space-y-5">
      <h2 className="text-sm font-semibold text-primary">Create Plan</h2>

      <TaskInput onProcessStart={onProcessStart} />

      <div className="border-t border-border" />

      <div>
        <button
          type="button"
          onClick={() => setParamsOpen((o) => !o)}
          data-active={paramsOpen}
          className="segmented-btn flex items-center gap-2 w-full sm:w-auto justify-center"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Planning Parameters
          {paramsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {paramsOpen && (
          <div className="mt-3 rounded-lg border border-border bg-base/60 p-4 divide-y divide-border">
            <div className="pb-4">
              <SchedulePreferences />
            </div>
            <div className="pt-4">
              <ResourceModeToggle />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
