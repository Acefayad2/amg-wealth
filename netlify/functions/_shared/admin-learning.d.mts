export type LearnerSnapshot = {
  learnerId: string;
  name: string;
  email: string;
  lastActiveAt: string;
  completedLessons: number;
  totalLessons: number;
  courseProgressPercent: number;
  currentLesson: string | null;
  attempts: unknown[];
  firstSeenAt?: string;
};

export function buildAdminLearningSnapshot(user: { id: string; name?: string; email: string }, records: Record<string, unknown>, observedAt?: number): LearnerSnapshot;
export function persistAdminLearningSnapshot(store: any, user: { id: string; name?: string; email: string }, records: Record<string, unknown>, observedAt?: number): Promise<LearnerSnapshot>;
export function createAdminLearningHandler(deps: {
  authenticate: (request: Request) => Promise<{ id: string }>;
  isAdmin: (id: string) => Promise<boolean>;
  list: (page: number, pageSize: number) => Promise<{ learners: unknown[]; total: number }>;
}): (request: Request) => Promise<Response>;
