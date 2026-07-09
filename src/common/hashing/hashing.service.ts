import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

@Injectable()
export class HashingService implements OnModuleInit {
  private dummyHash!: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-password-for-timing-equalization');
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain, ARGON2_OPTIONS);
  }

  /** Dipanggil saat user tidak ditemukan / tanpa password, agar durasi login seragam. */
  async verifyDummy(plain: string): Promise<void> {
    await this.verify(this.dummyHash, plain).catch(() => false);
  }
}
