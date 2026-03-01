export interface AuditLogEntity {
  id: string;
  actorUserId: string;
  actorRoles: string[];
  action: string;
  targetType: string;
  targetId: string;
  payloadJson?: unknown;
  traceId: string;
  createdAt: Date;
}
