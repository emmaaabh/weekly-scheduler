import { WeekSchedule, Employee, ShiftTemplate, DAYS_OF_WEEK } from './types';

export function formatScheduleForSlack(schedule: WeekSchedule, employees: Employee[], shiftTemplate: ShiftTemplate): string {
  const empMap = new Map(employees.map(e => [e.id, e.name]));

  const weekStart = new Date(schedule.weekStartDate + 'T00:00:00');
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  let text = `*📅 Weekly Schedule: ${formatDate(weekStart)} – ${formatDate(weekEnd)}*\n\n`;

  for (const daySchedule of schedule.days) {
    const shiftTypes = shiftTemplate[daySchedule.day] || [];
    text += `*${daySchedule.day}*\n`;

    for (let i = 0; i < daySchedule.shifts.length; i++) {
      const shift = daySchedule.shifts[i];
      const shiftType = shiftTypes[i];
      const names = shift.employeeIds
        .map(id => empMap.get(id) || 'Unknown')
        .join(', ');
      const timeStr = shiftType ? `${shiftType.startTime}–${shiftType.endTime}` : '';
      text += `  ${shift.shiftName} (${timeStr}): ${names || '_unfilled_'}\n`;
    }
    text += '\n';
  }

  return text;
}

export async function sendToSlack(webhookUrl: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('/api/slack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, text: message }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${response.status}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
