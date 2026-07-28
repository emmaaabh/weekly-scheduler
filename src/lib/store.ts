'use client';

import { useState, useEffect, useCallback } from 'react';
import { Employee, WeekSchedule, DAYS_OF_WEEK, DEFAULT_SHIFT_TEMPLATE, ShiftTemplate, ShiftType, ShiftPreference } from './types';

const EMPLOYEES_KEY = 'ws_employees';
const SCHEDULES_KEY = 'ws_schedules';
const SLACK_WEBHOOK_KEY = 'ws_slack_webhook';
const SHIFT_TEMPLATE_KEY = 'ws_shift_template';
const SHIFT_PREFS_KEY = 'ws_shift_preferences';

function loadFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setEmployees(loadFromStorage<Employee[]>(EMPLOYEES_KEY, []));
    setLoaded(true);
  }, []);

  const save = useCallback((emps: Employee[]) => {
    setEmployees(emps);
    saveToStorage(EMPLOYEES_KEY, emps);
  }, []);

  const addEmployee = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newEmp: Employee = { id: crypto.randomUUID(), name: trimmed };
    save([...employees, newEmp]);
  }, [employees, save]);

  const removeEmployee = useCallback((id: string) => {
    save(employees.filter(e => e.id !== id));
  }, [employees, save]);

  return { employees, addEmployee, removeEmployee, loaded };
}

export function useShiftTemplate() {
  const [template, setTemplate] = useState<ShiftTemplate>(DEFAULT_SHIFT_TEMPLATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTemplate(loadFromStorage<ShiftTemplate>(SHIFT_TEMPLATE_KEY, DEFAULT_SHIFT_TEMPLATE));
    setLoaded(true);
  }, []);

  const save = useCallback((t: ShiftTemplate) => {
    setTemplate(t);
    saveToStorage(SHIFT_TEMPLATE_KEY, t);
  }, []);

  const updateShift = useCallback((day: string, shiftId: string, updates: Partial<ShiftType>) => {
    const dayShifts = template[day] ?? [];
    const updated = dayShifts.map(s => s.id === shiftId ? { ...s, ...updates } : s);
    save({ ...template, [day]: updated });
  }, [template, save]);

  const addShift = useCallback((day: string) => {
    const dayShifts = template[day] ?? [];
    const newShift: ShiftType = {
      id: crypto.randomUUID(),
      name: 'New Shift',
      startTime: '9:00 AM',
      endTime: 'Close',
      minStaff: 1,
    };
    save({ ...template, [day]: [...dayShifts, newShift] });
  }, [template, save]);

  const removeShift = useCallback((day: string, shiftId: string) => {
    const dayShifts = template[day] ?? [];
    if (dayShifts.length <= 1) return; // keep at least one shift per day
    save({ ...template, [day]: dayShifts.filter(s => s.id !== shiftId) });
  }, [template, save]);

  const resetToDefaults = useCallback(() => {
    save(DEFAULT_SHIFT_TEMPLATE);
  }, [save]);

  return { template, updateShift, addShift, removeShift, resetToDefaults, loaded };
}

export function useSchedules() {
  const [schedules, setSchedules] = useState<WeekSchedule[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSchedules(loadFromStorage<WeekSchedule[]>(SCHEDULES_KEY, []));
    setLoaded(true);
  }, []);

  const save = useCallback((scheds: WeekSchedule[]) => {
    setSchedules(scheds);
    saveToStorage(SCHEDULES_KEY, scheds);
  }, []);

  const getNextMonday = (): string => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 1 : 8 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    return monday.toISOString().split('T')[0];
  };

  const createSchedule = useCallback((shiftTemplate: ShiftTemplate, weekStartDate?: string): WeekSchedule => {
    const startDate = weekStartDate || getNextMonday();
    const newSchedule: WeekSchedule = {
      id: crypto.randomUUID(),
      weekStartDate: startDate,
      days: DAYS_OF_WEEK.map(day => ({
        day,
        shifts: (shiftTemplate[day] || []).map(st => ({
          shiftName: st.name,
          employeeIds: [],
        })),
      })),
      unavailableEmployeeIds: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    save([newSchedule, ...schedules]);
    return newSchedule;
  }, [schedules, save]);

  const updateSchedule = useCallback((updated: WeekSchedule) => {
    save(schedules.map(s => s.id === updated.id ? updated : s));
  }, [schedules, save]);

  const markSent = useCallback((id: string) => {
    save(schedules.map(s => s.id === id ? { ...s, status: 'sent' as const, sentAt: new Date().toISOString() } : s));
  }, [schedules, save]);

  return { schedules, createSchedule, updateSchedule, markSent, loaded };
}

export function useSlackWebhook() {
  const [webhook, setWebhook] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setWebhook(loadFromStorage<string>(SLACK_WEBHOOK_KEY, ''));
    setLoaded(true);
  }, []);

  const saveWebhook = useCallback((url: string) => {
    setWebhook(url);
    saveToStorage(SLACK_WEBHOOK_KEY, url);
  }, []);

  return { webhook, saveWebhook, loaded };
}

export function useShiftPreferences() {
  const [preferences, setPreferences] = useState<ShiftPreference[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPreferences(loadFromStorage<ShiftPreference[]>(SHIFT_PREFS_KEY, []));
    setLoaded(true);
  }, []);

  const save = useCallback((prefs: ShiftPreference[]) => {
    setPreferences(prefs);
    saveToStorage(SHIFT_PREFS_KEY, prefs);
  }, []);

  const setPreference = useCallback((employeeId: string, day: string, shiftName: string) => {
    // Toggle: if this exact pref exists, remove it; otherwise add it
    const exists = preferences.find(
      p => p.employeeId === employeeId && p.day === day && p.shiftName === shiftName
    );
    if (exists) {
      save(preferences.filter(p => p !== exists));
    } else {
      save([...preferences, { employeeId, day: day as ShiftPreference['day'], shiftName }]);
    }
  }, [preferences, save]);

  const getPreferencesForEmployee = useCallback((employeeId: string) => {
    return preferences.filter(p => p.employeeId === employeeId);
  }, [preferences]);

  const getPreferencesForDayShift = useCallback((day: string, shiftName: string) => {
    return preferences.filter(p => p.day === day && p.shiftName === shiftName);
  }, [preferences]);

  const clearPreferencesForEmployee = useCallback((employeeId: string) => {
    save(preferences.filter(p => p.employeeId !== employeeId));
  }, [preferences, save]);

  return { preferences, setPreference, getPreferencesForEmployee, getPreferencesForDayShift, clearPreferencesForEmployee, loaded };
}
