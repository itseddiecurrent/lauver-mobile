import { Prisma } from '@prisma/client';

export function visibleUserWhere(viewerId: string): Prisma.UserWhereInput {
  return { status: 'ACTIVE', outgoingBlocks: { none: { blockedId: viewerId } }, incomingBlocks: { none: { blockerId: viewerId } } };
}

export function noBlockSQL(viewerId: string, target: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = ${target})
       OR (b.blocked_id = ${viewerId}::uuid AND b.blocker_id = ${target}))`;
}
