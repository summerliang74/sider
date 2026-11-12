export function apiPathsForRoute(href, base = 'https://sider.invalid/') {
  const url = new URL(href, base);
  if (url.origin !== new URL(base).origin) return [];
  if (url.pathname === '/resources') {
    const query = new URLSearchParams();
    for (const key of ['q', 'type', 'tag']) if (url.searchParams.get(key)) query.set(key, url.searchParams.get(key));
    return ['/api/resources/tags', '/api/resources?' + query];
  }
  if (url.pathname === '/me/resources') return ['/api/me/resources?view=workspace'];
  if (url.pathname === '/admin/dashboard') {
    const range = url.searchParams.get('range') || '7d';
    return ['24h', '7d', '30d'].includes(range) ? ['/api/admin/dashboard?range=' + range] : [];
  }
  if (url.pathname === '/admin/reports') return ['/api/admin/reports?view=workspace'];
  if (url.pathname === '/admin/audit') return ['/api/admin/audit?view=workspace'];
  if (/^\/resources\/[^/]+$/.test(url.pathname) && url.pathname !== '/resources/new') {
    return ['/api/resources/' + encodeURIComponent(decodeURIComponent(url.pathname.slice('/resources/'.length)))];
  }
  return [];
}
