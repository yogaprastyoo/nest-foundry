import { PaginationQueryDto } from '../dto/pagination-query.dto';

export interface PaginatedData<T> {
  items: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export function paginate<T>(
  items: T[],
  total: number,
  query: PaginationQueryDto,
): PaginatedData<T> {
  return {
    items,
    pagination: {
      page: query.page,
      per_page: query.per_page,
      total,
      total_pages: Math.ceil(total / query.per_page),
    },
  };
}
