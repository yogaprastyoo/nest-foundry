export class PrismaService {
  user = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  verificationToken = {
    create: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
  };
  $transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(this));
}
