import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMemberBodyDto {
  @ApiProperty({
    description: 'Security code',
    maxLength: 20,
    example: 'abcd1234',
  })
  @IsString()
  @MaxLength(20)
  cert: string;

  @ApiProperty({
    description: 'Agent ID for identity check',
    maxLength: 20,
    example: 'agent007',
  })
  @IsString()
  @MaxLength(20)
  agentId: string;

  @ApiProperty({
    description: 'A unique user ID, only allow 0-9 a-z',
    maxLength: 21,
    example: 'testplayer',
  })
  @IsString()
  @MaxLength(21)
  userId: string;

  @ApiProperty({
    description: 'Player currency code',
    maxLength: 4,
    example: 'INR',
  })
  @IsString()
  @MaxLength(4)
  currency: string;

  @ApiProperty({
    description: 'Bet limit, Only for LIVE game types',
    maxLength: 2000,
    example: '1000',
  })
  @IsString()
  @MaxLength(2000)
  betLimit: string;

  @ApiProperty({
    description: 'Language',
    maxLength: 10,
    required: false,
    example: 'en',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @ApiProperty({
    description:
      'User name for player to show on the specific platforms frontend',
    maxLength: 20,
    required: false,
    example: 'playerOne',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  userName?: string;
}
