'use client';
import React, { useState, useEffect } from 'react';
import { useEmployees, useSchedules, useSlackWebhook, useShiftTemplate, useShiftPreferences } from '@/lib/store';
import { generateDraftSchedule } from '@/lib/scheduler';
import { formatScheduleForSlack, sendToSlack } from '@/lib/slack';
import { ShiftTemplate, ShiftType, DAYS_OF_WEEK, WeekSchedule, DayOfWeek } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateRange(weekStartDate: string): string {
  const start = new Date(weekStartDate + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
}

const DAY_COLORS: Record<string, string> = {
  Monday: 'bg-purple-500',
  Tuesday: 'bg-teal-500',
  Wednesday: 'bg-orange-500',
  Thursday: 'bg-blue-500',
  Friday: 'bg-pink-500',
  Saturday: 'bg-indigo-500',
  Sunday: 'bg-emerald-500',
};

const DAY_TEXT_COLORS: Record<string, string> = {
  Monday: 'text-purple-600',
  Tuesday: 'text-teal-600',
  Wednesday: 'text-orange-600',
  Thursday: 'text-blue-600',
  Friday: 'text-pink-600',
  Saturday: 'text-indigo-600',
  Sunday: 'text-emerald-600',
};

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'schedule' | 'team' | 'history' | 'settings';

export default function Page() {
  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('schedule');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [currentScheduleId, setCurrentScheduleId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [webhookInput, setWebhookInput] = useState('');
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

  const { employees, addEmployee, removeEmployee, loaded: empLoaded } = useEmployees();
  const { schedules, createSchedule, updateSchedule, markSent, loaded: schedLoaded } = useSchedules();
  const { webhook, saveWebhook, loaded: hookLoaded } = useSlackWebhook();
  const { template, updateShift, addShift, removeShift, resetToDefaults, loaded: templateLoaded } = useShiftTemplate();
  const { preferences, setPreference, getPreferencesForEmployee, getPreferencesForDayShift, clearPreferencesForEmployee, loaded: prefsLoaded } = useShiftPreferences();

  useEffect(() => {
    if (empLoaded && schedLoaded && hookLoaded && templateLoaded && prefsLoaded) {
      setHydrated(true);
      setWebhookInput(webhook ?? '');
    }
  }, [empLoaded, schedLoaded, hookLoaded, templateLoaded, prefsLoaded, webhook]);

  const activeSchedule: WeekSchedule | null =
    (currentScheduleId ? schedules.find(s => s.id === currentScheduleId) : null) ??
    schedules.find(s => s.status === 'draft') ??
    null;

  const sentSchedules = [...schedules]
    .filter(s => s.status === 'sent')
    .sort((a, b) => new Date(b.sentAt ?? 0).getTime() - new Date(a.sentAt ?? 0).getTime());

  const unavailableIds = activeSchedule?.unavailableEmployeeIds ?? [];
  const availableEmployees = employees.filter(e => !unavailableIds.includes(e.id));

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50" role="status" aria-label="Loading application">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span className="text-gray-400 text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleNewWeek() {
    const schedule = createSchedule(template);
    setCurrentScheduleId(schedule.id);
    setSendResult(null);
  }

  function toggleUnavailable(employeeId: string) {
    if (!activeSchedule) return;
    const current = activeSchedule.unavailableEmployeeIds;
    const updated = current.includes(employeeId)
      ? current.filter(id => id !== employeeId)
      : [...current, employeeId];
    updateSchedule({ ...activeSchedule, unavailableEmployeeIds: updated });
  }

  function handleAutoFill() {
    if (!activeSchedule) return;
    const filled = generateDraftSchedule(activeSchedule, employees, template, preferences);
    updateSchedule(filled);
  }

  function handleAssignEmployee(dayIndex: number, shiftName: string, slotIndex: number, employeeId: string) {
    if (!activeSchedule) return;
    const newDays = activeSchedule.days.map((day, di) => {
      if (di !== dayIndex) return day;
      return {
        ...day,
        shifts: day.shifts.map(shift => {
          if (shift.shiftName !== shiftName) return shift;
          const ids = [...shift.employeeIds];
          ids[slotIndex] = employeeId;
          return { ...shift, employeeIds: ids };
        }),
      };
    });
    updateSchedule({ ...activeSchedule, days: newDays });
  }

  function handleAddSlot(dayIndex: number, shiftName: string) {
    if (!activeSchedule) return;
    const newDays = activeSchedule.days.map((day, di) => {
      if (di !== dayIndex) return day;
      return {
        ...day,
        shifts: day.shifts.map(shift => {
          if (shift.shiftName !== shiftName) return shift;
          return { ...shift, employeeIds: [...shift.employeeIds, ''] };
        }),
      };
    });
    updateSchedule({ ...activeSchedule, days: newDays });
  }

  async function handleSendToSlack() {
    if (!activeSchedule || !webhook) return;
    setSending(true);
    setConfirmSend(false);
    setSendResult(null);
    try {
      const message = formatScheduleForSlack(activeSchedule, employees, template);
      const result = await sendToSlack(webhook, message);
      if (result.ok) {
        markSent(activeSchedule.id);
        setCurrentScheduleId(null);
        setSendResult({ ok: true, message: 'Schedule sent to Slack!' });
      } else {
        setSendResult({ ok: false, message: result.error ?? 'Failed to send.' });
      }
    } catch {
      setSendResult({ ok: false, message: 'Network error. Please try again.' });
    }
    setSending(false);
  }

  function handleAddEmployee() {
    const name = newEmployeeName.trim();
    if (!name) return;
    addEmployee(name);
    setNewEmployeeName('');
  }

  function handleSaveWebhook() {
    saveWebhook(webhookInput.trim());
    setWebhookSaved(true);
    setTimeout(() => setWebhookSaved(false), 2000);
  }

  function handleResetToDefaults() {
    resetToDefaults();
    setResetConfirm(false);
  }

  // ─── Tab content renderers ────────────────────────────────────────────────

  function renderScheduleTab() {
    if (!activeSchedule) {
      return (
        <div className="flex flex-col items-center gap-6 py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-3xl">📅</div>
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-1">No Schedule Yet</h2>
            <p className="text-gray-400 text-sm">Create a schedule for next week</p>
          </div>
          <button
            onClick={handleNewWeek}
            className="w-full max-w-xs h-12 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-xl font-semibold shadow-sm transition-colors"
            aria-label="Create a new weekly schedule"
          >
            + New Week
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Week header */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Week of</p>
              <h2 className="text-lg font-bold text-gray-900">{formatDateRange(activeSchedule.weekStartDate)}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${activeSchedule.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {activeSchedule.status === 'sent' ? 'Sent' : 'Draft'}
              </span>
              {activeSchedule.status === 'draft' && (
                <button onClick={handleNewWeek} className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200">
                  + New
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Unavailable + Auto-fill */}
        {activeSchedule.status === 'draft' && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-2">Mark Unavailable This Week</h3>
            {employees.length === 0 ? (
              <p className="text-sm text-gray-400">
                No team members yet — add them in the{' '}
                <button onClick={() => setActiveTab('team')} className="text-blue-500 underline">
                  Team
                </button>{' '}
                tab.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {employees.map(emp => (
                  <label key={emp.id} className="flex items-center gap-2 min-h-[40px] px-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={unavailableIds.includes(emp.id)}
                      onChange={() => toggleUnavailable(emp.id)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                    />
                    <span className={`text-sm truncate ${unavailableIds.includes(emp.id) ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                      {emp.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <button
              onClick={handleAutoFill}
              className="mt-3 w-full h-11 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-xl font-semibold text-sm shadow-sm transition-colors"
              aria-label="Auto-fill schedule using employee preferences and round-robin"
            >
              ✨ Auto-Fill Schedule
            </button>
          </div>
        )}

        {/* Day-by-day schedule grid */}
        {DAYS_OF_WEEK.map((day, dayIndex) => {
          const daySchedule = activeSchedule.days[dayIndex];
          const shiftTypes = template[day] ?? [];
          if (!daySchedule) return null;

          return (
            <div key={day} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Day header bar */}
              <div className={`${DAY_COLORS[day]} px-4 py-2.5`}>
                <h3 className="font-bold text-white text-sm uppercase tracking-wide">{day}</h3>
              </div>

              {/* Shifts as rows */}
              <div className="divide-y divide-gray-100">
                {shiftTypes.map(shiftType => {
                  const shift = daySchedule.shifts.find(s => s.shiftName === shiftType.name);
                  const ids = shift?.employeeIds ?? [];
                  const slotCount = Math.max(ids.length, shiftType.minStaff);
                  const filledCount = ids.filter(id => id && id !== '').length;
                  const underStaffed = filledCount < shiftType.minStaff;

                  return (
                    <div key={shiftType.id ?? shiftType.name} className="px-4 py-3">
                      {/* Shift label row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-sm ${DAY_TEXT_COLORS[day]}`}>{shiftType.name}</span>
                          <span className="text-xs text-gray-400">
                            {shiftType.startTime} – {shiftType.endTime}
                          </span>
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${underStaffed ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                          {filledCount}/{shiftType.minStaff}
                        </span>
                      </div>

                      {/* Employee slots */}
                      <div className="space-y-1.5">
                        {Array.from({ length: slotCount }).map((_, slotIndex) => (
                          <select
                            key={slotIndex}
                            value={ids[slotIndex] ?? ''}
                            onChange={e => handleAssignEmployee(dayIndex, shiftType.name, slotIndex, e.target.value)}
                            disabled={activeSchedule.status === 'sent'}
                            aria-label={`${day} ${shiftType.name} shift, slot ${slotIndex + 1}`}
                            className={`w-full h-10 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                              ids[slotIndex]
                                ? 'bg-white border-gray-200 text-gray-800'
                                : 'bg-gray-50 border-dashed border-gray-300 text-gray-400'
                            } disabled:opacity-50`}
                          >
                            <option value="">— Select employee —</option>
                            {availableEmployees.map(emp => {
                              const hasPref = getPreferencesForDayShift(day, shiftType.name).some(p => p.employeeId === emp.id);
                              return (
                                <option key={emp.id} value={emp.id}>
                                  {hasPref ? '⭐ ' : ''}{emp.name}
                                </option>
                              );
                            })}
                          </select>
                        ))}
                      </div>

                      {activeSchedule.status === 'draft' && (
                        <button
                          onClick={() => handleAddSlot(dayIndex, shiftType.name)}
                          className="mt-1.5 w-full h-8 text-xs text-blue-500 hover:text-blue-600 font-medium"
                        >
                          + Add person
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Send to Slack */}
        {activeSchedule.status === 'draft' && (
          <div className="pt-1 pb-4">
            {sendResult && (
              <div className={`mb-3 px-4 py-3 rounded-xl text-sm font-medium ${sendResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {sendResult.message}
              </div>
            )}
            {webhook ? (
              <button
                onClick={() => setConfirmSend(true)}
                disabled={sending}
                className="w-full h-12 bg-green-500 hover:bg-green-600 active:bg-green-700 disabled:opacity-50 text-white rounded-xl font-semibold shadow-sm transition-colors"
              >
                {sending ? 'Sending…' : '📨 Send to Slack'}
              </button>
            ) : (
              <p className="text-center text-sm text-gray-400 py-2">
                Add a Slack webhook in{' '}
                <button onClick={() => setActiveTab('settings')} className="text-blue-500 underline">
                  Settings
                </button>{' '}
                to send schedules.
              </p>
            )}
          </div>
        )}

        {/* Confirm send modal */}
        {confirmSend && activeSchedule && (
          <div
            className="fixed inset-0 bg-black/40 flex items-end sm:items-center z-50 p-4"
            onClick={() => setConfirmSend(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-send-title"
          >
            <div
              className="bg-white rounded-2xl w-full max-w-sm mx-auto p-6"
              onClick={e => e.stopPropagation()}
            >
              <h3 id="confirm-send-title" className="text-lg font-bold text-gray-800 mb-1">Send to Slack?</h3>
              <p className="text-sm text-gray-500 mb-5">
                Post schedule for{' '}
                <span className="font-semibold text-gray-700">{formatDateRange(activeSchedule.weekStartDate)}</span>{' '}
                to your channel.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmSend(false)}
                  className="flex-1 h-11 rounded-xl bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendToSlack}
                  className="flex-1 h-11 rounded-xl bg-green-500 text-white font-semibold hover:bg-green-600"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderTeamTab() {
    return (
      <div className="space-y-4">
        {/* Add employee */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Add Team Member</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newEmployeeName}
              onChange={e => setNewEmployeeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddEmployee()}
              placeholder="Employee name"
              aria-label="New employee name"
              autoComplete="off"
              className="flex-1 h-11 rounded-xl border border-gray-200 px-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleAddEmployee}
              disabled={!newEmployeeName.trim()}
              className="h-11 px-5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:opacity-40 text-white rounded-xl font-semibold text-sm transition-colors"
            >
              Add
            </button>
          </div>
        </div>

        {/* Employee list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {employees.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-2xl mb-3">👥</div>
              <p className="text-sm text-gray-400">No team members yet</p>
            </div>
          ) : (
            <ul>
              {employees.map((emp, i) => (
                <li
                  key={emp.id}
                  className={`flex items-center justify-between px-4 min-h-[52px] ${i > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600">
                      {emp.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-gray-800">{emp.name}</span>
                  </div>
                  <button
                    onClick={() => {
                      if (removeConfirm === emp.id) {
                        removeEmployee(emp.id);
                        setRemoveConfirm(null);
                      } else {
                        setRemoveConfirm(emp.id);
                        setTimeout(
                          () => setRemoveConfirm(prev => (prev === emp.id ? null : prev)),
                          3000,
                        );
                      }
                    }}
                    className={`h-8 px-3 rounded-lg text-xs font-semibold transition-all ${
                      removeConfirm === emp.id
                        ? 'bg-red-500 text-white'
                        : 'bg-red-50 text-red-500 hover:bg-red-100'
                    }`}
                  >
                    {removeConfirm === emp.id ? 'Confirm' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-gray-400 text-center">
          {employees.length} team member{employees.length !== 1 ? 's' : ''}
        </p>

        {/* ── Shift Preferences Section ──────────────────────────────── */}
        {employees.length > 0 && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3 mt-2">Set Schedules / Preferences</h2>
            <p className="text-xs text-gray-400 mb-3">
              Tap a person to set their recurring shifts. Auto-fill will slot them in first.
            </p>
            <div className="space-y-2">
              {employees.map(emp => {
                const isExpanded = expandedEmployee === emp.id;
                const empPrefs = getPreferencesForEmployee(emp.id);
                return (
                  <div key={emp.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedEmployee(isExpanded ? null : emp.id)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-800">{emp.name}</span>
                          {empPrefs.length > 0 && (
                            <p className="text-xs text-gray-400">
                              {empPrefs.length} set shift{empPrefs.length !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100 px-3 py-3 bg-gray-50 space-y-3">
                        {DAYS_OF_WEEK.map(day => {
                          const dayShifts = template[day] ?? [];
                          return (
                            <div key={day}>
                              <p className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${DAY_TEXT_COLORS[day]}`}>
                                {day}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {dayShifts.map(st => {
                                  const isSet = empPrefs.some(p => p.day === day && p.shiftName === st.name);
                                  return (
                                    <button
                                      key={st.id ?? st.name}
                                      onClick={() => setPreference(emp.id, day, st.name)}
                                      className={`h-9 px-3 rounded-lg text-xs font-semibold transition-all border ${
                                        isSet
                                          ? `${DAY_COLORS[day]} text-white border-transparent shadow-sm`
                                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                                      }`}
                                    >
                                      {isSet ? '⭐ ' : ''}{st.name}
                                      <span className="text-[10px] font-normal opacity-75 ml-1">
                                        {st.startTime}–{st.endTime}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {empPrefs.length > 0 && (
                          <button
                            onClick={() => clearPreferencesForEmployee(emp.id)}
                            className="w-full h-9 rounded-lg text-xs text-red-500 hover:bg-red-50 font-medium transition-colors border border-red-200"
                          >
                            Clear All Preferences
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderHistoryTab() {
    if (sentSchedules.length === 0) {
      return (
        <div className="flex flex-col items-center gap-4 py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-3xl">📋</div>
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-1">No History Yet</h2>
            <p className="text-gray-400 text-sm">Sent schedules appear here</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {sentSchedules.map(schedule => {
          const isExpanded = expandedHistory === schedule.id;
          return (
            <div key={schedule.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setExpandedHistory(isExpanded ? null : schedule.id)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
              >
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{formatDateRange(schedule.weekStartDate)}</p>
                  {schedule.sentAt && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Sent{' '}
                      {new Date(schedule.sentAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
                  {schedule.days.map(ds => {
                    const shiftTypes = template[ds.day] ?? [];
                    return (
                      <div key={ds.day}>
                        <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${DAY_TEXT_COLORS[ds.day]}`}>
                          {ds.day}
                        </p>
                        {ds.shifts.map((shift, si) => {
                          const st = shiftTypes.find(s => s.name === shift.shiftName);
                          const names = shift.employeeIds
                            .filter(id => id)
                            .map(id => employees.find(e => e.id === id)?.name ?? '?');
                          return (
                            <div key={si} className="flex gap-2 text-sm ml-2 py-0.5">
                              <span className="text-gray-500 w-16 shrink-0">{shift.shiftName}</span>
                              <span className="text-gray-400 w-24 shrink-0 text-xs leading-5">
                                {st ? `${st.startTime}–${st.endTime}` : ''}
                              </span>
                              <span className="text-gray-800">
                                {names.length > 0 ? (
                                  names.join(', ')
                                ) : (
                                  <span className="text-gray-300 italic">unfilled</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderSettingsTab() {
    return (
      <div className="space-y-6">
        {/* ── Section 1: Shift Template Editor ─────────────────────────── */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3">Shift Template</h2>

          <div className="space-y-3">
            {DAYS_OF_WEEK.map(day => {
              const shiftTypes = template[day] ?? [];
              return (
                <div key={day} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Day header */}
                  <div className={`${DAY_COLORS[day]} px-4 py-2.5`}>
                    <h3 className="font-bold text-white text-sm uppercase tracking-wide">{day}</h3>
                  </div>

                  {/* Shift rows */}
                  <div className="divide-y divide-gray-100">
                    {shiftTypes.map(shiftType => {
                      const shiftId = shiftType.id ?? shiftType.name;
                      const isOnly = shiftTypes.length <= 1;

                      return (
                        <div key={shiftId} className="px-3 py-3 space-y-2">
                          {/* Row 1: Name input + trash button */}
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={shiftType.name}
                              onChange={e => updateShift(day, shiftId, { name: e.target.value })}
                              placeholder="Shift name"
                              aria-label={`${day} shift name`}
                              className="flex-1 h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <button
                              onClick={() => !isOnly && removeShift(day, shiftId)}
                              disabled={isOnly}
                              title={isOnly ? 'At least one shift required' : 'Remove shift'}
                              aria-label={`Remove ${shiftType.name} shift from ${day}`}
                              className={`h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lg transition-colors ${
                                isOnly
                                  ? 'text-gray-200 cursor-not-allowed'
                                  : 'text-gray-300 hover:text-red-500 hover:bg-red-50'
                              }`}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>

                          {/* Row 2: Start time + End time + Min staff stepper */}
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={shiftType.startTime}
                              onChange={e => updateShift(day, shiftId, { startTime: e.target.value })}
                              placeholder="Start"
                              aria-label={`${day} ${shiftType.name} start time`}
                              className="flex-1 h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <input
                              type="text"
                              value={shiftType.endTime}
                              onChange={e => updateShift(day, shiftId, { endTime: e.target.value })}
                              placeholder="End"
                              aria-label={`${day} ${shiftType.name} end time`}
                              className="flex-1 h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            {/* Min staff stepper: [–] N [+] */}
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={() =>
                                  updateShift(day, shiftId, { minStaff: Math.max(1, shiftType.minStaff - 1) })
                                }
                                aria-label={`Decrease ${day} ${shiftType.name} minimum staff`}
                                className="h-9 w-8 flex items-center justify-center rounded-l-lg border border-gray-200 text-gray-500 hover:bg-gray-100 font-bold text-base leading-none"
                              >
                                −
                              </button>
                              <div className="h-9 w-8 flex items-center justify-center border-t border-b border-gray-200 text-sm font-semibold text-gray-800 bg-white" aria-label={`Minimum staff: ${shiftType.minStaff}`}>
                                {shiftType.minStaff}
                              </div>
                              <button
                                onClick={() =>
                                  updateShift(day, shiftId, { minStaff: shiftType.minStaff + 1 })
                                }
                                aria-label={`Increase ${day} ${shiftType.name} minimum staff`}
                                className="h-9 w-8 flex items-center justify-center rounded-r-lg border border-gray-200 text-gray-500 hover:bg-gray-100 font-bold text-base leading-none"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add shift button */}
                  <div className="px-3 py-2 border-t border-gray-100">
                    <button
                      onClick={() => addShift(day)}
                      className="w-full h-9 rounded-lg text-sm text-blue-500 hover:text-blue-600 hover:bg-blue-50 font-medium transition-colors"
                    >
                      + Add Shift
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reset to Defaults */}
          <div className="mt-4">
            {resetConfirm ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm text-red-700 font-medium mb-3">
                  Reset all shifts to default values? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setResetConfirm(false)}
                    className="flex-1 h-10 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleResetToDefaults}
                    className="flex-1 h-10 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setResetConfirm(true)}
                className="w-full h-10 rounded-xl border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200 hover:bg-red-50 text-sm font-medium transition-colors"
              >
                Reset to Defaults
              </button>
            )}
          </div>
        </div>

        {/* ── Section 2: Slack Webhook ──────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3">Slack Webhook</h2>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-1">Webhook URL</h3>
            <p className="text-xs text-gray-400 mb-3">Paste your Incoming Webhook URL from Slack.</p>
            <input
              type="url"
              value={webhookInput}
              onChange={e => setWebhookInput(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              aria-label="Slack webhook URL"
              className="w-full h-11 rounded-xl border border-gray-200 px-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 mb-3"
            />
            <button
              onClick={handleSaveWebhook}
              className={`w-full h-11 rounded-xl font-semibold text-sm transition-all ${
                webhookSaved ? 'bg-green-500 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {webhookSaved ? '✓ Saved!' : 'Save'}
            </button>
            {webhook && <p className="mt-2 text-xs text-green-600 truncate">✓ Webhook configured</p>}
          </div>
        </div>
      </div>
    );
  }

  // ─── Tab config ───────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'schedule', label: 'Schedule', icon: '📅' },
    { key: 'team', label: 'Team', icon: '👥' },
    { key: 'history', label: 'History', icon: '📋' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Skip to content link for keyboard users */}
      <a href="#main-content" className="skip-link">Skip to content</a>

      <div className="max-w-md mx-auto flex flex-col min-h-screen">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-4" role="banner">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">WEEKLY EMPLOYEE SCHEDULE</h1>
        </header>

        {/* Content */}
        <main id="main-content" className="flex-1 px-4 py-4 pb-24" role="main" aria-label={`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} tab content`}>
          {activeTab === 'schedule' && renderScheduleTab()}
          {activeTab === 'team' && renderTeamTab()}
          {activeTab === 'history' && renderHistoryTab()}
          {activeTab === 'settings' && renderSettingsTab()}
        </main>
      </div>

      {/* Live region for announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" id="live-announcements">
        {sendResult?.message}
      </div>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} role="tablist" aria-label="Main navigation">
        <div className="flex max-w-md mx-auto">
          {tabs.map(({ key, label, icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${key}`}
                id={`tab-${key}`}
                onClick={() => setActiveTab(key)}
                className={`relative flex-1 flex flex-col items-center justify-center min-h-[56px] py-2 transition-colors ${
                  active ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                <span className="text-lg leading-none" aria-hidden="true">{icon}</span>
                <span className={`text-[10px] font-semibold mt-1 ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                  {label}
                </span>
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-10 bg-blue-500 rounded-b-full" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
