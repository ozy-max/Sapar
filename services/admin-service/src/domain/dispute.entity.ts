export type DisputeType = 'NO_SHOW' | 'OTHER';
export type DisputeStatus = 'OPEN' | 'RESOLVED' | 'CLOSED';
export type DisputeResolution = 'REFUND' | 'NO_REFUND' | 'PARTIAL' | 'BAN_USER';

export interface DisputeEntity {
  id: string;
  type: DisputeType;
  bookingId: string;
  departAt: Date;
  evidenceUrls: string[];
  status: DisputeStatus;
  resolution?: DisputeResolution | null;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
