export interface Employee {
  id: string;
  name: string;
}

// A preference says "this employee is always scheduled for this day+shift"
export interface ShiftPreference {
  employeeId: string;
  day: DayOfWeek;
  shiftName: string;
}

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface ShiftType {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  minStaff: number;
}

export interface ShiftTemplate {
  [key: string]: ShiftType[];
}

export interface ShiftAssignment {
  shiftName: string;
  employeeIds: string[];
}

export interface DaySchedule {
  day: DayOfWeek;
  shifts: ShiftAssignment[];
}

export interface WeekSchedule {
  id: string;
  weekStartDate: string; // ISO date string for Monday of that week
  days: DaySchedule[];
  unavailableEmployeeIds: string[];
  status: 'draft' | 'sent';
  sentAt?: string;
  createdAt: string;
}

export const DAYS_OF_WEEK: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const DEFAULT_SHIFT_TEMPLATE: ShiftTemplate = {
  Monday: [
    { id: 'mon-opener', name: 'Opener', startTime: '6:45 AM', endTime: '3:00 PM', minStaff: 1 },
    { id: 'mon-closer', name: 'Closer', startTime: '9:00 AM', endTime: 'Close', minStaff: 2 },
  ],
  Tuesday: [
    { id: 'tue-opener', name: 'Opener', startTime: '6:45 AM', endTime: '3:00 PM', minStaff: 1 },
    { id: 'tue-closer', name: 'Closer', startTime: '9:00 AM', endTime: 'Close', minStaff: 2 },
  ],
  Wednesday: [
    { id: 'wed-opener', name: 'Opener', startTime: '6:45 AM', endTime: '3:00 PM', minStaff: 1 },
    { id: 'wed-closer', name: 'Closer', startTime: '9:00 AM', endTime: 'Close', minStaff: 2 },
  ],
  Thursday: [
    { id: 'thu-opener', name: 'Opener', startTime: '6:45 AM', endTime: '3:00 PM', minStaff: 1 },
    { id: 'thu-closer', name: 'Closer', startTime: '9:00 AM', endTime: 'Close', minStaff: 2 },
  ],
  Friday: [
    { id: 'fri-opener', name: 'Opener', startTime: '6:45 AM', endTime: '3:00 PM', minStaff: 2 },
    { id: 'fri-closer', name: 'Closer', startTime: '9:00 AM', endTime: 'Close', minStaff: 2 },
  ],
  Saturday: [
    { id: 'sat-opener', name: 'Opener', startTime: '6:45 AM', endTime: '3:00 PM', minStaff: 2 },
    { id: 'sat-closer', name: 'Closer', startTime: '9:00 AM', endTime: 'Close', minStaff: 2 },
  ],
  Sunday: [
    { id: 'sun-early', name: 'Early', startTime: '7:15 AM', endTime: 'Close', minStaff: 2 },
    { id: 'sun-late', name: 'Late', startTime: '10:00 AM', endTime: 'Close', minStaff: 1 },
  ],
};
