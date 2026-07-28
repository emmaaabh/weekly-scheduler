import { Employee, WeekSchedule, DAYS_OF_WEEK, ShiftTemplate, ShiftPreference } from './types';

export function generateDraftSchedule(
  schedule: WeekSchedule,
  employees: Employee[],
  shiftTemplate: ShiftTemplate,
  preferences: ShiftPreference[] = [],
): WeekSchedule {
  const available = employees.filter(
    e => !schedule.unavailableEmployeeIds.includes(e.id)
  );

  if (available.length === 0) {
    return schedule;
  }

  // Track how many shifts each employee has been assigned this week for fairness
  const assignmentCounts = new Map<string, number>();
  available.forEach(e => assignmentCounts.set(e.id, 0));

  const updatedDays = DAYS_OF_WEEK.map(day => {
    const shiftTypes = shiftTemplate[day] || [];
    // Track who's already assigned today to avoid double-booking
    const assignedToday = new Set<string>();

    const shifts = shiftTypes.map(st => {
      const employeeIds: string[] = [];

      // 1. First, slot in preferred employees for this day+shift (if available)
      const prefsForShift = preferences.filter(
        p => p.day === day && p.shiftName === st.name
      );
      for (const pref of prefsForShift) {
        if (
          available.some(e => e.id === pref.employeeId) &&
          !assignedToday.has(pref.employeeId) &&
          employeeIds.length < st.minStaff
        ) {
          employeeIds.push(pref.employeeId);
          assignedToday.add(pref.employeeId);
          assignmentCounts.set(pref.employeeId, (assignmentCounts.get(pref.employeeId) ?? 0) + 1);
        }
      }

      // 2. Fill remaining slots with round-robin, preferring least-assigned employees
      while (employeeIds.length < st.minStaff) {
        // Sort available by assignment count, then pick someone not already on this shift
        const candidates = available
          .filter(e => !employeeIds.includes(e.id))
          .sort((a, b) => (assignmentCounts.get(a.id) ?? 0) - (assignmentCounts.get(b.id) ?? 0));

        // Prefer someone not already assigned today
        const notToday = candidates.filter(e => !assignedToday.has(e.id));
        const pick = notToday[0] ?? candidates[0];

        if (!pick) break; // no one left

        employeeIds.push(pick.id);
        assignedToday.add(pick.id);
        assignmentCounts.set(pick.id, (assignmentCounts.get(pick.id) ?? 0) + 1);
      }

      return { shiftName: st.name, employeeIds };
    });
    return { day, shifts };
  });

  return { ...schedule, days: updatedDays };
}
