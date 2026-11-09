import { accessSecret, readAccessCookie, SESSION_COOKIE, verifyAccessToken, type CourseUser } from './access-session.ts';

export async function getCourseUser(request: Request): Promise<CourseUser | null> {
  try {
    const payload = await verifyAccessToken(readAccessCookie(request, SESSION_COOKIE), 'session', accessSecret());
    if (!payload || payload.purpose !== 'session') return null;
    // Shared-code access and a supplied tracking email are not email verification.
    return { id: payload.id, email: payload.email, name: payload.name, accessGranted: true };
  } catch { return null; }
}
