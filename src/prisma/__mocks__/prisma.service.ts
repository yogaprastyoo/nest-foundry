import { mockDeep } from 'jest-mock-extended';
import type { PrismaService as RealPrismaService } from '../prisma.service';

// mockDeep<PrismaService> derives the mock shape from the real class type, so
// a new model/method added to PrismaService is automatically covered — a
// missing mock now fails type check instead of failing silently at runtime.
export const PrismaService = jest.fn(() => mockDeep<RealPrismaService>());
