export interface ProfileEntity {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  createdAt: Date;
  updatedAt: Date;
}
