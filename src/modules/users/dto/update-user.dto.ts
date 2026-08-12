import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ValidationMessage } from '../../../common/validation/validation-message';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString({ message: ValidationMessage.string('Name') })
  @MinLength(2, { message: ValidationMessage.min('Name', 2) })
  @MaxLength(100, { message: ValidationMessage.max('Name', 100) })
  name?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.png',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: ValidationMessage.string('Avatar URL') })
  @IsUrl({}, { message: ValidationMessage.url('Avatar URL') })
  avatarUrl?: string | null;
}
