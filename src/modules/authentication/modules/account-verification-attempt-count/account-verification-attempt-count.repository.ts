import moment from 'moment';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../@global/prisma/prisma.service';
import { AccountVerificationAttemptCount } from '@prisma/client';
import { AccVerifyAttemptCountCreate, AccVerifyAttemptCountUpdate } from './account-verification-attempt-count.type';

@Injectable()
export class AccountVerificationAttemptCountRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(params: AccVerifyAttemptCountCreate): Promise<AccountVerificationAttemptCount> {
    const { accountVerificationId } = params;

    return this.prismaService.accountVerificationAttemptCount.create({
      data: {
        accountVerificationId,
      },
    });
  }
  async getByAccountVerificationId(accountVerificationId: number): Promise<AccountVerificationAttemptCount | null> {
    return this.prismaService.accountVerificationAttemptCount.findUnique({
      where: {
        accountVerificationId,
        deletedAt: null,
      },
    });
  }

  async updateById(id: number, params: AccVerifyAttemptCountUpdate): Promise<AccountVerificationAttemptCount | null> {
    const { count, countIncreaseLastUpdateDate } = params;

    return this.prismaService.accountVerificationAttemptCount.update({
      where: {
        id,
      },
      data: {
        count,
        countIncreaseLastUpdateDate,
      },
    });
  }

  async softDelete(id: number) {
    return this.prismaService.accountVerificationAttemptCount.update({
      where: { id },
      data: { deletedAt: moment().toDate() },
    });
  }
}