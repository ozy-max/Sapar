const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_PATTERN = /^\d+$/;

export function normalizeRoute(rawPath: string): string {
  const path = rawPath.split('?')[0] ?? rawPath;
  return (
    path
      .split('/')
      .map((segment) => {
        if (segment === '') return segment;
        if (UUID_PATTERN.test(segment)) return ':id';
        if (NUMERIC_ID_PATTERN.test(segment)) return ':id';
        return segment;
      })
      .join('/') || '/'
  );
}
