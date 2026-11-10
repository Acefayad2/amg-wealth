export interface LicensingStep { id: string; label: string; tasks: string[]; official?: boolean; help: string; }
export interface LicensingPerson { tasks?: Record<string, { done?: boolean }>; exam_status?: string; exam_date?: string | null; }
export const licensingSteps: LicensingStep[];
export function taskDone(person: LicensingPerson, key: string): boolean;
export function stepDone(person: LicensingPerson, step: LicensingStep): boolean;
export function licensingProgress(person: LicensingPerson): { completed: number; percent: number; current: number; label: string };
export function stepUpdates(selected: string[], source: string): Record<string, { done: boolean; source: string; updatedAt: string }>;

export function selectedStepsForStage(stage: number): string[];
