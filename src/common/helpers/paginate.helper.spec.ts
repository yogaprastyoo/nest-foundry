import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { paginate } from './paginate.helper';

function makeQuery(raw: Record<string, unknown>): PaginationQueryDto {
  return plainToInstance(PaginationQueryDto, raw);
}

describe('PaginationQueryDto', () => {
  it('default page=1 per_page=20, skip=0', () => {
    const q = makeQuery({});
    expect(q.page).toBe(1);
    expect(q.per_page).toBe(20);
    expect(q.skip).toBe(0);
  });

  it('coerces string query params and computes skip', () => {
    const q = makeQuery({ page: '3', per_page: '10' });
    expect(q.skip).toBe(20);
    expect(validateSync(q)).toHaveLength(0);
  });

  it('rejects per_page above 100', () => {
    expect(validateSync(makeQuery({ per_page: '500' }))).not.toHaveLength(0);
  });
});

describe('paginate', () => {
  it('produces the standard pagination format', () => {
    const q = makeQuery({ page: '2', per_page: '10' });
    expect(paginate(['a', 'b'], 25, q)).toEqual({
      items: ['a', 'b'],
      pagination: { page: 2, per_page: 10, total: 25, total_pages: 3 },
    });
  });
});
