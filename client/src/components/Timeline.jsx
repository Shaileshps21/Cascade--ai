import { format, isToday, isTomorrow, isPast } from 'date-fns';

function groupByDay(items) {
  const groups = {};
  items.forEach((item) => {
    const key = format(new Date(item.startTime), 'yyyy-MM-dd');
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return groups;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return format(d, 'EEE, MMM d');
}

/**
 * @param {object[]} tasks – all user tasks with scheduledSlots
 */
export default function Timeline({ tasks }) {
  // Flatten all scheduled subtasks across tasks
  const items = [];

  tasks.forEach((task) => {
    (task.subtasks || []).forEach((subtask) => {
      if (!subtask.scheduledStart || subtask.completed) return;
      items.push({
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        subtaskId: subtask.id,
        subtaskTitle: subtask.title,
        startTime: subtask.scheduledStart,
        endTime: subtask.scheduledEnd,
        estimatedMinutes: subtask.estimatedMinutes,
        riskScore: task.riskScore,
      });
    });
  });

  // Sort by start time, upcoming only
  const upcoming = items
    .filter((i) => !isPast(new Date(i.endTime || i.startTime)))
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .slice(0, 20);

  if (upcoming.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-white/30 text-sm">No scheduled work blocks yet.</p>
        <p className="text-white/20 text-xs mt-1">Add a task and connect Google Calendar to see your schedule here.</p>
      </div>
    );
  }

  const grouped = groupByDay(upcoming);

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <h2 className="font-semibold text-sm text-white">Upcoming Work Blocks</h2>
      </div>

      <div className="divide-y divide-white/5">
        {Object.entries(grouped).map(([date, dayItems]) => (
          <div key={date}>
            <div className="px-4 py-2 bg-white/2">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                {dayLabel(date)}
              </span>
            </div>

            {dayItems.map((item, i) => {
              const riskColor =
                item.riskScore >= 80 ? 'bg-rose-400'
                : item.riskScore >= 55 ? 'bg-amber-400'
                : 'bg-brand-400';

              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-white/2 transition-colors">
                  {/* Time */}
                  <div className="w-16 flex-shrink-0 text-right">
                    <p className="text-xs font-mono text-white/50">
                      {format(new Date(item.startTime), 'h:mm a')}
                    </p>
                    <p className="text-[10px] text-white/25">
                      {item.estimatedMinutes}m
                    </p>
                  </div>

                  {/* Risk dot + connector */}
                  <div className="flex flex-col items-center gap-0.5">
                    <div className={`w-2 h-2 rounded-full ${riskColor}`} />
                    {i < dayItems.length - 1 && <div className="w-px h-6 bg-white/10" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{item.subtaskTitle}</p>
                    <p className="text-xs text-white/30 truncate">{item.taskTitle}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
