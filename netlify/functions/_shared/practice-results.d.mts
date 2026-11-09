export function createPracticeSubmitHandler(save: (record: any) => Promise<boolean>): (request: Request) => Promise<Response>;
export function validateResult(input: unknown): Record<string, unknown>;
