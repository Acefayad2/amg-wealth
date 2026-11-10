export function learningIdentity<T extends { id: string; email: string }>(store: any, user: T): Promise<T & { accountId: string; resetGeneration: boolean; deletionPending?: boolean }>;
export function purgeLearningNamespace(store: any, id: string): Promise<void>;
export function eraseLearningHistory(store: any, person: { email: string; baseUserId: string; deletionId: string }): Promise<void>;
export function withLearningIdentity(store: any, user: { id: string; email: string; [key: string]: unknown }, run: (user: any) => Promise<Response>): Promise<Response>;
