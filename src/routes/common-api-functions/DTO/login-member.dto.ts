import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginMemberDto {
  @ApiProperty({
    description: 'Security code',
    maxLength: 20,
    example: 'abcd1234',
  })
  @IsString()
  @IsNotEmpty()
  cert: string;

  @ApiProperty({
    description: 'Agent ID',
    maxLength: 50,
    example: 'agent001',
  })
  @IsString()
  @IsNotEmpty()
  agentId: string;

  @ApiProperty({
    description: 'User ID',
    maxLength: 50,
    example: 'player123',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Is Mobile Login',
    example: false,
    required: false,
  })
  @IsOptional()
  isMobileLogin?: boolean;

  @ApiProperty({
    description: 'External URL',
    maxLength: 200,
    example: 'https://www.example.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  externalURL?: string;

  @ApiProperty({
    description: 'Platform',
    maxLength: 50,
    example: 'SPADE',
    required: false,
  })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiProperty({
    description: 'Game Type',
    maxLength: 50,
    example: 'LIVE',
    required: false,
  })
  @IsOptional()
  @IsString()
  gameType?: string;

  @ApiProperty({
    description: 'Game Forbidden JSON String',
    maxLength: 1000,
    example: '{"SPADE":{"LIVE":["ALL"]}}',
    required: false,
  })
  @IsOptional()
  @IsString()
  gameForbidden?: string;

  @ApiProperty({
    description: 'Language',
    maxLength: 10,
    example: 'en',
    required: false,
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({
    description: 'Bet Limit JSON String',
    maxLength: 2000,
    example:
      '{"SPADE":{"LIVE":{"limitId":[280301,280303,280307]}},"SV388":{"LIVE":{"maxbet":1000,"minbet":1,"mindraw":1,"matchlimit":1000,"maxdraw":100}}}',
    required: false,
  })
  @IsOptional()
  @IsString()
  betLimit?: string;

  @ApiProperty({
    description: 'Auto Bet Mode',
    maxLength: 10,
    example: '1',
    required: false,
  })
  @IsOptional()
  @IsString()
  autoBetMode?: string;

  @ApiProperty({
    description: 'Is Enable Jackpot',
    example: false,
    required: false,
  })
  @IsOptional()
  isEnableJackpot?: boolean;

  @ApiProperty({
    description: 'Landing Sport ID',
    maxLength: 50,
    example: '3',
    required: false,
  })
  @IsOptional()
  @IsString()
  landingSportId?: string;
}
