import { CloseDisputeUseCase } from '../close-dispute.usecase';
import { PrismaService } from '../../adapters/db/prisma.service';
import { AuditLogRepository } from '../../adapters/db/audit-log.repository';
import { DisputeNotFoundError, InvalidStateError } from '../../shared/errors';

const DISPUTE_ID = '00000000-0000-0000-0000-000000000001';
const ACTOR_USER_ID = 'user-admin';
const ACTOR_ROLES = ['admin'];
const TRACE_ID = 'trace-abc';

interface DisputeRow {
  id: string;
  status: string;
}

function makeTx(rows: DisputeRow[] = [{ id: DISPUTE_ID, status: 'OPEN' }]): {
  $queryRaw: jest.Mock;
  dispute: { update: jest.Mock };
} {
  const updated: DisputeRow = { id: DISPUTE_ID, status: 'CLOSED' };
  return {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    dispute: {
      update: jest.fn().mockResolvedValue(updated),
    },
  };
}

function buildDeps(txRows: DisputeRow[] = [{ id: DISPUTE_ID, status: 'OPEN' }]): {
  useCase: CloseDisputeUseCase;
  prisma: { $transaction: jest.Mock };
  auditLogRepo: { create: jest.Mock };
  tx: ReturnType<typeof makeTx>;
} {
  const tx = makeTx(txRows);
  const prisma = {
    $transaction: jest.fn(
      async (
        cb: (txClient: unknown) => Promise<{ id: string; status: string }>,
        _opts?: { timeout?: number },
      ): Promise<{ id: string; status: string }> => {
        return cb(tx);
      },
    ),
  } as unknown as { $transaction: jest.Mock };

  const auditLogRepo = {
    create: jest.fn().mockResolvedValue({}),
  } as unknown as { create: jest.Mock };

  const useCase = new CloseDisputeUseCase(
    prisma as unknown as PrismaService,
    auditLogRepo as unknown as AuditLogRepository,
  );

  return { useCase, prisma, auditLogRepo, tx };
}

const baseInput = {
  disputeId: DISPUTE_ID,
  actorUserId: ACTOR_USER_ID,
  actorRoles: ACTOR_ROLES,
  traceId: TRACE_ID,
};

describe('CloseDisputeUseCase', () => {
  it('should use transaction timeout of 5000ms', async () => {
    const { useCase, prisma } = buildDeps();

    await useCase.execute(baseInput);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000 });
  });

  it('should throw InvalidStateError when dispute is already CLOSED', async () => {
    const { useCase } = buildDeps([{ id: DISPUTE_ID, status: 'CLOSED' }]);

    await expect(useCase.execute(baseInput)).rejects.toThrow(InvalidStateError);
  });

  it('should throw DisputeNotFoundError when dispute does not exist', async () => {
    const { useCase } = buildDeps([]);

    await expect(useCase.execute(baseInput)).rejects.toThrow(DisputeNotFoundError);
  });
});
