import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ValidationMessage as V } from '../../../common/validation/validation-message';

export class GoogleExchangeDto {
  @ApiProperty({
    description: 'One-time Google OAuth exchange code',
    example: 'xQwE4gW9L9dR3mJ7V2kA',
  })
  @IsNotEmpty({ message: V.required('Code') })
  @IsString({ message: V.string('Code') })
  @MaxLength(256, { message: V.max('Code', 256) })
  code!: string;
}
