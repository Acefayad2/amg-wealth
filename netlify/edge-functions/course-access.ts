import { getCourseUser } from '../shared/course-user.ts';

export default async function courseAccess(request: Request, context: { next: () => Promise<Response> }) {
  const url = new URL(request.url);
  const publicResource = url.pathname.startsWith('/course/assets/') || /^\/course\/shared\/(?:app\.css|account\.css|account\.js|login\.js)$/.test(url.pathname);
  if (publicResource) return context.next();
  const user = await getCourseUser(request);
  if (user?.accessGranted !== true) {
    const login = new URL('/login/', url.origin);
    login.searchParams.set('next', url.pathname + url.search);
    return new Response(null, { status: 302, headers: { Location: login.href, 'Cache-Control': 'private, no-store' } });
  }
  const response = await context.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { path: ['/course', '/course/*'], onError: 'fail' };
