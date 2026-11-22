export function pagination(query: { page?: string; pageSize?: string }) {
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 24));
  return {
    page: Math.floor(page),
    pageSize: Math.floor(pageSize),
    skip: (Math.floor(page) - 1) * Math.floor(pageSize),
    take: Math.floor(pageSize),
  };
}
