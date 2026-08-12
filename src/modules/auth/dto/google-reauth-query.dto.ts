import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { ValidationMessage as V } from '../../../common/validation/validation-message';
import { GOOGLE_REAUTH_PURPOSES } from '../password.constants';
import type { GoogleReauthPurpose } from '../password.constants';

export class GoogleReauthQueryDto {
  @ApiProperty({
    description: 'Reauthentication purpose',
    enum: GOOGLE_REAUTH_PURPOSES,
  })
  @IsNotEmpty({ message: V.required('Purpose') })
  @IsIn(GOOGLE_REAUTH_PURPOSES, { message: V.string('Purpose') })
  purpose!: GoogleReauthPurpose;
}
