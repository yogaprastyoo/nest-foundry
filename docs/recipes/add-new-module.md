# Recipe: Adding a New Domain Module

This recipe provides step-by-step instructions for adding a new domain module to `loopwork-backend`, following the canonical `UsersModule` reference pattern (`src/modules/users/users.module.ts:1`).

## Status

**READY TO USE:** This recipe has been verified by creating, testing, and cleaning up a temporary `notes` module against `npm run lint && npx tsc --noEmit && npm run test`.

---

## Prasyarat

1. NestJS CLI or standard TypeScript file structure.
2. Understanding of core conventions in `docs/conventions.md:1`.
3. Database entity defined in `prisma/schema.prisma` if persistent storage is required.

---

## Langkah

### Step 1: Create Module Directory Structure

```
src/modules/notes/
├── dto/
│   ├── create-note.dto.ts
│   └── note-response.dto.ts
├── notes.controller.spec.ts
├── notes.controller.ts
├── notes.module.ts
├── notes.service.spec.ts
└── notes.service.ts
```

### Step 2: Implement DTOs with Validation & Response Mapping

Create `src/modules/notes/dto/create-note.dto.ts`:
```typescript
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}
```

Create `src/modules/notes/dto/note-response.dto.ts`:
```typescript
export class NoteResponseDto {
  id!: string;
  title!: string;
  createdAt!: Date;

  static fromEntity(entity: { id: string; title: string; createdAt: Date }): NoteResponseDto {
    return {
      id: entity.id,
      title: entity.title,
      createdAt: entity.createdAt,
    };
  }
}
```

### Step 3: Implement Service

Create `src/modules/notes/notes.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import type { CreateNoteDto } from './dto/create-note.dto';

@Injectable()
export class NotesService {
  private notes: Array<{ id: string; title: string; createdAt: Date }> = [];

  create(dto: CreateNoteDto) {
    const note = { id: `note-${Date.now()}`, title: dto.title, createdAt: new Date() };
    this.notes.push(note);
    return note;
  }

  findAll() {
    return this.notes;
  }
}
```

### Step 4: Implement Controller with Envelope Decorators

Create `src/modules/notes/notes.controller.ts`:
```typescript
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CreateNoteDto } from './dto/create-note.dto';
import { NoteResponseDto } from './dto/note-response.dto';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post()
  @ResponseMessage('Note created successfully.')
  create(@Body() dto: CreateNoteDto): NoteResponseDto {
    const note = this.notesService.create(dto);
    return NoteResponseDto.fromEntity(note);
  }

  @Get()
  @ResponseMessage('Notes retrieved successfully.')
  findAll(): NoteResponseDto[] {
    return this.notesService
      .findAll()
      .map((entity) => NoteResponseDto.fromEntity(entity));
  }
}
```

### Step 5: Implement Module Declaration

Create `src/modules/notes/notes.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
```

### Step 6: Register Module in `AppModule`

Add `NotesModule` to `imports` in `src/app.module.ts:68`:
```typescript
imports: [
  // ... existing modules
  UsersModule,
  NotesModule,
  AuthModule,
]
```

---

## Verifikasi

Run verification commands:

```bash
npm run lint && npx tsc --noEmit && npm run test
```
