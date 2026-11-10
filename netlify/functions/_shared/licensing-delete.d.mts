import type pg from 'pg';
export function deleteLicensingPerson(pool: pg.Pool, store: any, id: string, version: number, baseIdForEmail: (email: string) => Promise<string>): Promise<{ id: string } | null>;
